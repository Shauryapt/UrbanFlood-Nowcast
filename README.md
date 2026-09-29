# UrbanFlood Nowcast

**Urban Flood Intelligence & 0–3 Hour Nowcasting**. A prototype for SIH 2026 problem statement **SIH26085: Urban Flood Nowcasting System (Drainage and Rainfall Coupling)**.

This is a study-area-agnostic platform. It couples rainfall forcing, surface runoff and a drainage-network digital twin to produce an explainable 0–3 hour flood-risk nowcast. **Mumbai** is the demonstration study area, chosen because public data and published research are available for it. Adding another city is a configuration and data task; the frontend does not change.

> **Prototype.** The drainage network is **representative**: generated from terrain and land cover, and **not** the municipal storm-water network. Environmental layers use public data. Depths and risk scores are model estimates and have not been validated against observed flooding.

---

## Run

Requirements: Python 3.11+ and Node 20+.

```bash
# backend (API on :8000)
cd backend
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt   # (Linux/macOS: .venv/bin/python)
.venv/Scripts/python -m uvicorn app:app --port 8000

# frontend (UI on :3000, proxies /api to :8000)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The processed Mumbai data is committed in `backend/data/cities/mumbai/processed/`, so the prep scripts only need to run again to rebuild it.

## Architecture

```
backend/
  cities/index.json        study-area registry (Mumbai ready; others "planned")
  cities/mumbai.json       bbox, grid, map view, tide + drainage design params, historical-spot source
  prep/01_dem.py           SRTM 1" -> elevation, slope per 300 m cell
  prep/02_worldcover.py    ESA WorldCover -> imperviousness proxy, SCS curve number, land mask
  prep/03_osm.py           OpenStreetMap roads + waterways (Overpass)
  prep/04_chirps.py        CHIRPS July climatology -> spatial rainfall pattern
  prep/05_drainage.py      REPRESENTATIVE drainage digital twin (nodes, conduits, capacities)
  prep/06_hotspots.py      historical flooding spots -> proximity factor
  model.py                 deterministic nowcast engine + explainability
  app.py                   FastAPI: /api/cities, /meta, /layers, /nowcast, /cell
  eval/check_hotspots.py   plausibility check vs historical spots
  data/cities/<id>/        raw/ (git-ignored downloads), processed/ (grids + GeoJSON)
