"""The candidate list, the hand-picked match, and the settings surface.

Triage exists because confidence is not a fix: when two shows called *One Piece*
score alike, no threshold tells them apart — only the user can. So two things are
pinned here. That the candidates offered are the ones that were actually scored,
including the ones episode evidence ruled out. And that picking one produces an
exact filename, because a hand-picked match still writes to a real Plex library.
"""

import pytest
from fastapi.testclient import TestClient

from backend import matching
from backend.analyzer import enrich_media_item, locate_absolute_episode
from backend.api_clients import MAX_EXPOSED_CANDIDATES, TMDB_IMAGE_BASE, TMDBClient, TVDBClientV4
from backend.main import app
from backend.models import MediaItem

# --- Fixtures, shaped like the real payloads --------------------------------

MATRIX_RESULTS = [
    {
        "id": 604,
        "title": "The Matrix Reloaded",
        "original_title": "The Matrix Reloaded",
        "release_date": "2003-05-15",
        "poster_path": "/9TGHDvWrqKBzwDxDodHYXEmOE6J.jpg",
        "overview": "Neo and his allies race against time.",
    },
    {
        "id": 605,
        "title": "The Matrix Revolutions",
        "original_title": "The Matrix Revolutions",
        "release_date": "2003-11-05",
        "poster_path": None,
        "overview": None,
    },
]

# The anime is listed *second*, so "selected" cannot be confused with "first".
ONE_PIECE_ENTRIES = [
    {
        "tvdb_id": "424435",
        "name": "One Piece",
        "year": "2023",
        "overview": "The live action adaptation.",
        "image_url": "https://artworks.thetvdb.com/banners/v4/series/424435/posters/1.jpg",
    },
    {
        "tvdb_id": "81797",
        "name": "One Piece",
        "year": "1999",
        "overview": "Monkey D. Luffy sets out to become King of the Pirates.",
        "image_url": "https://artworks.thetvdb.com/banners/posters/81797-1.jpg",
    },
]

# TVDB's default order splits the anime into arc-sized seasons, so season 1 stops
# at episode 8 in *both* records — the live action for real, the anime because of
# the arc split. Only the anime carries episode 10, one arc later, so the evidence
# below is the anime's alone.
ANIME_EXTENDED = {
    "tvdb_id": "81797",
    "name": "One Piece",
    "season_episode_counts": {1: 8, 2: 22},
    "episodes_raw": [
        {"id": 1, "seasonNumber": 1, "number": 10, "name": "I'm Luffy"},
    ],
    "year": "1999",
}

# The same anime record with TVDB's absolute numbering on it, which the real payload
# carries. The season and episode below are this fixture's own, not TVDB's — live,
# absolute 1015 resolves to S21E124 (verified 2026-08-13). What is being pinned is that
# the lookup answers with whatever the *series* files the number under, and that the
# special listed just before it, reusing the number, is not what answers.
ANIME_ABSOLUTE_EXTENDED = {
    "tvdb_id": "81797",
    "name": "One Piece",
    "season_episode_counts": {1: 8, 20: 92},
    "episodes_raw": [
        {"id": 1, "seasonNumber": 1, "number": 10, "name": "I'm Luffy", "absoluteNumber": 10},
        {"id": 2, "seasonNumber": 0, "number": 4, "name": "A Recap Special", "absoluteNumber": 1015},
        {"id": 3, "seasonNumber": 20, "number": 63, "name": "Foxy's Interference", "absoluteNumber": 1015},
    ],
    "year": "1999",
}

LIVE_ACTION_EXTENDED = {
    "tvdb_id": "424435",
    "name": "One Piece",
    "season_episode_counts": {1: 8},
    "episodes_raw": [
        {"id": 90, "seasonNumber": 1, "number": 1, "name": "Romance Dawn"},
    ],
    "year": "2023",
}


