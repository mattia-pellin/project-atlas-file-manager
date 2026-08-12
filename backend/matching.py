"""Confidence scoring for TMDB/TVDB search results.

Pure and offline: nothing here touches the network. `api_clients` hands over the
raw candidate list an API returned, and this module decides which candidate wins
and how much that decision can be trusted.

It exists because taking `results[0]` and calling it `"matched"` filed
*Doctor Who S05E01* under the 1963 classic run and *One Piece S01E10* under the
2023 Netflix live action. Both produced a perfectly formed filename for the
wrong show — the one failure mode this application must never have unattended.

Two consequences of keeping the scoring separate from the clients:

- it is testable without an API key, so the thresholds are pinned by
  `test_matching.py` rather than by whatever the live API returned that day;
- only *raw* API payloads are cached, never scores, so retuning a threshold
  takes effect immediately instead of waiting out a 24h cache entry.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

# --- Thresholds -------------------------------------------------------------
# A leader this far ahead of the runner-up is considered decisive on its own.
# Below it, confidence is scaled down: two candidates that score alike mean the
# evidence does not pick between them, however good the leader looks in isolation.
DECISIVE_MARGIN = 0.08

# At or above this the item is auto-selected for rename. Below it the name is
# still proposed but the row must be ticked by hand.
MATCH_THRESHOLD = 0.75

# Below this the candidate is discarded entirely — no name is proposed.
REVIEW_THRESHOLD = 0.45

# --- Title similarity -------------------------------------------------------
# A title that is a strict subset of the other side's tokens is the normal case,
# not a weak match: filenames carry franchise prefixes the API drops
# ("Star Wars The Empire Strikes Back" vs "The Empire Strikes Back") and APIs
# carry subtitles the filename drops. Penalise it gently, per missing word, and
# always below 1.0 so an exact title still wins.
SUBSET_BASE = 0.97
SUBSET_STEP = 0.03
SUBSET_FLOOR = 0.70

# --- Year agreement ---------------------------------------------------------
# Multiplicative on the title score: a wrong year scales a perfect title down
# rather than merely failing to boost it. `YEAR_NEAR` covers the festival- and
# region-release skew that puts a film one year either side of its TMDB date.
YEAR_EXACT = 1.0
YEAR_NEAR = 0.93
YEAR_UNKNOWN = 0.85
YEAR_MISMATCH = 0.55

_COMBINING = unicodedata.combining
_APOSTROPHES = re.compile("['\u2019\u02bc]")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_TRAILING_YEAR = re.compile(r"\s*\((?:19|20)\d{2}\)\s*$")


@dataclass(frozen=True)
class Thresholds:
    """The two bands a user is allowed to move, carried together.

    They are per-request rather than global mutable state: `/api/analyze` takes
    them as query parameters, so two concurrent analyses cannot read a threshold
    that a third request changed halfway through.
    """

    match: float = MATCH_THRESHOLD
    review: float = REVIEW_THRESHOLD


DEFAULT_THRESHOLDS = Thresholds()


@dataclass(frozen=True)
class Candidate:
    """One search result, reduced to what scoring needs.

    `key` and `payload` are opaque here — the client that built the candidate is
    the only thing that interprets them.
    """

    key: Any
    names: tuple[str, ...]
    year: int | None = None
    payload: Any = None

    @property
    def label(self) -> str:
        """Short human-readable form, for the message shown next to a review row."""
        name = self.names[0] if self.names else "?"
        # TVDB disambiguates its own duplicates in the name ("Doctor Who (2005)"),
        # which would otherwise print the year twice.
        name = _TRAILING_YEAR.sub("", name).strip() or name
        return f"{name} ({self.year})" if self.year else name


@dataclass(frozen=True)
class ScoredCandidate:
    candidate: Candidate
    score: float
    title_score: float
    year_factor: float


@dataclass(frozen=True)
class Decision:
    """The outcome of scoring, in the vocabulary `MediaItem.status` uses.

    `verdict` is one of `"matched"`, `"review"`, `"rejected"`. `payload` is the
    winning API object, and is None exactly when the verdict is `"rejected"`.
    """

    verdict: str
    confidence: float
    reason: str
    payload: Any = None
    ranked: tuple[ScoredCandidate, ...] = field(default=())

    @property
    def accepted(self) -> bool:
        """Whether a name may be built from this. True for both "matched" and "review"."""
        return self.verdict != "rejected"


def normalize_title(text: str) -> str:
    """Folds a title to a comparable form: no accents, no case, no punctuation.

    Apostrophes are *removed* rather than replaced by a space, so the Italian
    elisions this library is full of stay one token: "dell'Amore" and "dellamore"
    compare equal instead of splitting into two words that no candidate has.
    """
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not _COMBINING(ch))
    lowered = stripped.lower().replace("&", " and ")
    lowered = _APOSTROPHES.sub("", lowered)
    return " ".join(_NON_ALNUM.sub(" ", lowered).split())


def title_similarity(query: str, name: str) -> float:
    """0.0-1.0 similarity between a parsed filename title and one candidate name."""
    q = normalize_title(query)
    c = normalize_title(name)
    if not q or not c:
        return 0.0
    if q == c:
        return 1.0

    ratio = SequenceMatcher(None, q, c).ratio()

    q_words = q.split()
    c_words = c.split()
    q_tokens = set(q_words)
    c_tokens = set(c_words)
    if q_tokens <= c_tokens or c_tokens <= q_tokens:
        extra = abs(len(q_words) - len(c_words))
        ratio = max(ratio, max(SUBSET_FLOOR, SUBSET_BASE - SUBSET_STEP * extra))

    return ratio


def best_title_score(query: str, names: tuple[str, ...]) -> float:
    """Best similarity across every name a candidate is known by.

    All of them, not just the primary: with `lang=it` TMDB returns *L'Impero
    Colpisce Ancora* as the title, and only `original_title` still resembles the
    English filename the scan actually found.
    """
    return max((title_similarity(query, name) for name in names if name), default=0.0)


def year_factor(query_year: int | None, candidate_year: int | None) -> float:
    """Multiplier applied to the title score for year agreement.

    A filename with no year is not evidence against anything, so it is neutral.
    A filename *with* a year that disagrees is strong evidence against.
    """
    if query_year is None:
        return 1.0
    if candidate_year is None:
        return YEAR_UNKNOWN
    diff = abs(query_year - candidate_year)
    if diff == 0:
        return YEAR_EXACT
    if diff == 1:
        return YEAR_NEAR
    return YEAR_MISMATCH


def score_candidate(query_title: str, query_year: int | None, candidate: Candidate) -> ScoredCandidate:
    title = best_title_score(query_title, candidate.names)
    factor = year_factor(query_year, candidate.year)
    return ScoredCandidate(candidate=candidate, score=title * factor, title_score=title, year_factor=factor)


def rank_candidates(query_title: str, query_year: int | None, candidates: list[Candidate]) -> list[ScoredCandidate]:
    """Scores every candidate, best first. Ties keep the API's own order."""
    scored = [score_candidate(query_title, query_year, c) for c in candidates]
    # `sorted` is stable, so equal scores stay in the order the API returned them —
    # which is the only tiebreak available and is at least reproducible.
    return sorted(scored, key=lambda s: s.score, reverse=True)


