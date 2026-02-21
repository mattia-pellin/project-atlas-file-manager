import os
import httpx
from typing import List, Optional, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type, retry_if_exception

def is_retryable_error(exception: Exception) -> bool:
    if isinstance(exception, httpx.RequestError):
        return True
    if isinstance(exception, httpx.HTTPStatusError):
        # Retry only on 5xx or 429 Too Many Requests
        return exception.response.status_code >= 500 or exception.response.status_code == 429
    return False

# We will use diskcache for a simple, persistent bypassing cache
import diskcache

cache = diskcache.Cache('.cache')

class APIError(Exception):
    pass

def get_cache_key(prefix: str, *args, **kwargs) -> str:
    key = f"{prefix}:" + ":".join(str(a) for a in args)
    if kwargs:
        key += ":" + ":".join(f"{k}={v}" for k, v in sorted(kwargs.items()))
    return key


class TMDBClient:
    BASE_URL = "https://api.themoviedb.org/3"
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        
    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception(is_retryable_error)
    )
    async def _request(self, endpoint: str, params: Dict[str, Any]) -> Dict[str, Any]:
        params['api_key'] = self.api_key
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.BASE_URL}{endpoint}", params=params, timeout=10.0)
            response.raise_for_status()
            return response.json()

    async def search_movie(self, title: str, year: Optional[int], language_prefs: List[str], bypass_cache: bool = False) -> Optional[Dict[str, Any]]:
        # Check cache
        cache_key = get_cache_key("tmdb_search", title, year, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            return cache[cache_key]
        
        # Determine language (fallback loop)
        for lang in language_prefs:
            params = {"query": title, "language": f"{lang}-{lang.upper()}"}
            if year:
                params["year"] = year
                
            try:
                data = await self._request("/search/movie", params)
                if data.get("results"):
                    result = data["results"][0]
                    # We found a match, cache it and return
                    cache.set(cache_key, result, expire=int(os.getenv("CACHE_TTL_HOURS", 24)) * 3600)
                    return result
            except Exception as e:
                print(f"TMDB search failed for {lang}: {e}")
                
        # Cache negative result briefly to avoid hammering on unmatchable items
        cache.set(cache_key, None, expire=3600)
        return None


class TVDBClientV4:
    BASE_URL = "https://api4.thetvdb.com/v4"
    
    def __init__(self, api_key: str, pin: Optional[str] = None):
        self.api_key = api_key
        self.pin = pin
        
    async def get_token(self, bypass_cache: bool = False) -> str:
        cache_key = "tvdb_token_v4"
        if not bypass_cache and cache_key in cache:
            return cache.get(cache_key)
            
        payload = {"apikey": self.api_key}
        if self.pin:
            payload["pin"] = self.pin
            
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(f"{self.BASE_URL}/login", json=payload, timeout=10.0)
                response.raise_for_status()
                token = response.json().get("data", {}).get("token")
                # Token usually valid for 1 month, let's cache for 24h
                cache.set(cache_key, token, expire=86400)
                return token
            except Exception as e:
                print(f"TVDB Auth failed: {e}")
                return ""

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception(is_retryable_error)
    )
    async def _request(self, endpoint: str, token: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.BASE_URL}{endpoint}", headers=headers, params=params, timeout=10.0)
            response.raise_for_status()
            return response.json()

    async def search_series(self, title: str, language_prefs: List[str], bypass_cache: bool = False) -> Optional[Dict[str, Any]]:
        cache_key = get_cache_key("tvdb_search_series", title, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            return cache[cache_key]
            
        token = await self.get_token(bypass_cache)
        if not token:
            return None
            
        params = {"query": title, "type": "series"}
        
        try:
            data = await self._request("/search", token, params)
            if data.get("data"):
                # For now just grab the first valid result ID to query translations
                result = data["data"][0]
                
                # We fetch extended info to get language specific translation
                series_id = result.get("tvdb_id")
                series_data = await self.get_series_extended(series_id, language_prefs, token, bypass_cache)
                
                cache.set(cache_key, series_data, expire=int(os.getenv("CACHE_TTL_HOURS", 24)) * 3600)
                return series_data
        except Exception as e:
            print(f"TVDB search failed: {e}")
            
        return None

    async def get_series_extended(self, series_id: int, language_prefs: List[str], token: str, bypass_cache: bool = False) -> Optional[Dict[str, Any]]:
        cache_key = get_cache_key("tvdb_series_ext", series_id, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            return cache[cache_key]
            
        try:
            data = await self._request(f"/series/{series_id}/extended", token)
            series_info = data.get("data", {})
            
            # Extract total episodes for padding calculation across all seasons
            total_eps = 0
            episodes = series_info.get("episodes", [])
            season_arrays = [ep for ep in episodes if ep.get("seasonNumber", 0) > 0]
            total_eps = len(season_arrays)
            
            # Find closest translation
            best_translation = series_info.get("name")
            translations = series_info.get("translations", {}).get("nameTranslations", [])
            for lang in language_prefs:
                # TVDB uses 'ita', 'eng' style (3-letter usually), adapting from 2 letter logic 
                # This could be refined based on TVDB exact lang format
                match = next((t.get("name") for t in translations if t.get("language") and t.get("language").startswith(lang)), None)
                if match:
                    best_translation = match
                    break

            result = {
                "name": best_translation or series_info.get("name"),
                "total_episodes": total_eps,
                "episodes_raw": episodes # Store raw for episode lookups
            }
            cache.set(cache_key, result, expire=int(os.getenv("CACHE_TTL_HOURS", 24)) * 3600)
            return result
        except Exception as e:
            print(f"TVDB series extended failed: {e}")
            return None


def calculate_padding(total_items: int) -> int:
    """Calculates zero-padding based on total expected items (minimum 2 chars)"""
    if total_items < 100:
        return 2
    return len(str(total_items))
