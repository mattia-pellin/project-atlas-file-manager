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
    status: str = "pending"  # pending, renaming, error, success
    message: str | None = None


class ScanRequest(BaseModel):
    directory: str
    bypass_cache: bool = False
    language_preference: list[str] = ["it", "en"]


class RenameRequest(BaseModel):
    items: list[MediaItem]
