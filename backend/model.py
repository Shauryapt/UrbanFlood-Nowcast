"""Explainable hybrid urban-flood nowcast (deterministic).

Per 15-min step, for each land cell / drainage node:
  1. Rainfall  i(t) [mm/h] = hyetograph(t) x scenario multiplier x spatial pattern
  2. Runoff    SCS Curve Number on event-cumulative rainfall -> incremental runoff depth
  3. Drainage  node inflow = local runoff + upstream outflow; effective capacity =
               Manning full-pipe capacity x (1 - blockage) x tide factor (outfalls) x backwater factor;
               excess goes to node surcharge storage; storage beyond conduit volume floods the surface,
               which recedes with a lumped time constant (overland flow to receiving water)
  4. Depth     surface flood volume spread over the node's sub-catchment, weighted to low-lying cells
               (HAND-type weights on SRTM elevations) -> prototype depth estimate
  5. Risk      additive score = sum(weight_i x factor_i); exact per-factor contributions (explainability)
  6. Class     max(class by score, class by depth); lead time = first step reaching High
"""
from __future__ import annotations
import json, math
from dataclasses import dataclass
from functools import lru_cache
import numpy as np

from config import City, get_city, KY

DT_MIN = 15
DT_S = DT_MIN * 60
HIST_HOURS = 6          # antecedent ("observed") hours simulated before T+0
FCST_HOURS = 3
M2_PERIOD_H = 12.42

# --- scoring (documented, expert-assigned, not trained) ---------------------------------------
FACTORS = [  # key, label, weight
    ("rain_int", "Rainfall intensity", 0.13),
    ("rain_cum", "Cumulative rainfall", 0.09),
    ("low_elev", "Low elevation", 0.10),
    ("depression", "Local depression (HAND-type)", 0.06),
    ("flat", "Flat terrain", 0.04),
    ("imperv", "Imperviousness", 0.08),
    ("hist", "Historical flooding nearby", 0.10),
    ("drain_util", "Drainage utilisation", 0.14),
    ("blockage", "Drain blockage", 0.06),
    ("depth", "Estimated ponding depth", 0.20),
]
NORM = dict(rain_int_mmph=50.0,  # 50 mm/h: BRIMSTOWAD upgraded design intensity (2x legacy 25 mm/h)
            rain_cum_mm=200.0, elev_m=15.0, hand_m=8.0, slope_deg=5.0, util=1.5, blockage=0.6, depth_m=0.6)
CLASSES = ["Low", "Moderate", "High", "Severe"]
SCORE_T = [45, 60, 75]            # score thresholds -> Moderate / High / Severe
DEPTH_T = [0.15, 0.30, 0.60]      # depth thresholds (m) -> Moderate / High / Severe (operational, configurable)
MAX_DEPTH = 2.0
H0_M = 1.5               # HAND e-folding height for ponding weights
SURF_TAU_MIN = 90.0      # surface-flood recession time constant (representative)
SURF_RECESSION = 1 - math.exp(-DT_MIN / SURF_TAU_MIN)
PONDING_FRACTION = 1.0   # share of cell area available for ponding (1 = whole cell)

# --- rainfall scenarios: hourly mm/h for hours -6..-1 (antecedent) and 0..2 (next 3 h) -------------
SCENARIOS = {
    "moderate": dict(label="Moderate monsoon spell", kind="design",
                     hourly=[2, 4, 6, 8, 10, 12, 15, 18, 12]),
    "heavy": dict(label="Heavy spell (exceeds 25 mm/h legacy design)", kind="design",
                  hourly=[5, 10, 15, 20, 28, 35, 45, 55, 40]),
    "extreme": dict(label="Extreme cloudburst (illustrative)", kind="design",
                    hourly=[15, 30, 45, 60, 75, 85, 100, 90, 70]),
}
TIDES = {"low": math.pi, "rising": -math.pi / 2, "high": 0.0}   # phase of M2 cosine at T+0


