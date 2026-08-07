"""Containment tests for backend/paths.py.

These pin the exact resolved path, because the failure mode is not an exception
that someone notices — it is a file quietly landing outside the library.
"""

from pathlib import Path

import pytest

from backend.paths import PathNotAllowed, allowed_roots, resolve_rename_target, resolve_within_roots


@pytest.fixture
def media_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "media"
    (root / "Shows" / "Breaking Bad").mkdir(parents=True)
    (tmp_path / "outside").mkdir()
    monkeypatch.setenv("MEDIA_ROOT", str(root))
    monkeypatch.delenv("LIBRARY_ROOT", raising=False)
    return root


def test_the_root_defaults_to_media(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MEDIA_ROOT", raising=False)
    monkeypatch.delenv("LIBRARY_ROOT", raising=False)
    assert allowed_roots() == [Path("/media")]


def test_a_second_root_is_picked_up_when_configured(media_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The automatic-move feature needs only this variable, not a code change."""
    library = media_root.parent / "library"
    library.mkdir()
    monkeypatch.setenv("LIBRARY_ROOT", str(library))
    assert allowed_roots() == [media_root, library]


# --- resolve_within_roots -----------------------------------------------------


def test_the_root_itself_is_allowed(media_root: Path) -> None:
    assert resolve_within_roots(str(media_root)) == media_root


def test_a_subdirectory_is_allowed(media_root: Path) -> None:
    target = media_root / "Shows" / "Breaking Bad"
    assert resolve_within_roots(str(target)) == target


@pytest.mark.parametrize("escape", ["/etc", "/", "{root}/../outside", "{root}/Shows/../../outside"])
def test_anything_outside_the_root_is_refused(media_root: Path, escape: str) -> None:
    with pytest.raises(PathNotAllowed):
        resolve_within_roots(escape.format(root=media_root))


def test_a_sibling_with_a_shared_prefix_is_refused(media_root: Path) -> None:
    """ "/media-backup" starts with "/media" as a string but is not below it.

    A `str.startswith` check would let this through; comparing resolved parents
    does not.
    """
    sibling = media_root.parent / f"{media_root.name}-backup"
    sibling.mkdir()
    with pytest.raises(PathNotAllowed):
        resolve_within_roots(str(sibling))


def test_a_symlink_pointing_out_of_the_root_is_refused(media_root: Path) -> None:
    link = media_root / "escape"
    link.symlink_to(media_root.parent / "outside", target_is_directory=True)
    with pytest.raises(PathNotAllowed):
        resolve_within_roots(str(link))


# --- resolve_rename_target ----------------------------------------------------


def test_a_bare_name_renames_in_place(media_root: Path) -> None:
    source = media_root / "Shows" / "Breaking Bad" / "old.mkv"
    source.touch()
    resolved_source, target = resolve_rename_target(str(source), "Breaking Bad - S02E10-E12.mkv")
    assert resolved_source == source
    assert target == source.parent / "Breaking Bad - S02E10-E12.mkv"


def test_an_absolute_proposed_name_is_refused(media_root: Path) -> None:
    """The reason this is not merely a join: `Path('/media/x') / '/etc/passwd'`
    discards the left operand and evaluates to `/etc/passwd`."""
    source = media_root / "Shows" / "x.mkv"
    source.touch()
    with pytest.raises(PathNotAllowed):
        resolve_rename_target(str(source), "/etc/passwd")


@pytest.mark.parametrize(
    "name",
    [
        "../escaped.mkv",
        "../../etc/passwd",
        "sub/dir.mkv",
        "back\\slash.mkv",
        "..",
        ".",
        "",
        "   ",
        "nul\x00byte.mkv",
    ],
)
def test_a_non_bare_proposed_name_is_refused(media_root: Path, name: str) -> None:
    source = media_root / "Shows" / "x.mkv"
    source.touch()
    with pytest.raises(PathNotAllowed):
        resolve_rename_target(str(source), name)


def test_a_source_outside_the_root_is_refused(media_root: Path) -> None:
    outside = media_root.parent / "outside" / "x.mkv"
    outside.touch()
    with pytest.raises(PathNotAllowed):
        resolve_rename_target(str(outside), "renamed.mkv")
