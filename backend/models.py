from pydantic import BaseModel


class CandidateOut(BaseModel):
    """One search result the scoring considered, as the triage UI sees it.

    The point of exposing these is that confidence is not a fix: when two shows
    called *Doctor Who* score alike, no threshold can tell them apart — only the
    user can. `key` is what they send back as `forced_key` to settle it.

    Every candidate that was ranked appears here, including ones the episode
    evidence eliminated. That is deliberate: TVDB's arc-sized seasons mean the
    *correct* series can be the one that does not list the episode, so hiding
    the eliminated candidates would hide the right answer.
    """

    key: str  # stringified — TMDB ids are ints, TVDB's are strings
    label: str
    source: str  # "tmdb" or "tvdb"
    year: int | None = None
    score: float
    title_score: float
    year_factor: float
    poster_url: str | None = None
    overview: str | None = None
    # Which one the backend actually built the proposed name from.
    selected: bool = False


class MediaItem(BaseModel):
    id: str  # Unique identifier for the frontend table
    original_path: str
    original_name: str
    media_type: str  # "movie" or "series"
    clean_title: str
    year: int | None = None
    season: int | None = None
    episode: int | str | None = None
    episode_title: str | None = None
    proposed_name: str | None = None
    tmdb_id: int | None = None
    tvdb_id: int | None = None
    # "review" is a match the scoring is not sure of: the name is proposed and
    # editable, but the row is not auto-selected, so renaming it takes a deliberate
    # tick. See backend/matching.py for how the confidence is derived.
    status: str = "pending"  # pending, matched, review, renaming, error, success
    confidence: float | None = None
    message: str | None = None
    # Best first. Populated on every analyzed item, including rejected ones — a row
    # with no name is exactly the row whose alternatives the user needs to see.
    candidates: list[CandidateOut] = []


class ScanRequest(BaseModel):
    directory: str
    bypass_cache: bool = False
    language_preference: list[str] = ["it", "en"]


class RenameRequest(BaseModel):
    items: list[MediaItem]


class ThresholdsOut(BaseModel):
    """The confidence bands, as reported to the UI.

    `match` and `review` are per-request overridable on `/api/analyze`.
    `decisive_margin` is not: it is how close a runner-up has to be to count as a
    tie, which is scoring internals rather than a user preference.
    """

    match: float
    review: float
    decisive_margin: float


class ConfigOut(BaseModel):
    """Everything the UI needs to render its settings panel without guessing."""

    media_roots: list[str]
    default_directory: str | None
    language_preference: list[str]
    cache_ttl_hours: int
    cache_entries: int
    cache_size_bytes: int
    thresholds: ThresholdsOut
    max_candidates: int
    # Booleans, never the keys themselves. A missing key currently presents as
    # "Nessuna corrispondenza trovata", which reads as an API fault rather than a
    # configuration one; this is what lets the UI say which it is.
    tmdb_configured: bool
    tvdb_configured: bool


class KeyStatus(BaseModel):
    """The result of actually using a key, rather than of finding one set.

    Four states, not two, because they call for four different actions and three of
    them used to arrive as the same "Nessuna corrispondenza trovata":

    - `missing`     — nothing in the environment. Set it.
    - `ok`          — the provider accepted it.
    - `invalid`     — the provider rejected it. Rotate it.
    - `unreachable` — the request never got an answer. Nothing is wrong with the key,
                      and telling the user to replace it would be actively misleading;
                      DNS on this network has failed this way before.

    `detail` is a sentence for the tooltip. It must never carry the key itself, so it
    is built from the status code and the exception type only.
    """

    state: str  # "ok" | "invalid" | "missing" | "unreachable"
    detail: str


class KeyCheckOut(BaseModel):
    tmdb: KeyStatus
    tvdb: KeyStatus
