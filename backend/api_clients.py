import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import Any

import diskcache
import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from . import matching
from .models import CandidateOut, KeyStatus


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

# How many scored candidates are handed to the UI for manual triage. Costs nothing
# extra — they all come out of the search payload that was fetched anyway.
MAX_EXPOSED_CANDIDATES = 5

# Poster thumbnails. w185 is the smallest TMDB size that is still legible in a list.
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w185"

# A candidate blurb is a tell-apart aid, not reading material.
MAX_OVERVIEW_CHARS = 300

# TVDB speaks ISO 639-2/T where the rest of the app speaks 639-1. An unlisted code is
# passed through unchanged: TVDB answers an unknown one with a 404, which the callers
# read as "not in this language" and step past.
TVDB_LANGUAGES = {
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


def tvdb_language(code: str) -> str:
    return TVDB_LANGUAGES.get(code.lower(), code.lower())


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


def _trim(text: Any) -> str | None:
    if not isinstance(text, str) or not text.strip():
        return None
    text = " ".join(text.split())
    return text if len(text) <= MAX_OVERVIEW_CHARS else text[: MAX_OVERVIEW_CHARS - 1].rstrip() + "…"


def _candidate_out(scored: matching.ScoredCandidate, source: str, selected_key: Any) -> CandidateOut:
    """One scored candidate, flattened for the triage UI.

    The poster and the blurb come out of the search payload already in hand, so
    exposing candidates costs no extra API call. Only the two payload shapes are
    known here — nothing downstream has to learn what TMDB or TVDB return.
    """
    candidate = scored.candidate
    payload = candidate.payload if isinstance(candidate.payload, dict) else {}

    if source == "tmdb":
        poster_path = payload.get("poster_path")
        poster_url = f"{TMDB_IMAGE_BASE}{poster_path}" if isinstance(poster_path, str) and poster_path else None
    else:
        raw = payload.get("image_url") or payload.get("thumbnail")
        poster_url = raw if isinstance(raw, str) and raw.startswith("http") else None

    return CandidateOut(
        key=str(candidate.key),
        label=candidate.label,
        source=source,
        year=candidate.year,
        score=round(scored.score, 3),
        title_score=round(scored.title_score, 3),
        year_factor=round(scored.year_factor, 3),
        poster_url=poster_url,
        overview=_trim(payload.get("overview")),
        # Compared as strings: TMDB keys arrive as ints and TVDB's as strings, and
        # the UI only ever holds the stringified form.
        selected=selected_key is not None and str(candidate.key) == str(selected_key),
    )


def candidates_for_ui(
    ranked: tuple[matching.ScoredCandidate, ...], source: str, selected_key: Any = None
) -> list[CandidateOut]:
    """The top `MAX_EXPOSED_CANDIDATES` of a ranking, plus the selected one if it fell outside.

    Episode evidence can hand the match to a candidate the title ranking put well
    down the list, and a triage panel that omitted the row it says is selected
    would be lying about what the name was built from.
    """
    exposed = list(ranked[:MAX_EXPOSED_CANDIDATES])
    if selected_key is not None and not any(str(s.candidate.key) == str(selected_key) for s in exposed):
        chosen = next((s for s in ranked if str(s.candidate.key) == str(selected_key)), None)
        if chosen is not None:
            exposed.append(chosen)
    return [_candidate_out(scored, source, selected_key) for scored in exposed]


def find_forced(ranked: list[matching.ScoredCandidate], forced_key: str) -> matching.ScoredCandidate | None:
    """The candidate the user picked in triage, matched by its stringified key."""
    return next((s for s in ranked if str(s.candidate.key) == str(forced_key)), None)


def _forced_match(
    ranked: list[matching.ScoredCandidate], chosen: matching.ScoredCandidate, payload: Any
) -> matching.Decision:
    """A hand-picked candidate, taken at face value.

    Confidence 1.0 is not a claim about the title similarity — the user looked at
    the candidates and said which one it is, and that is better evidence than any
    string comparison. The reason line says so, so a `matched` row that was
    settled by hand is still distinguishable from one the scoring was sure of.
    """
    return matching.Decision(
        verdict="matched",
        confidence=1.0,
        reason=f"Scelto a mano: {chosen.candidate.label}",
        payload=payload,
        ranked=tuple(ranked),
    )


def _forced_gone(ranked: list[matching.ScoredCandidate], source: str, title: str) -> matching.Decision:
    """The picked candidate is not in the results any more (a cache expiry, say).

    Rejected rather than silently re-scored: falling back to whatever the scoring
    now prefers would rename the file to a title the user never chose, which is
    the one failure this application must not have.
    """
    return matching.Decision(
        verdict="rejected",
        confidence=0.0,
        reason=f"Il candidato scelto non è più tra i risultati {source} per {title!r} — scegline un altro",
        ranked=tuple(ranked),
    )


# One in-flight fetch per cache key.
#
# Every lookup below is check-cache, fetch, store — and the frontend analyses up to
# `Settings.analyzeConcurrency` files at once. A season pack therefore has N rows
# reaching an empty entry for the *same* series simultaneously, and all N fetch it:
# the cache is keyed correctly, it simply has no way to say "someone is already
# getting this". The lock closes that window, so the first caller fetches and the
# rest wait and then find the entry.
#
# Refcounted rather than kept for the life of the process: the keys carry titles and
# series ids, so a plain dict grows with every distinct thing ever looked up. The
# entry is dropped once the last waiter leaves, which is safe because everyone
# already queued holds a reference to the same Lock object.
_search_locks: dict[str, asyncio.Lock] = {}
_lock_waiters: dict[str, int] = {}


@asynccontextmanager
async def single_flight(key: str) -> AsyncIterator[None]:
    """Serialises concurrent work on one cache key.

    The caller must re-check the cache inside the block: waiting is only useful if
    what the winner stored is then read instead of fetched again.
    """
    lock = _search_locks.get(key)
    if lock is None:
        lock = _search_locks[key] = asyncio.Lock()
    _lock_waiters[key] = _lock_waiters.get(key, 0) + 1
    try:
        async with lock:
            yield
    finally:
        remaining = _lock_waiters[key] - 1
        if remaining:
            _lock_waiters[key] = remaining
        else:
            _lock_waiters.pop(key, None)
            _search_locks.pop(key, None)


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

    async def verify_key(self) -> KeyStatus:
        """Ask TMDB whether this key works, using the endpoint whose only job is to say so.

        Not `self._request`: that retries five times with exponential backoff, which
        would turn "the key is wrong" — known from the first 401 — into a thirty-second
        wait. Not cached either; a status that can be stale is not a status.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.BASE_URL}/authentication", params={"api_key": self.api_key}, timeout=8.0
                )
        except httpx.HTTPError as error:
            return KeyStatus(state="unreachable", detail=f"TMDB non raggiungibile ({type(error).__name__})")

        if response.status_code in (401, 403):
            return KeyStatus(state="invalid", detail="TMDB ha rifiutato questa chiave")
        if not response.is_success:
            return KeyStatus(state="unreachable", detail=f"TMDB ha risposto {response.status_code}")
        return KeyStatus(state="ok", detail="TMDB ha accettato questa chiave")

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
        self,
        title: str,
        year: int | None,
        language_prefs: list[str],
        bypass_cache: bool = False,
        forced_key: str | None = None,
        thresholds: matching.Thresholds = matching.DEFAULT_THRESHOLDS,
    ) -> matching.Decision:
        """Scores every candidate TMDB returned and reports how much the winner is trusted.

        Returns a `Decision`, not a bare result: the caller must not be able to
        use the match without also seeing the confidence attached to it.

        `forced_key` is a candidate the user picked by hand in triage. It bypasses
        scoring entirely — a human looking at the poster is better evidence than
        any title similarity — and costs no extra request, because the search
        results it is chosen from are the cached ones.
        """
        results = await self._search_movie_results(title, year, language_prefs, bypass_cache)
        ranked = matching.rank_candidates(title, year, [_movie_candidate(r) for r in results])

        if forced_key is not None:
            chosen = find_forced(ranked, forced_key)
            if chosen is None:
                return _forced_gone(ranked, "TMDB", title)
            return _forced_match(ranked, chosen, payload=chosen.candidate.payload)

        return matching.decide(ranked, thresholds=thresholds)


class TVDBClientV4:
    BASE_URL = "https://api4.thetvdb.com/v4"

    def __init__(self, api_key: str, pin: str | None = None):
        self.api_key = api_key
        self.pin = pin

    async def get_token(self, bypass_cache: bool = False) -> str:
        cache_key = "tvdb_token_v4"
        if not bypass_cache and cache_key in cache:
            return cache.get(cache_key)

        async with single_flight(cache_key):
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

    async def verify_key(self) -> KeyStatus:
        """A fresh `POST /login`, which *is* TVDB's authentication.

        Not `get_token()`, for two reasons. It serves a token cached for 24 hours, so a
        key revoked yesterday would still report as working — and a status that can be
        stale is not a status. And it swallows the exception and returns `""`, which
        loses the difference between a rejected key and a host that never answered.
        """
        payload = {"apikey": self.api_key}
        if self.pin:
            payload["pin"] = self.pin

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(f"{self.BASE_URL}/login", json=payload, timeout=8.0)
        except httpx.HTTPError as error:
            return KeyStatus(state="unreachable", detail=f"TVDB non raggiungibile ({type(error).__name__})")

        if response.status_code in (401, 403):
            return KeyStatus(state="invalid", detail="TVDB ha rifiutato questa chiave o il suo PIN")
        if not response.is_success:
            return KeyStatus(state="unreachable", detail=f"TVDB ha risposto {response.status_code}")

        try:
            token = (response.json().get("data") or {}).get("token")
        except ValueError:
            return KeyStatus(state="unreachable", detail="TVDB ha risposto con qualcosa che non è JSON")
        if not token:
            return KeyStatus(state="invalid", detail="TVDB ha risposto senza un token")
        return KeyStatus(state="ok", detail="TVDB ha accettato questa chiave")

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

        async with single_flight(cache_key):
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
        forced_key: str | None = None,
        thresholds: matching.Thresholds = matching.DEFAULT_THRESHOLDS,
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

        `forced_key` short-circuits all of it: the user has looked at the candidates
        and said which series it is, so neither the scoring nor the episode evidence
        gets a vote. It reuses the cached search and the cached extended record, so
        applying one triage choice to every episode of a series costs no requests.
        """
        entries = await self._search_series_results(title, language_prefs, bypass_cache)
        # The complete title ranking, kept whole. `ranked` below may be narrowed to the
        # candidates that survived the episode check; this one is what the UI is shown,
        # because the survivor rule is a heuristic and the user must still see who lost.
        all_ranked = matching.rank_candidates(title, year, [_series_candidate(e) for e in entries])
        ranked = all_ranked
        if not ranked:
            return matching.Decision(
                verdict="rejected", confidence=0.0, reason="Nessuna serie corrisponde a quel titolo"
            )

        token = await self.get_token(bypass_cache)
        if not token:
            return matching.Decision(
                verdict="rejected", confidence=0.0, reason="Autenticazione TVDB fallita", ranked=tuple(all_ranked)
            )

        # Extended payloads fetched while disambiguating, so the winner is not re-fetched.
        fetched: dict[Any, dict[str, Any]] = {}

        if forced_key is not None:
            chosen = find_forced(all_ranked, forced_key)
            if chosen is None:
                return _forced_gone(all_ranked, "TVDB", title)
            series_data = await self.get_series_extended(chosen.candidate.key, language_prefs, token, bypass_cache)
            if not series_data:
                return matching.Decision(
                    verdict="rejected",
                    confidence=0.0,
                    reason=f"TVDB non ha restituito dettagli per {chosen.candidate.label}",
                    ranked=tuple(all_ranked),
                )
            return _forced_match(all_ranked, chosen, payload=series_data)

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

        decision = matching.decide(ranked, disambiguated=disambiguated, thresholds=thresholds)
        if not decision.accepted:
            return replace(decision, ranked=tuple(all_ranked))

        series_id = ranked[0].candidate.key
        series_data = fetched.get(series_id) or await self.get_series_extended(
            series_id, language_prefs, token, bypass_cache
        )
        if not series_data:
            return matching.Decision(
                verdict="rejected",
                confidence=decision.confidence,
                reason=f"TVDB non ha restituito dettagli per {ranked[0].candidate.label}",
                ranked=tuple(all_ranked),
            )

        # The payload the caller needs is the extended record, not the search stub.
        # `ranked` goes back to the full list: the episode check may have narrowed the
        # decision, but the UI still has to offer every candidate for a manual override.
        return replace(decision, payload=series_data, ranked=tuple(all_ranked))

    async def _walk_episode_pages(
        self, series_id: int, token: str, language: str | None = None
    ) -> list[dict[str, Any]]:
        """The series' whole episode list, following TVDB's pagination.

        `language` selects the translated variant, whose payload is field-for-field the
        untranslated one — `id`, `number`, `seasonNumber` and `absoluteNumber` included
        — with `name` localised and left null where that language has no title.
        """
        suffix = f"/{language}" if language else ""
        episodes: list[dict[str, Any]] = []
        page = 0
        while True:
            data = await self._request(f"/series/{series_id}/episodes/default{suffix}", token, params={"page": page})
            episodes.extend(data.get("data", {}).get("episodes", []))

            links = data.get("links", {})
            if links.get("next") and links.get("next") != links.get("self"):
                page += 1
            else:
                return episodes

    async def get_episode_names(
        self, series_id: int, language_prefs: list[str], bypass_cache: bool = False
    ) -> dict[int, str]:
        """Every episode title of a series, best available language first, keyed by episode id.

        This replaced one `/episodes/{id}/translations/{lang}` request *per episode*,
        which is the one cost in the pipeline that scaled with the number of files: a
        twenty-four file season pack made twenty-four of them. TVDB serves the whole
        series' localised list from one paginated endpoint, so the pack now costs one
        request — and the disambiguation loop never triggers it at all, because the map
        is only built for the series the name is actually being made from.

        The language chain is preserved exactly, just resolved in bulk instead of per
        episode: a later language only fills the titles an earlier one left blank, and
        an id absent from the result means no language had a title for it. The caller
        then keeps the default name off `episodes_raw`, which is what it did when the
        per-episode call returned None.
        """
        cache_key = get_cache_key("tvdb_ep_names_v1", series_id, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            return cache[cache_key]

        async with single_flight(cache_key):
            if not bypass_cache and cache_key in cache:
                return cache[cache_key]

            token = await self.get_token(bypass_cache)
            if not token:
                return {}

            names: dict[int, str] = {}
            for language in language_prefs:
                try:
                    episodes = await self._walk_episode_pages(series_id, token, tvdb_language(language))
                except Exception as e:
                    # A language TVDB does not carry answers 404. Step past it, exactly
                    # as the per-episode call did, and let the next one try.
                    print(f"TVDB episode names failed for {language}: {e}")
                    continue

                complete = True
                for episode in episodes:
                    ep_id = episode.get("id")
                    name = (episode.get("name") or "").strip()
                    if not name:
                        complete = False
                    elif ep_id is not None and ep_id not in names:
                        names[ep_id] = name

                # Nothing left for a later language to fill.
                if episodes and complete:
                    break

            cache.set(cache_key, names, expire=int(os.getenv("CACHE_TTL_HOURS", 24)) * 3600)
            return names

    async def get_series_translation(
        self, series_id: int, language_prefs: list[str], bypass_cache: bool = False
    ) -> str | None:
        cache_key = get_cache_key("tvdb_series_trans", series_id, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            val = cache[cache_key]
            return val if val != "__NONE__" else None

        async with single_flight(cache_key):
            if not bypass_cache and cache_key in cache:
                val = cache[cache_key]
                return val if val != "__NONE__" else None

            token = await self.get_token(bypass_cache)
            if not token:
                return None

            for lang in language_prefs:
                try:
                    data = await self._request(f"/series/{series_id}/translations/{tvdb_language(lang)}", token)
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
        # _v4: the payload gained `tvdb_id`. A stale _v3 entry has no id in it, so the
        # analyzer could not record which candidate the name was built from and the
        # triage panel would show nothing as selected.
        cache_key = get_cache_key("tvdb_series_ext_v4", series_id, ",".join(language_prefs))
        if not bypass_cache and cache_key in cache:
            return cache[cache_key]

        # The most expensive call in the file, and the one most often asked for in
        # parallel: every episode of a season resolves the same series, and the
        # disambiguation loop above asks for up to three of them per row. Without the
        # single flight a 24-file pack paginated the whole episode list 72 times.
        async with single_flight(cache_key):
            if not bypass_cache and cache_key in cache:
                return cache[cache_key]

            try:
                data = await self._request(f"/series/{series_id}/extended", token)
                series_info = data.get("data", {})

                episodes = series_info.get("episodes")

                # TVDB v4 completely omits episodes in extended payload for massive series > 500 eps (like SpongeBob)
                # We must fetch them manually using the paginated episodes endpoint
                if episodes is None:
                    episodes = await self._walk_episode_pages(series_id, token)

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
                    "tvdb_id": series_id,
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