def _keys_present(mocker) -> None:
    mocker.patch(
        "os.getenv", side_effect=lambda key, default=None: "dummy" if "KEY" in key or "PIN" in key else default
    )


def _movie_item(name: str = "The Matrix Reloaded 2003.mkv", title: str = "The Matrix Reloaded") -> MediaItem:
    return MediaItem(
        id="dummy",
        original_path=f"/media/{name}",
        original_name=name,
        media_type="movie",
        clean_title=title,
        year=2003,
    )


def _episode_item(season: int = 1, episode=10) -> MediaItem:
    name = "One Piece S01E10.mkv"
    return MediaItem(
        id="dummy",
        original_path=f"/media/{name}",
        original_name=name,
        media_type="episode",
        clean_title="One Piece",
        season=season,
        episode=episode,
    )


def _mock_tmdb(mocker, results: list[dict]) -> None:
    async def search(self, title, year, language_prefs, bypass_cache):
        return results

    mocker.patch.object(TMDBClient, "_search_movie_results", search)
    _keys_present(mocker)


def _mock_tvdb(mocker, entries: list[dict], extended: dict[str, dict]):
    """Wires TVDB up with everything mocked below the search, and counts the extended fetches."""
    calls: list[str] = []

    async def search(self, title, language_prefs, bypass_cache):
        return entries

    async def token(self, bypass_cache=False):
        return "token"

    async def series_extended(self, series_id, language_prefs, tok, bypass_cache=False):
        calls.append(str(series_id))
        return extended.get(str(series_id))

    async def episode_names(self, series_id, language_prefs, bypass_cache=False):
        return {}

    mocker.patch.object(TVDBClientV4, "_search_series_results", search)
    mocker.patch.object(TVDBClientV4, "get_token", token)
    mocker.patch.object(TVDBClientV4, "get_series_extended", series_extended)
    mocker.patch.object(TVDBClientV4, "get_episode_names", episode_names)
    _keys_present(mocker)
    return calls


# --- What the user is offered ------------------------------------------------


@pytest.mark.asyncio
async def test_a_movie_exposes_every_scored_candidate_best_first(mocker) -> None:
    _mock_tmdb(mocker, MATRIX_RESULTS)
    item = await enrich_media_item(_movie_item(), ["en"])

    assert [c.key for c in item.candidates] == ["604", "605"]
    assert [c.selected for c in item.candidates] == [True, False]
    assert item.candidates[0].source == "tmdb"
    assert item.candidates[0].score >= item.candidates[1].score


@pytest.mark.asyncio
async def test_a_candidate_carries_its_poster_and_blurb(mocker) -> None:
    """Both come out of the search payload already in hand — no extra request."""
    _mock_tmdb(mocker, MATRIX_RESULTS)
    item = await enrich_media_item(_movie_item(), ["en"])

    assert item.candidates[0].poster_url == f"{TMDB_IMAGE_BASE}/9TGHDvWrqKBzwDxDodHYXEmOE6J.jpg"
    assert item.candidates[0].overview == "Neo and his allies race against time."
    # A result with neither must not produce "None" or a broken URL.
    assert item.candidates[1].poster_url is None
    assert item.candidates[1].overview is None


@pytest.mark.asyncio
async def test_the_candidate_list_is_capped(mocker) -> None:
    results = [
        {"id": 100 + n, "title": f"Result {n}", "release_date": "2003-01-01", "overview": None} for n in range(9)
    ]
    _mock_tmdb(mocker, results)
    item = await enrich_media_item(_movie_item(title="Result 0"), ["en"])

    assert len(item.candidates) == MAX_EXPOSED_CANDIDATES


