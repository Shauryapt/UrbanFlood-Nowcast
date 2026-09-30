"""Street flood status: the modelled 300 m flood grid sampled onto OSM road segments (DERIVED, not measured).

Each OSM road LineString is densified (~25 m) and split wherever it crosses into another grid cell, so every
segment lies in exactly one grid cell and takes that cell's modelled depth and risk class for the frame.
Segments over cells the model does not cover (water, e.g. bridges and sea links, or outside the grid) are
left out. The status uses the model's existing depth-class thresholds (model.DEPTH_T):
  depth < 0.15 m CLEAR · < 0.30 m CAUTION · < 0.60 m HIGH RISK · otherwise ROAD CLOSURE RISK.
The split geometry is built once per study area and cached; per-scenario values reuse the cached model run.
"""
from __future__ import annotations
import json, math
from functools import lru_cache

import numpy as np

import model
from config import KY

STATUSES = ["CLEAR", "CAUTION", "HIGH RISK", "ROAD CLOSURE RISK"]
STEP_M = 25.0   # densification step for locating cell crossings
NOTE = ("Derived from the 300 m model grid: each road segment takes the modelled depth and risk class of the grid "
        "cell it lies in. Not measured street water depth and not an official road status.")


class StreetSegments:
    def __init__(self, city_id: str):
        m = model.get_model(city_id); C = m.city
        pos = np.full(C.nx * C.ny, -1)
        pos[m.idx] = np.arange(len(m.idx))
        roads = json.loads((C.proc / "roads.geojson").read_text(encoding="utf-8"))["features"]
        feats, ks = [], []
        excluded = 0
        for road_id, f in enumerate(roads):
            pts, is_vertex = self._densify(np.array(f["geometry"]["coordinates"], float), C.kx)
            r = np.floor((C.bbox["north"] - pts[:, 1]) / C.dlat).astype(int)
            c = np.floor((pts[:, 0] - C.bbox["west"]) / C.dlon).astype(int)
            inside = (r >= 0) & (r < C.ny) & (c >= 0) & (c < C.nx)
            k = np.where(inside, pos[np.clip(r, 0, C.ny - 1) * C.nx + np.clip(c, 0, C.nx - 1)], -1)
            breaks = np.flatnonzero(np.diff(k)) + 1
            for s, e in zip(np.r_[0, breaks], np.r_[breaks, len(k)]):
                if k[s] < 0:
                    excluded += 1; continue
                # segment = start sample, original vertices inside the run, and the first sample of the next run
                idx = [s] + [i for i in range(s + 1, e) if is_vertex[i]] + ([e] if e < len(k) else [])
                coords = []
                for i in idx:
                    p = [round(float(pts[i, 0]), 5), round(float(pts[i, 1]), 5)]
                    if not coords or coords[-1] != p:
                        coords.append(p)
                if len(coords) < 2:
                    continue
                props = f["properties"]
                feats.append(dict(id=len(feats), road_id=road_id, name=props.get("name"), highway=props.get("highway"),
                                  cell=int(m.idx[k[s]]), coords=coords))
                ks.append(int(k[s]))
        self.features = feats
        self.k = np.array(ks, int)          # model cell position per segment
        self.excluded = excluded
        self.n_roads = len(roads)

    @staticmethod
    def _densify(a: np.ndarray, kx: float):
        pts, vert = [a[:1]], [True]
        for p, q in zip(a[:-1], a[1:]):
            n = max(1, math.ceil(math.hypot((q[0] - p[0]) * kx, (q[1] - p[1]) * KY) / STEP_M))
            t = np.arange(1, n + 1)[:, None] / n
            pts.append(p + (q - p) * t)
            vert += [False] * (n - 1) + [True]
        return np.vstack(pts), np.array(vert)


@lru_cache(maxsize=None)
def get_segments(city_id: str) -> StreetSegments:
    return StreetSegments(city_id)


def frame_values(city_id: str, sc: model.Scenario, frame: int):
    """(depth_m, risk class index, status index) per segment for one exposed hourly frame."""
    seg = get_segments(city_id)
    f = model.run_scenario(city_id, sc)["frames"][model.HOURLY_FRAMES[frame]]
    depth = f["depth"][seg.k]
    return depth, f["cls"][seg.k], np.searchsorted(model.DEPTH_T, depth, side="right"), f["t_min"]


def derived_info(city_id: str) -> dict:
    seg = get_segments(city_id)
    return dict(method="road segments split at 300 m grid-cell boundaries; value of the containing modelled cell",
                note=NOTE, cls="SIMULATED", cell_m=model.get_model(city_id).city.cell_m,
                statuses=STATUSES, depth_thresholds_m=list(model.DEPTH_T), segments=len(seg.features),
                roads=seg.n_roads, excluded_unmodelled_segments=seg.excluded)


def geojson(city_id: str, sc: model.Scenario, frame: int) -> dict:
    seg = get_segments(city_id)
    depth, cls, status, t_min = frame_values(city_id, sc, frame)
    feats = []
    for i, s in enumerate(seg.features):
        feats.append({"type": "Feature", "id": s["id"], "geometry": {"type": "LineString", "coordinates": s["coords"]},
                      "properties": dict(id=s["id"], road_id=s["road_id"], name=s["name"], highway=s["highway"],
                                         cell=s["cell"], t_min=t_min, depth_cm=int(round(float(depth[i]) * 100)),
                                         risk_class=model.CLASSES[int(cls[i])], flood_status=STATUSES[int(status[i])])})
    return {"type": "FeatureCollection", "features": feats, "t_min": t_min, "derived": derived_info(city_id)}


def status(city_id: str, sc: model.Scenario) -> dict:
    """Compact per-segment values for all exposed frames (array index = segment id), for map feature-state."""
    frames = []
    for fi in range(len(model.HOURLY_FRAMES)):
        depth, cls, st, t_min = frame_values(city_id, sc, fi)
        frames.append(dict(t_min=t_min, depth_cm=np.round(depth * 100).astype(int).tolist(),
                           risk=cls.astype(int).tolist(), status=st.astype(int).tolist()))
    return dict(city=city_id, classes=model.CLASSES, frames=frames, derived=derived_info(city_id))
