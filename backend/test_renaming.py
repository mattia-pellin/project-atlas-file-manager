"""Exact-string tests for the proposed filename.

Every case here pins the whole `proposed_name`, not a fragment of it. A rename
runs against a real Plex library, so a substring assertion that passes while the
padding or the separator changed is worse than no test.
"""

import pytest

from backend.analyzer import enrich_media_item, parse_episode_range
from backend.api_clients import calculate_padding
from backend.matching import Decision
from backend.models import MediaItem


def test_calculate_padding():
    assert calculate_padding(0) == 2
    assert calculate_padding(1) == 2
    assert calculate_padding(99) == 2
    assert calculate_padding(100) == 3
    assert calculate_padding(999) == 3
    assert calculate_padding(1000) == 4


@pytest.mark.parametrize(
    ("episode", "expected"),
    [
        (1, (1, 1)),
        ("7", (7, 7)),
        (" 7 ", (7, 7)),
        ("10-12", (10, 12)),
        ("5-5", (5, 5)),
        # Unparseable or nonsensical: the caller must decline to propose a name
        # rather than fall back to episode 1.
        (None, None),
        ("", None),
        ("abc", None),
        ("12-10", None),
        ("1-2-3", None),
        ("10-E12", None),
    ],
)
def test_parse_episode_range(episode, expected) -> None:
    assert parse_episode_range(episode) == expected


def _tvdb_series(name: str, season_episode_counts: dict[int, int], episodes_raw: list[dict]) -> dict:
    return {
        "name": name,
        "season_episode_counts": season_episode_counts,
        "episodes_raw": episodes_raw,
        "year": None,
    }


def _mock_tvdb(mocker, series: dict, *, verdict: str = "matched", confidence: float = 1.0) -> None:
    """Wire a TVDB response in, with the API keys present and parsing bypassed."""
    instance = mocker.patch("backend.analyzer.TVDBClientV4").return_value

    async def search(*args, **kwargs):
        # `search_series` hands back a Decision, never a bare payload: the caller
        # must not be able to use a match without seeing its confidence.
        return Decision(verdict=verdict, confidence=confidence, reason="", payload=series)

    async def translation(*args, **kwargs):
        return None

    instance.search_series.side_effect = search
    instance.get_episode_translation.side_effect = translation

    mocker.patch(
        "os.getenv", side_effect=lambda key, default=None: "dummy" if "KEY" in key or "PIN" in key else default
    )


def _episode_item(name: str, season, episode, episode_title=None) -> MediaItem:
    return MediaItem(
        id="dummy",
        original_path=f"/media/{name}",
        original_name=name,
        media_type="episode",
        clean_title="ignored",
        season=season,
        episode=episode,
        episode_title=episode_title,
        status="pending",
    )


@pytest.mark.asyncio
async def test_padding_comes_from_the_season_not_the_series(mocker) -> None:
    """One Piece has 1100+ episodes overall but 61 in season 1.

    Padding against the series total produced S01E0010, which is not the name
    Plex expects and does not match the existing library folder.
    """
    _mock_tvdb(
        mocker,
        _tvdb_series(
            "One Piece",
            {1: 61, 2: 16, 21: 1000},
            [{"seasonNumber": 1, "number": 10, "name": "I'm Luffy"}],
        ),
    )
    item = await enrich_media_item(_episode_item("One Piece S01E10.mkv", 1, 10), ["it", "en"])
    assert item.proposed_name == "One Piece - S01E10 - I'm Luffy.mkv"


@pytest.mark.asyncio
async def test_a_season_over_99_episodes_still_pads_wide(mocker) -> None:
    """Per-season padding is not a blanket "always 2": season 21 has 1000 episodes."""
    _mock_tvdb(
        mocker,
        _tvdb_series(
            "One Piece",
            {1: 61, 21: 1000},
            [{"seasonNumber": 21, "number": 10, "name": "Somewhere"}],
        ),
    )
    item = await enrich_media_item(_episode_item("One Piece S21E10.mkv", 21, 10), ["it", "en"])
    assert item.proposed_name == "One Piece - S21E0010 - Somewhere.mkv"


