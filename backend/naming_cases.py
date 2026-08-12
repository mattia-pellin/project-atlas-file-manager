"""Reads `naming_cases.toml`: the hand-written "this file should end up called that" list.

The fixtures in `test_media/` were chosen by us, so they test what we already thought
of. This file is the other direction — it is where a name that came out wrong *during
real use* gets written down, by hand, the moment it is noticed, and stays written down.

Two consumers, one loader, so a case cannot mean one thing offline and another live:

- `backend/test_naming_cases.py` runs in the normal suite. It touches no network: it
  checks that each case is internally consistent and *reachable* — that the expected
  name is a string the pipeline could produce at all, and that the parser sees in the
  filename the kind of thing the expectation describes.
- `scripts/check-naming-cases.py` is run on demand. It drives the real pipeline against
  TMDB/TVDB and reports which cases actually come out right.

The split matters: a typo'd expectation and a genuinely wrong match look identical in a
live run, and only one of them is a bug in the app.

`tomllib` is in the standard library on 3.11+, so the format costs no dependency, and a
TOML syntax error names its own line — which a hand-edited file needs.
"""

import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CASES_PATH = Path(__file__).resolve().parent.parent / "naming_cases.toml"

# What `enrich_media_item` can leave in `status` once it has run. "pending" is not
# here: it is the value the item is reset to on entry, never one it finishes on.
VALID_STATUSES = frozenset({"matched", "review", "error"})

_KNOWN_KEYS = frozenset({"file", "expect", "note", "lang", "forced_key", "status"})


class NamingCaseError(ValueError):
    """The TOML is malformed, or a case is missing something it cannot run without."""


@dataclass(frozen=True)
class NamingCase:
    """One hand-written expectation.

    `expect` is the complete filename, extension included, exactly as it should appear
    on disk — never a fragment and never a pattern. An empty `expect` is a real
    expectation too: "this file must *not* be given a name", which is the correct
    outcome whenever no candidate is trustworthy.
    """

    file: str
    expect: str
    note: str = ""
    lang: tuple[str, ...] = ("it", "en")
    # The candidate key a human picked in triage, when the case is only reproducible
    # after that choice. Replays the triage decision without a UI.
    forced_key: str | None = None
    # The expected `status`. Optional, and worth setting: a name that is right but
    # arrives as `review` still has to be ticked by hand, which is a different app.
    status: str | None = None

    @property
    def expects_no_name(self) -> bool:
        return self.expect == ""


def load_cases(path: Path = CASES_PATH) -> list[NamingCase]:
    """Parses the file. Returns `[]` when it does not exist — an empty list is a
    legitimate state, and neither consumer should fail merely because nothing has
    been reported yet.
    """
    if not path.exists():
        return []

    with path.open("rb") as handle:
        data = tomllib.load(handle)

    raw_cases = data.get("case", [])
    if not isinstance(raw_cases, list):
        raise NamingCaseError("`case` must be a list of tables: write each case as [[case]].")

    return [_case_from(raw, index) for index, raw in enumerate(raw_cases, start=1)]


def _case_from(raw: Any, index: int) -> NamingCase:
    where = f"case #{index}"
    if not isinstance(raw, dict):
        raise NamingCaseError(f"{where}: expected a [[case]] table, got {type(raw).__name__}.")

    unknown = sorted(set(raw) - _KNOWN_KEYS)
    if unknown:
        # Silently ignoring a key is how "expected" quietly becomes a no-op comment.
        raise NamingCaseError(
            f"{where}: unknown key(s) {', '.join(unknown)}. Allowed: {', '.join(sorted(_KNOWN_KEYS))}."
        )

    file = raw.get("file")
    if not isinstance(file, str) or not file.strip():
        raise NamingCaseError(f"{where}: `file` is required and must be a non-empty string.")

    expect = raw.get("expect")
    if not isinstance(expect, str):
        raise NamingCaseError(f'{where} ({file}): `expect` is required. Use "" for "no name should be proposed".')

    lang = raw.get("lang", ["it", "en"])
    if not isinstance(lang, list) or not all(isinstance(code, str) and code for code in lang):
        raise NamingCaseError(f'{where} ({file}): `lang` must be a list of language codes, e.g. ["it", "en"].')

    status = raw.get("status")
    if status is not None and status not in VALID_STATUSES:
        raise NamingCaseError(f"{where} ({file}): status {status!r} is not one of {', '.join(sorted(VALID_STATUSES))}.")

    note = raw.get("note", "")
    if not isinstance(note, str):
        raise NamingCaseError(f"{where} ({file}): `note` must be a string.")

    forced_key = raw.get("forced_key")
    if forced_key is not None:
        # TMDB ids are ints and TVDB's are strings; the API takes the key as a string,
        # so an integer in the TOML is accepted and converted rather than rejected.
        if isinstance(forced_key, int):
            forced_key = str(forced_key)
        elif not isinstance(forced_key, str) or not forced_key:
            raise NamingCaseError(f"{where} ({file}): `forced_key` must be a candidate key.")

    return NamingCase(
        file=file,
        expect=expect,
        note=note,
        lang=tuple(lang),
        forced_key=forced_key,
        status=status,
    )
