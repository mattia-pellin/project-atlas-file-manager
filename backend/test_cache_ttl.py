"""`CACHE_TTL_HOURS`, and the one number every cache write and the settings panel share.

The TTL used to be five copies of `int(os.getenv("CACHE_TTL_HOURS", 24)) * 3600`
written inline at the `cache.set` calls, plus a sixth reading in `/api/config`. Six
readings of one variable is six chances for the number the panel prints to stop being
the number the cache uses — and one of them, `int()`, turned a typo into a 500.

These tests pin the parsing, the fallbacks, and the fact that a cache write and the
config endpoint cannot disagree.
"""

from pathlib import Path
from typing import Any

import diskcache
import pytest
from fastapi.testclient import TestClient

from backend import api_clients
from backend.api_clients import (
    DEFAULT_CACHE_TTL_HOURS,
    MAX_NEGATIVE_CACHE_TTL_SECONDS,
    TMDBClient,
    cache_ttl_hours,
    cache_ttl_seconds,
    negative_cache_ttl_seconds,
)
from backend.main import app


class RecordingCache:
    """The diskcache surface `api_clients` uses, remembering the TTL it was handed."""

    def __init__(self) -> None:
        self.store: dict[str, Any] = {}
        self.expires: dict[str, int | None] = {}

    def __contains__(self, key: str) -> bool:
        return key in self.store

    def __getitem__(self, key: str) -> Any:
        return self.store[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.store.get(key, default)

    def set(self, key: str, value: Any, expire: int | None = None) -> None:
        self.store[key] = value
        self.expires[key] = expire


class StubTMDB(TMDBClient):
    """Answers a search without a network, with or without results."""

    def __init__(self, results: list[dict[str, Any]]) -> None:
        super().__init__("api-key")
        self.results = results

    async def _request(self, endpoint: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"results": self.results}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("CACHE_TTL_HOURS", raising=False)


def test_the_default_is_a_day() -> None:
    assert cache_ttl_hours() == DEFAULT_CACHE_TTL_HOURS
    assert cache_ttl_seconds() == 86400


@pytest.mark.parametrize(
    ("configured", "expected_hours"),
    [
        ("1", 1.0),
        ("48", 48.0),
        # Fractions are the useful case while chasing a wrong match: half an hour is
        # long enough to spare the provider a re-scan, short enough to try again.
        ("0.5", 0.5),
        (" 6 ", 6.0),
        # Zero is a real setting, not a mistake: reuse nothing.
        ("0", 0.0),
    ],
)
def test_the_environment_decides(monkeypatch, configured: str, expected_hours: float) -> None:
    monkeypatch.setenv("CACHE_TTL_HOURS", configured)

    assert cache_ttl_hours() == expected_hours
    assert cache_ttl_seconds() == int(expected_hours * 3600)


@pytest.mark.parametrize("configured", ["", "   ", "abc", "24h", "-1", "-0.5"])
def test_an_unusable_value_falls_back_instead_of_raising(monkeypatch, configured: str) -> None:
    """A typo must not reach the request path.

    `int("24h")` raises, and it used to raise inside `/api/config` — so a stray
    character in one environment variable presented as an app that would not load,
    for a setting whose worst honest consequence is fetching a title again early.
    """
    monkeypatch.setenv("CACHE_TTL_HOURS", configured)

    assert cache_ttl_hours() == DEFAULT_CACHE_TTL_HOURS


def test_the_value_is_read_per_call_not_at_import(monkeypatch) -> None:
    """Otherwise the container would have to be rebuilt, not just restarted."""
    monkeypatch.setenv("CACHE_TTL_HOURS", "2")
    assert cache_ttl_seconds() == 7200

    monkeypatch.setenv("CACHE_TTL_HOURS", "3")
    assert cache_ttl_seconds() == 10800


class TestTheNegativeAnswer:
    """ "Nothing matched" is held for an hour at most, whatever the TTL says."""

    def test_it_does_not_follow_a_long_ttl_up(self, monkeypatch) -> None:
        monkeypatch.setenv("CACHE_TTL_HOURS", "72")

        assert cache_ttl_seconds() == 259200
        assert negative_cache_ttl_seconds() == MAX_NEGATIVE_CACHE_TTL_SECONDS

    def test_it_does_follow_a_short_one_down(self, monkeypatch) -> None:
        # A TTL below the cap has to win, or "reuse nothing" would still reuse the
        # one answer most likely to be wrong for a reason outside this app.
        monkeypatch.setenv("CACHE_TTL_HOURS", "0.25")

        assert negative_cache_ttl_seconds() == 900

    def test_zero_reuses_nothing_at_all(self, monkeypatch) -> None:
        monkeypatch.setenv("CACHE_TTL_HOURS", "0")

        assert cache_ttl_seconds() == 0
        assert negative_cache_ttl_seconds() == 0

    def test_and_diskcache_agrees_that_zero_means_gone(self, tmp_path) -> None:
        """`CACHE_TTL_HOURS=0` is documented as "reuse nothing", and that promise rests
        on a library detail rather than on our own code: `expire=0` could as easily have
        meant "no expiry", which is what `expire=None` means two lines down.
        """
        cache = diskcache.Cache(str(tmp_path))

        cache.set("gone", ["payload"], expire=0)
        cache.set("kept", ["payload"], expire=None)

        assert "gone" not in cache
        assert "kept" in cache


class TestWhatTheCacheIsActuallyGiven:
    """The helper is not enough on its own — the `cache.set` calls have to use it."""

    @pytest.fixture
    def recording(self, monkeypatch) -> RecordingCache:
        recording = RecordingCache()
        monkeypatch.setattr(api_clients, "cache", recording)
        return recording

    async def test_a_found_payload_expires_on_the_configured_ttl(self, monkeypatch, recording) -> None:
        monkeypatch.setenv("CACHE_TTL_HOURS", "3")

        await StubTMDB([{"id": 603, "title": "The Matrix"}])._search_movie_results("The Matrix", 1999, ["en"], False)

        assert list(recording.expires.values()) == [10800]

    async def test_a_no_match_is_held_for_an_hour_even_under_a_long_ttl(self, monkeypatch, recording) -> None:
        # The negative answer is the one most likely to be wrong for a reason outside
        # this app — an unloaded key, a provider having a bad minute — so three days of
        # configured TTL must not become three days of "nothing matched".
        monkeypatch.setenv("CACHE_TTL_HOURS", "72")

        await StubTMDB([])._search_movie_results("all'ombra dell'olmo", 2010, ["it"], False)

        assert list(recording.expires.values()) == [MAX_NEGATIVE_CACHE_TTL_SECONDS]

    def test_no_call_site_hardcodes_the_ttl_any_more(self) -> None:
        """The regression this file exists for: a sixth copy added by hand later.

        Only the TVDB auth token keeps a literal, and deliberately — it is a
        credential's lifetime, not a payload's freshness.
        """
        source = Path(api_clients.__file__).read_text(encoding="utf-8")
        writes = [line.strip() for line in source.splitlines() if "cache.set(" in line and "expire=" in line]

        assert writes, "no cache.set calls found — did the file move?"
        for line in writes:
            assert (
                "expire=cache_ttl_seconds()" in line
                or "expire=negative_cache_ttl_seconds()" in line
                or ("expire=86400" in line and "token" in line)
            ), line


class TestTheSettingsPanelIsToldTheTruth:
    def test_config_reports_the_ttl_in_force(self, monkeypatch) -> None:
        monkeypatch.setenv("CACHE_TTL_HOURS", "0.5")

        with TestClient(app) as client:
            assert client.get("/api/config").json()["cache_ttl_hours"] == 0.5

    def test_config_reports_the_fallback_rather_than_the_typo(self, monkeypatch) -> None:
        """And answers 200 while doing it. `int("nope")` used to make this a 500."""
        monkeypatch.setenv("CACHE_TTL_HOURS", "nope")

        with TestClient(app) as client:
            response = client.get("/api/config")

        assert response.status_code == 200
        assert response.json()["cache_ttl_hours"] == DEFAULT_CACHE_TTL_HOURS
