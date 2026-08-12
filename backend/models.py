from pydantic import BaseModel


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


class ScanRequest(BaseModel):
    directory: str
    bypass_cache: bool = False
    language_preference: list[str] = ["it", "en"]


class RenameRequest(BaseModel):
    items: list[MediaItem]
