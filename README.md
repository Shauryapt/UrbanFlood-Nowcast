# UrbanFlood Nowcast

**Urban Flood Intelligence & 0–3 Hour Nowcasting.** A research prototype for SIH 2026 problem statement **SIH26085: Urban Flood Nowcasting System (Drainage and Rainfall Coupling)**.

Short, intense monsoon rainfall regularly overwhelms urban storm-water drainage, and flooding builds within hours. UrbanFlood Nowcast couples rainfall forcing, surface runoff and a drainage-network model to estimate where flooding is likely over the next 0–3 hours, and explains why each location is at risk.

The platform is designed to be **city-agnostic**: a study area is a configuration file plus a processed-data folder, and the frontend does not change. **Mumbai** is the demonstration study area because public data and published research are available for it.

> **Prototype.** The drainage network is **representative**, not the municipal storm-water network. Depths, risk scores, street status and guidance are model estimates. They are not official measurements and have not been validated as operational forecasts. See [Limitations](#limitations).

---

## Core features

- **Rainfall-driven 0–3 h nowcast.** Uses a design storm or live Open-Meteo hourly rainfall (6 h antecedent plus 3 h ahead).
- **15-minute model timeline.** Steps are NOW, +15, +30 … +180 min, the model's native timestep. Play steps through all 13 frames.
- **Flood risk map.** Risk class, predicted depth, rainfall, elevation and imperviousness on a 300 m grid, with model hotspot alerts.
- **Street flood status.** The modelled grid is sampled onto OpenStreetMap road segments: CLEAR, CAUTION, HIGH RISK or ROAD CLOSURE RISK, using the model's depth thresholds.
- **Drainage-aware modelling.** Node utilisation, surcharge, blockage and tide throttling of sea outfalls on a representative drainage network.
- **Historical flood context.** Publicly reported chronic flooding spots are shown on the map and used as a risk factor.
- **Operational alerts.** One alert per drainage zone at High or Severe, with lead time. Each has a response label (PREPARE RESPONSE / PRIORITY RESPONSE) and recommended response categories.
- **Operational modes: Emergency / Transit / Navigation.** Each mode changes how the modelled street status is prioritised in the guidance text. They do not route.
- **Scenario controls.** Rainfall multiplier, added drain blockage and tide state, plus a baseline comparison.
- **Inspection.** Click a cell for depth, lead time and the exact per-factor score breakdown. Click a road for its derived status over the 15-minute timeline.
- **Data provenance panel.** Every layer is tagged Real, Representative or Simulated.

## Architecture

```
backend/                     FastAPI + numpy (no database, no cache server)
  app.py                     API endpoints
  config.py                  study-area config (grid geometry, paths)
  model.py                   deterministic nowcast engine + explainable risk score
  streets.py                 derived street flood status (grid -> OSM road segments)
  timeline.py                15-min model frames from the same cached model run
  cities/index.json          study-area registry (Mumbai ready; others "planned")
  cities/mumbai.json         bbox, grid, map view, tide + drainage design params, historical-spot source
  prep/01_dem.py … 06_hotspots.py   data preparation (SRTM, WorldCover, OSM, CHIRPS, drainage, hotspots)
  eval/check_hotspots.py     plausibility check against historical spots
  data/cities/<id>/processed committed processed grids + GeoJSON (raw/ downloads are git-ignored)
  tests/                     pytest regression suite
  pytest.ini                 test configuration
  requirements.txt           runtime dependencies
  requirements-dev.txt       runtime + test dependencies (pytest, httpx)
frontend/                    Next.js + React + TypeScript + Tailwind, map rendering with MapLibre GL
  components/                Dashboard, MapView, Timeline, ControlPanel, IntelPanel, …
  lib/                       API client, types, metrics, 15-min series helpers, operational modes
```

The frontend calls relative `/api/...` URLs. `frontend/next.config.ts` rewrites these to the backend, which defaults to `http://127.0.0.1:8000` and can be overridden with the `API_ORIGIN` environment variable, so the browser only talks to the Next.js server. A nowcast request takes well under a second, and model runs are cached in-process per scenario.

### API endpoints

All scenario endpoints accept `source` (`scenario` or `live`), `preset` (`moderate`, `heavy` or `extreme`), `multiplier` (0.25–3), `blockage` (0–0.8) and `tide` (`low`, `rising` or `high`).

| Endpoint | Returns |
|---|---|
| `GET /api/cities` | Study-area registry |
| `GET /api/cities/{id}/meta` | Grid, map view, model card (factors, weights, thresholds, scenarios), provenance |
| `GET /api/cities/{id}/layers/{name}` | GeoJSON: `roads`, `waterways`, `drainage_nodes`, `drainage_pipes`, `historical_spots` |
| `GET /api/cities/{id}/static` | Per-cell elevation and imperviousness |
| `GET /api/cities/{id}/nowcast` | Hourly nowcast (NOW, +1, +2, +3 h): per-cell class, score, depth, rainfall; node utilisation; alerts; lead times |
| `GET /api/cities/{id}/nowcast/timeline` | All 13 native 15-min model frames from the same run |
| `GET /api/cities/{id}/cell/{cell}` | Cell explanation at the hourly steps (factor contributions, drainage node) |
| `GET /api/cities/{id}/cell/{cell}/timeline` | The same explanation at every 15-min step |
| `GET /api/cities/{id}/streets?frame=0..3` | Derived street flood status (GeoJSON) for one hourly step |
| `GET /api/cities/{id}/streets/status` | Compact per-segment status for the hourly steps |

## Method (`backend/model.py`)

The model runs a 6 h antecedent period followed by a 3 h nowcast, in 15-minute steps, on a 300 m grid (6,924 land cells) coupled to 511 drainage nodes.

1. **Rainfall.** The hourly intensity comes from a design storm or from live Open-Meteo data (6 h past plus 3 h forecast). It is multiplied by the scenario multiplier and distributed across the city by the CHIRPS July climatology pattern (mean 1). Each hour's intensity is held constant over its four 15-min steps.
2. **Runoff.** SCS Curve Number applied to event-cumulative rainfall. The CN is derived from the WorldCover class mix with an assumed hydrologic soil group D.
3. **Drainage coupling.**
   - Each cell drains to the node of its sub-catchment. Node inflow is local runoff plus upstream outflow.
   - Effective capacity is the full-pipe Manning capacity × (1 − blockage) × a tide factor (at outfalls) × a backwater factor (when the downstream node is surcharged).
   - Excess inflow goes to surcharge storage, and storage beyond the conduit volume floods the surface.
   - Surface water recedes with a lumped 90-minute time constant.
4. **Depth.** Surface flood volume is spread over the sub-catchment, weighted towards cells lying low relative to the drain node (a HAND-type weighting, `exp(−HAND/1.5 m)`).
5. **Risk score (0–100).** A weighted sum of ten normalised factors: rainfall intensity, cumulative rainfall, low elevation, local depression, flat terrain, imperviousness, historical flooding nearby, drainage utilisation, blockage, and ponding depth. The score is additive, so each factor's contribution is exact, and the UI shows them summing to the score.
6. **Class.** The higher of the score class (45 / 60 / 75) and the depth class (0.15 / 0.30 / 0.60 m).
7. **Lead time.** The first 15-minute step at which a cell reaches High.
8. **Street status.** Each OSM road segment takes the modelled depth and class of the 300 m cell it lies in. CLEAR / CAUTION / HIGH RISK / ROAD CLOSURE RISK use the same depth thresholds (0.15 / 0.30 / 0.60 m).

Weights, thresholds and time constants are set by expert judgement, not trained, and all of them are in `model.py`. The drainage design intensity (25 mm/h at low tide) comes from the MCGM storm-water drainage chapter cited in [REFERENCES.md](REFERENCES.md).

Flood states are generated by the prototype's 15-minute model timestep. Live weather-model input is refreshed/cached on a 10-minute cycle.

## Data provenance

Representative and simulated components are **not** official municipal measurements or records.

| Class | Component | Source / basis |
|---|---|---|
| **REAL / public data** | Elevation and slope | SRTM 1″ (NASA/USGS) via AWS Terrain Tiles |
| | Land cover, imperviousness proxy | ESA WorldCover 10 m 2021 v200 |
| | Roads and waterways | OpenStreetMap contributors (Overpass API) |
| | Spatial rainfall pattern | CHIRPS v2.0 monthly, July 2019–2023 |
| | Live rainfall input | Open-Meteo hourly precipitation. This is weather-model output at one point, not gauge or radar observation. |
| | Historical flooding spots (55) | "Chronic Flooding Spots" web map, cityresource.in. A **secondary, community-digitised source**: locations only, no dates or depths. |
| **REPRESENTATIVE** | Drainage nodes, conduits, sizes and capacities | A representative digital drainage network generated from terrain and land cover (`prep/05_drainage.py`). It is not the municipal storm-water network. |
| **SIMULATED / prototype** | Drain blockage | Seeded Beta(2,8) baseline plus scenario slider |
| | Tide at outfalls | Representative M2 sinusoid (low / rising / high scenarios) |
| | Design-storm hyetographs | Scenario presets in `model.py` |
| | Risk weights and thresholds | Expert-assigned, not trained |
| | Predicted depth, risk score, class, lead time | Model output |
| | Street flood status | Derived from the 300 m model grid |
| | Operational alert response guidance | Label from risk class; recommended categories only |
| | Operational mode guidance | Prioritisation text from modelled street status only |

The dashboard's **Data provenance** panel shows this classification for every layer. Full citations are in [REFERENCES.md](REFERENCES.md).

## Data licensing and attribution

- **Source code:** MIT License, see [LICENSE](LICENSE).
- **OpenStreetMap-derived data** (`roads.geojson`, `waterways.geojson`, `osm_grid.json` and the street segments derived from them): © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0), https://www.openstreetmap.org/copyright.
- **ESA WorldCover-derived data** (`landcover_grid.json` and the land-cover inputs to other grids): © ESA WorldCover project, contains modified Copernicus Sentinel data, licensed under CC BY 4.0. Cite Zanaga et al. (2022), https://doi.org/10.5281/zenodo.7254221.
- **SRTM, CHIRPS and Open-Meteo:** attributed and cited in [REFERENCES.md](REFERENCES.md).
- **Historical flooding spots (cityresource.in):** the source web map (https://cityresource.in/MumbaiFloods/) does not specify a clear redistribution licence in the material used for this prototype. The derived spot locations (`historical_spots.geojson`, `hist_grid.json`) are included with attribution only. No open-data licence is claimed for them.

## Setup (Windows, PowerShell)

Verified on a fresh clone with **Python 3.13.7** and **Node 22.19**.

Backend (terminal 1):

```powershell
git clone <repo-url> UrbanFlood
cd UrbanFlood\backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m uvicorn app:app --port 8000
```

Frontend (terminal 2):

```powershell
cd UrbanFlood\frontend
npm ci
npm run dev
```

Open http://localhost:3000. The UI runs on :3000 and proxies `/api` to the API on http://127.0.0.1:8000. The processed Mumbai data is committed, so the prep scripts are only needed to rebuild it. On Linux or macOS, use `.venv/bin/python` instead of `.venv\Scripts\python`.

## Testing

From `backend\`:

```powershell
.venv\Scripts\python -m pytest
```

The regression suite currently has **53 tests**. They cover the API contracts, heavy-scenario regression values, the 15-min timeline and the street flood status. They use only the committed data, and live mode is not called.

The plausibility check against historical spots is separate:

```powershell
.venv\Scripts\python eval\check_hotspots.py
```

### Plausibility check (not validation)

It compares model High/Severe cells at +2 h (high tide) with the 55 publicly reported chronic flooding spots. Proximity to those spots is itself a model factor, so the check is also run with that factor switched off.

| Model | Scenario | Spot hit rate | Area share High+ | Lift | Spots ≥15 cm | Area share ≥15 cm |
|---|---|---|---|---|---|---|
| full model | moderate | 0% | 0% | – | 0% | 1% |
| full model | heavy | 71% | 14% | 5.0× | 11% | 8% |
| full model | extreme | 75% | 23% | 3.2× | 25% | 19% |
| without historical factor | heavy | 13% | 9% | 1.4× | 11% | 8% |
| without historical factor | extreme | 22% | 19% | 1.2× | 25% | 19% |

**Reading it honestly.** The full model's hit rate is inflated by circularity. The physically based part (terrain, runoff, drainage) locates known spots only slightly better than chance at 300 m resolution. Many chronic spots are sub-grid features, such as subways and junction depressions, that a 30 m DEM aggregated to 300 m cannot resolve. The spots are also not an event record. Real validation would need observed inundation extents (e.g. Sentinel-1 flood maps) or gauge and depth reports for specific events.

## Limitations

- **Routing is not implemented.** Emergency / Transit / Navigation modes provide prioritisation guidance only. They do not compute routes or travel times.
- **No live service integration.** Nothing is connected to municipal, emergency, transit or navigation systems. Alert response categories are recommendations for the prototype, not dispatch instructions.
- **Street status is derived from the 300 m model grid.** It is not measured street water depth or an official road status.
- **The drainage network is representative,** not the official municipal storm-water network. The municipal asset data would replace `prep/05_drainage.py` output directly.
- **Predictions have not been validated.** They are prototype estimates, not validated operational forecasts. See the plausibility check above.
- SRTM is a surface model (it includes buildings and vegetation) at 30 m. A LiDAR DTM would change depths substantially.
- Rainfall input is hourly and not spatially dynamic; only its long-term pattern varies across the city. Radar nowcasts or IMERG would be the operational forcing.
- Live mode uses weather-model precipitation at a single point (Open-Meteo), not observations.
- Tide is a representative sinusoid, not predicted tide tables.
- The model has no 2D overland flow routing. Surface water stays within its sub-catchment and recedes with a lumped constant.

## Adding a study area

1. Add `backend/cities/<id>.json` (copy `mumbai.json`; set the bbox, map view, `coastal`, drainage design intensity and a historical-spots source), and set its status to `ready` in `cities/index.json`.
2. Run `python prep/01_dem.py <id>`, then `02_worldcover`, `03_osm`, `04_chirps`, `05_drainage` and `06_hotspots` with the same argument.
3. Restart the API. The city appears in the study-area selector.

The prototype currently supports northern/eastern-hemisphere study areas that fit within a single 3° WorldCover tile.

## Documentation

- [DEMO.md](DEMO.md): a two-minute demo script
- [REFERENCES.md](REFERENCES.md): datasets and literature, with verified DOIs
