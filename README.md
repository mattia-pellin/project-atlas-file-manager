# Project: Atlas - Files

A modern, containerized Single Page Application built to recursively scan, identify, and intelligently mass-rename your Movies and TV Series to be 100% compliant with Plex Media Server naming conventions. It uses TheMovieDb (TMDB) for movies and TheTVDB (TVDB) for series.

## Features
- **Smart Scanning**: Uses magic bytes (`filetype`) to ignore non-media files automatically.
- **Intelligent Parsing**: Extracts title, year, season, and episode from chaotic filenames using `guessit`.
- **API integrations**: Fetches accurate metadata with exponential backoff retries and local disk caching to prevent API abuse and bans.
- **Dynamic Padding**: Automatically calculates episode padding (e.g., `E001`, `E012`) based on the total number of episodes in the series.
- **Confidence scoring**: Every candidate a search returns is scored on title and year; a result the scoring cannot trust is held for review instead of being renamed silently.
- **Keyboard-first grid**: A dark, dense, editable grid you can run entirely from the keyboard — arrows to move, type to edit, `Space` to tick, `Ctrl+D` to fill a column down, `Ctrl+Z` to undo. `Ctrl+/` lists every shortcut.
- **Triage**: When two shows genuinely look alike, the ambiguous files are queued and answered with a digit — and one answer can be applied to every episode of the series at once. `Ctrl+G` walks the queue; `Ctrl+Shift+G` triages just the row under the cursor, which is how a match the scoring was *confidently* wrong about gets corrected.
- **Everything is tunable**: Scan directory, language codes (checked as you type — an unknown one is refused rather than silently ignored by the providers), the two confidence thresholds on one three-colour track, and the API cache, all in the settings panel (`Ctrl+,`). The TMDB and TVDB keys are verified live there, by using them.
- **One bulk action**: a rescan re-reads the directory and matches it. Everything else is per-row and deliberate — pick a candidate in triage, or correct a cell and watch that row re-match on what you typed. Nothing re-matches a file you already decided.

## The library is a mount, and it goes at `/media`

Read this before anything else, because it is the one part of the setup that is not
configurable.

**Whatever directory you want the app to work on must be mounted at `/media` inside
the container.** There is no environment variable for it. The host side is yours to
choose; the container side is fixed, and `MEDIA_ROOT` — the root the app refuses to
read or rename outside of — is set to `/media` by the image's own compose file and
should be left there.

Mount it `rw`: renaming is what the app is for, and a read-only mount fails at the
last step of the job rather than at the first.

```
-v /srv/plex:/media:rw            ✅  the library appears at /media
-v /srv/plex:/library:rw          ❌  nothing at /media; every scan returns 400
-v /srv/plex:/media:ro            ❌  scans fine, renames nothing
```

## Quick start — `docker run`

```bash
docker run -d --name atlas \
  -p 8080:8000 \
  -v /srv/plex:/media:rw \
  -e TMDB_API_KEY=your_tmdb_api_key \
  -e TVDB_API_KEY=your_tvdb_api_key \
  -e TVDB_PIN=your_tvdb_pin \
  ghcr.io/mattia-pellin/project-atlas-file-manager:latest
```

The app listens on **8000** inside the container, always. `8080` above is only the
host side of the mapping — publish it wherever you like. Then open
<http://localhost:8080>.

## Quick start — Docker Compose

1. Copy `.env.example` to `.env` and fill in the two API keys. Note that the library
   path is *not* in there — see above.

```env
TMDB_API_KEY=your_tmdb_api_key
TVDB_API_KEY=your_tvdb_api_key
TVDB_PIN=your_tvdb_pin
PORT=8080
```

2. Point the mount at your library. The committed `docker-compose.yml` deliberately
   mounts a throwaway test directory, so that a checkout of this repo cannot touch
   anything you care about. Override it in `docker-compose.override.yml`, which
   compose merges automatically and which is gitignored:

```yaml
# docker-compose.override.yml
services:
  plex-file-manager:
    volumes:
      - /srv/plex:/media:rw
```

Compose merges volumes by their *target*, so naming `/media` replaces the default
rather than adding a second mount.

3. Build and start:

```bash
docker compose up -d --build
```

4. Open <http://localhost:8080>.

### Deploying the published image

The compose file in this repo builds from source, which is what you want while
working on it. To *deploy* — Portainer, a NAS, anywhere the source is not checked
out — write a stack of your own against the image on GHCR. An override cannot do
this for you: the base file's `build:` would still win, so this is a whole file
rather than a patch on one.

