"""Checks that every hand-written case in `naming_cases.toml` *could* pass.

Offline and fast, so it runs in the normal suite. It deliberately does not ask whether
the app gets the name right — that needs TMDB and TVDB, and lives in
`scripts/check-naming-cases.py`. It asks the question that has to be settled first:
is this case a statement the pipeline is capable of satisfying?

A case that fails here is a bug in the case, not in the app: an expectation containing
a character `sanitize_name` strips, an episode name written for a filename with no
episode number in it, a changed extension. Caught here they cost a second; caught in a
live run they look exactly like a wrong match, and the search for the fault starts in
the wrong file.
"""

import re
from pathlib import Path

import pytest

from backend.analyzer import parse_episode_range, sanitize_name
from backend.naming_cases import CASES_PATH, NamingCase, load_cases
from backend.parser import parse_filename

CASES = load_cases()

# `Name - S01E02 - Title.mkv`: what the episode branch of the analyzer always builds,
# and the only shape it can build. The season is always two digits; the episode is
# padded from that season's episode count, so its width is not fixed.
EPISODE_SHAPE = re.compile(r" - S\d{2}E\d+")


def test_the_file_parses() -> None:
    """Runs even when there are no cases yet — this is where a TOML syntax error or a
    misspelled key surfaces, and it must not depend on the file having content."""
    assert isinstance(load_cases(), list)
    assert CASES_PATH.name == "naming_cases.toml"


def test_no_case_is_written_twice() -> None:
    # Same file, same triage choice, same languages: two answers to one question, and
    # nothing decides which one is meant.
    keys = [(case.file, case.forced_key, case.lang) for case in CASES]
    duplicates = sorted({key[0] for key in keys if keys.count(key) > 1})
    assert not duplicates, f"listed more than once: {', '.join(duplicates)}"


@pytest.mark.parametrize("case", CASES, ids=[case.file for case in CASES])
class TestCaseIsWellFormed:
    def test_both_names_are_bare_filenames(self, case: NamingCase) -> None:
        # A case describes a rename, and a rename never moves a file. A path on either
        # side would be describing the move feature, which does not exist yet.
        for label, name in (("file", case.file), ("expect", case.expect)):
            if name:
                assert Path(name).name == name, f"{label} must be a bare filename, not a path"

    def test_the_extension_is_preserved(self, case: NamingCase) -> None:
        if case.expects_no_name:
            return
        # The analyzer takes the extension off the original name and puts it back
        # untouched, so an expectation that changes it can never be met.
        assert Path(case.expect).suffix == Path(case.file).suffix

    def test_the_expected_name_survives_sanitize_name(self, case: NamingCase) -> None:
        if case.expects_no_name:
            return
        # Necessary, not sufficient: every part of the name goes through sanitize_name,
        # so a name that sanitize_name would alter is one the pipeline cannot emit.
        # Usually a ':' or a '?' typed out of habit from the real title.
        assert sanitize_name(case.expect) == case.expect, "contains characters the pipeline strips or rewrites"

    def test_the_status_agrees_with_the_expectation(self, case: NamingCase) -> None:
        if case.expects_no_name:
            assert case.status in (None, "error"), 'expecting no name means status "error"'
        else:
            assert case.status != "error", 'status "error" means no name is proposed, so `expect` must be ""'

    def test_the_parser_sees_what_the_expectation_describes(self, case: NamingCase) -> None:
        parsed = parse_filename(case.file)
        is_episode = parsed.get("media_type") == "episode"

        if case.expects_no_name:
            return

        # The two branches of the analyzer produce two shapes and cannot be crossed:
        # an episode is always `Name - SxxEyy`, a movie never is. When these disagree
        # the case is unsatisfiable however good the API match turns out to be.
        if is_episode:
            assert EPISODE_SHAPE.search(case.expect), (
                f"guessit reads {case.file!r} as an episode "
                f"(S{parsed.get('season')}E{parsed.get('episode')}), so the name will contain ' - SxxEyy'"
            )
            assert parse_episode_range(parsed.get("episode")) is not None, (
                "no usable episode number, so the analyzer refuses to build a name at all"
            )
        else:
            assert not EPISODE_SHAPE.search(case.expect), (
                f"the expected name is an episode name, but guessit reads {case.file!r} as a "
                f"{parsed.get('media_type')} — the episode branch will never run"
            )
