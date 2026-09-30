"""Derived street flood status: modelled grid values sampled onto OSM road segments."""
import hashlib
from pathlib import Path

import pytest

import model
from conftest import CITY, HEAVY

STATUSES = ["CLEAR", "CAUTION", "HIGH RISK", "ROAD CLOSURE RISK"]
PROPS = {"id", "road_id", "name", "highway", "cell", "t_min", "depth_cm", "risk_class", "flood_status"}


@pytest.fixture(scope="module")
def streets_by_frame(client):
    out = []
    for frame in range(4):
        r = client.get(f"/api/cities/{CITY}/streets", params=dict(HEAVY, frame=frame))
        assert r.status_code == 200
        out.append(r.json())
    return out


@pytest.fixture(scope="module")
def street_status(client):
    r = client.get(f"/api/cities/{CITY}/streets/status", params=HEAVY)
    assert r.status_code == 200
    return r.json()


def test_geojson_structure(streets_by_frame):
    fc = streets_by_frame[0]
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) > 1000
    assert [f["properties"]["id"] for f in fc["features"]] == list(range(len(fc["features"])))
    for f in fc["features"]:
        assert f["type"] == "Feature" and f["id"] == f["properties"]["id"]
        assert f["geometry"]["type"] == "LineString" and len(f["geometry"]["coordinates"]) >= 2
        assert set(f["properties"]) == PROPS


def test_derived_labelling(streets_by_frame):
    d = streets_by_frame[0]["derived"]
    assert d["cls"] == "SIMULATED"
    assert "Derived from the 300 m model grid" in d["note"]
    assert d["statuses"] == STATUSES
    assert d["depth_thresholds_m"] == list(model.DEPTH_T)     # existing model thresholds, not new ones


def test_properties_and_statuses_valid(streets_by_frame, heavy):
    cells = set(heavy["cells"])
    for fc in streets_by_frame:
        for f in fc["features"]:
            p = f["properties"]
            assert p["flood_status"] in STATUSES
            assert p["risk_class"] in model.CLASSES
            assert p["depth_cm"] >= 0 and p["cell"] in cells
            assert p["highway"] in ("motorway", "trunk", "primary", "secondary")


def test_segment_values_match_nowcast_grid(streets_by_frame, heavy):
    k_of = {c: k for k, c in enumerate(heavy["cells"])}
    for fc, frame in zip(streets_by_frame, heavy["frames"]):
        assert fc["t_min"] == frame["t_min"]
        for f in fc["features"][::50]:
            p = f["properties"]; k = k_of[p["cell"]]
            assert p["t_min"] == frame["t_min"]
            assert p["depth_cm"] == frame["depth_cm"][k]
            assert p["risk_class"] == model.CLASSES[frame["cls"][k]]


def test_status_uses_existing_depth_thresholds(streets_by_frame):
    # status boundaries are model.DEPTH_T (0.15 / 0.30 / 0.60 m); allow 1 cm for rounding of depth_cm
    lo = [0] + [round(t * 100) for t in model.DEPTH_T]
    hi = [round(t * 100) for t in model.DEPTH_T] + [10_000]
    for fc in streets_by_frame:
        for f in fc["features"]:
            i = STATUSES.index(f["properties"]["flood_status"])
            assert lo[i] - 1 <= f["properties"]["depth_cm"] <= hi[i]


def test_frame_changes_values(streets_by_frame):
    counts = [sum(f["properties"]["flood_status"] != "CLEAR" for f in fc["features"]) for fc in streets_by_frame]
    assert counts[2] > counts[0]           # heavy storm: more flooded road segments at +2 h than at NOW
    d0 = [f["properties"]["depth_cm"] for f in streets_by_frame[0]["features"]]
    d2 = [f["properties"]["depth_cm"] for f in streets_by_frame[2]["features"]]
    assert d0 != d2


def test_geometry_is_frame_independent(streets_by_frame):
    g = [[f["geometry"] for f in fc["features"]] for fc in streets_by_frame]
    assert g[0] == g[1] == g[2] == g[3]


def test_status_endpoint_matches_geojson(street_status, streets_by_frame):
    assert len(street_status["frames"]) == 4
    assert street_status["derived"]["statuses"] == STATUSES
    for s, fc in zip(street_status["frames"], streets_by_frame):
        assert s["t_min"] == fc["t_min"]
        n = len(fc["features"])
        assert len(s["status"]) == len(s["depth_cm"]) == len(s["risk"]) == n
        for f in fc["features"]:
            p = f["properties"]; i = p["id"]
            assert STATUSES[s["status"][i]] == p["flood_status"]
            assert s["depth_cm"][i] == p["depth_cm"]
            assert model.CLASSES[s["risk"][i]] == p["risk_class"]


def test_scenario_changes_status(client, street_status):
    r = client.get(f"/api/cities/{CITY}/streets/status", params=dict(HEAVY, multiplier=0.5))
    assert r.status_code == 200
    low = sum(v > 0 for v in r.json()["frames"][2]["status"])
    assert low < sum(v > 0 for v in street_status["frames"][2]["status"])


def test_bad_requests(client):
    assert client.get("/api/cities/atlantis/streets").status_code == 404
    assert client.get("/api/cities/atlantis/streets/status").status_code == 404
    assert client.get(f"/api/cities/{CITY}/streets", params=dict(HEAVY, frame=4)).status_code == 422
    assert client.get(f"/api/cities/{CITY}/streets", params=dict(HEAVY, preset="nope")).status_code == 400


def test_existing_roads_layer_unchanged(client):
    r = client.get(f"/api/cities/{CITY}/layers/roads")
    assert r.status_code == 200
    committed = (Path(__file__).resolve().parents[1] / "data/cities" / CITY / "processed/roads.geojson").read_bytes()
    assert hashlib.sha256(r.content).digest() == hashlib.sha256(committed).digest()
    assert set(r.json()["features"][0]["properties"]) == {"highway", "name"}


def test_streets_do_not_change_nowcast(client, heavy):
    client.get(f"/api/cities/{CITY}/streets", params=dict(HEAVY, frame=2))
    again = client.get(f"/api/cities/{CITY}/nowcast", params=HEAVY).json()
    for k in ("cells", "frames", "lead_min", "alerts", "node_blockage"):
        assert again[k] == heavy[k]
