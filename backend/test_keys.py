"""`GET /api/keys` — whether a key works, as opposed to whether one is set.

The distinction is the whole point of the endpoint. A key that is present but revoked,
and a provider that cannot be reached, both used to arrive in the UI as rows reading
"Nessuna corrispondenza trovata" — the same words a genuine no-match produces — so the user went
looking at the naming pipeline for a problem that was in the environment.

Nothing here touches the network: `httpx.AsyncClient` is replaced, so a run offline (or
in CI, where there are no keys) exercises exactly the same branches.
"""

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import api_clients
from backend.api_clients import TMDBClient, TVDBClientV4
from backend.main import app


class _FakeClient:
    """Stands in for `httpx.AsyncClient` as the two verifiers use it: one call, in a
    context manager. Anything else raises rather than quietly returning a stub."""

    def __init__(self, handler):
        self._handler = handler

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    async def get(self, url, **kwargs):
        return self._handler("GET", url, kwargs)

    async def post(self, url, **kwargs):
        return self._handler("POST", url, kwargs)


@pytest.fixture
def transport(monkeypatch):
    """Installs a handler for the next verification call and records what it saw."""

    calls: list[tuple[str, str, dict]] = []

    def install(handler):
        def record(method, url, kwargs):
            calls.append((method, url, kwargs))
            return handler(method, url, kwargs)

        monkeypatch.setattr(api_clients.httpx, "AsyncClient", lambda *a, **k: _FakeClient(record))
        return calls

    return install


def _ok(payload: dict | None = None, status: int = 200) -> httpx.Response:
    return httpx.Response(status_code=status, json=payload if payload is not None else {"success": True})


async def test_tmdb_accepts_the_key(transport):
    calls = transport(lambda *_: _ok())
    status = await TMDBClient("k").verify_key()
    assert status.state == "ok"
    # The cheapest authenticated call TMDB has: its only job is to answer this question.
    assert calls[0][0] == "GET"
    assert calls[0][1].endswith("/authentication")


@pytest.mark.parametrize("code", [401, 403])
async def test_a_rejected_tmdb_key_is_invalid_not_unreachable(transport, code):
    transport(lambda *_: httpx.Response(status_code=code, json={"status_message": "Invalid API key"}))
    status = await TMDBClient("k").verify_key()
    assert status.state == "invalid"


async def test_a_tmdb_outage_is_not_the_user_s_fault(transport):
    # 500 and a dead socket are the same answer: nothing is known about the key, and
    # telling the user to rotate it would send them to revoke a working one.
    transport(lambda *_: _ok(status=503))
    assert (await TMDBClient("k").verify_key()).state == "unreachable"

    def explode(*_):
        raise httpx.ConnectError("DNS")

    transport(explode)
    status = await TMDBClient("k").verify_key()
    assert status.state == "unreachable"
    assert "ConnectError" in status.detail


async def test_tvdb_logs_in_with_the_pin(transport):
    calls = transport(lambda *_: _ok({"data": {"token": "t"}}))
    status = await TVDBClientV4("k", "1234").verify_key()
    assert status.state == "ok"
    assert calls[0][0] == "POST"
    assert calls[0][1].endswith("/login")
    assert calls[0][2]["json"] == {"apikey": "k", "pin": "1234"}


async def test_a_tvdb_login_without_a_token_is_invalid(transport):
    # A 200 with no token is TVDB accepting the request and refusing the credentials.
    transport(lambda *_: _ok({"data": {}}))
    assert (await TVDBClientV4("k", None).verify_key()).state == "invalid"


async def test_tvdb_answering_with_something_that_is_not_json(transport):
    transport(lambda *_: httpx.Response(status_code=200, text="<html>maintenance</html>"))
    assert (await TVDBClientV4("k", None).verify_key()).state == "unreachable"


def test_no_key_is_reported_as_missing_without_a_request(transport, monkeypatch):
    def explode(*_):
        raise AssertionError("no request may be made when there is nothing to verify")

    transport(explode)
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    monkeypatch.delenv("TVDB_API_KEY", raising=False)

    body = TestClient(app).get("/api/keys").json()
    assert body["tmdb"]["state"] == "missing"
    assert body["tvdb"]["state"] == "missing"
    assert "TMDB_API_KEY" in body["tmdb"]["detail"]


def test_the_endpoint_never_echoes_the_key(transport, monkeypatch):
    transport(lambda *_: _ok({"data": {"token": "t"}}))
    monkeypatch.setenv("TMDB_API_KEY", "super-secret-value")
    monkeypatch.setenv("TVDB_API_KEY", "super-secret-value")
    monkeypatch.setenv("TVDB_PIN", "super-secret-pin")

    response = TestClient(app).get("/api/keys")
    assert response.json()["tmdb"]["state"] == "ok"
    assert "super-secret" not in response.text
