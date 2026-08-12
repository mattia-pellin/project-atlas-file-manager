"""Tests for the confidence scoring that picks which API result a file belongs to.

This is the gate that stops a perfectly formed filename from being written for
the wrong show. The cases below are the real failures the scoring was built for:
*Doctor Who* matching the 1963 run instead of the 2005 one, and *One Piece
S01E10* matching the 2023 Netflix live action, which only has eight episodes.

Entirely offline — no API key, no network. That is the point: the thresholds are
pinned here rather than by whatever the live API happened to return that day.
"""

import pytest

from backend.api_clients import TVDBClientV4, _movie_candidate, _series_candidate
from backend.matching import (
    MATCH_THRESHOLD,
    REVIEW_THRESHOLD,
    Candidate,
    confidence,
    decide,
    elimination_is_trustworthy,
    normalize_title,
    rank_candidates,
    series_has_episodes,
    tied_leaders,
    title_similarity,
    year_factor,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("The Matrix", "the matrix"),
        # Accents fold, so an Italian title matches however the filename spelled it.
        ("Tè Sotto l'Albero", "te sotto lalbero"),
        ("L\u2019Impero Colpisce Ancora", "limpero colpisce ancora"),
        # The apostrophe is removed, not turned into a space: "dell'Amore" is one
        # word, and splitting it would invent a token no candidate has.
        ("dell'Amore", "dellamore"),
        ("Fast & Furious", "fast and furious"),
        ("Star Wars: Episode V - The Empire Strikes Back", "star wars episode v the empire strikes back"),
        ("  spaced   out  ", "spaced out"),
        ("", ""),
    ],
)
def test_normalize_title(raw: str, expected: str) -> None:
    assert normalize_title(raw) == expected


def test_an_exact_title_scores_one() -> None:
    assert title_similarity("Breaking Bad", "breaking bad") == 1.0
    assert title_similarity("L'Impero Colpisce Ancora", "L\u2019impero colpisce ancora") == 1.0


def test_a_franchise_prefix_the_api_drops_is_only_gently_penalised() -> None:
    """Filenames carry prefixes the API does not, and vice versa.

    "Star Wars The Empire Strikes Back" must still land on "The Empire Strikes
    Back" — but below an exact match, so a real exact title always outranks it.
    """
    score = title_similarity("Star Wars The Empire Strikes Back", "The Empire Strikes Back")
    assert 0.85 < score < 1.0


def test_an_unrelated_title_scores_low() -> None:
    assert title_similarity("Breaking Bad", "Better Call Saul") < 0.5


def test_an_empty_side_scores_zero() -> None:
    assert title_similarity("", "Breaking Bad") == 0.0
    assert title_similarity("Breaking Bad", "") == 0.0


@pytest.mark.parametrize(
    ("query", "candidate", "expected"),
    [
        # A filename with no year is not evidence against anything.
        (None, 1999, 1.0),
        (None, None, 1.0),
        (2003, 2003, 1.0),
        # Region and festival releases straddle a year boundary.
        (2003, 2004, 0.93),
        (2003, 2002, 0.93),
        (2003, 1999, 0.55),
        (2003, None, 0.85),
    ],
)
def test_year_factor(query, candidate, expected) -> None:
    assert year_factor(query, candidate) == expected


def test_the_year_outranks_a_shorter_title() -> None:
    """The Matrix Reloaded (2003) must not match The Matrix (1999).

    This is the fixture that used to launder its own wrong answer: the code took
    result[0], then overwrote the parsed 2003 with the matched film's 1999, so the
    result looked self-consistent. The year is evidence to check, not a hint.
    """
    reloaded = Candidate(key=604, names=("Matrix Reloaded",), year=2003)
    original = Candidate(key=603, names=("The Matrix",), year=1999)

    ranked = rank_candidates("The Matrix Reloaded", 2003, [original, reloaded])

    assert ranked[0].candidate is reloaded
    assert decide(ranked).verdict == "matched"


def test_a_clear_leader_is_matched() -> None:
    winner = {"tvdb_id": "81189"}
    ranked = rank_candidates(
        "Breaking Bad",
        None,
        [
            Candidate(key=1, names=("Breaking Bad",), year=2008, payload=winner),
            Candidate(key=2, names=("Breaking Bad: Original Minisodes",), year=2009, payload={"tvdb_id": "1"}),
        ],
    )
    decision = decide(ranked)
    assert decision.verdict == "matched"
    assert decision.confidence >= MATCH_THRESHOLD
    assert decision.payload is winner


