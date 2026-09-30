"""API contract tests: status codes and the response fields the frontend depends on."""
from conftest import CITY, HEAVY

CLASSES = ["Low", "Moderate", "High", "Severe"]
DATA_CLASSES = {"REAL", "REPRESENTATIVE", "SIMULATED"}


def test_cities(client):
    r = client.get("/api/cities")
    assert r.status_code == 200
    cities = {c["id"]: c for c in r.json()}
    assert cities[CITY]["status"] == "ready"
    assert {"west", "south", "east", "north"} <= set(cities[CITY]["bbox"])
    assert {"center", "zoom"} <= set(cities[CITY]["map"])
    for c in cities.values():
        assert c["status"] in ("ready", "planned")


def test_meta(meta):
    assert meta["id"] == CITY
    for k in ("name", "region", "timezone", "bbox", "map", "coastal", "drainage", "grid", "layers", "model", "provenance"):
        assert k in meta
    assert meta["grid"]["nx"] * meta["grid"]["ny"] > 0
    assert {"roads", "waterways", "drainage_nodes", "drainage_pipes", "historical_spots"} <= set(meta["layers"])
    m = meta["model"]
    assert m["classes"] == CLASSES
    assert {"moderate", "heavy", "extreme"} <= set(m["scenarios"])
    assert set(m["tides"]) == {"low", "rising", "high"}
    assert abs(sum(f["weight"] for f in m["factors"]) - 1.0) < 1e-9


def test_meta_provenance_classes(meta):
    prov = meta["provenance"]
    assert {p["cls"] for p in prov} == DATA_CLASSES
    for p in prov:
        assert p["cls"] in DATA_CLASSES and p["layer"] and p["source"]
    by_layer = {p["layer"]: p["cls"] for p in prov}
    drainage = [cls for layer, cls in by_layer.items() if layer.startswith("Drainage network")]
    assert drainage == ["REPRESENTATIVE"]
    assert by_layer["Water depth, risk score, lead time"] == "SIMULATED"
    assert by_layer["Elevation & slope"] == "REAL"


def _layer(client, name):
    r = client.get(f"/api/cities/{CITY}/layers/{name}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/geo+json")
    fc = r.json()
    assert fc["type"] == "FeatureCollection" and fc["features"]
    return fc


def test_layer_roads(client):
    fc = _layer(client, "roads")
    assert all(f["geometry"]["type"] == "LineString" for f in fc["features"])
    assert all("highway" in f["properties"] and "name" in f["properties"] for f in fc["features"])


def test_layer_drainage_nodes(client):
    fc = _layer(client, "drainage_nodes")
    assert all(f["geometry"]["type"] == "Point" for f in fc["features"])
    for f in fc["features"]:
        p = f["properties"]
        assert {"id", "type", "down", "capacity_m3s", "blockage", "pipe_d_m"} <= set(p)
        assert p["type"] in ("outfall", "junction", "inlet")


def test_layer_drainage_pipes(client):
    fc = _layer(client, "drainage_pipes")
    assert all(f["geometry"]["type"] == "LineString" for f in fc["features"])
    assert all({"id", "to", "d_m", "outfall", "capacity_m3s"} <= set(f["properties"]) for f in fc["features"])


def test_nowcast_heavy_shape(heavy):
    for k in ("city", "cells", "frames", "lead_min", "node_blockage", "rain_hourly", "rain_hours", "alerts",
              "source", "status", "generated"):
        assert k in heavy
    assert heavy["city"] == CITY and heavy["source"] == "scenario" and heavy["status"] == "DEMO"
    n = len(heavy["cells"])
    assert n > 0 and len(heavy["lead_min"]) == n
    assert heavy["rain_hours"] == list(range(-6, 3)) and len(heavy["rain_hourly"]) == 9


def test_nowcast_exposes_four_hourly_frames(heavy):
    assert [f["t_min"] for f in heavy["frames"]] == [0, 60, 120, 180]
    assert len(heavy["alerts"]) == 4
    assert [a["t_min"] for a in heavy["alerts"]] == [0, 60, 120, 180]


