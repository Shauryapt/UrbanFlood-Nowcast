"""REPRESENTATIVE drainage digital twin (NOT Mumbai's actual storm-water network).

Construction (deterministic, seed fixed):
  * Land grid is tiled into BLOCK x BLOCK cell sub-catchments (~1.2 km); each gets one node at its
    lowest-elevation cell (inlet/junction).
  * Blocks containing receiving water (sea/creek cells connected to the boundary) get an outfall.
  * Network topology: breadth-first "hops to outfall" over land blocks; each node drains to the
    neighbouring node with fewer hops (ties -> lower ground). Guarantees an acyclic tree to the sea.
  * Conduit sizing: rational method Q = C i A at a per-city design intensity (cities/<id>.json), full-pipe Manning capacity, smallest standard size that meets the design flow.
  * Baseline blockage per node ~ Beta(2, 8) (mean 0.2), seeded -- a SIMULATED silt/debris parameter.
"""
import json, sys
from collections import deque
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import city_from_argv, KY

MANNING_N = 0.013           # concrete conduit
MIN_SLOPE = 0.001           # Mumbai is very flat; enforce minimum constructed grade
COVER_M = 1.5               # ground-to-crown cover
SIZES_M = [0.6, 0.9, 1.2, 1.5, 1.8, 2.4, 3.0]
SEED = 26085


def manning_full(d, s, n=MANNING_N):
    a = np.pi * d * d / 4; r = d / 4
    return a * r ** (2 / 3) * np.sqrt(s) / n


