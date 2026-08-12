#!/usr/bin/env python3
"""Runs every case in `naming_cases.toml` against the real TMDB/TVDB pipeline.

    .venv/bin/python scripts/check-naming-cases.py
    .venv/bin/python scripts/check-naming-cases.py --only "One Piece"
    .venv/bin/python scripts/check-naming-cases.py --bypass-cache

This is the live half of the naming-case system; `backend/test_naming_cases.py` is the
offline half and should be green before this is worth running. Exits non-zero when any
case comes out with a name other than the one written down, so it can gate a release.

**It never touches the filesystem.** The cases are filenames, not files: nothing is
opened, created or renamed, and a case may describe a file that only exists on the NAS.
The only side effect is the API cache in `.cache/`.

Cases run one at a time. That is not a limitation to fix — the search results are cached
per title and the extended series record per id, so a series' second episode usually
makes no request at all, and a serial run keeps the ordering of the output honest.
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.analyzer import enrich_media_item  # noqa: E402
from backend.models import MediaItem  # noqa: E402
from backend.naming_cases import NamingCase, load_cases  # noqa: E402

USE_COLOUR = sys.stdout.isatty()


def paint(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if USE_COLOUR else text


def load_env(path: Path) -> None:
    """Puts the keys from `.env` into the environment.

    Nothing in `backend/` calls `load_dotenv()` — in production the keys are injected by
    docker-compose — so without this every row comes back "Could not find a match",
    which reads as an API fault rather than a missing key. Values are never printed.
    """
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


async def run_case(case: NamingCase, bypass_cache: bool = False) -> tuple[bool, MediaItem | None, str]:
    """Returns (passed, the analyzed item, a one-line reason when it did not)."""
    item = MediaItem(
        id=case.file,
        # Synthetic and never resolved: enrich_media_item reads the name, not the disk.
        original_path=f"/media/{case.file}",
        original_name=case.file,
        media_type="unknown",
        clean_title="",
    )
    try:
        analyzed = await enrich_media_item(item, list(case.lang), bypass_cache=bypass_cache, forced_key=case.forced_key)
    except Exception as error:
        return False, None, f"{type(error).__name__}: {error}"

    got = analyzed.proposed_name or ""
    if got != case.expect:
        return False, analyzed, "wrong name"
    if case.status and analyzed.status != case.status:
        return False, analyzed, f"expected status {case.status!r}, got {analyzed.status!r}"
    return True, analyzed, ""


def report(case: NamingCase, passed: bool, item: MediaItem | None, reason: str) -> None:
    mark = paint("PASS", "32") if passed else paint("FAIL", "31")
    print(f"{mark}  {case.file}")

    if passed:
        detail = item.proposed_name if item and item.proposed_name else "(no name, as expected)"
        confidence = f"  {item.status} {item.confidence:.2f}" if item and item.confidence is not None else ""
        print(f"      {detail}{paint(confidence, '90')}")
        return

    print(f"      {paint(reason, '31')}")
    print(f"      expect  {case.expect or '(no name)'}")
    if item is None:
        return
    confidence = f"  [{item.status} {item.confidence:.2f}]" if item.confidence is not None else f"  [{item.status}]"
    print(f"      got     {item.proposed_name or '(no name)'}{paint(confidence, '90')}")
    if item.message:
        print(f"      why     {item.message}")
    if case.note:
        print(f"      note    {case.note}")
    # The candidate list is the actionable part of a failure: if the right series is in
    # it, the case just needs `forced_key = "<key>"` and the app is not wrong at all.
    for candidate in item.candidates[:5]:
        picked = "*" if candidate.selected else " "
        year = f" ({candidate.year})" if candidate.year else ""
        print(f"      {picked} {candidate.key:>10}  {candidate.score:.2f}  {candidate.label}{year}")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="run only the cases whose filename contains this text")
    parser.add_argument("--bypass-cache", action="store_true", help="ignore the disk cache and refetch")
    args = parser.parse_args()

    load_env(ROOT / ".env")
    missing = [name for name in ("TMDB_API_KEY", "TVDB_API_KEY") if not os.getenv(name)]
    if missing:
        # Worth stopping for: with no key every case fails identically, and the output
        # is indistinguishable from the app being broken.
        print(paint(f"{', '.join(missing)} not set — every case would fail as a no-match.", "31"))
        return 2

    cases = load_cases()
    if args.only:
        cases = [case for case in cases if args.only.lower() in case.file.lower()]
    if not cases:
        print("No cases to run. Add one to naming_cases.toml.")
        return 0

    failures = 0
    for index, case in enumerate(cases):
        passed, item, reason = await run_case(case, bypass_cache=args.bypass_cache)
        if not passed:
            failures += 1
        report(case, passed, item, reason)
        if index != len(cases) - 1:
            print()

    total = len(cases)
    summary = f"{total - failures}/{total} cases pass"
    print()
    print(paint(summary, "31" if failures else "32"))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
