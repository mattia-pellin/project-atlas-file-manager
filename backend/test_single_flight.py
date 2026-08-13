"""One fetch per cache key, however many rows ask for it at once.

The cache in `api_clients` is keyed correctly — a search on the title, an extended
record on the series id — but it is read before the request and written after it, and
the frontend analyses up to `Settings.analyzeConcurrency` files in parallel. A season
pack therefore had every row reach the same empty entry simultaneously and every row
fetch it, which for `get_series_extended` means paginating the whole episode list N
times over. These tests pin the coalescing, and the fact that the lock registry does
not grow while doing it.

Nothing here asserts a filename: the payloads are unchanged by design, so the naming
suites remain the ones that speak for the output.
"""

import asyncio
from typing import Any

import pytest

from backend import api_clients
from backend.api_clients import TVDBClientV4

DOCTOR_WHO = 78804
STARGATE = 72449


class FakeCache:
    """The diskcache surface `api_clients` actually uses, in a dict."""

    def __init__(self) -> None:
        self.store: dict[str, Any] = {}

    def __contains__(self, key: str) -> bool:
        return key in self.store

    def __getitem__(self, key: str) -> Any:
        return self.store[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.store.get(key, default)

    def set(self, key: str, value: Any, expire: int | None = None) -> None:
        self.store[key] = value


class GatedTVDB(TVDBClientV4):
    """Counts requests and holds them open until the test says so.

    The gate is what makes the assertion meaningful: it parks the first caller
    *inside* the fetch, so every other task has reached its own cache check before
    anything is stored. Without it a fast stub could complete before the second task
    was ever scheduled, and the test would pass with the lock removed.
    """

    def __init__(self) -> None:
        super().__init__("api-key")
        self.calls: list[str] = []
        self.gate = asyncio.Event()

    async def _request(self, endpoint: str, token: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.calls.append(endpoint)
        await self.gate.wait()
        return {
            "data": {
                "name": "Doctor Who",
                "year": "2005",
                "episodes": [{"id": 1, "seasonNumber": 5, "number": 1, "name": "The Eleventh Hour"}],
            }
        }

    async def get_series_translation(
        self, series_id: int, language_prefs: list[str], bypass_cache: bool = False
    ) -> None:
        return None


async def _let_everyone_reach_the_cache(times: int = 20) -> None:
    for _ in range(times):
        await asyncio.sleep(0)


@pytest.fixture(autouse=True)
def isolated_cache(mocker):
    mocker.patch.object(api_clients, "cache", FakeCache())
    api_clients._search_locks.clear()
    api_clients._lock_waiters.clear()


async def test_one_extended_fetch_serves_every_episode_of_a_season() -> None:
    """Four `Doctor Who S05E0n.mkv` rows resolve one series, so they cost one request."""
    client = GatedTVDB()

    tasks = [asyncio.create_task(client.get_series_extended(DOCTOR_WHO, ["it", "en"], "token")) for _ in range(4)]
    await _let_everyone_reach_the_cache()
    client.gate.set()
    results = await asyncio.gather(*tasks)

    assert client.calls == [f"/series/{DOCTOR_WHO}/extended"]
    # And the three that waited get the same record, not None.
    assert [r["name"] for r in results] == ["Doctor Who"] * 4
    assert [r["tvdb_id"] for r in results] == [DOCTOR_WHO] * 4


async def test_distinct_series_are_not_serialised_behind_one_another() -> None:
    """The flight is per key. Two different series must still be fetched twice."""
    client = GatedTVDB()

    tasks = [
        asyncio.create_task(client.get_series_extended(series_id, ["it", "en"], "token"))
        for series_id in (DOCTOR_WHO, STARGATE)
    ]
    await _let_everyone_reach_the_cache()
    client.gate.set()
    await asyncio.gather(*tasks)

    assert sorted(client.calls) == sorted([f"/series/{DOCTOR_WHO}/extended", f"/series/{STARGATE}/extended"])


async def test_a_second_wave_reads_the_cache_instead_of_refetching() -> None:
    """The coalescing must not have cost the ordinary cache hit that follows it."""
    client = GatedTVDB()
    client.gate.set()

    await client.get_series_extended(DOCTOR_WHO, ["it", "en"], "token")
    await client.get_series_extended(DOCTOR_WHO, ["it", "en"], "token")

    assert client.calls == [f"/series/{DOCTOR_WHO}/extended"]


async def test_the_lock_registry_is_empty_once_the_callers_are_done() -> None:
    """Refcounted, because the keys carry every title and series id ever looked up.

    `_search_locks` growing without bound is a tracked defect; the entry has to be
    dropped by the last waiter out, not kept for the life of the process.
    """
    client = GatedTVDB()

    tasks = [asyncio.create_task(client.get_series_extended(DOCTOR_WHO, ["it", "en"], "token")) for _ in range(4)]
    await _let_everyone_reach_the_cache()
    # Held open, so the entry must still be there while anyone is using it.
    assert api_clients._search_locks
    client.gate.set()
    await asyncio.gather(*tasks)

    assert api_clients._search_locks == {}
    assert api_clients._lock_waiters == {}


async def test_a_failed_fetch_leaves_no_lock_behind() -> None:
    """The cleanup is in a `finally`, so an exception must not leak the entry either."""

    class ExplodingTVDB(TVDBClientV4):
        async def _request(self, endpoint: str, token: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
            raise RuntimeError("TVDB fell over")

    assert await ExplodingTVDB("api-key").get_series_extended(DOCTOR_WHO, ["it"], "token") is None
    assert api_clients._search_locks == {}


class GatedLogin:
    """`httpx.AsyncClient` for the one call `get_token` makes."""

    def __init__(self) -> None:
        self.posts = 0
        self.gate = asyncio.Event()

    def __call__(self, *args: Any, **kwargs: Any) -> GatedLogin:
        return self

    async def __aenter__(self) -> GatedLogin:
        return self

    async def __aexit__(self, *args: Any) -> bool:
        return False

    async def post(self, url: str, **kwargs: Any) -> Any:
        self.posts += 1
        await self.gate.wait()
        return _LoginResponse()


class _LoginResponse:
    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict[str, Any]:
        return {"data": {"token": "a-token"}}


async def test_one_login_serves_every_row_that_starts_together(mocker) -> None:
    """`get_token` was the other unguarded one: ten rows meant ten `POST /login`."""
    login = GatedLogin()
    mocker.patch.object(api_clients.httpx, "AsyncClient", login)
    client = TVDBClientV4("api-key")

    tasks = [asyncio.create_task(client.get_token()) for _ in range(10)]
    await _let_everyone_reach_the_cache()
    login.gate.set()
    tokens = await asyncio.gather(*tasks)

    assert login.posts == 1
    assert tokens == ["a-token"] * 10
