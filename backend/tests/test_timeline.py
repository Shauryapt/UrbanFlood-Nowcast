"""15-min model forecast: native model frames exposed from the same run as the 4-frame /nowcast."""
import numpy as np
import pytest

import model
from conftest import CITY, HEAVY

T_MIN = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180]
HEAVY_HIGH_SEVERE_HOURLY = [96, 493, 984, 584]


@pytest.fixture(scope="module")
def tl(client):
    r = client.get(f"/api/cities/{CITY}/nowcast/timeline", params=HEAVY)
    assert r.status_code == 200
    return r.json()


def test_thirteen_frames_in_order(tl):
    assert len(tl["frames"]) == 13
    assert [f["t_min"] for f in tl["frames"]] == T_MIN
    assert [a["t_min"] for a in tl["alerts"]] == T_MIN


def test_resolution_is_stated_honestly(tl):
    r = tl["resolution"]
    assert r["model_dt_min"] == 15 and r["frames"] == 13 and r["live_cache_s"] == 600
    assert "15-minute model timestep" in r["note"] and "10-minute cycle" in r["note"]
    assert "hourly" in r["rain_input"]
    assert tl["source"] == "scenario" and tl["status"] == "DEMO"


def test_arrays_have_cell_count(tl, heavy):
    assert tl["cells"] == heavy["cells"]
    n = len(tl["cells"]); nn = len(heavy["node_blockage"])
    assert len(tl["rain_pattern"]) == n and len(tl["lead_min"]) == n
    for f in tl["frames"]:
        for k in ("cls", "depth_cm", "depth_cls"):
            assert len(f[k]) == n, k
        assert len(f["node_util"]) == nn
        assert set(f["cls"]) <= {0, 1, 2, 3} and set(f["depth_cls"]) <= {0, 1, 2, 3}
        assert min(f["depth_cm"]) >= 0 and f["rain_mmph"] >= 0


def test_counts_internally_consistent(tl):
    n = len(tl["cells"])
    for f in tl["frames"]:
        assert [f["cls"].count(c) for c in range(4)] == f["counts"]
        assert sum(f["counts"]) == n
        assert f["high_severe"] == f["counts"][2] + f["counts"][3]
        assert all(c >= d for c, d in zip(f["cls"], f["depth_cls"]))   # class = max(score class, depth class)


def test_hourly_frames_match_nowcast(tl, heavy):
    for i, h in enumerate(heavy["frames"]):
        f = tl["frames"][4 * i]
        assert f["t_min"] == h["t_min"]
        for k in ("cls", "depth_cm", "node_util", "counts", "tide"):
            assert f[k] == h[k], k
        rain = np.array(tl["rain_pattern"]) * f["rain_mmph"]
        assert np.abs(rain - np.array(h["rain"])).max() <= 0.06
    assert [tl["frames"][i]["high_severe"] for i in (0, 4, 8, 12)] == HEAVY_HIGH_SEVERE_HOURLY
    assert tl["lead_min"] == heavy["lead_min"]


def test_hourly_alerts_match_nowcast(tl, heavy):
    for i, a in enumerate(heavy["alerts"]):
        assert tl["alerts"][4 * i] == a


def test_intermediate_frames_are_native_model_states(tl):
    r = model.run_scenario(CITY, model.Scenario("heavy"))
    assert len(r["frames"]) == 13
    for f, rf in zip(tl["frames"], r["frames"]):
        assert f["t_min"] == rf["t_min"]
        assert f["cls"] == rf["cls"].astype(int).tolist()
        assert f["high_severe"] == int((rf["cls"] >= 2).sum())
    hs = [f["high_severe"] for f in tl["frames"]]
    assert hs[1] not in (hs[0], hs[4]) or hs[2] not in (hs[0], hs[4])   # sub-hourly frames carry their own state


def test_depth_cls_matches_street_status(client, tl):
    k_of = {c: k for k, c in enumerate(tl["cells"])}
    for hourly in range(4):
        fc = client.get(f"/api/cities/{CITY}/streets", params=dict(HEAVY, frame=hourly)).json()
        f = tl["frames"][4 * hourly]
        for seg in fc["features"][::25]:
            p = seg["properties"]; k = k_of[p["cell"]]
            assert ["CLEAR", "CAUTION", "HIGH RISK", "ROAD CLOSURE RISK"][f["depth_cls"][k]] == p["flood_status"]
            assert f["depth_cm"][k] == p["depth_cm"]


def test_cell_timeline(client, heavy, alert_cell):
    r = client.get(f"/api/cities/{CITY}/cell/{alert_cell}/timeline", params=HEAVY)
    assert r.status_code == 200
    d = r.json()
    assert [t["t_min"] for t in d["timeline"]] == T_MIN
    hourly = client.get(f"/api/cities/{CITY}/cell/{alert_cell}", params=HEAVY).json()
    for k in ("cell", "lon", "lat", "place", "static", "node", "lead_min"):
        assert d[k] == hourly[k], k
    for i, t in enumerate(hourly["timeline"]):
        assert d["timeline"][4 * i] == t
    for t in d["timeline"]:
        assert abs(sum(c["points"] for c in t["contributions"]) - t["score"]) <= 0.6


def test_cell_timeline_404(client):
    assert client.get(f"/api/cities/{CITY}/cell/0/timeline", params=HEAVY).status_code == 404
    assert client.get("/api/cities/atlantis/cell/1/timeline").status_code == 404


def test_timeline_bad_requests(client):
    assert client.get("/api/cities/atlantis/nowcast/timeline").status_code == 404
    assert client.get(f"/api/cities/{CITY}/nowcast/timeline", params=dict(HEAVY, preset="nope")).status_code == 400
    assert client.get(f"/api/cities/{CITY}/nowcast/timeline", params=dict(HEAVY, multiplier=9)).status_code == 422


def test_existing_nowcast_still_four_frames(client, tl):
    n = client.get(f"/api/cities/{CITY}/nowcast", params=HEAVY).json()
    assert [f["t_min"] for f in n["frames"]] == [0, 60, 120, 180]
    assert set(n) == {"city", "cells", "frames", "lead_min", "node_blockage", "rain_hourly", "rain_hours", "alerts",
                      "source", "status", "generated"}
    assert [f["counts"][2] + f["counts"][3] for f in n["frames"]] == HEAVY_HIGH_SEVERE_HOURLY


def test_existing_street_endpoints_still_four_frames(client, tl):
    s = client.get(f"/api/cities/{CITY}/streets/status", params=HEAVY).json()
    assert [f["t_min"] for f in s["frames"]] == [0, 60, 120, 180]
    assert client.get(f"/api/cities/{CITY}/streets", params=dict(HEAVY, frame=3)).status_code == 200
    assert client.get(f"/api/cities/{CITY}/streets", params=dict(HEAVY, frame=4)).status_code == 422