@pytest.mark.asyncio
async def test_multi_episode_uses_the_plex_e_dash_e_form(mocker) -> None:
    """Plex documents S02E10-E12. The second number carries its own 'E'."""
    _mock_tvdb(
        mocker,
        _tvdb_series(
            "Breaking Bad",
            {2: 13},
            [
                {"seasonNumber": 2, "number": 10, "name": "Over"},
                {"seasonNumber": 2, "number": 11, "name": "Mandala"},
                {"seasonNumber": 2, "number": 12, "name": "Phoenix"},
            ],
        ),
    )
    item = await enrich_media_item(_episode_item("Breaking Bad S02E10-12.mkv", 2, "10-12"), ["it", "en"])
    assert item.proposed_name == "Breaking Bad - S02E10-E12 - Over - Mandala - Phoenix.mkv"


@pytest.mark.asyncio
async def test_a_single_episode_range_collapses_to_one_number(mocker) -> None:
    """ "5-5" is one episode, so it must render as E05, never as E05-E05."""
    _mock_tvdb(mocker, _tvdb_series("Breaking Bad", {2: 13}, [{"seasonNumber": 2, "number": 5, "name": "Breakage"}]))
    item = await enrich_media_item(_episode_item("Breaking Bad S02E05.mkv", 2, "5-5"), ["it", "en"])
    assert item.proposed_name == "Breaking Bad - S02E05 - Breakage.mkv"


@pytest.mark.asyncio
async def test_the_filename_title_is_not_reused_across_a_range(mocker) -> None:
    """A filename carries one episode title; it cannot stand for three episodes."""
    _mock_tvdb(mocker, _tvdb_series("Some Show", {1: 20}, []))
    item = await enrich_media_item(
        _episode_item("Some Show S01E01-03.mkv", 1, "1-3", episode_title="Pilot"), ["it", "en"]
    )
    assert item.proposed_name == "Some Show - S01E01-E03.mkv"


@pytest.mark.asyncio
async def test_the_filename_title_is_used_for_a_single_episode(mocker) -> None:
    """With no API title, a single episode falls back to the one in the filename."""
    _mock_tvdb(mocker, _tvdb_series("Some Show", {1: 20}, []))
    item = await enrich_media_item(_episode_item("Some Show S01E04.mkv", 1, 4, episode_title="the pilot"), ["it", "en"])
    assert item.proposed_name == "Some Show - S01E04 - The Pilot.mkv"


@pytest.mark.asyncio
async def test_an_unparseable_episode_is_an_error_not_episode_one(mocker) -> None:
    """The old fallback invented E01, producing a confident name for the wrong episode."""
    _mock_tvdb(mocker, _tvdb_series("Some Show", {1: 20}, []))
    item = await enrich_media_item(_episode_item("Some Show S01Exx.mkv", 1, "not-a-number"), ["it", "en"])
    assert item.proposed_name is None
    assert item.status == "error"
    assert item.message == "Numero di episodio non riconosciuto"


@pytest.mark.asyncio
async def test_an_unknown_season_is_treated_as_season_one_throughout(mocker) -> None:
    """S01 is assumed for the name, so the episode lookup must assume it too.

    Previously the name said S01 while the lookup compared against None, so the
    episode title was silently dropped.
    """
    _mock_tvdb(mocker, _tvdb_series("Some Show", {1: 20}, [{"seasonNumber": 1, "number": 3, "name": "Third"}]))
    item = await enrich_media_item(_episode_item("Some Show 03.mkv", None, 3), ["it", "en"])
    assert item.proposed_name == "Some Show - S01E03 - Third.mkv"


