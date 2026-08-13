import asyncio
import os
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import matching
from .analyzer import enrich_media_item
from .api_clients import MAX_EXPOSED_CANDIDATES, TMDBClient, TVDBClientV4, cache, cache_ttl_hours
from .models import ConfigOut, KeyCheckOut, KeyStatus, MediaItem, RenameRequest, ScanRequest, ThresholdsOut
from .parser import parse_filename
from .paths import (
    DEFAULT_MEDIA_ROOT,
    MEDIA_ROOT_VAR,
    PathNotAllowed,
    allowed_roots,
    resolve_rename_target,
    resolve_within_roots,
)
from .scanner import get_media_files

app = FastAPI(title="Plex File Manager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/scan", response_model=list[MediaItem])
async def scan_directory(request: ScanRequest):
    results = []
    try:
        # The client picks the directory, so it is untrusted input. It may only ever
        # be a configured root or a subdirectory of one.
        scan_root = resolve_within_roots(request.directory)
    except PathNotAllowed as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    try:
        # Fast iteration over local files
        for file_path in get_media_files(scan_root):
            filename = os.path.basename(file_path)
            parsed = parse_filename(filename)

            item = MediaItem(
                id=str(uuid.uuid4()),
                original_path=str(file_path),
                original_name=filename,
                media_type=parsed.get("media_type", "unknown"),
                clean_title=parsed.get("clean_title", ""),
                year=parsed.get("year"),
                season=parsed.get("season"),
                episode=parsed.get("episode"),
                episode_title=parsed.get("episode_title"),
            )
            results.append(item)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/api/analyze", response_model=MediaItem)
async def analyze_item(
    item: MediaItem,
    bypass_cache: bool = False,
    lang_prefs: str = "it,en",
    forced_key: str | None = None,
    match_threshold: float | None = None,
    review_threshold: float | None = None,
    absolute_episode: int | None = None,
):
    """Re-analyze a single item against the APIs.

    `forced_key` is the `key` of a `CandidateOut` the user picked in triage: the
    match is then settled by hand and the name rebuilt from that candidate, off the
    cached search. Sending the same key for every episode of a series is how one
    triage decision is applied to the whole show.

    `absolute_episode` is the number a file carries when the library numbers episodes
    absolutely — `One Piece - 1015.mkv`. The chosen series' own episode list resolves
    it into a season and an episode, which is the only place that mapping exists.

    The thresholds are per-request rather than server state, so the user can move
    the confidence bands from the settings panel without two concurrent analyses
    disagreeing about which bands were in force.
    """
    prefs = [lang.strip() for lang in lang_prefs.split(",")]
    thresholds = _thresholds(match_threshold, review_threshold)
    if absolute_episode is not None and absolute_episode < 1:
        raise HTTPException(status_code=400, detail="absolute_episode deve essere almeno 1")
    return await enrich_media_item(
        item,
        prefs,
        bypass_cache,
        forced_key=forced_key,
        thresholds=thresholds,
        absolute_episode=absolute_episode,
    )


def _thresholds(match: float | None, review: float | None) -> matching.Thresholds:
    """Validate the two confidence bands the client may override.

    Rejected rather than clamped: a threshold silently corrected to something else
    would make the UI report a band that is not the one being applied.
    """
    resolved = matching.Thresholds(
        match=matching.MATCH_THRESHOLD if match is None else match,
        review=matching.REVIEW_THRESHOLD if review is None else review,
    )
    for name, value in (("match_threshold", resolved.match), ("review_threshold", resolved.review)):
        if not 0.0 <= value <= 1.0:
            raise HTTPException(status_code=400, detail=f"{name} deve essere compreso tra 0 e 1")
    if resolved.review > resolved.match:
        raise HTTPException(status_code=400, detail="review_threshold non può superare match_threshold")
    return resolved


