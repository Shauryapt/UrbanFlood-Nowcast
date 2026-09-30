"""Model regression tests against the committed Mumbai data (heavy design storm, x1, no added blockage,
high tide). Reference values were recorded from the working prototype at commit 39339bd; if a deliberate
model change alters them, update the references here and the README tables together."""
import time

import numpy as np
import pytest

import model
from conftest import CITY

HEAVY_HIGH_SEVERE = [96, 493, 984, 584]     # cells at High or Severe at NOW, +1 h, +2 h, +3 h
HEAVY_MAX_DEPTH_2H_CM = 114


@pytest.fixture(scope="module")
def m():
    return model.get_model(CITY)


@pytest.fixture(scope="module")
def run(m):
    return model.run_scenario(CITY, model.Scenario("heavy"))


def test_network_size(m):
    assert len(m.idx) == 6924
    assert len(m.nodes) == 511


def test_heavy_high_severe_counts(run):
    got = [int((run["frames"][fi]["cls"] >= 2).sum()) for fi in model.HOURLY_FRAMES]
    assert got == HEAVY_HIGH_SEVERE


def test_heavy_max_depth_at_2h(run):
    depth_cm = run["frames"][model.HOURLY_FRAMES[2]]["depth"].max() * 100
    assert abs(depth_cm - HEAVY_MAX_DEPTH_2H_CM) <= 1.0


def test_summary_matches_model(run):
    s = model.summary(CITY, model.Scenario("heavy"))
    assert [f["counts"][2] + f["counts"][3] for f in s["frames"]] == HEAVY_HIGH_SEVERE
    assert max(s["frames"][2]["depth_cm"]) == HEAVY_MAX_DEPTH_2H_CM


def test_contributions_sum_to_score(run):
    for f in run["frames"]:
        total = sum(f["contrib"].values())
        np.testing.assert_allclose(total, f["score"], rtol=0, atol=1e-9)
        assert f["score"].min() >= 0 and f["score"].max() <= 100


def test_contribution_keys_match_factors(run):
    keys = {k for k, _, _ in model.FACTORS}
    for f in run["frames"]:
        assert set(f["contrib"]) == keys


def test_class_is_max_of_score_and_depth_class(run):
    for f in run["frames"]:
        cls_s = np.searchsorted(model.SCORE_T, f["score"], side="right")
        cls_d = np.searchsorted(model.DEPTH_T, f["depth"], side="right")
        np.testing.assert_array_equal(f["cls"], np.maximum(cls_s, cls_d))
        assert set(np.unique(f["cls"])) <= {0, 1, 2, 3}


def test_lead_time_consistent_with_classes(run):
    lead = run["lead_min"]
    hi = np.array([f["cls"] >= 2 for f in run["frames"]])
    assert np.array_equal(lead >= 0, hi.any(0))
    assert set(np.unique(lead[lead >= 0])) <= {i * model.DT_MIN for i in range(len(run["frames"]))}


def test_frames_are_15_min_steps_over_3h(run):
    assert [f["t_min"] for f in run["frames"]] == list(range(0, 181, model.DT_MIN))
    assert [run["frames"][fi]["t_min"] for fi in model.HOURLY_FRAMES] == [0, 60, 120, 180]


def test_drainage_node_references(m):
    nn = len(m.nodes)
    # node id == list index: the frontend's MapLibre promoteId/feature-state relies on this
    assert [n["id"] for n in m.nodes] == list(range(nn))
    for n in m.nodes:
        assert n["down"] is None or 0 <= n["down"] < nn
        assert (n["type"] == "outfall") == (n["down"] is None)
    # every node reaches an outfall (acyclic tree)
    for k in range(nn):
        seen = 0
        while m.nodes[k]["down"] is not None:
            k = m.nodes[k]["down"]; seen += 1
            assert seen <= nn
    assert m.cnode.min() >= 0 and m.cnode.max() < nn


def test_drainage_layers_match_model(client, m):
    nodes = client.get(f"/api/cities/{CITY}/layers/drainage_nodes").json()["features"]
    pipes = client.get(f"/api/cities/{CITY}/layers/drainage_pipes").json()["features"]
    assert [f["properties"]["id"] for f in nodes] == list(range(len(m.nodes)))
    assert [f["properties"]["id"] for f in pipes] == list(range(len(m.nodes)))
    for f in nodes:
        assert f["properties"]["down"] == m.nodes[f["properties"]["id"]]["down"]
    for f in pipes:
        p = f["properties"]
        assert p["to"] == m.nodes[p["id"]]["down"]
        assert p["outfall"] == (p["to"] is None)


def test_runtime_reasonable(m):
    t = time.perf_counter()
    m.run(model.Scenario("heavy"))          # uncached run
    assert time.perf_counter() - t < 5.0     # ~0.3 s locally; generous margin for slow machines