@pytest.mark.asyncio
async def test_the_selected_candidate_is_shown_even_from_outside_the_cap(mocker) -> None:
    """A panel that omits the row it calls selected is lying about what it renamed to."""
    results = [
        {"id": 100 + n, "title": f"Result {n}", "release_date": "2003-01-01", "overview": None} for n in range(9)
    ]
    _mock_tmdb(mocker, results)
    item = await enrich_media_item(_movie_item(title="Result 0"), ["en"], forced_key="108")

    assert len(item.candidates) == MAX_EXPOSED_CANDIDATES + 1
    assert item.candidates[-1].key == "108"
    assert item.candidates[-1].selected is True


@pytest.mark.asyncio
async def test_a_rejected_item_still_offers_its_candidates(mocker) -> None:
    """The row with no name is exactly the row whose alternatives the user needs."""
    _mock_tmdb(mocker, [{"id": 7, "title": "Something Else Entirely", "release_date": "1975-01-01"}])
    item = await enrich_media_item(_movie_item(title="Il Trionfo dell'Amore"), ["en"])

    assert item.status == "error"
    assert item.proposed_name is None
    assert [c.key for c in item.candidates] == ["7"]
    assert item.candidates[0].selected is False


@pytest.mark.asyncio
async def test_a_series_still_offers_the_candidate_the_episode_evidence_eliminated(mocker) -> None:
    """The eliminated one can be the right one, so it may not be hidden.

    TVDB's arc-sized seasons mean a real `S01E10` is missing from the series it
    belongs to. That is why the episode check narrows the *decision* only, while
    the whole title ranking is still handed to the UI.
    """
    _mock_tvdb(mocker, ONE_PIECE_ENTRIES, {"81797": ANIME_EXTENDED, "424435": LIVE_ACTION_EXTENDED})
    item = await enrich_media_item(_episode_item(), ["en"])

    assert [c.key for c in item.candidates] == ["424435", "81797"]
    assert [c.selected for c in item.candidates] == [False, True]
    assert item.tvdb_id == 81797
    assert item.proposed_name == "One Piece - S01E10 - I'm Luffy.mkv"


# --- The hand-picked match ---------------------------------------------------


@pytest.mark.asyncio
async def test_forcing_a_movie_candidate_pins_its_exact_name(mocker) -> None:
    _mock_tmdb(mocker, MATRIX_RESULTS)
    item = await enrich_media_item(_movie_item(), ["en"], forced_key="605")

    assert item.proposed_name == "The Matrix Revolutions (2003).mkv"
    assert item.tmdb_id == 605
    assert item.status == "matched"
    assert item.confidence == 1.0
    assert item.message == "Scelto a mano: The Matrix Revolutions (2003)"
    assert [c.selected for c in item.candidates] == [False, True]


@pytest.mark.asyncio
async def test_forcing_a_series_candidate_pins_its_exact_name(mocker) -> None:
    """Forcing the live action gets an episode it does not have, and no title for it.

    Which is the honest outcome: the user overrode the match, so the name is built
    from what they chose, not from what the scoring preferred.
    """
    calls = _mock_tvdb(mocker, ONE_PIECE_ENTRIES, {"81797": ANIME_EXTENDED, "424435": LIVE_ACTION_EXTENDED})
    item = await enrich_media_item(_episode_item(), ["en"], forced_key="424435")

    assert item.proposed_name == "One Piece - S01E10.mkv"
    assert item.tvdb_id == 424435
    assert item.status == "matched"
    assert item.message == "Scelto a mano: One Piece (2023)"
    # One fetch, for the chosen series. A forced pick skips disambiguation entirely,
    # which is what makes replaying it across a whole season free.
    assert calls == ["424435"]


@pytest.mark.asyncio
async def test_replaying_one_choice_across_a_season_costs_one_fetch_per_episode_at_most(mocker) -> None:
    """Applying a triage decision to every episode must not re-search per file."""
    calls = _mock_tvdb(mocker, ONE_PIECE_ENTRIES, {"81797": ANIME_EXTENDED, "424435": LIVE_ACTION_EXTENDED})

    names = []
    for episode in (10, 10, 10):
        item = await enrich_media_item(_episode_item(episode=episode), ["en"], forced_key="81797")
        names.append(item.proposed_name)

    assert names == ["One Piece - S01E10 - I'm Luffy.mkv"] * 3
    # Never the rival series: three fetches at most, all for the chosen one. In
    # production `get_series_extended` is cached, so it is one.
    assert set(calls) == {"81797"}


