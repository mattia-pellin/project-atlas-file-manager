import asyncio
import os
from dataclasses import replace
from typing import Any

import diskcache
import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from . import matching


def is_retryable_error(exception: Exception) -> bool:
    if isinstance(exception, httpx.RequestError):
        return True
    if isinstance(exception, httpx.HTTPStatusError):
        # Retry only on 5xx or 429 Too Many Requests
        return exception.response.status_code >= 500 or exception.response.status_code == 429
    return False


# Simple, persistent on-disk cache so repeated scans don't hammer TMDB/TVDB.
cache = diskcache.Cache(".cache")


class APIError(Exception):
    pass


def get_cache_key(prefix: str, *args, **kwargs) -> str:
    key = f"{prefix}:" + ":".join(str(a) for a in args)
    if kwargs:
        key += ":" + ":".join(f"{k}={v}" for k, v in sorted(kwargs.items()))
    return key


# How many raw search results are kept per query. Scoring only ever needs the
# top handful, and the list goes into the on-disk cache.
MAX_CACHED_RESULTS = 10

# How many near-tied series to spend an extra `get_series_extended` call on when
# the title alone cannot separate them. Bounded because that call paginates the
# whole episode list for large series.
MAX_DISAMBIGUATION_CANDIDATES = 3


def _movie_candidate(result: dict[str, Any]) -> matching.Candidate:
    """A TMDB search result, reduced for scoring.

    Both names are kept: with `lang=it` `title` is the Italian one and only
    `original_title` still resembles the English filename that was scanned.
    """
    release = str(result.get("release_date") or "")
    year = int(release[:4]) if release[:4].isdigit() else None
    names = tuple(dict.fromkeys(n for n in (result.get("title"), result.get("original_title")) if n))
    return matching.Candidate(key=result.get("id"), names=names, year=year, payload=result)


def _series_candidate(entry: dict[str, Any]) -> matching.Candidate:
    """A TVDB search result, reduced for scoring.

    Aliases and translations are folded in as names, because the filename may
    well carry any of them — TVDB's Italian name for SpongeBob drops
    "SquarePants", which the scanned file still has.
    """
    names: list[Any] = [entry.get("name")]
    names.extend(entry.get("aliases") or [])
    translations = entry.get("translations")
    if isinstance(translations, dict):
        names.extend(translations.values())

    year_raw = str(entry.get("year") or "") or str(entry.get("first_air_time") or "")[:4]
    year = int(year_raw) if year_raw.isdigit() else None

    return matching.Candidate(
        key=entry.get("tvdb_id"),
        names=tuple(dict.fromkeys(n for n in names if isinstance(n, str) and n)),
        year=year,
        payload=entry,
    )


# Locks to prevent concurrent API flooding for the exact same resource
_search_locks: dict[str, asyncio.Lock] = {}


def get_lock(key: str) -> asyncio.Lock:
    if key not in _search_locks:
        _search_locks[key] = asyncio.Lock()
    return _search_locks[key]


