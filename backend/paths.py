"""Filesystem containment.

Every path this application reads or writes must resolve inside one of a small set
of configured roots. In the container that is `/media`, the bind mount holding the
Plex library; the user may narrow a scan to a subdirectory of it, and to nothing
else.

The roots are a *list* on purpose. The roadmap adds a destination library
(`/archive`, `/library`) that the automatic-move feature will write into, and that
must be a second root rather than a rewrite of this module.

Containment is checked on the **resolved** path, so it holds against `..`, against
an absolute path supplied by the client, and against a symlink pointing out of the
tree. Checking the unresolved string would not.
"""

import os
from pathlib import Path

# Container-side roots. Distinct from the `MEDIA_DIR` in `.env`, which is the *host*
# path docker-compose bind-mounts onto `/media` — same idea, opposite side of the
# mount, and conflating the two would silently disable containment.
MEDIA_ROOT_VAR = "MEDIA_ROOT"
LIBRARY_ROOT_VAR = "LIBRARY_ROOT"
DEFAULT_MEDIA_ROOT = "/media"


class PathNotAllowed(ValueError):
    """A path resolved outside every configured root."""


def allowed_roots() -> list[Path]:
    """The directories this application may touch, resolved and de-duplicated.

    `LIBRARY_ROOT` is unset today; it is read now so that configuring it is all the
    automatic-move feature needs from this module.
    """
    configured = [
        os.getenv(MEDIA_ROOT_VAR, DEFAULT_MEDIA_ROOT),
        os.getenv(LIBRARY_ROOT_VAR),
    ]

    roots: list[Path] = []
    for entry in configured:
        if not entry:
            continue
        root = Path(entry).expanduser().resolve()
        if root not in roots:
            roots.append(root)
    return roots


def resolve_within_roots(candidate: str | Path) -> Path:
    """Resolve `candidate` and assert it is a configured root or below one.

    Returns the resolved path, which is what callers should then use — resolving
    once here and touching the filesystem through a different string later would
    reopen the hole this closes.

    Raises `PathNotAllowed` if it escapes.
    """
    resolved = Path(candidate).expanduser().resolve()
    roots = allowed_roots()

    for root in roots:
        if resolved == root or root in resolved.parents:
            return resolved

    allowed = ", ".join(str(root) for root in roots) or "(none configured)"
    raise PathNotAllowed(f"'{candidate}' è fuori dalle cartelle consentite: {allowed}")


def resolve_rename_target(original_path: str | Path, proposed_name: str) -> tuple[Path, Path]:
    """Compute the two ends of an in-place rename and prove the destination is safe.

    Returns `(source, target)`, both resolved. Both are returned so the caller
    renames exactly the path that was checked, rather than re-deriving the source
    from the original string.

    `proposed_name` must be a bare filename. The check is not paranoia about the
    join — `Path('/media/x') / '/etc/passwd'` *is* `/etc/passwd`, because `/`
    discards its left operand when the right one is absolute. A name of `/etc/passwd`
    would therefore not be contained by the parent directory at all.

    Raises `PathNotAllowed` if the source escapes the roots or the name is not bare.
    """
    source = resolve_within_roots(original_path)

    name = proposed_name.strip()
    if not name:
        raise PathNotAllowed("Il nome proposto è vuoto")
    if name in {".", ".."} or "/" in name or "\\" in name or "\x00" in name:
        raise PathNotAllowed(f"Il nome proposto '{proposed_name}' non è un nome di file semplice")

    target = source.parent / name
    # Belt and braces: a rename never leaves the file's own directory, and that
    # directory is already known to be inside a root.
    if target.parent != source.parent:
        raise PathNotAllowed(f"Il nome proposto '{proposed_name}' sposterebbe il file fuori dalla sua cartella")
    return source, target
