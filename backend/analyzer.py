from .api_clients import TMDBClient, TVDBClientV4, calculate_padding
from .parser import parse_filename
from .models import MediaItem
import os
import uuid
import re

def sanitize_name(name: str) -> str:
    if not name:
        return ""
    name = re.sub(r'[\\/]', '-', name)
    name = re.sub(r'[*?"<>|]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name

async def enrich_media_item(item: MediaItem, language_prefs: list[str], bypass_cache: bool = False) -> MediaItem:
    # If standard scan, we parse the filename here. If re-analyzing, we use user overrides.
    if not item.media_type or item.media_type == "unknown":
        parsed = parse_filename(item.original_name)
        item.media_type = parsed.get("media_type")
        item.clean_title = parsed.get("clean_title")
        item.year = parsed.get("year")
        item.season = parsed.get("season")
        item.episode = parsed.get("episode")
        item.episode_title = parsed.get("episode_title")
    
    # Initialize clients lazily or globally (using env vars)
    tmdb_key = os.getenv("TMDB_API_KEY")
    tvdb_key = os.getenv("TVDB_API_KEY")
    tvdb_pin = os.getenv("TVDB_PIN")
    
    ext = os.path.splitext(item.original_name)[1]
    
    if item.media_type == "movie" and tmdb_key:
        client = TMDBClient(tmdb_key)
        movie_data = await client.search_movie(item.clean_title, item.year, language_prefs, bypass_cache)
        if movie_data:
            title = movie_data.get("title") or movie_data.get("original_title")
            # Format: Title Case, replace slashes with dashes, remove illegal chars
            title = sanitize_name(title.title())
            
            # Map API year to item
            api_year = movie_data.get("release_date", "")[:4]
            if api_year and api_year.isdigit():
                item.year = int(api_year)
                
            item.proposed_name = f"{title}"
            if item.year:
                item.proposed_name += f" ({item.year})"
            item.proposed_name += ext
            item.tmdb_id = movie_data.get("id")
            item.status = "matched"
            
    elif item.media_type == "episode" and tvdb_key:
        client = TVDBClientV4(tvdb_key, tvdb_pin)
        series_data = await client.search_series(item.clean_title, language_prefs, bypass_cache)
        if series_data:
            series_name = sanitize_name(series_data.get("name", "").title())
            total_eps = series_data.get("total_episodes", 0)
            
            # Find specific episode and its ID
            ep_title = ""
            ep_id = None
            for ep in series_data.get("episodes_raw", []):
                if ep.get("seasonNumber") == item.season and ep.get("number") == item.episode:
                    ep_id = ep.get("id")
                    ep_title = ep.get("name", "")
                    break
                    
            if ep_id:
                # Ask API to pull prioritized translation for this specific episode
                translated_title = await client.get_episode_translation(ep_id, language_prefs, bypass_cache)
                if translated_title:
                    ep_title = translated_title.title()
                    
            if not ep_title and item.episode_title:
                ep_title = item.episode_title.title()
                
            ep_title = sanitize_name(ep_title)
            
            pad = calculate_padding(total_eps)
            s_str = f"{item.season:02d}" if item.season is not None else "01"
            
            # The format string ensures dynamic padding E.g. 02, 002, 0002 based on pad length
            e_str = f"{item.episode:0{pad}d}" if item.episode is not None else "01".zfill(pad)
            
            proposed = f"{series_name} - S{s_str}E{e_str}"
            if ep_title:
                proposed += f" - {ep_title}"
            proposed += ext
            # Map API year to item
            api_year = series_data.get("year")
            if api_year:
                try:
                    item.year = int(api_year)
                except ValueError:
                    pass

            item.proposed_name = proposed
            item.status = "matched"
            
    if not item.proposed_name:
        item.status = "error"
        item.message = "Could not find a match"
        
    return item
