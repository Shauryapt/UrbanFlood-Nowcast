"""SRTM 1-arcsec elevation (AWS Terrain Tiles 'skadi' mirror of SRTM HGT) -> per-cell mean/min elevation + slope.

Source: https://registry.opendata.aws/terrain-tiles/  (skadi = SRTM HGT, 1x1 deg, 3601x3601)
Usage: python prep/01_dem.py [city_id]   (northern/eastern hemisphere tiles only)
"""
import gzip, json, math, sys
from pathlib import Path
import numpy as np, requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import city_from_argv, KY

URL = "https://s3.amazonaws.com/elevation-tiles-prod/skadi/{ns}/{name}.hgt.gz"
N = 3601


def load_tile(raw: Path, lat: int, lon: int) -> np.ndarray:
    name = f"N{lat:02d}E{lon:03d}"
    f = raw / f"{name}.hgt.gz"
    if not f.exists():
        print("downloading", name)
        r = requests.get(URL.format(ns=name[:3], name=name), timeout=120)
        r.raise_for_status()
        f.write_bytes(r.content)
    a = np.frombuffer(gzip.decompress(f.read_bytes()), ">i2").reshape(N, N).astype(np.float32)
    a[a == -32768] = np.nan
    return a


def main():
    C = city_from_argv(); C.ensure_dirs(); B = C.bbox
    lats = range(math.floor(B["south"]), math.floor(B["north"]) + 1)
    lons = range(math.floor(B["west"]), math.floor(B["east"]) + 1)
    # mosaic, row 0 = north; adjacent tiles share one edge row/column
    rows = [np.hstack([load_tile(C.raw, la, lo)[:, : (None if lo == lons[-1] else -1)] for lo in lons])
            for la in reversed(lats)]
    mosaic = np.vstack([r[: (None if i == len(rows) - 1 else -1)] for i, r in enumerate(rows)])
    top_lat, left_lon, px = lats[-1] + 1.0, float(lons[0]), 1.0 / 3600
    r0 = int((top_lat - B["north"]) / px); r1 = int(math.ceil((top_lat - B["south"]) / px))
    c0 = int((B["west"] - left_lon) / px); c1 = int(math.ceil((B["east"] - left_lon) / px))
    dem = mosaic[r0:r1, c0:c1]
    if np.isnan(dem).any():
        dem = np.where(np.isnan(dem), np.nanmean(dem), dem)

    gy, gx = np.gradient(dem, px * KY, px * C.kx)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))

    lat_f = B["north"] - (np.arange(dem.shape[0]) + 0.5) * px
    lon_f = B["west"] + (np.arange(dem.shape[1]) + 0.5) * px
    ri = np.clip(((B["north"] - lat_f) / C.dlat).astype(int), 0, C.ny - 1)
    ci = np.clip(((lon_f - B["west"]) / C.dlon).astype(int), 0, C.nx - 1)
    idx = (ri[:, None] * C.nx + ci[None, :]).ravel()
    n = C.nx * C.ny
    cnt = np.bincount(idx, minlength=n)
    mean = np.bincount(idx, dem.ravel(), n) / cnt
    smean = np.bincount(idx, slope.ravel(), n) / cnt
    mn = np.full(n, np.inf); np.minimum.at(mn, idx, dem.ravel())

    out = dict(nx=C.nx, ny=C.ny, elev_mean=np.round(mean, 2).tolist(), elev_min=np.round(mn, 2).tolist(),
               slope_deg=np.round(smean, 3).tolist())
    (C.proc / "dem_grid.json").write_text(json.dumps(out))
    print(f"[{C.id}] grid {C.nx}x{C.ny}; elev {mean.min():.1f}..{mean.max():.1f} m; slope mean {smean.mean():.2f} deg")


if __name__ == "__main__":
    main()
