---
name: plex-naming
description: The Plex Media Server naming and folder conventions this project targets, plus how the current code maps onto them and where it deviates. Load before changing how a filename or a destination path is produced, or when designing the automatic move-into-library feature.
paths:
  - backend/analyzer.py
  - backend/parser.py
  - backend/api_clients.py
  - frontend/src/lib/**
allowed-tools: Read, Grep, Glob, Bash
---

# Plex naming conventions

The target this project is measured against. When something here conflicts
with the code, the code is wrong unless a comment explains the deviation.

Authoritative sources, worth re-checking if a case is genuinely ambiguous:
- Movies: <https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/>
- TV: <https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/>

## Movies

Plex wants one folder per movie, with the file repeating the folder name.

```
Movies/
└── Title (Year)/
    └── Title (Year).ext
```

- The year is the **release year**, in parentheses, and it is what
  disambiguates remakes. Always include it when known.
- Optional edition marker in braces, kept out of the title:
  `Blade Runner (1982) {edition-Final Cut}.mkv`
- Multi-part films use a `- partN` / `- cdN` suffix:
  `Title (Year) - part1.mkv`
- An explicit id removes all guesswork and is the recommended escape hatch for
  a title Plex mismatches: `Title (Year) {tmdb-12345}.mkv`

## TV series

```
Show Name (Year)/
├── Season 01/
│   ├── Show Name - S01E01 - Episode Title.ext
│   └── Show Name - S01E02-E03 - First Title - Second Title.ext
└── Season 00/          ← specials
    └── Show Name - S00E01 - Special Title.ext
```

- Season folders are `Season 01`, zero-padded to two digits. `Season 00` is
  the conventional home for specials; `Specials` is also accepted.
- The `SxxEyy` marker is the only part Plex actually parses. The episode title
  after it is cosmetic but is what makes a directory readable.
- **Multi-episode files** are `S01E01-E02` in Plex's own documentation. The
  bare `S01E01-02` form is widely used and generally matched, but `E` before
  the second number is the safer spelling.
- Date-based shows (daily talk shows) use `Show - 2026-08-07 - Title.ext`
  instead of `SxxEyy`. This project does not handle them.
- An explicit id works here too: `Show Name (Year) {tvdb-123456}`.

## Characters

Avoid, in any filename this project produces: `/ \ : * ? " < > |`. They are
illegal on Windows and NTFS/SMB shares, which is where most Plex libraries
actually live even when the server is Linux.

Also avoid a trailing dot or space in any path component, and keep the total
path length reasonable — deep season folders plus a long episode title can
exceed limits on SMB clients.

## How this project maps onto the above

Current behaviour, in `backend/analyzer.py`:

| Plex convention | This project |
| --- | --- |
| `Title (Year)/Title (Year).ext` | `Title (Year).ext`, **renamed in place** — no folder is created |
| `Season 01/` | not created |
| `Show - S01E01 - Title.ext` | matches |
| `S01E01-E02` | emits `S01E01-02`, no second `E` |
| 2-digit episode padding | **dynamic**: padding comes from the series' total episode count, so a 1100-episode series gets `S01E0001` |
| Illegal characters | `sanitize_name()`: `: \ /` → space, `\|` → ` - `, `* ? " < >` dropped, whitespace collapsed, leading/trailing ` -` stripped |

### The two deliberate deviations

1. **No folder structure.** The app renames files where it finds them. The
   roadmap's automatic-move feature is what closes this gap — until then, the
   folder layout is the user's job.
2. **Dynamic episode padding.** Plex parses `E1`, `E01` and `E0001`
   identically, so padding is purely for human-readable sorting. The wider
   padding is intentional for very long-running series and must be preserved.

## When designing the automatic move

The destination is derived, not user-supplied. Requirements:

- Compute the full target path as a **pure function of a `MediaItem` plus the
  library root**, so it can be unit-tested without a filesystem.
- Resolve the result and assert containment in the library root. Compare
  resolved paths; do not pattern-match for `..`. `sanitize_name()` was written
  to strip illegal characters, not to be a security boundary.
- Never overwrite. Detect collisions across the whole batch before moving
  anything, not per file as you go.
- Prefer a same-filesystem `rename` and fall back to copy-then-verify-then-
  delete across devices — a Plex library is frequently on a different mount
  from the download directory.
- Write the journal entry **before** the move, and mark it complete after, so
  an interrupted run is still reversible.
