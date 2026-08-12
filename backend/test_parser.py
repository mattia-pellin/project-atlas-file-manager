"""Pins the exact guessit output for every fixture in `test_media/`.

`guessit` is the first stage of the naming pipeline: everything downstream —
the API search, the proposed name, the destination path — is derived from the
dict `parse_filename` returns. A guessit upgrade that changes one of these
values does not raise; it silently renames files differently.

`backend/requirements.lock` pins the version. *This file* is what makes a
version bump visible: change the pin, and any behavioural difference shows up
here as an exact-value diff instead of as a wrong name in a real Plex library.

When a bump does change a value, do not edit the expectation until you have
decided the new value is correct. The expectations below record what guessit
actually does today, defects included — see the inline notes.
"""

from pathlib import Path
from typing import Any

import pytest

from backend.parser import parse_filename
from backend.scanner import get_media_files

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "test_media"

# filename -> the complete dict parse_filename returns for it.
FIXTURE_PARSES: dict[str, dict[str, Any]] = {
    # Multi-episode range: guessit yields [10, 11, 12], format_episode joins
    # first and last. The gap (11) is not preserved anywhere.
    "Breaking Bad S02E10-12.mkv": {
        "media_type": "episode",
        "clean_title": "Breaking Bad",
        "year": None,
        "season": 2,
        "episode": "10-12",
        "episode_title": None,
    },
    # Note "1-3", not "01-03": format_episode does not pad. Padding is applied
    # later, in analyzer, from the matched series' episode count.
    "SpongeBob SquarePants S01E01-03.mkv": {
        "media_type": "episode",
        "clean_title": "SpongeBob SquarePants",
        "year": None,
        "season": 1,
        "episode": "1-3",
        "episode_title": None,
    },
    # Single episode stays an int, it is not routed through format_episode's
    # range branch.
    "Doctor Who S05E01.mkv": {
        "media_type": "episode",
        "clean_title": "Doctor Who",
        "year": None,
        "season": 5,
        "episode": 1,
        "episode_title": None,
    },
    # Apostrophe survives the parse intact; it is format_smart_title that
    # later breaks it ("I'm" -> "I'M").
    "One Piece S01E10 I'm Luffy.mkv": {
        "media_type": "episode",
        "clean_title": "One Piece",
        "year": None,
        "season": 1,
        "episode": 10,
        "episode_title": "I'm Luffy",
    },
    # Year with no parentheses, separated by a dash, is still recognised.
    "Star Wars The Empire Strikes Back - 1980.mp4": {
        "media_type": "movie",
        "clean_title": "Star Wars The Empire Strikes Back",
        "year": 1980,
        "season": None,
        "episode": None,
        "episode_title": None,
    },
    # A pipe splits the title: guessit reports title="The Matrix" plus
    # alternative_title="Reloaded". `parse_filename` rejoins them, otherwise the
    # search runs for "The Matrix" and matches the 1999 film instead of the 2003 one.
    "The Matrix | Reloaded | 2003.mkv": {
        "media_type": "movie",
        "clean_title": "The Matrix Reloaded",
        "year": 2003,
        "season": None,
        "episode": None,
        "episode_title": None,
    },
    # Elided Italian articles: the parse is clean, the API match is what fails.
    "Il Trionfo dell'Amore (1998).mp4": {
        "media_type": "movie",
        "clean_title": "Il Trionfo dell'Amore",
        "year": 1998,
        "season": None,
        "episode": None,
        "episode_title": None,
    },
    # Lowercase first letter is preserved here; capitalisation happens later.
    "all'ombra dell'olmo (2010).avi": {
        "media_type": "movie",
        "clean_title": "all'ombra dell'olmo",
        "year": 2010,
        "season": None,
        "episode": None,
        "episode_title": None,
    },
    # Three more Doctor Who episodes, so the fixture set contains a *series* and not
    # just single files. All four are equally ambiguous between the 1963 and the 2005
    # show, which is the point: one triage answer has to settle the whole season, and
    # a run that settles only some of them is visibly wrong in the grid.
    "Doctor Who S05E02.mkv": {
        "media_type": "episode",
        "clean_title": "Doctor Who",
        "year": None,
        "season": 5,
        "episode": 2,
        "episode_title": None,
    },
    "Doctor Who S05E03.mkv": {
        "media_type": "episode",
        "clean_title": "Doctor Who",
        "year": None,
        "season": 5,
        "episode": 3,
        "episode_title": None,
    },
    "Doctor Who S05E04.mkv": {
        "media_type": "episode",
        "clean_title": "Doctor Who",
        "year": None,
        "season": 5,
        "episode": 4,
        "episode_title": None,
    },
    # An abbreviation no API can resolve. The parse is fine and the match is hopeless,
    # which is the case for correcting the title in the grid: the row re-matches on
    # the edited value, since there is no bulk re-match command to fall back on.
    "BrBa S01E02.mkv": {
        "media_type": "episode",
        "clean_title": "BrBa",
        "year": None,
        "season": 1,
        "episode": 2,
        "episode_title": None,
    },
    # Scene naming: dots as separators, resolution, source, codec and release group,
    # all of which guessit strips. Note the country suffix goes too — "The Office US"
    # becomes "The Office", so the search cannot distinguish the UK original.
    "The.Office.US.S03E11.1080p.WEB-DL.x264-GROUP.mkv": {
        "media_type": "episode",
        "clean_title": "The Office",
        "year": None,
        "season": 3,
        "episode": 11,
        "episode_title": None,
    },
    # Absolute anime numbering, and guessit gets it wrong: 1015 is read as season 10,
    # episode 15, not as absolute episode 1015. Pinned as a defect, not as intent —
    # it is the fixture for fixing season and episode by hand in the grid.
    "One Piece - 1015.mkv": {
        "media_type": "episode",
        "clean_title": "One Piece",
        "year": None,
        "season": 10,
        "episode": 15,
        "episode_title": None,
    },
    # Accents plus an elision, and a film whose Italian title ("Il favoloso mondo di
    # Amélie") shares nothing with the filename — the match has to come from
    # `original_title`, exactly as the Empire Strikes Back fixture does.
    "Le Fabuleux Destin d'Amélie Poulain (2001).mkv": {
        "media_type": "movie",
        "clean_title": "Le Fabuleux Destin d'Amélie Poulain",
        "year": 2001,
        "season": None,
        "episode": None,
        "episode_title": None,
    },
    # Lives in `Stargate SG-1/Season 1/`, so the scan has to recurse and the rename has
    # to stay in the subdirectory it found the file in. The dash-digit in the title is
    # not mistaken for an episode number.
    "Stargate SG-1 S01E01.mkv": {
        "media_type": "episode",
        "clean_title": "Stargate SG-1",
        "year": None,
        "season": 1,
        "episode": 1,
        "episode_title": None,
    },
}