@dataclass
class Scenario:
    preset: str = "heavy"
    multiplier: float = 1.0
    blockage_add: float = 0.0     # added to each node's baseline blockage (0..0.8)
    tide: str = "high"
    hourly: tuple | None = None   # override (e.g. live Open-Meteo series), 9 values

    def key(self):
        return (self.preset, round(self.multiplier, 2), round(self.blockage_add, 2), self.tide, self.hourly)


class CityModel:
    def __init__(self, city: City):
        self.city = city
        P = city.proc
        dem = json.loads((P / "dem_grid.json").read_text())
        lc = json.loads((P / "landcover_grid.json").read_text())
        hist = json.loads((P / "hist_grid.json").read_text())
        dr = json.loads((P / "drainage.json").read_text())
        osm_f = P / "osm_grid.json"
        dist_w = np.array(json.loads(osm_f.read_text())["dist_waterway_m"]) if osm_f.exists() else None
        pat_f = P / "rain_pattern.json"

        land = np.array(lc["land"], bool)
        cell_node = np.array(dr["cell_node"])
        self.idx = np.where(land & (cell_node >= 0))[0]          # modelled cells
        i = self.idx
        self.elev = np.array(dem["elev_mean"])[i]
        self.slope = np.array(dem["slope_deg"])[i]
        self.imperv = np.array(lc["imperv"])[i]
        self.cn = np.clip(np.array(lc["cn"])[i], 30, 98)
        self.hist = np.array(hist["hist_kernel"])[i]
        self.dist_hist = np.array(hist["dist_hist_m"])[i]
        self.dist_water = dist_w[i] if dist_w is not None else np.full(len(i), np.nan)
        pat = json.loads(pat_f.read_text()) if pat_f.exists() else None
        self.pattern = np.array(pat["pattern"])[i] if pat else np.ones(len(i))
        self.july_mm = np.array(pat["july_mean_mm"])[i] if pat else np.full(len(i), np.nan)
        self.cnode = cell_node[i]

        self.nodes = dr["nodes"]
        nn = len(self.nodes)
        self.cap = np.array([n["capacity_m3s"] for n in self.nodes])
        self.base_block = np.array([n["blockage"] for n in self.nodes])
        self.down = np.array([-1 if n["down"] is None else n["down"] for n in self.nodes])
        self.is_out = self.down < 0
        self.pipe_vol = np.array([n["barrels"] * math.pi * n["pipe_d_m"] ** 2 / 4 * n["length_m"] for n in self.nodes])
        self.order = sorted(range(nn), key=lambda k: -self.nodes[k]["hops"])   # upstream -> downstream
        self.node_ground = np.array([n["ground_m"] for n in self.nodes])

        # static terrain factors
        self.hand = np.clip(self.elev - self.node_ground[self.cnode], 0, None)   # height above sub-catchment low point
        self.f_static = dict(
            low_elev=1 - np.clip(self.elev / NORM["elev_m"], 0, 1),
            depression=1 - np.clip(self.hand / NORM["hand_m"], 0, 1),
            flat=1 - np.clip(self.slope / NORM["slope_deg"], 0, 1),
            imperv=np.clip(self.imperv, 0, 1),
            hist=np.clip(self.hist, 0, 1),
        )
        self.pond_w = np.exp(-self.hand / H0_M)
        # per-node cell lists sorted by elevation
        self.node_cells = [[] for _ in range(nn)]
        for k, n in enumerate(self.cnode):
            self.node_cells[n].append(k)
        self.node_cells = [np.array(sorted(c, key=lambda k: self.elev[k]), int) for c in self.node_cells]
        self.tide_cfg = city.cfg.get("tide") if city.cfg.get("coastal") else None
        self._roads = None

    def place_name(self, lon: float, lat: float, max_m: float = 600.0) -> str | None:
        """Nearest named OSM road (for human-readable alert labels)."""
        if self._roads is None:
            pts, names = [], []
            f = self.city.proc / "roads.geojson"
            if f.exists():
                for ft in json.loads(f.read_text(encoding="utf-8"))["features"]:
                    nm = ft["properties"].get("name")
                    if nm:
                        for x, y in ft["geometry"]["coordinates"]:
                            pts.append((x, y)); names.append(nm)
            self._roads = (np.array(pts) if pts else np.zeros((0, 2)), names)
        pts, names = self._roads
        if not len(pts):
            return None
        d = np.hypot((pts[:, 0] - lon) * self.city.kx, (pts[:, 1] - lat) * KY)
        j = int(d.argmin())
        return names[j] if d[j] <= max_m else None

    # ------------------------------------------------------------------------------------------
    def hyetograph(self, sc: Scenario) -> np.ndarray:
        hourly = list(sc.hourly) if sc.hourly else SCENARIOS[sc.preset]["hourly"]
        per = 60 // DT_MIN
        return np.repeat(np.array(hourly, float), per) * sc.multiplier   # mm/h per 15-min step

    def tide_factor(self, t_h: float, sc: Scenario) -> tuple[float, float]:
        """Returns (normalised tide level -1..1, outfall capacity factor)."""
        if not self.tide_cfg:
            return 0.0, 1.0
        level = math.cos(2 * math.pi * t_h / M2_PERIOD_H + TIDES[sc.tide])
        return level, 1.0 - self.tide_cfg["outfall_submergence"] * max(0.0, level)

    def fill_depth(self, node: int, vol: float, out: np.ndarray):
        """Distribute surface flood volume over the sub-catchment, weighted towards cells lying low relative
        to the drainage node (HAND-type weighting, w = exp(-HAND / H0)); volume-conserving before the cap."""
        cells = self.node_cells[node]
        if vol <= 0 or len(cells) == 0:
            return
        w = self.pond_w[cells]
        out[cells] = np.minimum(vol * w / (self.city.cell_area_m2 * PONDING_FRACTION * w.sum()), MAX_DEPTH)

    # ------------------------------------------------------------------------------------------
    def run(self, sc: Scenario) -> dict:
        rain = self.hyetograph(sc)
        nsteps = len(rain); t0 = HIST_HOURS * 60 // DT_MIN
        ncell, nn = len(self.idx), len(self.nodes)
        S = 25400.0 / self.cn - 254.0; Ia = 0.2 * S
        block = np.clip(self.base_block + sc.blockage_add, 0, 0.95)
        A = self.city.cell_area_m2

        P = np.zeros(ncell); Q_prev = np.zeros(ncell)
        store = np.zeros(nn); util_prev = np.zeros(nn)
        frames = []
        for s in range(nsteps):
            t_h = (s - t0) * DT_MIN / 60.0
            i_cell = rain[s] * self.pattern
            P = P + i_cell * DT_MIN / 60.0
            Q = np.where(P > Ia, (P - Ia) ** 2 / (P - Ia + S), 0.0)
            dQ = Q - Q_prev; Q_prev = Q
            local_in = np.bincount(self.cnode, dQ / 1000 * A, nn) / DT_S           # m3/s
            tide_lvl, tf = self.tide_factor(t_h, sc)

            inflow = local_in.copy(); outflow = np.zeros(nn); cap_eff = np.zeros(nn)
            for k in self.order:
                c = self.cap[k] * (1 - block[k])
                if self.is_out[k]:
                    c *= tf
                else:  # backwater: surcharged downstream node throttles this conduit (previous-step state)
                    c /= max(1.0, util_prev[self.down[k]])
                cap_eff[k] = max(c, 1e-6)
                avail = inflow[k] + store[k] / DT_S
                outflow[k] = min(avail, cap_eff[k])
                store[k] = max(0.0, store[k] + (inflow[k] - outflow[k]) * DT_S)
                surf = store[k] - self.pipe_vol[k]
                if surf > 0:  # lumped surface recession: overland flow to receiving water + infiltration
                    store[k] -= surf * SURF_RECESSION
                if not self.is_out[k]:
                    inflow[self.down[k]] += outflow[k]
            util = inflow / cap_eff
            util_prev = util
            if s >= t0 - 1:  # state at end of step: T+0 (end of antecedent period) .. T+3h, 15-min resolution
                flood_vol = np.clip(store - self.pipe_vol, 0, None)
                depth = np.zeros(ncell)
                for k in np.nonzero(flood_vol)[0]:
                    self.fill_depth(k, flood_vol[k], depth)
                frames.append(dict(t_min=(s - t0 + 1) * DT_MIN, rain=i_cell, cum=P.copy(), util=util.copy(),
                                   store=store.copy(), flood_vol=flood_vol, depth=depth, tide=tide_lvl))
        return self._score(frames, block, rain, t0)

    def _score(self, frames, block, rain, t0):
        W = {k: w for k, _, w in FACTORS}
        out = []
        for f in frames:
            fx = dict(self.f_static)
            fx["rain_int"] = np.clip(f["rain"] / NORM["rain_int_mmph"], 0, 1)
            fx["rain_cum"] = np.clip(f["cum"] / NORM["rain_cum_mm"], 0, 1)
            fx["drain_util"] = np.clip(f["util"][self.cnode] / NORM["util"], 0, 1)
            fx["blockage"] = np.clip(block[self.cnode] / NORM["blockage"], 0, 1)
            fx["depth"] = np.clip(f["depth"] / NORM["depth_m"], 0, 1)
            contrib = {k: 100 * W[k] * fx[k] for k in W}
            score = sum(contrib.values())
            cls_s = np.searchsorted(SCORE_T, score, side="right")
            cls_d = np.searchsorted(DEPTH_T, f["depth"], side="right")
            cls = np.maximum(cls_s, cls_d)
            out.append(dict(f, score=score, cls=cls, contrib=contrib))
        # lead time: first 15-min step (from T+0) at which class >= High
        hi = np.array([o["cls"] >= 2 for o in out])
        first = np.where(hi.any(0), hi.argmax(0), -1)
        lead = np.where(first >= 0, first * DT_MIN, -1)
        return dict(frames=out, lead_min=lead, block=block, rain_series=rain, t0=t0)


