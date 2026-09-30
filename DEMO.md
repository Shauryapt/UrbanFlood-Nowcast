# Demo script (under 2 minutes)

Before starting, run both servers and open http://localhost:3000 once so the dev build is warm.

| # | Action | Say |
|---|---|---|
| 1 | Dashboard open. Study area is **Mumbai** and status is **DEMO**. | "UrbanFlood Nowcast is study-area agnostic. Mumbai is the configured demonstration city; Delhi, Bengaluru, Kolkata and Chennai are next, and adding one is configuration plus data." |
| 2 | Point to the **timeline**. | "Six hours of antecedent rain, then the next three. The dashed line is Mumbai's 25 mm/h legacy drain design. Rain is already above it, and the orange line counts cells at High or Severe." |
| 3 | Map at **NOW**. | "This is the 0–3 hour flood-risk map on a 300 m grid, coupled to a drainage digital twin. Rings are our model hotspots and white circles are publicly reported chronic flooding spots." |
| 4 | Click the top alert, **Near Jai Prakash Road**. | "Predicted depth, lead time, drainage utilisation, blockage, elevation, imperviousness." |
| 5 | Point to **Contributing factors**. | "The score is additive, so these bars are exact contributions and they sum to the score. Here: ponding depth, a surcharged drain and rainfall intensity." |
| 6 | Drag **Rainfall multiplier** to ×0.5, then to ×1.5. | "Halve the rain and alerts at +2 h drop from about 390 zones to about 20. Push it up and they spread." |
| 7 | Set **Tide** to Low, then back to High, and raise **Added drain blockage**. | "Tide throttles the sea outfalls, and blockage cuts conduit capacity. This is the drainage–rainfall coupling the problem statement asks for." |
| 8 | Step through the 15-minute timeline (**NOW, +15, +30 … +180**), or press **Play**. | "The model runs in 15-minute steps. Risk peaks around +2 h (+120 min) and eases by +180 min as rain and tide fall. The map, street status and alert list update at each step." |
| 9 | Switch to **Observed / Forecast**. | "Live mode pulls Open-Meteo hourly rainfall, the past 6 h and next 3 h, and the status changes to LIVE." |
| 10 | Open **Data provenance**. | "Every layer is tagged Real, Representative or Simulated. Terrain, land cover, roads, CHIRPS rainfall and the historical spots are real public data. The drainage network is representative, not the municipal network, and depths are prototype estimates." |

**If asked "is it validated?":** "No. There's a plausibility check against historical spots in the README, including an ablation that removes the circular historical factor. Real validation needs observed inundation extents, for example Sentinel-1 flood maps."
