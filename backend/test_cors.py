"""Tests for the absence of a CORS middleware.

The app used to mount `CORSMiddleware(allow_origins=["*"], allow_credentials=True)`.
That reads as spec-invalid-and-therefore-inert, and it is not: Starlette does not send
a literal `*` when credentials are on, it *echoes the requesting Origin* and pairs it
with `Access-Control-Allow-Credentials: true`. Any page in any tab could therefore
preflight `POST /api/rename`, and the browser would attach the SSO cookie of whoever
was logged in and write to a Plex library that has no undo.

Nothing legitimate needs it. In the container this app serves both the bundle and the
API under one hostname; in development Vite proxies `/api` server-side. The browser
sees one origin either way, so re-adding a middleware "for development" would buy
nothing and cost that.
"""

import json

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)
HOSTILE = "https://evil.example"

# The write endpoints, with a body each one would accept if it got that far. `/api/rename`
# is given an empty batch on purpose: it must be harmless even when it is *not* refused.
WRITES = [
    ("/api/rename", {"items": []}),
    ("/api/scan", {"directory": "/media"}),
]


@pytest.mark.parametrize("path", [path for path, _ in WRITES] + ["/api/cache", "/api/config"])
def test_a_preflight_from_another_origin_is_not_answered(path: str) -> None:
    """No `Access-Control-Allow-Origin`, so the browser never sends the real request."""
    response = client.options(
        path,
        headers={
            "Origin": HOSTILE,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code >= 400
    assert "access-control-allow-origin" not in response.headers
    assert "access-control-allow-credentials" not in response.headers


def test_a_cross_origin_response_carries_no_permission_to_read_it() -> None:
    """The other half: a request that *is* sent must not come back readable."""
    response = client.get("/api/health", headers={"Origin": HOSTILE})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
    assert "access-control-allow-credentials" not in response.headers


@pytest.mark.parametrize("path, body", WRITES)
@pytest.mark.parametrize(
    "content_type",
    [
        "text/plain;charset=UTF-8",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=----x",
    ],
)
def test_a_write_cannot_dodge_the_preflight_with_a_safelisted_content_type(
    path: str, body: dict, content_type: str
) -> None:
    """Why removing the middleware is a fix and not a mitigation.

    The usual objection to relying on CORS is that it stops a response being *read*,
    not a request being *sent* — an HTML form posts cross-site with no preflight at all.
    That escape needs one of the three CORS-safelisted content types, and every write
    here takes a JSON body, so all three are refused before any work happens. The
    preflight is therefore mandatory, and a preflight that is not answered is a request
    the browser never makes.

    This is the load-bearing assumption of the whole change: an endpoint that later
    learned to accept a form would quietly reopen the hole, and would fail here first.
    """
    response = client.post(path, content=json.dumps(body), headers={"Content-Type": content_type})
    assert response.status_code == 422


def test_the_same_body_as_json_is_accepted() -> None:
    """The refusals above have to be about the content type, not about the payload."""
    response = client.post("/api/rename", json={"items": []})
    assert response.status_code == 200
    assert response.json() == []