@pytest.mark.asyncio
async def test_a_low_confidence_match_still_proposes_a_name_but_is_not_matched(mocker) -> None:
    """A `review` row keeps its name and gains a reason; only the status differs.

    The name has to survive, because the user needs to see the candidate to judge
    it. What must not survive is the row being auto-selected for rename — the
    frontend keys that off `status === 'matched'`.
    """
    instance = mocker.patch("backend.analyzer.TVDBClientV4").return_value

    async def search(*args, **kwargs):
        return Decision(
            verdict="review",
            confidence=0.5,
            reason="Ambiguo (50%): Doctor Who (1963) e Doctor Who (2005) hanno punteggi equivalenti",
            payload=_tvdb_series("Doctor Who", {5: 40}, [{"seasonNumber": 5, "number": 1, "name": "The Tomb"}]),
        )

    async def translation(*args, **kwargs):
        return None

    instance.search_series.side_effect = search
    instance.get_episode_translation.side_effect = translation
    mocker.patch(
        "os.getenv", side_effect=lambda key, default=None: "dummy" if "KEY" in key or "PIN" in key else default
    )

    item = await enrich_media_item(_episode_item("Doctor Who S05E01.mkv", 5, 1), ["it", "en"])
    assert item.proposed_name == "Doctor Who - S05E01 - The Tomb.mkv"
    assert item.status == "review"
    assert item.confidence == 0.5
    assert "Ambiguo" in item.message


@pytest.mark.asyncio
async def test_a_rejected_match_reports_why_instead_of_could_not_find_a_match(mocker) -> None:
    """ "No candidate cleared the bar" and "no candidate at all" are different faults."""
    instance = mocker.patch("backend.analyzer.TVDBClientV4").return_value

    async def search(*args, **kwargs):
        return Decision(
            verdict="rejected", confidence=0.2, reason="No confident match — closest was Bob (1999) at 0.20"
        )

    instance.search_series.side_effect = search
    mocker.patch(
        "os.getenv", side_effect=lambda key, default=None: "dummy" if "KEY" in key or "PIN" in key else default
    )

    item = await enrich_media_item(_episode_item("Some Show S01E01.mkv", 1, 1), ["it", "en"])
    assert item.proposed_name is None
    assert item.status == "error"
    assert item.message == "No confident match — closest was Bob (1999) at 0.20"


@pytest.mark.asyncio
async def test_a_file_already_named_correctly_reads_as_renamed_not_as_pending(mocker) -> None:
    """The proposal equals what is on disk, so the rename has effectively happened.

    Left as `matched` the row sat among the ones still waiting to be written, while being
    untickable — `resolve_rename_target` refuses a no-op and so does `isRowValid`. The
    confidence survives: how sure the match was is still worth reading on the row.
    """
    _mock_tvdb(
        mocker,
        _tvdb_series(
            "Breaking Bad",
            {1: 7},
            [{"seasonNumber": 1, "number": 2, "name": "Cat's in the Bag..."}],
        ),
    )
    name = "Breaking Bad - S01E02 - Cat's in the Bag....mkv"
    item = await enrich_media_item(_episode_item(name, 1, 2), ["it", "en"])

    assert item.proposed_name == name
    assert item.status == "success"
    assert item.message == "Già nominato così — niente da rinominare"
    assert item.confidence == 1.0


@pytest.mark.asyncio
async def test_a_file_one_character_away_is_still_a_rename(mocker) -> None:
    """The comparison is the whole string: nothing here may normalise it into a match."""
    _mock_tvdb(
        mocker,
        _tvdb_series(
            "Breaking Bad",
            {1: 7},
            [{"seasonNumber": 1, "number": 2, "name": "Cat's in the Bag..."}],
        ),
    )
    item = await enrich_media_item(_episode_item("breaking bad - S01E02 - Cat's in the Bag....mkv", 1, 2), ["it", "en"])

    assert item.proposed_name == "Breaking Bad - S01E02 - Cat's in the Bag....mkv"
    assert item.status == "matched"
