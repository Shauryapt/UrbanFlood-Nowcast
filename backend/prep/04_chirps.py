"""CHIRPS v2.0 monthly (0.05 deg) -> July rainfall climatology -> spatial rainfall pattern per cell.

The pattern (mean-normalised to 1 over modelled land cells) distributes the scenario / live rainfall
intensity across the study area according to observed long-term monthly totals. It changes WHERE rain
falls within the city, not HOW MUCH falls on average.
Source: Funk et al. (2015) doi:10.1038/sdata.2015.66, https://data.chc.ucsb.edu/products/CHIRPS-2.0/
Usage: python prep/04_chirps.py [city_id]
"""
import gzip, json, sys
from pathlib import Path
import numpy as np, requests, rasterio
from rasterio.io import MemoryFile
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import city_from_argv

URL = "https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_monthly/tifs/chirps-v2.0.{y}.{m:02d}.tif.gz"
YEARS = range(2019, 2024)
MONTH = 7  # July: peak of the Indian summer monsoon (make per-city config if needed)
PAD = 0.1  # deg margin so interpolation at bbox edges has neighbours


def read_window(C, y):
    cache = C.raw / f"chirps_{y}_{MONTH:02d}.npz"
    if cache.exists():
        z = np.load(cache); return z["a"], z["tr"]
    print("downloading CHIRPS", y, MONTH)
    r = requests.get(URL.format(y=y, m=MONTH), timeout=300); r.raise_for_status()
    B = C.bbox
    with MemoryFile(gzip.decompress(r.content)) as mf, mf.open() as src:
        win = from_bounds(B["west"] - PAD, B["south"] - PAD, B["east"] + PAD, B["north"] + PAD, src.transform)
        win = win.round_offsets().round_lengths()
        a = src.read(1, window=win).astype(float)
        a[a < 0] = np.nan
        t = src.window_transform(win)
        tr = np.array([t.c, t.a, t.f, t.e])  # x0, dx, y0, dy
    np.savez(cache, a=a, tr=tr)
    return a, tr


def main():
    C = city_from_argv(); C.ensure_dirs()
    stack, tr = [], None
    for y in YEARS:
        a, tr = read_window(C, y); stack.append(a)
    clim = np.nanmean(np.stack(stack), 0)                      # mm/month
    # fill sea/nodata pixels from nearest valid pixel so coastal cells get a value
    if np.isnan(clim).any():
        vy, vx = np.where(~np.isnan(clim)); ny_, nx_ = np.where(np.isnan(clim))
        j = np.argmin((ny_[:, None] - vy) ** 2 + (nx_[:, None] - vx) ** 2, axis=1)
        clim[ny_, nx_] = clim[vy[j], vx[j]]
    x0, dx, y0, dy = tr
    cc = np.array([C.cell_center(r, c) for r in range(C.ny) for c in range(C.nx)])
    fx = (cc[:, 0] - x0) / dx - 0.5; fy = (cc[:, 1] - y0) / dy - 0.5    # pixel-centre coordinates
    ix = np.clip(np.floor(fx).astype(int), 0, clim.shape[1] - 2); iy = np.clip(np.floor(fy).astype(int), 0, clim.shape[0] - 2)
    wx = np.clip(fx - ix, 0, 1); wy = np.clip(fy - iy, 0, 1)
    val = (clim[iy, ix] * (1 - wx) * (1 - wy) + clim[iy, ix + 1] * wx * (1 - wy)
           + clim[iy + 1, ix] * (1 - wx) * wy + clim[iy + 1, ix + 1] * wx * wy)   # bilinear

    lc = json.loads((C.proc / "landcover_grid.json").read_text())
    land = np.array(lc["land"], bool)
    pattern = val / val[land].mean()
    (C.proc / "rain_pattern.json").write_text(json.dumps(dict(
        pattern=np.round(pattern, 3).tolist(), july_mean_mm=np.round(val, 0).tolist(),
        source="CHIRPS v2.0 monthly", years=list(YEARS), month=MONTH)))
    print(f"[{C.id}] July CHIRPS {val[land].min():.0f}..{val[land].max():.0f} mm/month; "
          f"pattern {pattern[land].min():.2f}..{pattern[land].max():.2f}")


if __name__ == "__main__":
    main()