# Files in `test_media/` that are deliberately *not* media. The scan must skip them,
# so they have no parse to pin — but they still have to be accounted for, otherwise
# the completeness check below cannot tell "ignored on purpose" from "forgotten".
NON_MEDIA_FIXTURES = {"appunti.txt"}


@pytest.mark.parametrize(("filename", "expected"), FIXTURE_PARSES.items(), ids=FIXTURE_PARSES.keys())
def test_parse_filename_is_pinned(filename: str, expected: dict[str, Any]) -> None:
    """Compare the whole dict, so a new or renamed key fails too."""
    assert parse_filename(filename) == expected


def test_every_fixture_is_pinned() -> None:
    """A fixture added to test_media/ without an expectation here fails the suite.

    `rglob`, not `iterdir`: one fixture sits in `Stargate SG-1/Season 1/`, and a
    top-level listing would silently stop pinning anything nested.
    """
    on_disk = {p.name for p in FIXTURE_DIR.rglob("*") if p.is_file()}
    expected = set(FIXTURE_PARSES) | NON_MEDIA_FIXTURES
    assert on_disk == expected, (
        f"only in test_media/: {sorted(on_disk - expected)}; only in this file: {sorted(expected - on_disk)}"
    )


def test_the_scan_sees_exactly_the_media_fixtures() -> None:
    """The magic-byte filter, against the real directory.

    `appunti.txt` is a text file, so it must not reach the parser however the scan is
    pointed at it; every media fixture must, including the nested one. Extension
    checking alone would get both of these wrong.
    """
    assert {p.name for p in get_media_files(FIXTURE_DIR)} == set(FIXTURE_PARSES)


def test_type_is_inferred_from_season_or_episode() -> None:
    """The `unknown` -> `episode` fallback in parse_filename.

    No fixture reaches this branch, so it is covered directly: a filename with
    an episode number but no recognisable series pattern must still be treated
    as an episode, otherwise it is searched against TMDB as a film.
    """
    assert parse_filename("Some Show - 05.mkv")["media_type"] == "episode"


def test_alternative_title_is_appended() -> None:
    """guessit's `alternative_title` holds the tail of a split title, not a synonym.

    Any separator it treats as structural does this, not just the pipe in the
    fixture above, so the dash form is covered too.
    """
    assert parse_filename("The Matrix - Reloaded - 2003.mkv")["clean_title"] == "The Matrix Reloaded"


@pytest.mark.parametrize(
    ("episode_value", "expected"),
    [
        ([5], 5),  # one-element list must not become "5-5"
        ([10, 11, 12], "10-12"),
        (7, 7),
        (None, None),
    ],
)
def test_format_episode_shapes(mocker, episode_value: Any, expected: Any) -> None:
    """`format_episode` is exercised through its caller, since it is a closure.

    The one-element case is why this is mocked rather than driven by a filename:
    guessit collapses S01E05E05, S01E05-E05 and 1x05x05 to the int 5, never to
    [5], so the branch is unreachable from real input but still live code.
    """
    mocker.patch("backend.parser.guessit", return_value={"type": "episode", "episode": episode_value})
    assert parse_filename("irrelevant.mkv")["episode"] == expected