def test_nowcast_frame_fields(heavy):
    n = len(heavy["cells"]); nn = len(heavy["node_blockage"])
    for f in heavy["frames"]:
        for k in ("score", "cls", "depth_cm", "rain"):
            assert len(f[k]) == n, k
        assert len(f["node_util"]) == nn
        assert len(f["counts"]) == 4 and sum(f["counts"]) == n
        assert set(f["cls"]) <= {0, 1, 2, 3}
        assert all(0 <= s <= 100 for s in f["score"])
        assert min(f["depth_cm"]) >= 0
        assert -1.0 <= f["tide"] <= 1.0
        assert [f["cls"].count(c) for c in range(4)] == f["counts"]


def test_nowcast_alerts_reference_valid_cells_and_nodes(heavy):
    cells = set(heavy["cells"]); nn = len(heavy["node_blockage"])
    for a in heavy["alerts"]:
        assert a["total"] >= len(a["items"])
        for it in a["items"]:
            assert it["cell"] in cells
            assert 0 <= it["node"] < nn
            assert it["cls"] in ("High", "Severe")


def test_cell_detail(client, alert_cell):
    r = client.get(f"/api/cities/{CITY}/cell/{alert_cell}", params=HEAVY)
    assert r.status_code == 200
    d = r.json()
    assert d["cell"] == alert_cell
    assert len(d["timeline"]) == 4
    assert [t["t_min"] for t in d["timeline"]] == [0, 60, 120, 180]
    for k in ("elev_m", "slope_deg", "imperv_pct", "curve_number", "hand_m", "dist_hist_m"):
        assert k in d["static"]
    for k in ("id", "type", "capacity_m3s", "pipe_d_m", "barrels", "blockage_pct", "acc_area_km2"):
        assert k in d["node"]
    for t in d["timeline"]:
        assert t["cls"] in CLASSES
        assert len(t["contributions"]) == 10
        # each contribution is rounded to 0.1, so allow the accumulated rounding error
        assert abs(sum(c["points"] for c in t["contributions"]) - t["score"]) <= 0.6


def test_cell_detail_matches_nowcast(client, heavy, alert_cell):
    d = client.get(f"/api/cities/{CITY}/cell/{alert_cell}", params=HEAVY).json()
    k = heavy["cells"].index(alert_cell)
    for f, t in zip(heavy["frames"], d["timeline"]):
        assert CLASSES[f["cls"][k]] == t["cls"]
        assert abs(f["score"][k] - t["score"]) <= 0.5 + 1e-9
    assert heavy["lead_min"][k] == d["lead_min"]


def test_cell_not_modelled_returns_404(client):
    # cell 0 is the NW corner of the grid, which lies over the sea
    r = client.get(f"/api/cities/{CITY}/cell/0", params=HEAVY)
    assert r.status_code == 404


def test_unknown_city_404(client):
    assert client.get("/api/cities/atlantis/meta").status_code == 404
    assert client.get("/api/cities/atlantis/nowcast").status_code == 404
    assert client.get("/api/cities/atlantis/layers/roads").status_code == 404


def test_unknown_layer_404(client):
    assert client.get(f"/api/cities/{CITY}/layers/not_a_layer").status_code == 404
    # processed files that exist but are not whitelisted layers stay private
    assert client.get(f"/api/cities/{CITY}/layers/dem_grid").status_code == 404


def test_bad_scenario_params_rejected(client):
    assert client.get(f"/api/cities/{CITY}/nowcast", params=dict(HEAVY, preset="nope")).status_code == 400
    assert client.get(f"/api/cities/{CITY}/nowcast", params=dict(HEAVY, tide="nope")).status_code == 400
    assert client.get(f"/api/cities/{CITY}/nowcast", params=dict(HEAVY, multiplier=10)).status_code == 422