def confidence(ranked: list[ScoredCandidate]) -> float:
    """How much the leader can be trusted: its own score, damped by how close the runner-up is.

    A lone candidate is worth exactly its score. A leader tied with the next
    candidate is worth half of it — "this looks like Doctor Who" is true of both
    Doctor Whos, and being sure of the title is not being sure of the series.
    """
    if not ranked:
        return 0.0
    best = ranked[0].score
    if len(ranked) == 1:
        return best
    margin = best - ranked[1].score
    return best * (0.5 + 0.5 * min(margin / DECISIVE_MARGIN, 1.0))


def tied_leaders(ranked: list[ScoredCandidate], limit: int) -> list[ScoredCandidate]:
    """The leader plus everything within `DECISIVE_MARGIN` of it, capped at `limit`.

    These are the candidates worth spending an extra API call on to tell apart.
    """
    if not ranked:
        return []
    cutoff = ranked[0].score - DECISIVE_MARGIN
    return [s for s in ranked if s.score > cutoff][:limit]


def series_has_episodes(episodes_raw: list[dict[str, Any]], season: int, start: int, end: int) -> bool:
    """Whether a series actually carries every episode in `start..end` of `season`.

    This is the evidence that separates two shows with the same name: the 2023
    live-action *One Piece* has eight episodes in season 1, so it cannot be the
    series a file called `S01E10` belongs to. Checked against the episode list
    rather than a count, because a season with gaps would pass a count test.
    """
    wanted = set(range(start, end + 1))
    for ep in episodes_raw:
        if ep.get("seasonNumber") == season:
            wanted.discard(ep.get("number"))
            if not wanted:
                return True
    return not wanted


def elimination_is_trustworthy(survivors: list[ScoredCandidate], eliminated: list[ScoredCandidate]) -> bool:
    """Whether episode evidence may be acted on, given who it ruled out.

    Evidence is allowed to break a tie between equals. It is *not* allowed to
    promote a weaker title over a stronger one, because "this series does not
    list that episode" is a much softer fact than it looks: TVDB's default order
    splits the One Piece anime into arc-sized seasons of 8 episodes, so a real
    `S01E10` is absent from the very series it belongs to.

    Trusting it anyway is not theoretical — it ranked a parody called *None Piece*
    above the anime and called the result a confident match.
    """
    if not survivors:
        return False
    best_eliminated = max((e.score for e in eliminated), default=0.0)
    return survivors[0].score >= best_eliminated


def decide(
    ranked: list[ScoredCandidate],
    *,
    disambiguated: bool = False,
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> Decision:
    """Turns a ranking into a verdict, a confidence and a message for the UI.

    `disambiguated=True` means the caller has already eliminated the rival
    candidates on hard evidence (see `series_has_episodes`), so the leader is no
    longer competing with them and its score stands undamped.
    """
    if not ranked:
        return Decision(verdict="rejected", confidence=0.0, reason="No candidate returned by the API")

    leader = ranked[0]
    conf = leader.score if disambiguated else confidence(ranked)

    if conf < thresholds.review:
        return Decision(
            verdict="rejected",
            confidence=conf,
            reason=f"No confident match — closest was {leader.candidate.label} at {conf:.2f}",
            ranked=tuple(ranked),
        )

    if conf >= thresholds.match:
        return Decision(
            verdict="matched", confidence=conf, reason="", payload=leader.candidate.payload, ranked=tuple(ranked)
        )

    rival = ranked[1] if len(ranked) > 1 else None
    if rival is not None and leader.score - rival.score < DECISIVE_MARGIN:
        reason = (
            f"Ambiguous ({conf:.2f}): {leader.candidate.label} and {rival.candidate.label} "
            f"score alike — confirm before renaming"
        )
    else:
        reason = f"Low confidence ({conf:.2f}) for {leader.candidate.label} — confirm before renaming"

    return Decision(
        verdict="review", confidence=conf, reason=reason, payload=leader.candidate.payload, ranked=tuple(ranked)
    )