class TMDBClient:
    BASE_URL = "https://api.themoviedb.org/3"

    def __init__(self, api_key: str):
        self.api_key = api_key

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception(is_retryable_error),
    )
    async def _request(self, endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
        params["api_key"] = self.api_key
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.BASE_URL}{endpoint}", params=params, timeout=10.0)
            response.raise_for_status()
            return response.json()

    async def _search_movie_results(
        self, title: str, year: int | None, language_prefs: list[str], bypass_cache: bool
    ) -> list[dict[str, Any]]:
        """The raw TMDB candidate list. Only raw payloads are cached, never scores."""
        cache_key = get_cache_key("tmdb_search_raw_v1", title, year, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            return cache[cache_key]

        # Determine language (fallback loop)
        for lang in language_prefs:
            # TMDB's `year` is a filter, not the soft boost it looks like. If it
            # excludes everything, the filename's year is likelier wrong than its
            # title, so widen the search and let scoring weigh the year instead —
            # a year that disagrees should cost the candidate points, not hide it.
            for attempt_year in [year, None] if year else [None]:
                params: dict[str, Any] = {"query": title, "language": f"{lang}-{lang.upper()}"}
                if attempt_year:
                    params["year"] = attempt_year

                try:
                    data = await self._request("/search/movie", params)
                except Exception as e:
                    print(f"TMDB search failed for {lang}: {e}")
                    continue

                results = data.get("results") or []
                if results:
                    results = results[:MAX_CACHED_RESULTS]
                    cache.set(cache_key, results, expire=int(os.getenv("CACHE_TTL_HOURS", 24)) * 3600)
                    return results

        # Cache negative result briefly to avoid hammering on unmatchable items
        cache.set(cache_key, [], expire=3600)
        return []

    async def search_movie(
        self, title: str, year: int | None, language_prefs: list[str], bypass_cache: bool = False
    ) -> matching.Decision:
        """Scores every candidate TMDB returned and reports how much the winner is trusted.

        Returns a `Decision`, not a bare result: the caller must not be able to
        use the match without also seeing the confidence attached to it.
        """
        results = await self._search_movie_results(title, year, language_prefs, bypass_cache)
        ranked = matching.rank_candidates(title, year, [_movie_candidate(r) for r in results])
        return matching.decide(ranked)


class TVDBClientV4:
    BASE_URL = "https://api4.thetvdb.com/v4"

    def __init__(self, api_key: str, pin: str | None = None):
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
        retry=retry_if_exception(is_retryable_error),
    )
    async def _request(self, endpoint: str, token: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.BASE_URL}{endpoint}", headers=headers, params=params, timeout=10.0)
            response.raise_for_status()
            return response.json()

    async def _search_series_results(
        self, title: str, language_prefs: list[str], bypass_cache: bool
    ) -> list[dict[str, Any]]:
        """The raw TVDB candidate list, cached on the title alone.

        Deliberately not keyed on the season/episode used to disambiguate below:
        every episode of a series shares one search, and the per-candidate
        evidence comes from `get_series_extended`, which has its own cache.
        """
        cache_key = get_cache_key("tvdb_search_raw_v1", title, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            return cache[cache_key]

        lock = get_lock(cache_key)
        async with lock:
            # Recheck cache inside lock to avoid redundant work
            if not bypass_cache and cache_key in cache:
                return cache[cache_key]

            token = await self.get_token(bypass_cache)
            if not token:
                return []

            params = {"query": title, "type": "series"}

            try:
                data = await self._request("/search", token, params)
                entries = data.get("data") or []
                if entries:
                    entries = entries[:MAX_CACHED_RESULTS]
                    cache.set(cache_key, entries, expire=int(os.getenv("CACHE_TTL_HOURS", 24)) * 3600)
                    return entries
            except Exception as e:
                print(f"TVDB search failed: {e}")

            cache.set(cache_key, [], expire=3600)
            return []

    async def search_series(
        self,
        title: str,
        language_prefs: list[str],
        year: int | None = None,
        season: int | None = None,
        episode: tuple[int, int] | None = None,
        bypass_cache: bool = False,
    ) -> matching.Decision:
        """Picks the series a file belongs to, and reports how much that pick is trusted.

        Title and year alone cannot separate the two shows called *Doctor Who*, nor
        the two called *One Piece*. When the leaders tie, `season`/`episode` are used
        as a further check: a series that does not list the episode the filename
        claims is less likely to be the right one.

        Less likely, not disqualified — measured against live TVDB, this evidence is
        far softer than it looks. Its default season order splits long anime into
        arcs, so One Piece season 1 stops at episode 8 and a real `S01E10` is missing
        from the correct series. Acting on that promoted a parody called *None Piece*
        to a confident match. Hence the two guards below: a failed lookup is never
        read as absence, and the evidence may break a tie between equals but never
        promote a weaker title.
        """
        entries = await self._search_series_results(title, language_prefs, bypass_cache)
        ranked = matching.rank_candidates(title, year, [_series_candidate(e) for e in entries])
        if not ranked:
            return matching.Decision(verdict="rejected", confidence=0.0, reason="No series matched that title")

        token = await self.get_token(bypass_cache)
        if not token:
            return matching.Decision(verdict="rejected", confidence=0.0, reason="TVDB authentication failed")

        # Extended payloads fetched while disambiguating, so the winner is not re-fetched.
        fetched: dict[Any, dict[str, Any]] = {}

        contenders = matching.tied_leaders(ranked, MAX_DISAMBIGUATION_CANDIDATES)
        disambiguated = False
        if len(contenders) > 1 and season is not None and episode is not None:
            survivors: list[matching.ScoredCandidate] = []
            eliminated: list[matching.ScoredCandidate] = []
            complete = True

            for scored in contenders:
                data = await self.get_series_extended(scored.candidate.key, language_prefs, token, bypass_cache)
                if not data:
                    # A fetch that failed is not evidence that the episode is absent.
                    # Counting it as one would let a network blip decide the match.
                    complete = False
                    break
                fetched[scored.candidate.key] = data
                if matching.series_has_episodes(data.get("episodes_raw", []), season, *episode):
                    survivors.append(scored)
                else:
                    eliminated.append(scored)

            if not complete:
                print(f"TVDB: incomplete episode evidence for {title!r}, keeping the title ranking")
            elif not survivors:
                print(f"TVDB: no candidate for {title!r} has S{season:02d}E{episode[0]}, keeping the title ranking")
            elif not matching.elimination_is_trustworthy(survivors, eliminated):
                print(f"TVDB: episode evidence for {title!r} would promote a weaker title, ignoring it")
            else:
                # A single survivor is settled on evidence, so it is no longer
                # competing with the rivals; several stay damped, minus the impossible ones.
                ranked = survivors
                disambiguated = len(survivors) == 1

        decision = matching.decide(ranked, disambiguated=disambiguated)
        if not decision.accepted:
            return decision

        series_id = ranked[0].candidate.key
        series_data = fetched.get(series_id) or await self.get_series_extended(
            series_id, language_prefs, token, bypass_cache
        )
        if not series_data:
            return matching.Decision(
                verdict="rejected",
                confidence=decision.confidence,
                reason=f"TVDB returned no details for {ranked[0].candidate.label}",
            )

        # The payload the caller needs is the extended record, not the search stub.
        return replace(decision, payload=series_data)

    async def get_episode_translation(
        self, ep_id: int, language_prefs: list[str], bypass_cache: bool = False
    ) -> str | None:
        cache_key = get_cache_key("tvdb_ep_trans", ep_id, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            val = cache[cache_key]
            return val if val != "__NONE__" else None

        lock = get_lock(cache_key)
        async with lock:
            if not bypass_cache and cache_key in cache:
                val = cache[cache_key]
                return val if val != "__NONE__" else None

            token = await self.get_token(bypass_cache)
            if not token:
                return None

            lang_map = {
                "it": "ita",
                "en": "eng",
                "fr": "fra",
                "es": "spa",
                "de": "deu",
                "ja": "jpn",
                "zh": "zho",
                "nl": "nld",
                "ru": "rus",
                "fi": "fin",
                "sv": "swe",
                "da": "dan",
                "hu": "hun",
                "pt": "por",
                "pl": "pol",
            }

            for lang in language_prefs:
                tvdb_lang = lang_map.get(lang.lower(), lang.lower())

                try:
                    data = await self._request(f"/episodes/{ep_id}/translations/{tvdb_lang}", token)
                    name = data.get("data", {}).get("name")
                    if name:
                        cache.set(cache_key, name, expire=int(os.getenv("CACHE_TTL_HOURS", 24)) * 3600)
                        return name
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 404:
                        continue
                    print(f"TVDB ep translation err for {lang}: {e}")
                except Exception as e:
                    print(f"TVDB ep translation err: {e}")

            cache.set(cache_key, "__NONE__", expire=3600)
            return None

    async def get_series_translation(
        self, series_id: int, language_prefs: list[str], bypass_cache: bool = False
    ) -> str | None:
        cache_key = get_cache_key("tvdb_series_trans", series_id, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            val = cache[cache_key]
            return val if val != "__NONE__" else None

        lock = get_lock(cache_key)
        async with lock:
            if not bypass_cache and cache_key in cache:
                val = cache[cache_key]
                return val if val != "__NONE__" else None

            token = await self.get_token(bypass_cache)
            if not token:
                return None

            lang_map = {
                "it": "ita",
                "en": "eng",
                "fr": "fra",
                "es": "spa",
                "de": "deu",
                "ja": "jpn",
                "zh": "zho",
                "nl": "nld",
                "ru": "rus",
                "fi": "fin",
                "sv": "swe",
                "da": "dan",
                "hu": "hun",
                "pt": "por",
                "pl": "pol",
            }

            for lang in language_prefs:
                tvdb_lang = lang_map.get(lang.lower(), lang.lower())
                try:
                    data = await self._request(f"/series/{series_id}/translations/{tvdb_lang}", token)
                    name = data.get("data", {}).get("name")
                    if name:
                        cache.set(cache_key, name, expire=int(os.getenv("CACHE_TTL_HOURS", 24)) * 3600)
                        return name
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 404:
                        continue
                except Exception:
                    pass

            cache.set(cache_key, "__NONE__", expire=3600)
            return None

    async def get_series_extended(
        self, series_id: int, language_prefs: list[str], token: str, bypass_cache: bool = False
    ) -> dict[str, Any] | None:
        # _v3: the payload shape changed (total_episodes -> season_episode_counts). A stale
        # _v2 entry would silently fall back to 2-digit padding on a 100+ episode season.
        cache_key = get_cache_key("tvdb_series_ext_v3", series_id, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            return cache[cache_key]

        try:
            data = await self._request(f"/series/{series_id}/extended", token)
            series_info = data.get("data", {})

            episodes = series_info.get("episodes")

            # TVDB v4 completely omits episodes in extended payload for massive series > 500 eps (like SpongeBob)
            # We must fetch them manually using the paginated episodes endpoint
            if episodes is None:
                episodes = []
                page = 0
                while True:
                    ep_data = await self._request(f"/series/{series_id}/episodes/default", token, params={"page": page})
                    page_eps = ep_data.get("data", {}).get("episodes", [])
                    episodes.extend(page_eps)

                    links = ep_data.get("links", {})
                    if links.get("next") and links.get("next") != links.get("self"):
                        page += 1
                    else:
                        break

            # Episode count per season, which is what the zero-padding is derived from.
            # It must NOT be the series total: One Piece has 1100+ episodes overall but
            # only 61 in season 1, and Plex expects S01E10, not S01E0010.
            # Specials (season 0) are excluded — they are not padded against.
            season_episode_counts: dict[int, int] = {}
            for ep in episodes:
                season_number = ep.get("seasonNumber", 0)
                if season_number > 0:
                    season_episode_counts[season_number] = season_episode_counts.get(season_number, 0) + 1

            # Fetch localized series translation
            series_translation = await self.get_series_translation(series_id, language_prefs, bypass_cache)

            year_raw = series_info.get("year", "")
            first_aired = series_info.get("firstAired", "")
            year = year_raw or (first_aired[:4] if first_aired else None)

            result = {
                "name": series_translation or series_info.get("name"),
                "season_episode_counts": season_episode_counts,
                "episodes_raw": episodes,
                "year": year,
            }
            cache.set(cache_key, result, expire=int(os.getenv("CACHE_TTL_HOURS", 24)) * 3600)
            return result
        except Exception as e:
            print(f"TVDB series extended failed: {e}")
            return None


def calculate_padding(total_items: int) -> int:
    """Zero-padding width for an episode number, from the episode count of *its own season*.

    Minimum 2, which is what Plex expects and what every season under 100 episodes gets.
    Callers must pass the season's count, never the series total — see
    `season_episode_counts` in `get_series_extended`.
    """
    if total_items < 100:
        return 2
    return len(str(total_items))