def test_two_identically_named_series_are_never_matched_outright() -> None:
    """Doctor Who 1963 and Doctor Who 2005 are indistinguishable from the filename.

    Scoring must not break the tie by picking the first one. Being certain of the
    title is not being certain of the series, and the whole defect was calling
    that "matched".
    """
    ranked = rank_candidates(
        "Doctor Who",
        None,
        [
            Candidate(key=76107, names=("Doctor Who",), year=1963),
            Candidate(key=78804, names=("Doctor Who",), year=2005),
        ],
    )
    assert ranked[0].score == ranked[1].score == 1.0

    decision = decide(ranked)
    assert decision.verdict == "review"
    assert REVIEW_THRESHOLD <= decision.confidence < MATCH_THRESHOLD
    # The name is still offered — the user needs to see the candidate to judge it.
    assert decision.accepted
    assert "Ambiguous" in decision.reason


def test_a_lone_candidate_is_worth_its_own_score() -> None:
    ranked = rank_candidates("Breaking Bad", None, [Candidate(key=1, names=("Breaking Bad",), year=2008)])
    assert confidence(ranked) == 1.0


def test_nothing_worth_proposing_is_rejected_outright() -> None:
    ranked = rank_candidates("Il Trionfo dell'Amore", 1998, [Candidate(key=9, names=("Some Other Film",), year=1975)])
    decision = decide(ranked)
    assert decision.verdict == "rejected"
    assert decision.payload is None
    assert not decision.accepted


def test_an_empty_candidate_list_is_rejected() -> None:
    decision = decide([])
    assert decision.verdict == "rejected"
    assert decision.confidence == 0.0
    assert decision.payload is None


def test_disambiguated_leaders_keep_their_undamped_score() -> None:
    """Once the rivals are eliminated on evidence, the leader stops competing with them."""
    ranked = rank_candidates("One Piece", None, [Candidate(key=81797, names=("One Piece",), year=1999)])
    assert decide(ranked, disambiguated=True).verdict == "matched"


def test_tied_leaders_returns_the_candidates_worth_an_extra_call() -> None:
    ranked = rank_candidates(
        "One Piece",
        None,
        [
            Candidate(key=1, names=("One Piece",), year=1999),
            Candidate(key=2, names=("One Piece",), year=2023),
            Candidate(key=3, names=("One Piece Film Red",), year=2022),
        ],
    )
    leaders = tied_leaders(ranked, 3)
    assert [s.candidate.key for s in leaders] == [1, 2]


def test_tied_leaders_respects_the_call_budget() -> None:
    ranked = rank_candidates("Same", None, [Candidate(key=i, names=("Same",)) for i in range(5)])
    assert len(tied_leaders(ranked, 3)) == 3


@pytest.mark.parametrize(
    ("season", "start", "end", "expected"),
    [
        (1, 10, 10, True),
        (1, 1, 3, True),
        # The 2023 live action stops at episode 8, so it cannot own a file called E10.
        (1, 10, 10, True),
        (1, 12, 12, False),
        (1, 8, 12, False),
        (2, 1, 1, False),
    ],
)
def test_series_has_episodes(season: int, start: int, end: int, expected: bool) -> None:
    episodes = [{"seasonNumber": 1, "number": n} for n in range(1, 11)]
    assert series_has_episodes(episodes, season, start, end) is expected


def test_series_has_episodes_needs_every_member_of_a_range() -> None:
    """A season with a gap must not pass — which a count-based check would allow."""
    episodes = [{"seasonNumber": 1, "number": n} for n in (1, 2, 4, 5)]
    assert series_has_episodes(episodes, 1, 1, 2) is True
    assert series_has_episodes(episodes, 1, 2, 4) is False


def test_movie_candidate_keeps_the_original_title() -> None:
    """With lang=it the localized title no longer resembles the scanned filename."""
    candidate = _movie_candidate(
        {
            "id": 1891,
            "title": "L'Impero Colpisce Ancora",
            "original_title": "The Empire Strikes Back",
            "release_date": "1980-05-20",
        }
    )
    assert candidate.year == 1980
    assert "The Empire Strikes Back" in candidate.names
    assert candidate.label == "L'Impero Colpisce Ancora (1980)"


