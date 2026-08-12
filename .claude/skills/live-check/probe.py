"""Run the real naming pipeline against live TMDB/TVDB and print what it would propose.

Replicates POST /api/scan followed by POST /api/analyze exactly, so the output
is what the app would actually put on disk. Read-only: nothing is renamed.

Never prints an API key - only whether each one is set.

Usage, from the repo root:

    set -a; . ./.env; set +a
    .venv/bin/python .claude/skills/live-check/probe.py [directory]

Defaults to test_media/. Pass --cache to reuse diskcache instead of forcing a
fresh API round trip.
"""

import argparse
import asyncio
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))

from backend.analyzer import enrich_media_item
from backend.models import MediaItem
from backend.parser import parse_filename
from backend.scanner import get_media_files


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("directory", nargs="?", default="test_media")
    ap.add_argument("--cache", action="store_true", help="reuse diskcache instead of bypassing it")
    ap.add_argument("--lang", default="it,en", help="language preference order")
    args = ap.parse_args()

    missing = [k for k in ("TMDB_API_KEY", "TVDB_API_KEY", "TVDB_PIN") if not os.getenv(k)]
    for key in ("TMDB_API_KEY", "TVDB_API_KEY", "TVDB_PIN"):
        print(f"{key:<16} {'MISSING' if key in missing else 'present'}")
    if missing:
        # Without a key the analyzer silently no-ops and leaves rows "pending",
        # which is indistinguishable from an API outage. Fail loudly instead.
        print("\nSource .env first:  set -a; . ./.env; set +a", file=sys.stderr)
        return 1

    prefs = [lang.strip() for lang in args.lang.split(",")]
    print(f"\nscanning {args.directory}  (lang={prefs}, cache={'on' if args.cache else 'bypassed'})")
    print("-" * 78)

    ok = review = err = 0
    for file_path in sorted(get_media_files(args.directory)):
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
        print(filename)
        print(f"  parsed: type={item.media_type} title={item.clean_title!r} S={item.season} E={item.episode!r}")
        try:
            result = await enrich_media_item(item, prefs, bypass_cache=not args.cache)
        # Broad on purpose: a probe reports every failure and keeps going,
        # so one unreachable API does not hide the rest of the batch.
        except Exception as exc:
            print(f"  !!      {type(exc).__name__}: {exc}\n")
            err += 1
            continue
        conf = f" conf={result.confidence:.2f}" if result.confidence is not None else ""
        print(f"  ->      {result.proposed_name!r}   [{result.status}{conf}] {result.message or ''}\n")
        if result.status == "matched" and result.proposed_name:
            ok += 1
        elif result.status == "review":
            # A name was proposed but the scoring would not auto-select it.
            review += 1
        else:
            err += 1

    print("-" * 78)
    print(f"{ok} auto-selected, {review} needing review, {err} without a usable name")
    return 0


raise SystemExit(asyncio.run(main()))