```yaml
services:
  atlas:
    image: ghcr.io/mattia-pellin/project-atlas-file-manager:latest
    container_name: atlas
    ports:
      - "8080:8000"
    environment:
      - TMDB_API_KEY=${TMDB_API_KEY}
      - TVDB_API_KEY=${TVDB_API_KEY}
      - TVDB_PIN=${TVDB_PIN}
      - MEDIA_ROOT=/media
      - LANG_PREFS=it,en
      - CACHE_TTL_HOURS=24
    volumes:
      - /srv/plex:/media:rw
    restart: unless-stopped
```

**Image tags carry no `v`**, unlike the git tags they are built from: release `v2.2.1`
publishes `:2.2.1`, and `:v2.2.1` does not exist. Three ways to pin, loosest first:

| Tag | Moves when |
| --- | --- |
| `:latest` | every release |
| `:2.2` | a patch lands on 2.2 — fixes, no new behaviour |
| `:2.2.1` | never |

A deployment that pulls on a webhook wants `:latest`; one you would rather update on
purpose wants an exact version.

## Trying it without risking a library

`test_media/` holds sixteen media fixtures built to break the parser in a
different way each — multi-episode ranges, scene naming, absolute anime
numbering, accents and elisions, a four-episode series that no scoring can
disambiguate, a nested `Show/Season 1/` directory, and one text file the scan
must ignore. They are committed, and their exact names are pinned by the test
suite, so the container is pointed at a throwaway copy instead:

```bash
scripts/sandbox-media.sh                                   # reset sandbox/media from test_media/
docker compose up -d --build
```

No flag and nothing to remember: `sandbox/media` is what the committed
`docker-compose.yml` mounts, so pointing the container at a real library is
something you have to *opt into* with an override, and forgetting the override can
only ever leave you renaming throwaway copies. Re-run the script whenever you want
the fixtures back.

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

## Configuration

Two things are configured, and they are configured differently:

| | How | Changeable? |
| --- | --- | --- |
| **The library** | A bind mount whose container side is `/media` | Host side yes, `/media` no |
| **Everything else** | Environment variables | Yes, see below |

### Environment variables

Passed to the container — with `-e` on `docker run`, or through the `environment:`
block that compose fills from your `.env`.

**Must be set:**

| Variable | What it does |
| --- | --- |
| `TMDB_API_KEY` | Matches **movies**. Without it every film comes back unmatched, with a message that reads like a genuine no-match. |
| `TVDB_API_KEY` | Matches **series**, and fetches episode titles. Same failure mode for every episode. |

Both are free. TMDB: <https://www.themoviedb.org/settings/api>. TVDB v4:
<https://thetvdb.com/api-information>.

The settings panel (`Ctrl+,`) checks both keys live, by using them, and says which of
`ok` / `invalid` / `missing` / `unreachable` each one is. A revoked key and an
unreachable provider look identical from the grid, which is why that check exists —
use it before concluding that a file cannot be matched.

**May be set:**

| Variable | Default | What it does |
| --- | --- | --- |
| `TVDB_PIN` | *(empty)* | TVDB user PIN, for a subscriber's extended API access. Optional but recommended. |
| `PORT` | `8080` | Host port compose publishes on — the **left** side of the mapping only. The app inside the container always listens on `8000`, and that does not move. |
| `LANG_PREFS` | `it,en` | Title languages, most preferred first, as ISO 639-1 codes. Only the value the UI *starts* with: the chain is editable per request in the settings panel. A code neither provider knows is not an error anywhere — TMDB answers with untranslated results and TVDB falls through — so the panel validates each one as you type. |
| `CACHE_TTL_HOURS` | `24` | How long a TMDB/TVDB response stays on disk before it is fetched again. Fractions count — `0.5` is thirty minutes — and `0` means reuse nothing, which is what you want while chasing a wrong match: a corrected answer upstream then shows up on the next scan instead of tomorrow. Anything that is not a positive number falls back to `24` rather than taking the app down with it. Two things deliberately do not follow it: a "nothing matched" answer is capped at one hour (it follows this value *down*, never up, because it is the answer most likely to be wrong for a reason outside this app), and the TVDB auth token keeps its own 24h, being a credential rather than a payload. |
| `MEDIA_ROOT` | `/media` | The root the app refuses to read or rename outside of. **Leave it alone in the container** — it is the mount's container side, and the compose file pins it to `/media`. It exists as a variable for one case: running the backend outside Docker, where `/media` does not exist and every scan would return `400`. |

There is no variable for the library path. See [the mount section](#the-library-is-a-mount-and-it-goes-at-media).

### Not environment variables

The languages, the two confidence thresholds, the analysis concurrency and the API
cache are all in the settings panel (`Ctrl+,`) and take effect per request, so
changing one does not mean restarting the container. `GET /api/config` is what the UI
reads their current values from.
