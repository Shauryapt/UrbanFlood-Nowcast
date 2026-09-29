"""Plausibility check: do model High/Severe cells coincide with publicly reported chronic flooding spots?

This is NOT validation (no observed depths / extents). Because proximity to historical spots is itself a
model factor, the check is repeated with that factor's weight set to zero (ablation) to remove circularity.
Metric: hit rate = share of spots whose nearest modelled cell is High/Severe; lift = hit rate / share of all
modelled cells that are High/Severe (1.0 = no better than chance).
Usage: python eval/check_hotspots.py [city_id]  -> prints a Markdown table
"""
import json, sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import model
from config import city_from_argv, KY

sys.stdout.reconfigure(encoding="utf-8")
C = city_from_argv()
m = model.CityModel(C)
spots = np.array([f["geometry"]["coordinates"] for f in
                  json.loads((C.proc / "historical_spots.geojson").read_text())["features"]])
cc = np.array([C.cell_center(*divmod(int(c), C.nx)) for c in m.idx])
d = np.hypot((cc[:, None, 0] - spots[None, :, 0]) * C.kx, (cc[:, None, 1] - spots[None, :, 1]) * KY)
spot_cell = d.argmin(0)
spot_ok = d.min(0) <= C.cell_m          # spot falls on a modelled land cell

base_factors = list(model.FACTORS)
rows = []
for label, hist_w in (("full model", None), ("without historical factor", 0.0)):
    model.FACTORS = [(k, l, (hist_w if (k == "hist" and hist_w is not None) else w)) for k, l, w in base_factors]
    for preset in ("moderate", "heavy", "extreme"):
        r = m.run(model.Scenario(preset, 1.0, 0.0, "high"))
        f = r["frames"][model.HOURLY_FRAMES[2]]       # +2 h
        hi = f["cls"] >= 2
        hit = hi[spot_cell[spot_ok]].mean(); base = hi.mean()
        deep = f["depth"] >= 0.15
        rows.append((label, preset, int(spot_ok.sum()), hit, base, hit / base if base else float("nan"),
                     deep[spot_cell[spot_ok]].mean(), deep.mean()))
model.FACTORS = base_factors

print(f"### {C.cfg['name']}: model High/Severe at +2 h (high tide) vs {len(spots)} historical flooding spots\n")
print("| Model | Scenario | Spots on land | Spot hit rate | Area share High+ | Lift | Spots ≥15 cm | Area share ≥15 cm |")
print("|---|---|---|---|---|---|---|---|")
for lab, p, n, h, b, lift, dh, db in rows:
    print(f"| {lab} | {p} | {n} | {h:.0%} | {b:.0%} | {lift:.1f}× | {dh:.0%} | {db:.0%} |")
