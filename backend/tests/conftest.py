"""Shared fixtures. Tests use the committed Mumbai processed data and design-storm scenarios only
(no network: live Open-Meteo mode is not exercised)."""
import pytest
from fastapi.testclient import TestClient

import app

CITY = "mumbai"
HEAVY = dict(source="scenario", preset="heavy", multiplier=1.0, blockage=0.0, tide="high")


@pytest.fixture(scope="session")
def client():
    return TestClient(app.app)


@pytest.fixture(scope="session")
def meta(client):
    r = client.get(f"/api/cities/{CITY}/meta")
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def heavy(client):
    r = client.get(f"/api/cities/{CITY}/nowcast", params=HEAVY)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="session")
def alert_cell(heavy):
    """A valid modelled cell: the top-ranked alert at +2 h in the heavy scenario."""
    items = heavy["alerts"][2]["items"]
    assert items, "heavy scenario should produce alerts at +2 h"
    return items[0]["cell"]