frontend/                  Next.js + TypeScript + Tailwind + MapLibre GL
```

There is no database and no cache server. A nowcast request takes well under a second (about 0.1–0.6 s locally). Results are memoised in-process per scenario.

## Method (`backend/model.py`)

The model runs a 6 h antecedent period followed by a 3 h nowcast, in 15-minute steps, on a 300 m grid (6,924 land cells) coupled to 511 drainage nodes.

1. **Rainfall.** The hourly intensity comes from a design storm or from live Open-Meteo data (6 h past plus 3 h forecast). It is multiplied by the scenario multiplier and distributed across the city by the CHIRPS July climatology pattern (mean 1).
2. **Runoff.** SCS Curve Number applied to event-cumulative rainfall. The CN is derived from the WorldCover class mix with an assumed hydrologic soil group D.
3. **Drainage coupling.**
   - Each cell drains to the node of its sub-catchment. Node inflow is local runoff plus upstream outflow.
   - Effective capacity is the full-pipe Manning capacity × (1 − blockage) × a tide factor (at outfalls) × a backwater factor (when the downstream node is surcharged).
   - Excess inflow goes to surcharge storage, and storage beyond the conduit volume floods the surface.
   - Surface water recedes with a lumped 90-minute time constant.
4. **Depth.** Surface flood volume is spread over the sub-catchment, weighted towards cells lying low relative to the drain node (a HAND-type weighting, `exp(−HAND/1.5 m)`).
5. **Risk score (0–100).** A weighted sum of ten normalised factors: rainfall intensity, cumulative rainfall, low elevation, local depression, flat terrain, imperviousness, historical flooding nearby, drainage utilisation, blockage, and ponding depth. The score is additive, so **each factor's contribution is exact**, and the UI shows them summing to the score.
6. **Class.** The higher of the score class (45 / 60 / 75) and the depth class (0.15 / 0.30 / 0.60 m).
7. **Lead time.** The first 15-minute step at which a cell reaches High.

Weights, thresholds and time constants are set by expert judgement, not trained, and all of them are in `model.py`. The drainage design intensity (25 mm/h at low tide) comes from the MCGM storm-water drainage chapter cited in [REFERENCES.md](REFERENCES.md).

## Real vs representative vs simulated

| REAL (public data) | REPRESENTATIVE | SIMULATED |
|---|---|---|
| SRTM 1″ elevation, slope | Drainage nodes, conduits, sizes, capacities | Drain blockage (seeded Beta(2,8) + slider) |
| ESA WorldCover 2021 land cover | | Design-storm hyetographs |
| OpenStreetMap roads, waterways | | Tide at outfalls (M2 sinusoid) |
| CHIRPS July 2019–2023 rainfall pattern | | Depth, risk score, lead time (model output) |
| Open-Meteo hourly rainfall (weather-model data) | | |
| 55 historical flooding spots (community-digitised web map) | | |

The dashboard's **Data provenance** panel shows the same classification for every layer.

## Plausibility check (not validation)

Command, from `backend/`: `.venv/Scripts/python eval/check_hotspots.py`. It compares model High/Severe cells at +2 h (high tide) with the 55 publicly reported chronic flooding spots. Proximity to those spots is itself a model factor, so the check is also run with that factor switched off.

| Model | Scenario | Spot hit rate | Area share High+ | Lift | Spots ≥15 cm | Area share ≥15 cm |
|---|---|---|---|---|---|---|
| full model | moderate | 0% | 0% | – | 0% | 1% |
| full model | heavy | 71% | 14% | 5.0× | 11% | 8% |
| full model | extreme | 75% | 23% | 3.2× | 25% | 19% |
| without historical factor | heavy | 13% | 9% | 1.4× | 11% | 8% |
| without historical factor | extreme | 22% | 19% | 1.2× | 25% | 19% |

**Reading it honestly.** The full model's hit rate is inflated by circularity. The physically based part (terrain, runoff, drainage) locates known spots only slightly better than chance at 300 m resolution. Many chronic spots are sub-grid features, such as subways and junction depressions, that a 30 m DEM aggregated to 300 m cannot resolve. The spots are also not an event record. Real validation would need observed inundation extents (e.g. Sentinel-1 flood maps) or gauge and depth reports for specific events.

## Known limitations

- The drainage network is representative, not the MCGM network. The municipal asset data would replace `prep/05_drainage.py` output directly.
- SRTM is a surface model (it includes buildings and vegetation) at 30 m. A LiDAR DTM would change depths substantially.
- Rainfall in the scenarios is not spatially dynamic; only its long-term pattern varies across the city. Radar nowcasts or IMERG would be the operational forcing.
- Live mode uses weather-model precipitation at a single point (Open-Meteo), not observations.
- Tide is a representative sinusoid, not predicted tide tables.
- The model has no 2D overland flow routing. Surface water stays within its sub-catchment and recedes with a lumped constant.

## Adding a study area

1. Add `backend/cities/<id>.json` (copy `mumbai.json`; set bbox, map view, `coastal`, drainage design intensity and a historical-spots source), and set its status to `ready` in `cities/index.json`.
2. Run `python prep/01_dem.py <id>`, then `02_worldcover`, `03_osm`, `04_chirps`, `05_drainage` and `06_hotspots` with the same argument.
3. Restart the API. The city appears in the study-area selector.

The prototype currently supports northern/eastern-hemisphere study areas that fit within a single 3° WorldCover tile.

## References

See [REFERENCES.md](REFERENCES.md). Every DOI was resolved via doi.org / Crossref.