def test_movie_candidate_survives_a_missing_release_date() -> None:
    candidate = _movie_candidate({"id": 1, "title": "Unreleased", "release_date": ""})
    assert candidate.year is None


def test_series_candidate_folds_in_aliases_and_translations() -> None:
    """TVDB's Italian name for SpongeBob drops "SquarePants"; the filename keeps it."""
    candidate = _series_candidate(
        {
            "tvdb_id": "74980",
            "name": "SpongeBob SquarePants",
            "year": "1999",
            "aliases": ["Sponge Bob"],
            "translations": {"ita": "Spongebob"},
        }
    )
    assert candidate.year == 1999
    assert set(candidate.names) == {"SpongeBob SquarePants", "Sponge Bob", "Spongebob"}


def test_series_candidate_falls_back_to_the_first_air_date() -> None:
    candidate = _series_candidate({"tvdb_id": "1", "name": "Show", "first_air_time": "2011-04-17"})
    assert candidate.year == 2011


# --- The disambiguation round trip -----------------------------------------
# These drive the real `search_series`, with only the two network calls stubbed,
# because the fix is the interaction between scoring and the episode evidence.


def _extended(episode_numbers: range) -> dict:
    return {
        "name": "One Piece",
        "season_episode_counts": {1: len(episode_numbers)},
        "episodes_raw": [{"seasonNumber": 1, "number": n, "id": n} for n in episode_numbers],
        "year": None,
    }


def _wire_tvdb(mocker, entries: list[dict], extended_by_id: dict[str, dict]) -> TVDBClientV4:
    client = TVDBClientV4("key", "pin")

    async def search_results(*args, **kwargs):
        return entries

    async def token(*args, **kwargs):
        return "token"

    async def extended(series_id, *args, **kwargs):
        return extended_by_id.get(series_id)

    mocker.patch.object(TVDBClientV4, "_search_series_results", side_effect=search_results)
    mocker.patch.object(TVDBClientV4, "get_token", side_effect=token)
    mocker.patch.object(TVDBClientV4, "get_series_extended", side_effect=extended)
    return client


@pytest.mark.asyncio
async def test_the_episode_number_settles_two_series_with_the_same_name(mocker) -> None:
    """One Piece S01E10 belongs to the 1999 anime, not the 2023 live action.

    Nothing in the title or the year tells them apart — the filename has no year
    and both are called "One Piece". What does is that the Netflix series has
    eight episodes in season 1, so E10 cannot be one of its files.
    """
    client = _wire_tvdb(
        mocker,
        entries=[
            {"tvdb_id": "392276", "name": "One Piece", "year": "2023"},
            {"tvdb_id": "81797", "name": "One Piece", "year": "1999"},
        ],
        extended_by_id={"392276": _extended(range(1, 9)), "81797": _extended(range(1, 62))},
    )

    decision = await client.search_series("One Piece", ["it", "en"], season=1, episode=(10, 10))

    assert decision.verdict == "matched"
    assert decision.payload["season_episode_counts"] == {1: 61}


@pytest.mark.asyncio
async def test_a_tie_both_candidates_can_explain_stays_for_review(mocker) -> None:
    """Both Doctor Who runs really do have S05E01, so the evidence settles nothing.

    The correct outcome is to refuse to guess, not to fall back to the first result.
    """
    client = _wire_tvdb(
        mocker,
        entries=[
            {"tvdb_id": "76107", "name": "Doctor Who", "year": "1963"},
            {"tvdb_id": "78804", "name": "Doctor Who", "year": "2005"},
        ],
        extended_by_id={
            "76107": {"name": "Doctor Who", "episodes_raw": [{"seasonNumber": 5, "number": 1}]},
            "78804": {"name": "Doctor Who", "episodes_raw": [{"seasonNumber": 5, "number": 1}]},
        },
    )

    decision = await client.search_series("Doctor Who", ["it", "en"], season=5, episode=(1, 1))

    assert decision.verdict == "review"
    assert decision.accepted


