"""OpenStreetMap (Overpass API) -> major roads + waterways GeoJSON, and per-cell distance to nearest waterway.

(c) OpenStreetMap contributors, ODbL.
"""
import json, sys, time
from pathlib import Path
import numpy as np, requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import city_from_argv, KY

OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter"]
FILTERS = {"roads": '"highway"~"^(motorway|trunk|primary|secondary)$"',
           "waterways": '"waterway"~"^(river|stream|canal|drain|ditch)$"'}
TILES_Y, TILES_X = 4, 2  # public Overpass servers are overloaded; small tiles succeed


def query(q):
    for _ in range(3):
        for url in OVERPASS:
            try:
                r = requests.post(url, data={"data": q}, timeout=150,
                                  headers={"User-Agent": "SIH26085-prototype/0.1", "Accept": "*/*"})
                r.raise_for_status()
                return r.json()["elements"]
            except (requests.RequestException, ValueError) as e:
                print("  failed", url, str(e)[:80])
            time.sleep(5)
    raise SystemExit("all Overpass mirrors failed")


def fetch(C, name):
    BBOX = C.bbox
    f = C.raw / f"osm_{name}.json"
    if not f.exists():
        els = {}
        dy = (BBOX["north"] - BBOX["south"]) / TILES_Y; dx = (BBOX["east"] - BBOX["west"]) / TILES_X
        for i in range(TILES_Y):
            for j in range(TILES_X):
                b = (BBOX["south"] + i * dy, BBOX["west"] + j * dx, BBOX["south"] + (i + 1) * dy, BBOX["west"] + (j + 1) * dx)
                print(f"querying Overpass: {name} tile {i},{j}")
                for e in query(f'[out:json][timeout:120];way[{FILTERS[name]}]({",".join(f"{v:.4f}" for v in b)});out geom;'):
                    els[e["id"]] = e
        f.write_text(json.dumps({"elements": list(els.values())}), encoding="utf-8")
    return json.loads(f.read_text(encoding="utf-8"))["elements"]


def to_geojson(elements, keep):
    feats = []
    for e in elements:
        if "geometry" not in e:
            continue
        coords = [[round(p["lon"], 5), round(p["lat"], 5)] for p in e["geometry"]]
        tags = e.get("tags", {})
        feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
                      "properties": {k: tags.get(k) for k in keep}})
    return {"type": "FeatureCollection", "features": feats}


def main():
    C = city_from_argv(); C.ensure_dirs()
    roads = to_geojson(fetch(C, "roads"), ["highway", "name"])
    water = to_geojson(fetch(C, "waterways"), ["waterway", "name"])
    (C.proc / "roads.geojson").write_text(json.dumps(roads, separators=(",", ":")))
    (C.proc / "waterways.geojson").write_text(json.dumps(water, separators=(",", ":")))

    # distance (m) from each cell centre to nearest waterway vertex (densified to ~50 m)
    pts = []
    for f in water["features"]:
        c = np.array(f["geometry"]["coordinates"])
        for a, b in zip(c[:-1], c[1:]):
            n = max(1, int(np.hypot(*(b - a)) / 0.0005))
            pts.append(a + (b - a) * np.linspace(0, 1, n, endpoint=False)[:, None])
    pts = np.vstack(pts)
    kx, ky = C.kx, KY
    cc = np.array([C.cell_center(r, c) for r in range(C.ny) for c in range(C.nx)])
    dist = np.empty(len(cc))
    for i in range(0, len(cc), 500):
        d = np.hypot((cc[i:i+500, None, 0] - pts[None, :, 0]) * kx, (cc[i:i+500, None, 1] - pts[None, :, 1]) * ky)
        dist[i:i+500] = d.min(1)
    (C.proc / "osm_grid.json").write_text(json.dumps({"dist_waterway_m": np.round(dist).tolist()}))
    print(f"[{C.id}] roads {len(roads['features'])}, waterways {len(water['features'])}, median dist {np.median(dist):.0f} m")


if __name__ == "__main__":
    main()