# ---- API-facing helpers ----------------------------------------------------------------------
_models: dict[str, CityModel] = {}


def get_model(city_id: str) -> CityModel:
    if city_id not in _models:
        _models[city_id] = CityModel(get_city(city_id))
    return _models[city_id]


@lru_cache(maxsize=64)
def _run_cached(city_id: str, key: tuple):
    preset, mult, badd, tide, hourly = key
    return get_model(city_id).run(Scenario(preset, mult, badd, tide, hourly))


def run_scenario(city_id: str, sc: Scenario):
    return _run_cached(city_id, sc.key())


HOURLY_FRAMES = [0, 4, 8, 12]   # indices of T+0, +1h, +2h, +3h in 15-min frames


def summary(city_id: str, sc: Scenario) -> dict:
    m = get_model(city_id); r = run_scenario(city_id, sc)
    frames = []
    for fi in HOURLY_FRAMES:
        f = r["frames"][fi]
        frames.append(dict(
            t_min=f["t_min"],
            score=np.round(f["score"]).astype(int).tolist(),
            cls=f["cls"].astype(int).tolist(),
            depth_cm=np.round(f["depth"] * 100).astype(int).tolist(),
            rain=np.round(f["rain"], 1).tolist(),
            node_util=np.round(f["util"], 2).tolist(),
            tide=round(f["tide"], 2),
            counts=[int((f["cls"] == c).sum()) for c in range(4)],
        ))
    rs = r["rain_series"]; per = 60 // DT_MIN
    return dict(city=city_id, cells=m.idx.tolist(), frames=frames, lead_min=r["lead_min"].astype(int).tolist(),
                node_blockage=np.round(r["block"], 2).tolist(),
                rain_hourly=[round(float(rs[h * per]), 1) for h in range(len(rs) // per)],
                rain_hours=list(range(-HIST_HOURS, FCST_HOURS)),
                alerts=alerts(city_id, sc))


def alerts(city_id: str, sc: Scenario, max_n: int = 30) -> list:
    """Per hourly frame: one alert per drainage sub-catchment with any High/Severe cell (its worst cell)."""
    m = get_model(city_id); r = run_scenario(city_id, sc)
    per_frame = []
    for fi in HOURLY_FRAMES:
        f = r["frames"][fi]
        best = {}
        for k in np.where(f["cls"] >= 2)[0]:
            n = int(m.cnode[k])
            if n not in best or f["score"][k] > f["score"][best[n]]:
                best[n] = k
        items = []
        for n, k in best.items():
            cell = int(m.idx[k]); lon, lat = m.city.cell_center(*divmod(cell, m.city.nx))
            items.append(dict(cell=cell, node=n, lon=round(lon, 5), lat=round(lat, 5), cls=CLASSES[int(f["cls"][k])],
                              score=int(round(f["score"][k])), depth_cm=int(round(f["depth"][k] * 100)),
                              lead_min=int(r["lead_min"][k]), util=round(float(f["util"][n]), 2),
                              place=m.place_name(lon, lat)))
        items.sort(key=lambda x: (-CLASSES.index(x["cls"]), -x["score"]))
        per_frame.append(dict(t_min=f["t_min"], total=len(items), items=items[:max_n]))
    return per_frame


def cell_detail(city_id: str, sc: Scenario, cell: int) -> dict:
    m = get_model(city_id); r = run_scenario(city_id, sc)
    pos = np.searchsorted(m.idx, cell)
    if pos >= len(m.idx) or m.idx[pos] != cell:
        raise KeyError("cell not modelled (water or outside study area)")
    k = int(pos); n = int(m.cnode[k]); node = m.nodes[n]
    lon, lat = m.city.cell_center(*divmod(cell, m.city.nx))
    timeline = []
    for fi in HOURLY_FRAMES:
        f = r["frames"][fi]
        contrib = sorted(((key, lab, round(float(f["contrib"][key][k]), 1)) for key, lab, _ in FACTORS),
                         key=lambda x: -x[2])
        timeline.append(dict(
            t_min=f["t_min"], score=round(float(f["score"][k]), 1), cls=CLASSES[int(f["cls"][k])],
            depth_cm=round(float(f["depth"][k]) * 100), rain_mmph=round(float(f["rain"][k]), 1),
            cum_mm=round(float(f["cum"][k]), 1), util=round(float(f["util"][n]), 2),
            surcharge_m3=round(float(f["store"][n])), tide=round(f["tide"], 2),
            contributions=[dict(key=a, label=b, points=c) for a, b, c in contrib]))
    return dict(
        cell=cell, lon=round(lon, 5), lat=round(lat, 5), place=m.place_name(lon, lat),
        static=dict(elev_m=round(float(m.elev[k]), 1), slope_deg=round(float(m.slope[k]), 2),
                    imperv_pct=round(float(m.imperv[k]) * 100), curve_number=round(float(m.cn[k]), 1),
                    hand_m=round(float(m.hand[k]), 1),
                    july_clim_mm=None if np.isnan(m.july_mm[k]) else int(m.july_mm[k]),
                    dist_hist_m=int(m.dist_hist[k]),
                    dist_waterway_m=None if np.isnan(m.dist_water[k]) else int(m.dist_water[k])),
        node=dict(id=n, type=node["type"], capacity_m3s=node["capacity_m3s"], pipe_d_m=node["pipe_d_m"],
                  barrels=node["barrels"], blockage_pct=round(float(r["block"][n]) * 100),
                  acc_area_km2=round(node["acc_area_m2"] / 1e6, 2)),
        lead_min=int(r["lead_min"][k]), timeline=timeline)


def model_card() -> dict:
    return dict(factors=[dict(key=k, label=l, weight=w) for k, l, w in FACTORS], norm=NORM, classes=CLASSES,
                score_thresholds=SCORE_T, depth_thresholds_m=DEPTH_T, dt_min=DT_MIN,
                scenarios={k: dict(label=v["label"], hourly=v["hourly"]) for k, v in SCENARIOS.items()},
                tides=list(TIDES))
