"""CORS preflight: the methods the browser is actually allowed to send.

This file exists because nothing asserted CORS before it, and that gap shipped a
real bug. `allow_methods` was ["GET", "POST"], so the preflight for every DELETE
and PATCH was rejected with "Disallowed CORS method" and the request never
reached FastAPI at all. Chat deletion from the sidebar and the entire memory
admin surface were dead in the browser while every server-side test passed --
the routes themselves were fine, and curl (which sends no Origin) proved it.

Only the clients that call API_BASE cross-origin are exposed to this. The ones
on relative Next routes are same-origin, never preflight, and would not have
caught the regression no matter how thoroughly they were tested.

TestClient is constructed WITHOUT the `with` block on purpose. Entering it as a
context manager runs the app lifespan, which calls `pool.open(wait=True)` and
hangs forever on Windows' ProactorEventLoop. Middleware runs on the request
path, not at startup, so a preflight needs no lifespan and no database.
"""

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app

ALLOWED_ORIGIN = get_settings().cors_origins[0]


def _preflight(method: str, origin: str = ALLOWED_ORIGIN):
    """One CORS preflight, exactly as a browser sends it before `method`."""
    return TestClient(app).options(
        "/api/chat/sessions/some-session-id",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
        },
    )


# GET and POST were already allowed and are here as controls: if the wiring
# broke entirely, these fail too and the DELETE/PATCH failures below are noise.
@pytest.mark.parametrize("method", ["GET", "POST", "PATCH", "DELETE"])
def test_the_browser_may_send_every_method_the_api_serves(method):
    """The regression. DELETE and PATCH are the two that were rejected."""
    response = _preflight(method)

    assert response.status_code == 200, (
        f"{method} preflight rejected: {response.text!r}. The browser would "
        f"never send the real request."
    )
    allowed = response.headers["access-control-allow-methods"]
    assert method in allowed, f"{method} missing from {allowed!r}"


def test_a_foreign_origin_is_still_refused():
    """Guards the fix against overcorrection.

    Widening allow_methods must not widen allow_origins. Without this, someone
    'fixing' a future CORS complaint with allow_origins=["*"] would leave every
    assertion above passing while the API answers to any site on the internet.
    """
    response = _preflight("DELETE", origin="http://evil.example.com")

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_put_is_not_allowed_until_a_route_needs_it():
    """No router defines PUT, so the allowlist stays a deliberate statement
    rather than a rubber stamp. Delete this test when a PUT route lands."""
    assert "PUT" not in _preflight("PUT").headers.get(
        "access-control-allow-methods", ""
    )
