"""UrbanFlood Nowcast API. Run: uvicorn app:app --reload --port 8000  (from backend/)"""
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import model
from config import city_index, get_city

app = FastAPI(title="UrbanFlood Nowcast API", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

LAYERS = {"roads", "waterways", "drainage_nodes", "drainage_pipes", "historical_spots"}
REAL, REPR, SIM = "REAL", "REPRESENTATIVE", "SIMULATED"


def provenance(city):
    hs = city.cfg.get("historical_spots", {})
    items = [
        dict(layer="Elevation & slope", cls=REAL, source="SRTM 1-arcsec (NASA/USGS) via AWS Terrain Tiles",
             detail=f"Aggregated to {int(city.cell_m)} m cells; SRTM is a surface model (includes buildings)",
             url="https://doi.org/10.1029/2005RG000183"),
        dict(layer="Land cover / imperviousness", cls=REAL, source="ESA WorldCover 10 m v200 (2021)",
             detail="Built-up fraction used as imperviousness proxy; curve numbers from NRCS tables (soil group D assumed)",
             url="https://doi.org/10.5281/zenodo.7254221"),
        dict(layer="Roads & waterways", cls=REAL, source="OpenStreetMap contributors (ODbL)",
             detail="Motorway–secondary roads; rivers, streams, canals, drains", url="https://www.openstreetmap.org/copyright"),
        dict(layer="Historical flooding spots", cls=REAL, source=hs.get("label", "—"),
             detail="Public secondary source; locations only (no dates or depths)", url=hs.get("page")),
        dict(layer="Spatial rainfall pattern", cls=REAL, source="CHIRPS v2.0 monthly, July 2019–2023 (0.05°)",
             detail="Long-term July totals, mean-normalised; distributes scenario/live intensity across the city",
             url="https://doi.org/10.1038/sdata.2015.66"),
        dict(layer="Live rainfall (Observed/Forecast mode)", cls=REAL, source="Open-Meteo hourly precipitation",
             detail="Numerical weather model output at the city centre, spread by the CHIRPS pattern — not gauge or radar observation",
             url="https://doi.org/10.5281/zenodo.7970649"),
        dict(layer="Drainage network (nodes, conduits, capacities)", cls=REPR,
             source="Generated from DEM + land cover (prep/05_drainage.py)",
             detail=city.cfg["drainage"]["note"] + "; NOT the municipal network", url=None),
        dict(layer="Drain blockage", cls=SIM, source="Seeded Beta(2,8) baseline + scenario slider", detail="Mean 20% baseline", url=None),
        dict(layer="Scenario rainfall hyetographs", cls=SIM, source="Design storms (model.py)", detail="City-mean intensity, spread by the CHIRPS pattern", url=None),
    ]
    if city.cfg.get("coastal"):
        items.append(dict(layer="Tide at outfalls", cls=SIM, source="Representative M2 (12.42 h) sinusoid",
                          detail=city.cfg["tide"]["note"], url=None))
    items.append(dict(layer="Water depth, risk score, lead time", cls=SIM, source="Model output (model.py)",
                      detail="Prototype estimates; not validated against observed depths", url=None))
    return items


def city_or_404(city_id):
    try:
        return get_city(city_id)
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.get("/api/cities")
def cities():
    out = []
    for c in city_index():
        if c["status"] == "ready":
            cfg = get_city(c["id"]).cfg
            c = dict(c, bbox=cfg["bbox"], map=cfg["map"])
        out.append(c)
    return out


@app.get("/api/cities/{city_id}/meta")
def meta(city_id: str):
    C = city_or_404(city_id)
    return dict(id=C.id, name=C.cfg["name"], region=C.cfg["region"], timezone=C.cfg["timezone"],
                bbox=C.bbox, map=C.cfg["map"], coastal=bool(C.cfg.get("coastal")), drainage=C.cfg["drainage"],
                grid=dict(nx=C.nx, ny=C.ny, dlat=C.dlat, dlon=C.dlon, cell_m=C.cell_m),
                layers=sorted(l for l in LAYERS if (C.proc / f"{l}.geojson").exists()),
                model=model.model_card(), provenance=provenance(C))


@app.get("/api/cities/{city_id}/layers/{name}")
def layer(city_id: str, name: str):
    C = city_or_404(city_id)
    f = C.proc / f"{name}.geojson"
    if name not in LAYERS or not f.exists():
        raise HTTPException(404, "layer not available")
    return FileResponse(f, media_type="application/geo+json")


_live_cache: dict = {}


def live_rain(C):
    """Open-Meteo hourly precipitation: 6 past hours + 3 forecast hours at the city centre."""
    hit = _live_cache.get(C.id)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    lon, lat = C.cfg["map"]["center"]
    r = requests.get("https://api.open-meteo.com/v1/forecast", timeout=15, params=dict(
        latitude=lat, longitude=lon, hourly="precipitation", past_hours=model.HIST_HOURS,
        forecast_hours=model.FCST_HOURS, timezone=C.cfg["timezone"]))
    r.raise_for_status()
    h = r.json()["hourly"]
    vals = tuple(float(v or 0.0) for v in h["precipitation"])[: model.HIST_HOURS + model.FCST_HOURS]
    if len(vals) != model.HIST_HOURS + model.FCST_HOURS:
        raise ValueError("unexpected Open-Meteo response length")
    res = dict(hourly=vals, times=h["time"][: len(vals)], fetched=datetime.now(timezone.utc).isoformat())
    _live_cache[C.id] = (time.time(), res)
    return res


def scenario_from(C, source, preset, multiplier, blockage, tide):
    if tide not in model.TIDES or (source == "scenario" and preset not in model.SCENARIOS):
        raise HTTPException(400, "unknown preset or tide")
    info = dict(source=source, status="DEMO")
    hourly = None
    if source == "live":
        try:
            lr = live_rain(C)
        except Exception as e:  # noqa: BLE001 -- report and let UI fall back
            raise HTTPException(503, f"live rainfall unavailable: {e}")
        hourly = lr["hourly"]; info.update(status="LIVE", live=lr)
    return model.Scenario(preset if source == "scenario" else "live", multiplier, blockage, tide, hourly), info


@app.get("/api/cities/{city_id}/nowcast")
def nowcast(city_id: str, source: str = Query("scenario", pattern="^(scenario|live)$"), preset: str = "heavy",
            multiplier: float = Query(1.0, ge=0.25, le=3.0), blockage: float = Query(0.0, ge=0.0, le=0.8),
            tide: str = "high"):
    C = city_or_404(city_id)
    sc, info = scenario_from(C, source, preset, multiplier, blockage, tide)
    out = model.summary(city_id, sc)
    out.update(info, generated=datetime.now(ZoneInfo(C.cfg["timezone"])).isoformat(timespec="seconds"))
    return out


@app.get("/api/cities/{city_id}/cell/{cell}")
def cell(city_id: str, cell: int, source: str = Query("scenario", pattern="^(scenario|live)$"), preset: str = "heavy",
         multiplier: float = Query(1.0, ge=0.25, le=3.0), blockage: float = Query(0.0, ge=0.0, le=0.8),
         tide: str = "high"):
    C = city_or_404(city_id)
    sc, _ = scenario_from(C, source, preset, multiplier, blockage, tide)
    try:
        return model.cell_detail(city_id, sc, cell)
    except KeyError as e:
        raise HTTPException(404, str(e))