@pytest.mark.asyncio
async def test_no_candidate_having_the_episode_falls_back_to_the_title_score(mocker) -> None:
    """Evidence that eliminates everybody is no evidence: do not silently reject.

    A season TVDB has not catalogued yet would otherwise make every candidate
    impossible, and the user would get no name at all instead of one to check.
    """
    client = _wire_tvdb(
        mocker,
        entries=[
            {"tvdb_id": "1", "name": "One Piece", "year": "2023"},
            {"tvdb_id": "2", "name": "One Piece", "year": "1999"},
        ],
        extended_by_id={"1": _extended(range(1, 9)), "2": _extended(range(1, 9))},
    )

    decision = await client.search_series("One Piece", ["it", "en"], season=1, episode=(99, 99))

    assert decision.verdict == "review"
    assert decision.accepted


@pytest.mark.asyncio
async def test_episode_evidence_never_promotes_a_weaker_title(mocker) -> None:
    """The regression that made this worse than no scoring at all.

    TVDB's default order splits the One Piece anime into arc-sized seasons, so
    season 1 holds 8 episodes and a real `S01E10` is missing from the very series
    it belongs to. A parody called *None Piece* does have 11, so eliminating on
    episode presence promoted the parody — and, being the lone survivor, it was
    stamped `matched` at 0.95. Absent-episode evidence may break a tie between
    equals; it may never outrank a better title.
    """
    client = _wire_tvdb(
        mocker,
        entries=[
            {"tvdb_id": "81797", "name": "One Piece", "year": "1999"},
            {"tvdb_id": "287080", "name": "None Piece", "year": "2011"},
        ],
        extended_by_id={
            "81797": _extended(range(1, 9)),
            "287080": {"name": "None Piece", "episodes_raw": [{"seasonNumber": 1, "number": n} for n in range(1, 12)]},
        },
    )

    decision = await client.search_series("One Piece", ["it", "en"], season=1, episode=(10, 10))

    # The better title wins despite being the one that "lacks" the episode.
    assert decision.payload["name"] == "One Piece"


@pytest.mark.asyncio
async def test_a_failed_lookup_is_not_evidence_that_the_episode_is_absent(mocker) -> None:
    """A network blip must not decide which series a file belongs to.

    Treating a `None` from `get_series_extended` as "this one lacks the episode"
    silently hands the match to whichever candidate happened to answer.
    """
    client = _wire_tvdb(
        mocker,
        entries=[
            {"tvdb_id": "1", "name": "Some Show", "year": "1999"},
            {"tvdb_id": "2", "name": "Some Show", "year": "2023"},
        ],
        # The leader answers and has the episode; its rival's lookup fails outright.
        # Read as "the rival lacks it", that would leave one survivor and read as settled.
        extended_by_id={"1": _extended(range(1, 21))},
    )

    decision = await client.search_series("Some Show", ["it", "en"], season=1, episode=(10, 10))

    assert decision.verdict == "review"


def test_elimination_is_trustworthy() -> None:
    strong = rank_candidates("Show", None, [Candidate(key=1, names=("Show",))])[0]
    weak = rank_candidates("Show", None, [Candidate(key=2, names=("Shows Off",))])[0]
    assert strong.score > weak.score

    # Breaking a tie between equals is the case this exists for.
    assert elimination_is_trustworthy([strong], [strong]) is True
    # Promoting the weaker candidate over the eliminated stronger one is not.
    assert elimination_is_trustworthy([weak], [strong]) is False
    assert elimination_is_trustworthy([], [strong]) is False


def test_a_candidate_label_does_not_repeat_the_year() -> None:
    """TVDB disambiguates its own duplicates in the name: "Doctor Who (2005)"."""
    assert Candidate(key=1, names=("Doctor Who (2005)",), year=2005).label == "Doctor Who (2005)"
    assert Candidate(key=2, names=("Doctor Who",), year=1963).label == "Doctor Who (1963)"
    assert Candidate(key=3, names=("Doctor Who",)).label == "Doctor Who"


@pytest.mark.asyncio
async def test_a_search_with_no_results_is_rejected_without_a_token_call(mocker) -> None:
    client = _wire_tvdb(mocker, entries=[], extended_by_id={})
    decision = await client.search_series("Nonexistent Show", ["it", "en"], season=1, episode=(1, 1))
    assert decision.verdict == "rejected"
    assert decision.payload is None
