"""Episode titles fetched per series instead of per episode.

`/episodes/{id}/translations/{lang}` was called once for every episode being renamed —
the only cost in the pipeline that scaled with the size of the batch, so a season pack
paid it twenty-four times. TVDB serves the whole series' localised list from one
paginated endpoint, and `get_episode_names` uses it.

What has to survive the swap is the *language chain*, which was per-episode and is now
resolved in bulk: a later language fills only the titles an earlier one left blank, and
an episode no language has a title for must stay absent from the map so the caller
keeps the default name off `episodes_raw`. Those are the same three outcomes the old
call produced with a name, a 404 and a None — pinned below, plus the exact filename at
the end, because that is the thing the user actually gets.
"""

from typing import Any

import httpx
import pytest

from backend import api_clients
from backend.analyzer import enrich_media_item
from backend.api_clients import TVDBClientV4
from backend.matching import Decision
from backend.models import MediaItem


def _episode(ep_id: int, season: int, number: int, name: str | None) -> dict[str, Any]:
    return {"id": ep_id, "seasonNumber": season, "number": number, "name": name}


class StubTVDB(TVDBClientV4):
    """Serves canned pages per endpoint and records what was asked for.

    An endpoint that is not in `pages` raises a 404, which is how TVDB answers a
    language it does not carry for a series.
    """

    def __init__(self, pages: dict[str, list[list[dict[str, Any]]]]) -> None:
        super().__init__("api-key")
        self.pages = pages
        self.calls: list[str] = []

    async def get_token(self, bypass_cache: bool = False) -> str:
        return "token"

    async def _request(self, endpoint: str, token: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.calls.append(endpoint)
        if endpoint not in self.pages:
            raise httpx.HTTPStatusError(
                "not found", request=httpx.Request("GET", "https://api4.thetvdb.com"), response=httpx.Response(404)
            )
        pages = self.pages[endpoint]
        index = (params or {}).get("page", 0)
        links: dict[str, str] = {"self": f"?page={index}"}
        if index + 1 < len(pages):
            links["next"] = f"?page={index + 1}"
        return {"data": {"episodes": pages[index]}, "links": links}


class FakeCache:
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


@pytest.fixture(autouse=True)
def isolated_cache(mocker):
    mocker.patch.object(api_clients, "cache", FakeCache())
    api_clients._search_locks.clear()
    api_clients._lock_waiters.clear()


ITA = "/series/1/episodes/default/ita"
ENG = "/series/1/episodes/default/eng"


async def test_a_whole_season_costs_one_request() -> None:
    """The point of the change: 24 episodes, one call, and English never asked for."""
    client = StubTVDB({ITA: [[_episode(i, 1, i, f"Titolo {i}") for i in range(1, 25)]]})

    names = await client.get_episode_names(1, ["it", "en"])

    assert client.calls == [ITA]
    assert len(names) == 24
    assert names[7] == "Titolo 7"


async def test_a_later_language_fills_only_what_the_first_left_blank() -> None:
    """The per-episode fallback chain, resolved in bulk. Italian still wins where it exists."""
    client = StubTVDB(
        {
            ITA: [[_episode(1, 1, 1, "Uno"), _episode(2, 1, 2, None)]],
            ENG: [[_episode(1, 1, 1, "One"), _episode(2, 1, 2, "Two")]],
        }
    )

    names = await client.get_episode_names(1, ["it", "en"])

    assert names == {1: "Uno", 2: "Two"}
    assert client.calls == [ITA, ENG]


async def test_an_episode_no_language_names_is_absent_from_the_map() -> None:
    """Absent, not empty-string: the caller reads that as "keep the default name"."""
    client = StubTVDB(
        {
            ITA: [[_episode(1, 1, 1, "Uno"), _episode(2, 1, 2, None)]],
            ENG: [[_episode(1, 1, 1, "One"), _episode(2, 1, 2, "  ")]],
        }
    )

    names = await client.get_episode_names(1, ["it", "en"])

    assert 2 not in names


async def test_a_language_tvdb_does_not_carry_is_stepped_past() -> None:
    """A 404 on the first language is not a failure, it is "try the next one"."""
    client = StubTVDB({ENG: [[_episode(1, 1, 1, "One")]]})

    names = await client.get_episode_names(1, ["it", "en"])

    assert names == {1: "One"}
    assert client.calls == [ITA, ENG]


async def test_no_language_answering_leaves_the_map_empty_rather_than_failing() -> None:
    """A series with no translations at all must still produce a name from the raw list."""
    client = StubTVDB({})

    assert await client.get_episode_names(1, ["it", "en"]) == {}


async def test_pagination_is_followed_to_the_last_page() -> None:
    """One Piece is 1236 episodes; the list arrives in pages and all of them count."""
    client = StubTVDB(
        {
            ITA: [
                [_episode(1, 1, 1, "Uno"), _episode(2, 1, 2, "Due")],
                [_episode(3, 1, 3, "Tre")],
            ]
        }
    )

    names = await client.get_episode_names(1, ["it", "en"])

    assert names == {1: "Uno", 2: "Due", 3: "Tre"}
    assert client.calls == [ITA, ITA]


async def test_a_second_row_of_the_same_series_reads_the_cache() -> None:
    """Two episodes of one series is the common case, and the second must be free."""
    client = StubTVDB({ITA: [[_episode(1, 1, 1, "Uno")]]})

    await client.get_episode_names(1, ["it", "en"])
    await client.get_episode_names(1, ["it", "en"])

    assert client.calls == [ITA]


async def test_the_chain_is_part_of_the_cache_key() -> None:
    """`it,en` and `en,it` are different answers and must not share an entry."""
    client = StubTVDB(
        {
            ITA: [[_episode(1, 1, 1, "Uno")]],
            ENG: [[_episode(1, 1, 1, "One")]],
        }
    )

    assert await client.get_episode_names(1, ["it", "en"]) == {1: "Uno"}
    assert await client.get_episode_names(1, ["en", "it"]) == {1: "One"}


# --- The filename, which is the thing that must not move ---------------------


def _mock_series(mocker, series: dict[str, Any], episode_names: dict[int, str]) -> None:
    instance = mocker.patch("backend.analyzer.TVDBClientV4").return_value

    async def search(*args: Any, **kwargs: Any) -> Decision:
        return Decision(verdict="matched", confidence=1.0, reason="", payload=series)

    async def names(*args: Any, **kwargs: Any) -> dict[int, str]:
        return episode_names

    instance.search_series.side_effect = search
    instance.get_episode_names.side_effect = names
    mocker.patch(
        "os.getenv", side_effect=lambda key, default=None: "dummy" if "KEY" in key or "PIN" in key else default
    )


def _item(name: str, season: int, episode: Any) -> MediaItem:
    return MediaItem(
        id="dummy",
        original_path=f"/media/{name}",
        original_name=name,
        media_type="episode",
        clean_title="ignored",
        season=season,
        episode=episode,
        status="pending",
    )


async def test_the_localised_title_still_reaches_the_filename(mocker) -> None:
    """Same name the per-episode call produced, from the bulk map instead."""
    _mock_series(
        mocker,
        {
            "tvdb_id": 78804,
            "name": "Doctor Who",
            "season_episode_counts": {5: 13},
            "episodes_raw": [_episode(1452891, 5, 1, "The Eleventh Hour")],
            "year": None,
        },
        {1452891: "L'undicesima ora"},
    )

    item = await enrich_media_item(_item("Doctor Who S05E01.mkv", 5, 1), ["it", "en"])

    assert item.proposed_name == "Doctor Who - S05E01 - L'Undicesima Ora.mkv"


async def test_an_untranslated_episode_keeps_the_default_name(mocker) -> None:
    """The map is empty for this id, so `episodes_raw` stands — as it did on a None.

    Unchanged by the capitalisation rule, which is the ordinary case: TVDB's default
    names are already title-cased. The one below is where the rule shows.
    """
    _mock_series(
        mocker,
        {
            "tvdb_id": 78804,
            "name": "Doctor Who",
            "season_episode_counts": {5: 13},
            "episodes_raw": [_episode(1452891, 5, 1, "The Eleventh Hour")],
            "year": None,
        },
        {},
    )

    item = await enrich_media_item(_item("Doctor Who S05E01.mkv", 5, 1), ["it", "en"])

    assert item.proposed_name == "Doctor Who - S05E01 - The Eleventh Hour.mkv"


@pytest.mark.parametrize("translated", [True, False])
async def test_one_capitalisation_rule_whichever_source_the_title_came_from(mocker, translated: bool) -> None:
    """The same string must land on disk the same way, translated or not.

    A default name off `episodes_raw` used to skip `format_smart_title` while a
    translated one went through it, so `DEATH ON THE NILE` was written shouting in
    English and `Assassinio sul Nilo` title-cased in Italian — one series, two
    conventions, decided by whether TVDB happened to carry a translation.
    """
    shouted = "DEATH ON THE NILE"
    _mock_series(
        mocker,
        {
            "tvdb_id": 78804,
            "name": "Doctor Who",
            "season_episode_counts": {5: 13},
            "episodes_raw": [_episode(1452891, 5, 1, "placeholder" if translated else shouted)],
            "year": None,
        },
        {1452891: shouted} if translated else {},
    )

    item = await enrich_media_item(_item("Doctor Who S05E01.mkv", 5, 1), ["it", "en"])

    assert item.proposed_name == "Doctor Who - S05E01 - Death on The Nile.mkv"


async def test_a_range_takes_every_title_from_the_one_map(mocker) -> None:
    """Three episodes, one request. This is the case the change exists for."""
    _mock_series(
        mocker,
        {
            "tvdb_id": 81189,
            "name": "Breaking Bad",
            "season_episode_counts": {2: 13},
            "episodes_raw": [
                _episode(10, 2, 10, "Over"),
                _episode(11, 2, 11, "Mandala"),
                _episode(12, 2, 12, "Phoenix"),
            ],
            "year": None,
        },
        {10: "Game Over", 11: "Mandala", 12: "Phoenix"},
    )

    item = await enrich_media_item(_item("Breaking Bad S02E10-12.mkv", 2, "10-12"), ["it", "en"])

    assert item.proposed_name == "Breaking Bad - S02E10-E12 - Game Over - Mandala - Phoenix.mkv"