@app.post("/api/rename", response_model=list[MediaItem])
async def rename_items(request: RenameRequest):
    results = []

    for item in request.items:
        if not item.proposed_name:
            item.status = "error"
            item.message = "No proposed name to rename to"
            results.append(item)
            continue

        try:
            # Both sides are client-supplied: the source must be inside a configured
            # root, and the name must be bare so the rename cannot leave that root.
            old_path, new_path = resolve_rename_target(item.original_path, item.proposed_name)
        except PathNotAllowed as e:
            item.status = "error"
            item.message = str(e)
            results.append(item)
            continue

        if not old_path.exists():
            item.status = "error"
            item.message = "Original file no longer exists"
            results.append(item)
            continue

        if new_path.exists() and old_path != new_path:
            item.status = "error"
            item.message = "Target file already exists (conflict)"
            results.append(item)
            continue

        try:
            old_path.rename(new_path)
            item.status = "success"
            item.message = "Renamed successfully"
            item.original_path = str(new_path)
            item.original_name = new_path.name
        except Exception as e:
            item.status = "error"
            item.message = f"Rename failed: {e!s}"

        results.append(item)

    return results


@app.get("/api/config", response_model=ConfigOut)
async def get_config():
    """Everything the settings panel needs, so the UI never hard-codes a default.

    `MEDIA_ROOT` in particular: a scan outside it is a 400, and the frontend
    shipped its own guess of the path, which is how a misconfigured mount used to
    look like a broken scan.
    """
    roots = [str(root) for root in allowed_roots()]
    return ConfigOut(
        media_roots=roots,
        default_directory=os.getenv(MEDIA_ROOT_VAR, DEFAULT_MEDIA_ROOT),
        language_preference=[lang.strip() for lang in os.getenv("LANG_PREFS", "it,en").split(",") if lang.strip()],
        # The helper, not a second reading of the variable: the panel prints this number
        # as the cache's TTL, so it has to be the one the cache was actually given —
        # including when the configured value was unusable and the default took over.
        cache_ttl_hours=cache_ttl_hours(),
        cache_entries=len(cache),
        cache_size_bytes=cache.volume(),
        thresholds=ThresholdsOut(
            match=matching.MATCH_THRESHOLD,
            review=matching.REVIEW_THRESHOLD,
            decisive_margin=matching.DECISIVE_MARGIN,
        ),
        max_candidates=MAX_EXPOSED_CANDIDATES,
        # Booleans only. A missing key otherwise surfaces as "Could not find a
        # match", which sends the user looking at the wrong problem.
        tmdb_configured=bool(os.getenv("TMDB_API_KEY")),
        tvdb_configured=bool(os.getenv("TVDB_API_KEY")),
    )


async def _missing_key(variable: str) -> KeyStatus:
    return KeyStatus(state="missing", detail=f"{variable} non è impostata")


@app.get("/api/keys", response_model=KeyCheckOut)
async def check_keys():
    """Whether each key actually works, by using it.

    `/api/config` only reports whether a key is *set*, which is the question that was
    never really being asked: a key that is present but revoked, or a provider that is
    unreachable, both produce rows that read "Nessuna corrispondenza trovata" — the same words
    a genuine no-match produces. One authenticated call each settles it, and the four
    states are four different things to do about it.

    The two run concurrently and neither is cached. A cached "ok" for a key that has
    since been rotated is worse than no check at all.
    """
    tmdb_key = os.getenv("TMDB_API_KEY")
    tvdb_key = os.getenv("TVDB_API_KEY")
    tmdb, tvdb = await asyncio.gather(
        TMDBClient(tmdb_key).verify_key() if tmdb_key else _missing_key("TMDB_API_KEY"),
        TVDBClientV4(tvdb_key, os.getenv("TVDB_PIN")).verify_key() if tvdb_key else _missing_key("TVDB_API_KEY"),
    )
    return KeyCheckOut(tmdb=tmdb, tvdb=tvdb)


@app.delete("/api/cache")
async def clear_cache():
    """Drop every cached API payload.

    Safe by construction: the cache only ever holds raw TMDB/TVDB responses, never
    scores and never anything about the local filesystem, so the worst case is the
    next scan being slow.
    """
    removed = len(cache)
    cache.clear()
    return {"cleared": removed}


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


# Mount frontend in production
frontend_dir = os.getenv("FRONTEND_DIR", "frontend/dist")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)
