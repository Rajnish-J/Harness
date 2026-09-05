"""The template catalog route, and init's optional body.

Mounted on a bare FastAPI app rather than app.main: these routes need no pool,
and the real lifespan cannot open one on Windows' ProactorEventLoop.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.projects import router
from app.projects.templates import DEFAULT_TEMPLATE_ID, TEMPLATES


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_catalog_lists_every_registered_template(client):
    body = client.get("/api/projects/templates").json()
    assert body["default"] == DEFAULT_TEMPLATE_ID
    assert [t["id"] for t in body["templates"]] == [t.id for t in TEMPLATES]
    assert all(t["name"] and t["description"] for t in body["templates"])


def test_catalog_needs_no_database(client):
    """No pool is configured here at all, so a 200 proves it never asks."""
    assert client.get("/api/projects/templates").status_code == 200


def test_init_accepts_a_bodyless_post(client):
    """Older clients POST no body; a required model would 422 every one of them.

    503 is the missing-pool guard, which sits *after* request validation -- so
    reaching it is the proof that the body was accepted.
    """
    response = client.post("/api/projects/whatever/init")
    assert response.status_code == 503


def test_init_accepts_an_explicit_template(client):
    response = client.post("/api/projects/whatever/init", json={"template": "nextjs"})
    assert response.status_code == 503


def test_init_rejects_an_over_long_template_id(client):
    """max_length on the field, so a junk id cannot reach the registry lookup."""
    response = client.post("/api/projects/whatever/init", json={"template": "x" * 200})
    assert response.status_code == 422