@pytest.mark.asyncio
async def test_a_stale_forced_key_is_refused_not_silently_rescored(mocker) -> None:
    """Falling back to the scoring's pick would rename to a title nobody chose."""
    _mock_tmdb(mocker, MATRIX_RESULTS)
    item = await enrich_media_item(_movie_item(), ["en"], forced_key="999999")

    assert item.proposed_name is None
    assert item.status == "error"
    assert "non è più tra i risultati TMDB" in item.message
    # The list is still offered, so the user can pick again without re-scanning.
    assert [c.key for c in item.candidates] == ["604", "605"]


@pytest.mark.asyncio
async def test_a_refused_reanalysis_does_not_return_the_previous_proposal(mocker) -> None:
    """The client sends the whole row back, previous answer included.

    Found against the live API: a stale `forced_key` came back carrying the name,
    status and confidence of the *earlier* analysis, so the row still read as
    decided. A name nobody chose, presented as current and ticked for rename, is
    precisely the failure this application must not have.
    """
    _mock_tmdb(mocker, MATRIX_RESULTS)
    item = await enrich_media_item(_movie_item(), ["en"])
    assert item.proposed_name == "The Matrix Reloaded (2003).mkv"

    again = await enrich_media_item(item, ["en"], forced_key="999999")

    assert again.proposed_name is None
    assert again.status == "error"
    assert again.confidence is None
    assert "non è più tra i risultati TMDB" in again.message


@pytest.mark.asyncio
async def test_an_edited_title_that_matches_nothing_clears_the_old_name(mocker) -> None:
    """The same staleness, reached from the grid rather than from triage."""
    _mock_tmdb(mocker, MATRIX_RESULTS)
    item = await enrich_media_item(_movie_item(), ["en"])

    item.clean_title = "Zzzzz Not A Film"
    item.year = None
    again = await enrich_media_item(item, ["en"])

    assert again.proposed_name is None
    assert again.status == "error"


# --- Absolute episode numbering ----------------------------------------------


def test_locate_absolute_episode_never_answers_with_a_special() -> None:
    """Season 0 reuses the absolute sequence in some records, and a special is never
    what a file numbered absolutely meant."""
    assert locate_absolute_episode(ANIME_ABSOLUTE_EXTENDED["episodes_raw"], 1015) == (20, 63)
    # Not in the series at all: no nearest neighbour, no guess.
    assert locate_absolute_episode(ANIME_ABSOLUTE_EXTENDED["episodes_raw"], 9999) is None


@pytest.mark.asyncio
async def test_an_absolute_number_becomes_the_season_and_episode_tvdb_files_it_under(mocker) -> None:
    """`One Piece - 1015.mkv` is the fixture this exists for.

    guessit reads 1015 as S10E15, the API answers about S10E15, and confidence is high
    because nothing downstream can know better. The series' own episode list is the
    only thing that carries both numberings, so the correction has to arrive with the
    hand-picked candidate — and once it does, the name is exact.
    """
    _mock_tvdb(mocker, ONE_PIECE_ENTRIES, {"81797": ANIME_ABSOLUTE_EXTENDED})
    item = await enrich_media_item(
        _episode_item(season=10, episode=15), ["en"], forced_key="81797", absolute_episode=1015
    )

    assert item.proposed_name == "One Piece - S20E63 - Foxy's Interference.mkv"
    # Written back onto the row, so the grid stops showing the numbers it was misread as.
    assert (item.season, item.episode) == (20, 63)
    assert item.status == "matched"


