"""ESA WorldCover 10 m v200 (2021) -> per-cell class fractions, imperviousness proxy, SCS curve number, land mask.

Source COG: s3://esa-worldcover (public, https://registry.opendata.aws/esa-worldcover-vito/)
Usage: python prep/02_worldcover.py [city_id]
"""
import json, math, sys
from pathlib import Path
import numpy as np, rasterio
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import city_from_argv

URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"

# WorldCover class -> (imperviousness proxy, SCS CN for hydrologic soil group D).
# CN values follow NRCS TR-55 Table 2-2 categories (impervious 98, woods good 77,
# brush 73, open space fair 84, row crops 89, bare/newly graded 94); water/wetland
# treated as saturated (98). Soil group D is an ASSUMPTION -- documented in provenance.
CLASSES = {10: ("tree", 0.0, 77), 20: ("shrub", 0.0, 73), 30: ("grass", 0.0, 84), 40: ("crop", 0.0, 89),
           50: ("built", 1.0, 98), 60: ("bare", 0.3, 94), 70: ("snow", 0.0, 98), 80: ("water", 0.0, 98),
           90: ("wetland", 0.0, 98), 95: ("mangrove", 0.0, 98), 100: ("moss", 0.0, 77)}


def tile_name(lat, lon):  # WorldCover tiles are 3x3 deg, named by SW corner (N/E hemispheres)
    return f"N{3 * math.floor(lat / 3):02d}E{3 * math.floor(lon / 3):03d}"


def main():
    C = city_from_argv(); C.ensure_dirs(); B = C.bbox
    tile = tile_name(B["south"], B["west"])
    if tile != tile_name(B["north"], B["east"]):
        raise SystemExit("bbox spans several WorldCover tiles; mosaicking not implemented in prototype")
    cache = C.raw / "worldcover.npy"
    if cache.exists():
        wc = np.load(cache)
    else:
        print("reading WorldCover COG window", tile)
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"), rasterio.open(URL.format(tile=tile)) as src:
            win = from_bounds(B["west"], B["south"], B["east"], B["north"], src.transform)
            wc = src.read(1, window=win.round_offsets().round_lengths())
        np.save(cache, wc)
    h, w = wc.shape
    n = C.nx * C.ny
    ri = np.clip(((np.arange(h) + 0.5) * (B["north"] - B["south"]) / h / C.dlat).astype(int), 0, C.ny - 1)
    ci = np.clip(((np.arange(w) + 0.5) * (B["east"] - B["west"]) / w / C.dlon).astype(int), 0, C.nx - 1)
    idx = (ri[:, None] * C.nx + ci[None, :]).ravel()
    flat = wc.ravel()
    cnt = np.bincount(idx, minlength=n).astype(float)

    frac, imperv, cn = {}, np.zeros(n), np.zeros(n)
    for code, (name, imp, c) in CLASSES.items():
        f = np.bincount(idx, (flat == code).astype(float), n) / cnt
        frac[name] = f; imperv += imp * f; cn += c * f
    land = (frac["water"] < 0.5).astype(int)
    out = dict(nx=C.nx, ny=C.ny, land=land.tolist(), imperv=np.round(imperv, 3).tolist(), cn=np.round(cn, 1).tolist(),
               frac_built=np.round(frac["built"], 3).tolist(), frac_water=np.round(frac["water"], 3).tolist(),
               frac_green=np.round(frac["tree"] + frac["shrub"] + frac["grass"] + frac["mangrove"], 3).tolist())
    (C.proc / "landcover_grid.json").write_text(json.dumps(out))
    print(f"[{C.id}] land cells {land.sum()} / {n}; mean imperv on land {imperv[land == 1].mean():.2f}")


if __name__ == "__main__":
    main()
