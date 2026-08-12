# Project: Atlas - Files

A modern, containerized Single Page Application built to recursively scan, identify, and intelligently mass-rename your Movies and TV Series to be 100% compliant with Plex Media Server naming conventions. It uses TheMovieDb (TMDB) for movies and TheTVDB (TVDB) for series.

## Features
- **Smart Scanning**: Uses magic bytes (`filetype`) to ignore non-media files automatically.
- **Intelligent Parsing**: Extracts title, year, season, and episode from chaotic filenames using `guessit`.
- **API integrations**: Fetches accurate metadata with exponential backoff retries and local disk caching to prevent API abuse and bans.
- **Dynamic Padding**: Automatically calculates episode padding (e.g., `E001`, `E012`) based on the total number of episodes in the series.
- **Confidence scoring**: Every candidate a search returns is scored on title and year; a result the scoring cannot trust is held for review instead of being renamed silently.
- **Keyboard-first grid**: A dark, dense, editable grid you can run entirely from the keyboard — arrows to move, type to edit, `Space` to tick, `Ctrl+D` to fill a column down, `Ctrl+Z` to undo. `Ctrl+/` lists every shortcut.
- **Triage**: When two shows genuinely look alike, the ambiguous files are queued and answered with a digit — and one answer can be applied to every episode of the series at once.
- **Everything is tunable**: Scan directory, language preference, confidence thresholds and the API cache are all exposed in the settings panel (`Ctrl+,`).
- **One bulk action**: a rescan re-reads the directory and matches it. Everything else is per-row and deliberate — pick a candidate in triage, or correct a cell and watch that row re-match on what you typed. Nothing re-matches a file you already decided.

## Quick Start (Docker Compose)

1. Create a `.env` file in the root directory:
```env
MEDIA_DIR=/path/to/your/real/media
PORT=8080
TMDB_API_KEY=your_tmdb_api_key
TVDB_API_KEY=your_tvdb_api_key
TVDB_PIN=your_tvdb_pin
```

2. Run the application:
```bash
docker-compose up -d --build
```

3. Access the web interface at `http://localhost:8080`.

## Trying it without risking a library

`test_media/` holds sixteen media fixtures built to break the parser in a
different way each — multi-episode ranges, scene naming, absolute anime
numbering, accents and elisions, a four-episode series that no scoring can
disambiguate, a nested `Show/Season 1/` directory, and one text file the scan
must ignore. They are committed, and their exact names are pinned by the test
suite, so the container is pointed at a throwaway copy instead:

```bash
scripts/sandbox-media.sh                                   # reset sandbox/media from test_media/
MEDIA_DIR="$PWD/sandbox/media" docker compose up -d --build
```

Re-run the script whenever you want the fixtures back. The `MEDIA_DIR` override
matters: without it, compose uses the one in your `.env` — your real library.

## Reporting a name that came out wrong

The fixtures only cover what we thought of. When a real file gets a name it
should not have, write it down in `naming_cases.toml` — filename in, expected
name out — and it stays covered from then on:

```toml
[[case]]
file   = "The Matrix | Reloaded | 2003.mkv"
expect = "Matrix Reloaded (2003).mkv"
note   = "pipes become separators, and the year outranks the shorter 'The Matrix'"
```

`expect = ""` means "the app must refuse to name this", which is often the right
answer. `status`, `lang` and `forced_key` (a candidate picked in triage) are
optional; the file itself documents them.

```bash
.venv/bin/python -m pytest backend/test_naming_cases.py   # offline: is the case even satisfiable?
.venv/bin/python scripts/check-naming-cases.py            # live: does the app get it right?
```

The first runs in the normal test suite and catches the case that could never
pass — an illegal character, a changed extension, an episode name expected from a
filename with no episode number. The second calls TMDB/TVDB for real, exits
non-zero on any mismatch, and prints the ranked candidates so a case that just
needs a hand-picked match can be closed with one `forced_key`. Neither one opens,
creates or renames a file.

## Configuration Options
All configuration is handled via environment variables passed to the container:
- `MEDIA_DIR` (Required): The host path to mount inside the container at `/media`.
- `MEDIA_ROOT` (Optional): The container-side root the app is allowed to read and
  rename inside. Default `/media`, which is the other side of the `MEDIA_DIR` mount.
  A scan may narrow to a subdirectory of it and to nothing else; anything outside is
  rejected with a `400`. Set it explicitly when running the backend outside Docker.
- `TMDB_API_KEY` (Required for Movies): Your TMDB API key.
- `TVDB_API_KEY` (Required for Series): Your TVDB v4 API key.
- `TVDB_PIN` (Optional but recommended): Your TVDB User PIN for extended API access.
- `PORT` (Optional): The host port the container is published on. Default is `8080`.
  The app inside the container always listens on `8000`; this is only the left-hand
  side of the compose port mapping.
- `CACHE_TTL_HOURS` (Optional): How long API requests should be cached locally. Default `24`.
- `LANG_PREFS` (Optional): Comma-separated title languages, most preferred first.
  Default `it,en`. This is only the value the UI starts with — the language pins,
  the cache switch and the confidence thresholds are all overridable per request
  from the settings panel, and `GET /api/config` is what the UI reads them from.
