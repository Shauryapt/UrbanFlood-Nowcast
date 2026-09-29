"""Publicly reported historical flooding spots -> point GeoJSON + per-cell proximity kernel.

Source is configured per city (cities/<id>.json -> historical_spots). Mumbai: community-digitised
"Chronic Flooding Spots" web map (cityresource.in, 55 buffer circles; centroids used as spot locations).
Original compilation source is not stated on that page, so it is labelled a public secondary source.
Usage: python prep/06_hotspots.py [city_id]
"""
import json, sys
from pathlib import Path
import numpy as np, requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import city_from_argv, KY

KERNEL_M = 500.0  # Gaussian length scale of proximity-to-known-flooding kernel (assumption)


def parse_qgis2web_buffers(text):
    fc = json.loads(text[text.index("{"):text.rindex("}") + 1])
    pts = []
    for feat in fc["features"]:
        g = feat["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        pts += [np.array(p[0][:-1]).mean(0) for p in polys]
    return np.array(pts)


PARSERS = {"qgis2web_buffers": parse_qgis2web_buffers}


def main():
    C = city_from_argv(); C.ensure_dirs()
    src = C.cfg["historical_spots"]
    f = C.raw / "historical_spots.src"
    if not f.exists():
        r = requests.get(src["url"], timeout=60); r.raise_for_status()
        f.write_text(r.text, encoding="utf-8")
    pts = PARSERS[src["format"]](f.read_text(encoding="utf-8"))
    gj = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(x, 5), round(y, 5)]},
         "properties": {"id": i + 1}} for i, (x, y) in enumerate(pts)]}
    (C.proc / "historical_spots.geojson").write_text(json.dumps(gj, separators=(",", ":")))

    cc = np.array([C.cell_center(r, c) for r in range(C.ny) for c in range(C.nx)])
    d = np.hypot((cc[:, None, 0] - pts[None, :, 0]) * C.kx, (cc[:, None, 1] - pts[None, :, 1]) * KY)
    kern = np.clip(np.exp(-0.5 * (d / KERNEL_M) ** 2).sum(1), 0, 1)
    (C.proc / "hist_grid.json").write_text(json.dumps({"hist_kernel": np.round(kern, 3).tolist(),
                                                       "dist_hist_m": np.round(d.min(1)).tolist()}))
    print(f"[{C.id}] {len(pts)} spots; cells with kernel>0.5: {(kern > 0.5).sum()}")


if __name__ == "__main__":
    main()
