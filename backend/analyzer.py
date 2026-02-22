from .api_clients import TMDBClient, TVDBClientV4, calculate_padding
from .parser import parse_filename
from .models import MediaItem
import os
import uuid
import re

def sanitize_name(name: str) -> str:
    if not name:
        return ""
    # Convert ':', '\', '/' to space
    name = re.sub(r'[:\\/]', ' ', name)
    # Convert '|' to ' - '
    name = re.sub(r'\|', ' - ', name)
    # Remove '*', '?', '"', '<', '>'
    name = re.sub(r'[*?"<>]', '', name)
    name = re.sub(r'\s+', ' ', name)
    name = name.strip(' -')
    return name

LOWERCASE_WORDS = {
    "è", "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
    "di", "a", "da", "in", "con", "su", "per", "tra", "fra",
    "del", "dello", "della", "dei", "degli", "delle", "dell",
    "al", "allo", "alla", "ai", "agli", "alle", "all", "si",
    "dal", "dallo", "dalla", "dai", "dagli", "dalle", "dall",
    "nel", "nello", "nella", "nei", "negli", "nelle", "nell",
    "sul", "sullo", "sulla", "sui", "sugli", "sulle", "sull",
    "e", "ed", "o", "od", "ma", "che", "se",
    "a", "an", "and", "but", "for", "or", "nor", 
    "at", "by", "in", "of", "on", "to", "with", "from", "into"
}

def format_smart_title(text: str) -> str:
    if not text:
        return ""
    
    text = text.title()
    
    def replacer(match):
        word = match.group(0)
        word_lower = word.lower()
        start = match.start()
        
        if start == 0:
            return word
            
        prefix = text[:start].rstrip()
        if prefix and prefix[-1] in [':', '-']:
            return word
            
        if word_lower in LOWERCASE_WORDS or word_lower == 'l':
            return word_lower
            
        return word

    return re.sub(r'[A-Za-z\u00C0-\u00FF]+', replacer, text)

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
            title = sanitize_name(format_smart_title(title))
            
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
            series_name = sanitize_name(format_smart_title(series_data.get("name", "")))
            total_eps = series_data.get("total_episodes", 0)
            
            pad = calculate_padding(total_eps)
            s_str = f"{item.season:02d}" if item.season is not None else "01"
            
            ep_val = str(item.episode).strip() if item.episode is not None else "1"
            if '-' in ep_val:
                try:
                    start_ep, end_ep = map(int, ep_val.split('-'))
                    ep_titles = []
                    for num in range(start_ep, end_ep + 1):
                        ep_id = None
                        ep_title = ""
                        for ep in series_data.get("episodes_raw", []):
                            if ep.get("seasonNumber") == item.season and ep.get("number") == num:
                                ep_id = ep.get("id")
                                ep_title = ep.get("name", "")
                                break
                        if ep_id:
                            translated_title = await client.get_episode_translation(ep_id, language_prefs, bypass_cache)
                            if translated_title:
                                ep_title = format_smart_title(translated_title)
                        ep_title = sanitize_name(ep_title)
                        if ep_title:
                            ep_titles.append(ep_title)
                    
                    e_str = f"{start_ep:0{pad}d}-{end_ep:0{pad}d}"
                    proposed = f"{series_name} - S{s_str}E{e_str}"
                    if ep_titles:
                        proposed += " - " + " - ".join(ep_titles)
                except ValueError:
                    item.episode = 1
                    e_str = f"{1:0{pad}d}"
                    proposed = f"{series_name} - S{s_str}E{e_str}"
            else:
                try:
                    ep_num = int(ep_val)
                except ValueError:
                    ep_num = 1
                
                ep_title = ""
                ep_id = None
                for ep in series_data.get("episodes_raw", []):
                    if ep.get("seasonNumber") == item.season and ep.get("number") == ep_num:
                        ep_id = ep.get("id")
                        ep_title = ep.get("name", "")
                        break
                        
                if ep_id:
                    # Ask API to pull prioritized translation for this specific episode
                    translated_title = await client.get_episode_translation(ep_id, language_prefs, bypass_cache)
                    if translated_title:
                        ep_title = format_smart_title(translated_title)
                        
                if not ep_title and item.episode_title:
                    ep_title = format_smart_title(item.episode_title)
                    
                ep_title = sanitize_name(ep_title)
                
                e_str = f"{ep_num:0{pad}d}"
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