@pytest.mark.asyncio
async def test_an_absolute_number_the_series_does_not_have_is_refused(mocker) -> None:
    """Approximating it would rename the file to a neighbouring episode, which is the
    one outcome worse than not renaming at all."""
    _mock_tvdb(mocker, ONE_PIECE_ENTRIES, {"81797": ANIME_ABSOLUTE_EXTENDED})
    item = await enrich_media_item(
        _episode_item(season=10, episode=15), ["en"], forced_key="81797", absolute_episode=4242
    )

    assert item.proposed_name is None
    assert item.status == "error"
    assert item.message == "L'episodio assoluto 4242 non esiste in One Piece"
    # The candidates survive the refusal: the pick may simply have been the wrong series.
    assert [c.key for c in item.candidates] == ["424435", "81797"]


def test_an_absolute_episode_below_one_is_refused() -> None:
    item = _episode_item().model_dump()
    response = TestClient(app).post("/api/analyze", json=item, params={"absolute_episode": 0})

    assert response.status_code == 400
    assert response.json()["detail"] == "absolute_episode deve essere almeno 1"


# --- Thresholds --------------------------------------------------------------


def test_thresholds_move_the_verdict_without_moving_the_score() -> None:
    """A user who lowers the bar sees more `matched` rows, not different names."""
    ranked = [
        matching.ScoredCandidate(matching.Candidate(key=1, names=("A Show",)), 0.60, 0.60, 1.0),
        matching.ScoredCandidate(matching.Candidate(key=2, names=("Another",)), 0.20, 0.20, 1.0),
    ]

    assert matching.decide(ranked).verdict == "review"
    assert matching.decide(ranked, thresholds=matching.Thresholds(match=0.5, review=0.4)).verdict == "matched"
    assert matching.decide(ranked, thresholds=matching.Thresholds(match=0.9, review=0.8)).verdict == "rejected"


# --- The settings surface ----------------------------------------------------


def test_config_reports_the_roots_and_whether_the_keys_are_present(mocker) -> None:
    """A missing key otherwise presents as "Nessuna corrispondenza trovata" — an API fault,
    not the configuration fault it actually is."""
    mocker.patch.dict("os.environ", {"MEDIA_ROOT": "/media", "TMDB_API_KEY": "x"}, clear=False)
    mocker.patch.dict("os.environ", {"TVDB_API_KEY": ""}, clear=False)

    body = TestClient(app).get("/api/config").json()

    assert body["media_roots"] == ["/media"]
    assert body["tmdb_configured"] is True
    assert body["tvdb_configured"] is False
    assert body["thresholds"]["match"] == matching.MATCH_THRESHOLD
    assert body["max_candidates"] == MAX_EXPOSED_CANDIDATES


def test_config_never_returns_a_key(mocker) -> None:
    mocker.patch.dict("os.environ", {"TMDB_API_KEY": "super-secret-value"}, clear=False)
    assert "super-secret-value" not in TestClient(app).get("/api/config").text


@pytest.mark.parametrize(
    ("params", "detail"),
    [
        ({"match_threshold": 1.5}, "match_threshold deve essere compreso tra 0 e 1"),
        ({"review_threshold": -0.1}, "review_threshold deve essere compreso tra 0 e 1"),
        ({"match_threshold": 0.3, "review_threshold": 0.8}, "review_threshold non può superare match_threshold"),
    ],
)
def test_an_impossible_threshold_is_refused_rather_than_clamped(params, detail) -> None:
    """A clamped threshold would make the UI report a band that is not in force."""
    item = _movie_item().model_dump()
    response = TestClient(app).post("/api/analyze", json=item, params=params)

    assert response.status_code == 400
    assert response.json()["detail"] == detail


def test_clearing_the_cache_reports_what_it_dropped(mocker) -> None:
    fake = mocker.patch("backend.main.cache")
    fake.__len__.return_value = 12

    assert TestClient(app).delete("/api/cache").json() == {"cleared": 12}
    fake.clear.assert_called_once()