def main():
    C = city_from_argv(); PROC = C.proc; NX, NY, CELL_AREA_M2 = C.nx, C.ny, C.cell_area_m2
    BLOCK = C.cfg["drainage"]["block_cells"]; DESIGN_I_MMPH = C.cfg["drainage"]["design_i_mmph"]
    cell_center = C.cell_center
    dem = json.loads((PROC / "dem_grid.json").read_text())
    lc = json.loads((PROC / "landcover_grid.json").read_text())
    elev = np.array(dem["elev_mean"]); land = np.array(lc["land"]).astype(bool)
    imperv = np.array(lc["imperv"])
    runoff_c = 0.3 + 0.6 * imperv  # rational-method C: 0.3 (pervious) .. 0.9 (fully built)

    BY, BX = -(-NY // BLOCK), -(-NX // BLOCK)
    cell_block = np.array([(r // BLOCK) * BX + (c // BLOCK) for r in range(NY) for c in range(NX)])
    # receiving water = water cells connected to the study-area boundary (sea/creeks); inland lakes excluded
    water = ~land
    water_cells = np.zeros_like(water)
    q = deque(i for i in range(NX * NY) if water[i] and (i < NX or i >= NX * (NY - 1) or i % NX in (0, NX - 1)))
    for i in q:
        water_cells[i] = True
    while q:
        i = q.popleft(); r, c = divmod(i, NX)
        for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            j = rr * NX + cc
            if 0 <= rr < NY and 0 <= cc < NX and water[j] and not water_cells[j]:
                water_cells[j] = True; q.append(j)

    nodes = {}  # block id -> dict
    for b in range(BY * BX):
        cells = np.where((cell_block == b) & land)[0]
        if len(cells) < 2:  # ignore slivers; their cells are handled below
            continue
        low = cells[np.argmin(elev[cells])]
        nodes[b] = dict(block=b, cell=int(low), cells=cells.tolist(), ground=float(elev[low]),
                        area=len(cells) * CELL_AREA_M2, c=float(runoff_c[cells].mean()))
    # attach sliver cells to nearest node block
    keys = np.array(list(nodes)); kr, kc = keys // BX, keys % BX
    cell_node = np.full(NX * NY, -1)
    for b, n in nodes.items():
        cell_node[n["cells"]] = b
    for i in np.where(land & (cell_node < 0))[0]:
        br, bc = cell_block[i] // BX, cell_block[i] % BX
        b = int(keys[np.argmin((kr - br) ** 2 + (kc - bc) ** 2)])
        cell_node[i] = b; nodes[b]["cells"].append(int(i)); nodes[b]["area"] += CELL_AREA_M2

    def nbrs(b):
        r, c = divmod(b, BX)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if (dr or dc) and 0 <= r + dr < BY and 0 <= c + dc < BX:
                    yield (r + dr) * BX + (c + dc)

    # outfalls: blocks containing or adjacent to water cells
    block_has_water = np.bincount(cell_block, water_cells.astype(int), BY * BX) >= 2
    hops = {b: 0 for b in nodes if block_has_water[b]}
    q = deque(sorted(hops))
    while q:
        b = q.popleft()
        for x in nbrs(b):
            if x in nodes and x not in hops:
                hops[x] = hops[b] + 1; q.append(x)
    for b in nodes:  # isolated inland pockets (none expected) -> treat as outfall
        hops.setdefault(b, 0)

    # downstream links
    for b, n in nodes.items():
        if hops[b] == 0:
            n["down"] = None
        else:
            cand = [x for x in nbrs(b) if x in nodes and hops[x] == hops[b] - 1]
            n["down"] = min(cand, key=lambda x: nodes[x]["ground"])

    # accumulate contributing area (process from farthest to outfalls)
    order = sorted(nodes, key=lambda b: -hops[b])
    for b in nodes:
        nodes[b]["acc_area"] = nodes[b]["area"]; nodes[b]["acc_ca"] = nodes[b]["area"] * nodes[b]["c"]
    for b in order:
        d = nodes[b]["down"]
        if d is not None:
            nodes[d]["acc_area"] += nodes[b]["acc_area"]; nodes[d]["acc_ca"] += nodes[b]["acc_ca"]

    # outfall location: nearest water cell centre to the node cell
    wc = np.where(water_cells)[0]
    wxy = np.array([cell_center(i // NX, i % NX) for i in wc])
    kx, ky = C.kx, KY

    rng = np.random.default_rng(SEED)
    out_nodes, pipes = [], []
    ids = {b: i for i, b in enumerate(sorted(nodes))}
    for b in sorted(nodes):
        n = nodes[b]
        lon, lat = cell_center(n["cell"] // NX, n["cell"] % NX)
        qd = n["acc_ca"] * DESIGN_I_MMPH / 1000 / 3600  # m3/s
        if n["down"] is None:
            j = np.argmin(np.hypot((wxy[:, 0] - lon) * kx, (wxy[:, 1] - lat) * ky))
            tlon, tlat = wxy[j]; tground = min(n["ground"], 0.5)
        else:
            m = nodes[n["down"]]; tlon, tlat = cell_center(m["cell"] // NX, m["cell"] % NX); tground = m["ground"]
        length = max(150.0, float(np.hypot((tlon - lon) * kx, (tlat - lat) * ky)))
        slope = max(MIN_SLOPE, (n["ground"] - tground) / length)
        barrels, size = 1, SIZES_M[-1]
        for s in SIZES_M:
            if manning_full(s, slope) >= qd:
                size = s; break
        else:
            barrels = int(np.ceil(qd / manning_full(size, slope)))
        cap = barrels * manning_full(size, slope)
        blockage = float(np.round(rng.beta(2, 8), 3))
        out_nodes.append(dict(id=ids[b], lon=round(lon, 5), lat=round(lat, 5),
                              type="outfall" if n["down"] is None else ("junction" if hops[b] < max(hops.values()) else "inlet"),
                              ground_m=round(n["ground"], 2), invert_m=round(n["ground"] - COVER_M - size, 2),
                              down=None if n["down"] is None else ids[n["down"]], hops=hops[b],
                              local_area_m2=n["area"], acc_area_m2=n["acc_area"], runoff_c=round(n["c"], 3),
                              acc_ca_m2=round(n["acc_ca"]), design_q_m3s=round(qd, 3), blockage=blockage,
                              pipe_d_m=size, barrels=barrels, slope=round(slope, 4), length_m=round(length),
                              manning_n=MANNING_N, capacity_m3s=round(cap, 3),
                              out_lon=round(float(tlon), 5), out_lat=round(float(tlat), 5)))
    cell_node_id = [ids[b] if b >= 0 else -1 for b in cell_node]

    fc_nodes = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [n["lon"], n["lat"]]},
         "properties": {k: v for k, v in n.items() if k not in ("lon", "lat", "out_lon", "out_lat")}} for n in out_nodes]}
    fc_pipes = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "LineString",
                                         "coordinates": [[n["lon"], n["lat"]], [n["out_lon"], n["out_lat"]]]},
         "properties": dict(id=n["id"], to=n["down"], d_m=n["pipe_d_m"], barrels=n["barrels"], outfall=n["down"] is None,
                            capacity_m3s=n["capacity_m3s"])} for n in out_nodes]}
    (PROC / "drainage_nodes.geojson").write_text(json.dumps(fc_nodes, separators=(",", ":")))
    (PROC / "drainage_pipes.geojson").write_text(json.dumps(fc_pipes, separators=(",", ":")))
    (PROC / "drainage.json").write_text(json.dumps(dict(
        nodes=out_nodes, cell_node=cell_node_id,
        params=dict(block_cells=BLOCK, design_i_mmph=DESIGN_I_MMPH, manning_n=MANNING_N, min_slope=MIN_SLOPE,
                    sizes_m=SIZES_M, seed=SEED, blockage_dist="Beta(2,8)"))))
    nout = sum(n["type"] == "outfall" for n in out_nodes)
    print(f"[{C.id}] {len(out_nodes)} nodes ({nout} outfalls); max acc area {max(n['acc_area_m2'] for n in out_nodes)/1e6:.1f} km2; "
          f"capacity range {min(n['capacity_m3s'] for n in out_nodes):.2f}..{max(n['capacity_m3s'] for n in out_nodes):.1f} m3/s")


if __name__ == "__main__":
    main()
