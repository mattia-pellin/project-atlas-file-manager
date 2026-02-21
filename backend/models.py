from pydantic import BaseModel
from typing import Optional, List

class MediaItem(BaseModel):
    id: str  # Unique identifier for the frontend table
    original_path: str
    original_name: str
    media_type: str  # "movie" or "series"
    clean_title: str
    year: Optional[int] = None
    season: Optional[int] = None
    episode: Optional[int] = None
    episode_title: Optional[str] = None
    proposed_name: Optional[str] = None
    tmdb_id: Optional[int] = None
    tvdb_id: Optional[int] = None
    status: str = "pending" # pending, renaming, error, success
    message: Optional[str] = None

class ScanRequest(BaseModel):
    directory: str
    bypass_cache: bool = False
    language_preference: List[str] = ["it", "en"]

class RenameRequest(BaseModel):
    items: List[MediaItem]
