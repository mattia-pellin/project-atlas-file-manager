from guessit import guessit
from typing import Dict, Any

def parse_filename(filename: str) -> Dict[str, Any]:
    """
    Uses GuessIt to extract metadata from the original filename.
    Returns a dictionary containing properties like:
    type (movie/episode), title, year, season, episode, format, etc.
    """
    guess = guessit(filename)
    
    # Normalize the output dictionary for our models
    result = {
        "media_type": guess.get("type", "unknown"), # Returns 'movie' or 'episode' usually
        "clean_title": guess.get("title", ""),
        "year": guess.get("year"),
        "season": guess.get("season"),
        "episode": guess.get("episode"),
        "episode_title": guess.get("episode_title"),
    }
    
    # Sometimes tv shows are parsed as unknown if there's no clear S01E01 but
    # they have 'season' or 'episode' properties
    if result["media_type"] == "unknown" and (result["season"] is not None or result["episode"] is not None):
        result["media_type"] = "episode"
        
    return result
