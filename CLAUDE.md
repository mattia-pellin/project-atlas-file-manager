# Project: Atlas — File Manager

Self-hosted web app that recursively scans a media directory, identifies each
file against TMDB (movies) and TVDB (series), and mass-renames it to Plex
naming conventions. Single container, personal home-lab, one user.

## Non-negotiable invariant

**This application writes to a real Plex library.** A wrong name or a wrong
path does not throw an error — it silently scatters files that the user then
has to find by hand. Every change to the naming pipeline or to any filesystem
operation needs a test that pins the exact resulting string or path.

Order of priority when trading off: **correctness of the final name/path >
usability of the UI > everything else.**

## Commands

Run everything from the repo root, inside WSL (Debian). The Python virtualenv
is **`.venv/`** at the root, on **Python 3.14**, managed by `uv` from
`uv.lock`. (It was `venv/` before, alongside a duplicate `backend/venv/`;
neither should reappear.)

| Task | Command |
| --- | --- |
| Full quality gate | `/check` (or see the four commands below) |
| Backend lint | `.venv/bin/python -m ruff check .` |
| Backend format | `.venv/bin/python -m ruff format .` |
| Backend tests | `.venv/bin/python -m pytest` |
| Frontend lint | `cd frontend && npm run lint` |
| Frontend types | `cd frontend && npm run typecheck` |
| Frontend tests | `cd frontend && npm test` |
| Naming cases, live | `.venv/bin/python scripts/check-naming-cases.py` |
| Dev servers | `/dev` |
| Sync `.venv/` to the lock | `.venv/bin/uv sync` |
| Reset the writable fixture copy | `scripts/sandbox-media.sh` |
| Container, against that copy | `MEDIA_DIR="$PWD/sandbox/media" docker compose up -d --build` |

The dev backend runs on **:8001** (Vite proxies `/api` there, see
`frontend/vite.config.ts`); the production container serves both on **:8000**
internally and is **published on :8080** (`PORT` in `.env`, left side of the
compose mapping only — the `EXPOSE`/`CMD` port in the image stays 8000).

**Never `docker compose up` without overriding `MEDIA_DIR`.** The one in `.env`
is the real Plex library, and the container mounts it read-write. See *Trying the
container against the fixtures* below.

## Dependencies are locked

Two files per side, and they mirror each other:

| | Declaration (ranges) | Lock (exact + hashes) |
| --- | --- | --- |
| Backend | `pyproject.toml` | `uv.lock` |
| Frontend | `frontend/package.json` | `frontend/package-lock.json` |

There is **no `requirements.txt` any more** — the four files that used to hold
this (`backend/requirements{.txt,.lock}`, `requirements-dev{.txt,.lock}`) were
collapsed into `pyproject.toml` + `uv.lock`. Runtime dependencies live in
`[project.dependencies]`, tooling in `[dependency-groups] dev`. One lock covers
both, and `--no-dev` selects the runtime subset, so the image never ships
pytest/ruff/uv.

All three consumers install from that one lock:

- local → `.venv/bin/uv sync`
- CI → `uv sync --locked --python 3.14`
- container → `uv sync --frozen --no-dev`

**Why this matters here and not just as hygiene.** Before locking, the venv had
`guessit 3.8.0` while CI and the image resolved `4.x` — so the naming pipeline
was being validated against a *different parser* than the one that renames the
real library. The outputs happened to be byte-identical on all eight fixtures;
that was luck, not control. `backend/test_parser.py` now pins the exact
`parse_filename` output for every fixture, so the next bump surfaces as a
failing assertion instead of as a wrongly named file.

To change a dependency: edit `pyproject.toml`, re-lock, sync, run the gate.

```
.venv/bin/uv lock              # honour the ranges, minimal change
.venv/bin/uv lock --upgrade    # pull everything to latest
.venv/bin/uv sync
```

CI runs `uv sync --locked`, which fails if `uv.lock` no longer satisfies
`pyproject.toml`. That is a real drift check and, unlike diffing against a
fresh resolve, it cannot go red merely because an upstream published a release.

`uv` is deliberately **not installed on this machine** — it is a `dev`-group
dependency, so the only copy is `.venv/bin/uv`. Bootstrapping a fresh clone is
therefore three lines, because you need a uv to build the venv that holds uv:

```
python3.14 -m venv .venv
.venv/bin/pip install uv
.venv/bin/uv sync
```

`pydantic-core` will always show as outdated in `uv pip list --outdated`. That
is correct and must not be "fixed": `pydantic` pins it with `==`, so it only
moves when pydantic does.

### Python 3.14

The backend runs unchanged on 3.14 — verified: identical test results on 3.13
and 3.14, clean imports under `-W error::DeprecationWarning`, and
`pydantic-core` (the only compiled dependency) ships a `cp314` wheel, so
`--only-binary=:all:` succeeds in `python:3.14-slim`.

**3.14 buys no speed for this workload.** Measured, not assumed: the
tail-call interpreter is not compiled into either build, the JIT is
present-but-off and slower when forced, no free-threaded build is installed,
and `InterpreterPoolExecutor` (PEP 734) came out 28× slower than serial for
`parse_filename`. Held constant, 3.13 vs 3.14 is indistinguishable (3033 vs
3092 µs/parse). An earlier "22% faster on 3.14" measurement was the
`guessit 3.8.0 → 4.4.0` upgrade, not the interpreter.

What 3.14 *does* buy is two roadmap enablers, both worth using when those items
land:

- `pathlib.Path.move()` — moves across filesystems, so the automatic-move
  feature (roadmap 2) does not fail with `EXDEV` when the download directory
  and the Plex library are different mounts. `os.rename`/`Path.rename` do.
- `uuid.uuid7()` — time-sortable IDs, which is what the rollback journal
  (roadmap 3) wants for ordering entries. `main.py` still uses `uuid4()`.

## Tooling

Claude Code is installed **only as the VS Code extension**, not system-wide.
There is no `claude` binary on the WSL PATH, so any instruction of the form
`claude mcp add …` has to be translated by hand into `.mcp.json` — that is how
the Stitch server below was configured. The `npx plugins` marketplace CLI
**does** work, though; it is a plain npm package and does not need the `claude`
binary. It warns "Claude Code was not detected on this system" and installs
anyway.

`gh` is **not installed** either. **Use the GitHub MCP server for every GitHub
operation** — CI runs, releases, issues, reading files off a branch. That is a
standing preference, not a fallback for when the shell is unavailable.

`git push` is the one thing the MCP cannot do. The server speaks REST, so
`push_files` fabricates a *new* commit from file contents instead of
transferring local history — pushing eight commits through it would collapse
them into one with different SHAs. **Commits and pushes therefore go through
the git CLI**, and are authenticated: the fine-grained PAT lives in
`~/.git-credentials` (mode `600`) behind a **repo-local** `credential.helper
store`, so `git push origin main` just works. The global helper is left unset
on purpose, so no other repo on this machine picks the token up. The tradeoff
is a plaintext token on disk — scoped to this one repo, and revocable at
<https://github.com/settings/tokens>. An SSH key would remove even that and is
the upgrade path if it ever matters.

Fetching and pulling need no credential at all: the repo is public.

For a single-file change with no history worth preserving — a doc fix, a
version bump — the MCP's `create_or_update_file` is still the tidier route:
one call, nothing to reconcile locally, then `git pull --ff-only`.

### MCP servers

`.mcp.json` declares two project-scoped MCP servers. Claude Code asks for
approval the first time it loads them (`enableAllProjectMcpServers` is
deliberately `false`).

| Server | Transport | Needs |
| --- | --- | --- |
| `github` | remote HTTP, `api.githubcopilot.com/mcp/` | A PAT in `GITHUB_MCP_PAT`, sent as `Authorization: Bearer`. A **fine-grained** PAT works — verified, 45 tools, scoped to this repo only. Toolsets pinned via `X-MCP-Toolsets`; `actions` is *not* in the default set and must stay listed explicitly. |
| `stitch` | remote HTTP, `stitch.googleapis.com/mcp` | `STITCH_API_KEY` in the environment, sent as the `X-Goog-Api-Key` header. The URL is public; only the key is secret. Key issued by <https://stitch.withgoogle.com/docs/mcp/setup/>. |

**Do not click "Authenticate" in `/mcp` for `github` or `stitch`.** Neither uses
OAuth. Both advertise an OAuth authorization server (`github.com/login/oauth`
and `accounts.google.com`) that does **not** implement RFC 7591 dynamic client
registration, which Claude Code's MCP OAuth flow requires. The attempt always
ends in:

```
SDK auth failed: Incompatible auth server: does not support dynamic client registration
```

That message means "this server cannot be authenticated this way", not "your
token is wrong". Both servers authenticate by **header only**, so the correct
action after fixing a credential is `/mcp` → **reconnect**.

Rotating a Stitch key at the setup page **issues a new key without revoking the
old one** — verified. Revoke the previous key explicitly, or it stays live.

`ERR_TLS_CERT_ALTNAME_INVALID fetching "https://api.githubcopilot.com/mcp/"` is
a **DNS fault on the local network, not a credential problem** — observed
mid-session on 2026-08-07, after the same server had been answering fine. The
upstream forwarder Windows resolves through returned `api.githubcopilot.com` as
a CNAME to bare `github.com.` instead of GitHub's load-balancer host
(`glb-….github.com.`); WSL's stub resolver forwards to Windows, so this distro
inherits it. The connection then lands on github.com's address and is served
github.com's certificate, whose SANs cover only `github.com` and
`www.github.com`. Node rejects it, correctly.

Confirm it before touching anything else — compare the resolver in use against a
public one:

```
dig +short api.githubcopilot.com            # via the configured resolver
dig +short @1.1.1.1 api.githubcopilot.com   # glb-….github.com. is the right answer
```

A bare `github.com.` from the first and `glb-….github.com.` from the second is
the signature. (`/etc/resolv.conf` names the WSL stub; `ipconfig /all` on the
Windows side names the real upstream behind it.)

`ipconfig /flushdns` does **not** fix it: the bad answer is upstream of the
Windows cache. It clears when that upstream's own cache expires. To not wait,
point DNS at a public resolver — on the Windows adapter, or for this distro only
via `/etc/wsl.conf` (`[network] generateResolvConf = false`) plus a
hand-written `/etc/resolv.conf`. Both are machine-level changes outside the
repo: **ask first.** Do not pin an address in `/etc/hosts` — load-balancer IPs
rotate, and WSL regenerates the file anyway.

`git` itself is unaffected: it talks to `github.com`, which resolves correctly.
So does the public REST API — `curl https://api.github.com/…` needs no
credential on this repo and is the fallback for reading CI results while the MCP
is down.

`list_pull_requests` returns **404 Not Found** on this repo. That is a property
of the repo, not a broken token: `GET /repos/…/pulls` 404s anonymously too,
while `commits`, `branches`, `tags`, `releases` and `issues` all return 200
anonymously, and `octocat/Hello-World/pulls` returns 200. The repo has
`has_issues: false` and has never had a pull request
(`search/issues?q=repo:…+is:pr` → `total_count: 0`). Expect it to start working
once a PR exists. Do not "fix" it by widening the PAT.

Note that `x-accepted-github-permissions` on a response documents what the
*endpoint* accepts; it is present on successful calls too, so it is not
evidence of a permission failure.

Diagnose a failing server from
`~/.cache/claude-cli-nodejs/-home-mattia-projects-project-atlas-file-manager/mcp-logs-<server>/`
rather than by guessing — the logs name the exact cause.

### Docker: plain CLI, deliberately no MCP

There is **no Docker MCP server**, and one should not be re-added. Docker
Desktop's MCP Toolkit runs Windows-side and reaches an integrated distro over
`/run/host-services/tools.sock`. In this Debian distro that path does not
exist, and `tools.sock` is absent from
`/mnt/wsl/docker-desktop/shared-sockets/host-services/` — the Toolkit backend
is simply never shared into WSL. Every `docker mcp …` subcommand therefore
answers `Docker Desktop is not running` even while the engine is perfectly up.
(`EnableDockerAI` is also `false` in Desktop's `settings-store.json`.)

Not worth chasing. The WSL `docker` CLI is fully functional — `desktop-linux`
context, client and server 29.2.1 — and covers everything this project needs:
`docker compose`, builds, logs, inspection. Use the terminal. A green
`docker version` says nothing about the Toolkit, so don't read it as a reason
to try again.

### Where credentials live

`.claude/settings.local.json` is gitignored and is the **only** file in the
repo allowed to hold a live credential. Its `env` block feeds the `${VAR}`
placeholders in the committed `.mcp.json`, which must never contain a literal
secret. `.env` remains the app's TMDB/TVDB keys and is separately protected.

### Stitch skills

The three official plugins from `google-labs-code/stitch-skills`
(`stitch-design`, `stitch-build`, `stitch-utilities`) are installed and enabled
for this project in `.claude/settings.json` under `enabledPlugins`. Reinstall
or update with:

```
npx plugins add google-labs-code/stitch-skills --scope project --target claude-code
```

Plugin *content* is cached globally in `~/.claude/plugins/`; only the
enablement is project-scoped. They cover roadmap item 4 — `code-to-design`,
`generate-design`, `shadcn-ui`, `react-vite-dashboard`, `extract-design-md`.

### Hooks

Both files in `.claude/hooks/` must stay **executable**. A hook that loses its
`+x` bit does not error — it silently stops running, and `guard-bash.sh` is
what blocks shell writes to `.env` and `git add .env`. Verify with
`ls -l .claude/hooks/`; self-test by piping a JSON payload into the script.

This repo has **`core.fileMode = false`**, so git ignores the on-disk `+x`
bit: a `chmod +x` followed by `git add` still stages the file as `100644`,
and a fresh clone gets a hook that never runs. Any new executable therefore
needs `git update-index --chmod=+x <file>`, and `git ls-files --stage` is the
only honest check — `ls -l` shows the working tree, not what git recorded.

## Architecture

```
POST /api/scan     → paths.resolve_within_roots()  400 if outside MEDIA_ROOT
                   → scanner.get_media_files()  walk + magic-byte filter
                   → parser.parse_filename()    guessit → title/year/S/E
                   ← MediaItem[] (no network calls, fast)

POST /api/analyze  → analyzer.enrich_media_item()
                     ├ TMDBClient.search_movie()      movies
                     └ TVDBClientV4.search_series()   series + per-episode
                                                      translations
                     → matching.rank_candidates() → matching.decide()
                     → format_smart_title() → sanitize_name()
                   ← MediaItem + proposed_name, status, confidence, candidates[]

POST /api/rename   → paths.resolve_rename_target()  containment + bare-name check
                   → Path.rename(), one item at a time, per-item status

GET  /api/config   ← roots, languages, cache stats, thresholds, key presence
GET  /api/keys     → TMDBClient.verify_key() ‖ TVDBClientV4.verify_key()
                   ← {tmdb, tvdb}: ok | invalid | missing | unreachable + detail
DEL  /api/cache    → drops every cached API payload (raw responses only)
```

`/api/analyze` takes three overrides as query parameters: `forced_key`,
`match_threshold` and `review_threshold`. The thresholds are per-request rather
than server state, so two concurrent analyses cannot disagree about which bands
were in force; an impossible pair is a `400` rather than being clamped, because a
silently corrected threshold makes the UI report a band that is not the one
applied.

The frontend calls `/api/analyze` **once per file**, through a pool of six
(`ANALYZE_CONCURRENCY` in `App.tsx`, `lib/pool.ts`). The backend has no cap of
its own and `api_clients.py` opens a fresh `httpx.AsyncClient` per request, so
the six is the only thing bounding the fan-out. Keep that in mind before adding
more per-item network calls.

**A re-analysis clears the row first.** The client sends the whole `MediaItem`
back, previous answer included, so `enrich_media_item` resets `proposed_name`,
`status`, `confidence`, `message` and `candidates` before it starts. Without
that, an analysis that finds nothing — a stale `forced_key`, a hand-edited title
that no longer matches — returned the *earlier* name and status unchanged and the
row still read as decided. Found against the live API, pinned by
`test_a_refused_reanalysis_does_not_return_the_previous_proposal`.

### Candidates and the hand-picked match

`MediaItem.candidates` carries every candidate that was scored, best first, with
the one the name was built from flagged `selected`. It costs nothing: the poster,
the blurb and the scores all come out of the search payload that was fetched
anyway. Confidence is not a fix for two shows called *One Piece* — no threshold
tells them apart, only the user can — so the list is populated even on rejected
rows, which are precisely the rows whose alternatives are needed.

The list is the **full title ranking**, including candidates the episode evidence
eliminated. That is the same lesson as `elimination_is_trustworthy`: TVDB's
arc-sized seasons mean a real `S01E10` is missing from the series it belongs to,
so the eliminated candidate can be the right answer and may not be hidden.

Sending a candidate's `key` back as `forced_key` settles the match by hand:
scoring and episode evidence both stand down, confidence is 1.0 and the message
says `Chosen by hand: …`, so a row settled by a human stays distinguishable from
one the scoring was sure of. A key that is no longer in the results is a
**rejection**, never a silent re-score — falling back to whatever the scoring now
prefers would rename the file to a title nobody chose.

Replaying one choice across a whole series is therefore free: the search is
cached on the title and `get_series_extended` on the id, so the second and
subsequent episodes make no request at all.

### Files that matter

- `backend/analyzer.py` — the naming pipeline. `LOWERCASE_WORDS`,
  `ITALIAN_ELISIONS`, `CONTRACTION_SUFFIXES`, `format_smart_title()`,
  `sanitize_name()`, `parse_episode_range()`. **Highest-risk file in the repo.**
- `backend/matching.py` — confidence scoring. Decides *which* API result a file
  belongs to, and whether that decision is trustworthy enough to rename
  unattended. Pure and offline, so the thresholds are pinned by tests rather
  than by whatever the live API returned that day.
- `backend/paths.py` — containment. Every client-supplied path goes through it;
  nothing else may build a path from request data.
- `backend/api_clients.py` — TMDB/TVDB clients, `diskcache`, retry, per-key
  `asyncio.Lock`, and `calculate_padding()`.
- `backend/parser.py` — thin `guessit` wrapper; normalises multi-episode
  lists to a `"10-12"` string and rejoins `alternative_title` onto the title.
- `naming_cases.toml` / `backend/naming_cases.py` — the hand-written
  `file → expect` list and its loader. See **Naming cases** below.
- `frontend/src/lib/validation.ts` — row validation. A row that fails
  `isRowValid` cannot be selected, so it cannot be renamed. This is the last
  gate before the filesystem; keep these functions pure and tested.
- `frontend/src/lib/gridReducer.ts` — **the whole keyboard model**, as one pure
  reducer: focus, type-to-edit, selection, fill-down, undo. Every key the grid
  receives becomes an action here, so behaviour is tested without a DOM. Editing
  an *input* field drops the row to `pending` and clears its candidates; editing
  `proposed_name` does not, because that is a decision rather than staleness.
- `frontend/src/lib/columns.ts` — the column model the reducer and the renderer
  share. They must agree on order and editability: a reducer that thinks column
  3 is the year while the header says season is silent data corruption.
- `frontend/src/lib/languages.ts` — ISO 639-1 validation for the language chain.
  The only place a bad code can be caught: both providers answer one by falling
  back rather than by erroring.
- `frontend/src/lib/bands.ts` — the two confidence thresholds and the rule that
  they cannot cross. Pure, so the pair the backend rejects is pinned by a test.
- `frontend/src/lib/series.ts` — groups episodes by normalised title, mirroring
  `matching.normalize_title`, so one triage answer settles a whole season.
  Grouped on the title and never on the matched id, because the rows needing the
  fix are exactly the ones pointing at the wrong series.
- `frontend/src/components/Grid.tsx` — TanStack Table + `@tanstack/react-virtual`.
  Rendering and key routing only; no behaviour.

### Padding rule

Episode zero-padding is derived from **that season's** episode count, not from a
constant and not from the series total: `calculate_padding()` returns 2 below 100
episodes, otherwise `len(str(count))`. Season is always 2 digits.

`get_series_extended` exposes `season_episode_counts` (`{season: count}`) for this;
`analyzer.py` looks up the item's own season, defaulting to season 1 when the
filename has none. One Piece has 1236 episodes overall but 8 in season 1, so
`S01E10` is correct and the old `S01E0010` was not — it does not match the folder
Plex already has. A season that genuinely exceeds 99 episodes still pads wide;
under TVDB's default order One Piece really does have several (S11 = 99,
S13 = 100, S17 = 118, S21 = 194).

**TVDB's default order splits long anime into arc-sized seasons.** Verified
2026-08-12: One Piece season 1 is the 8-episode Romance Dawn arc, not the
61-episode East Blue saga an earlier note here claimed. The consequence reaches
past padding — a file legitimately named `S01E10` has *no* counterpart in the
series it belongs to, which is why episode presence is weak evidence when
telling two candidates apart (see below).

**Unexpected padding is usually evidence of a wrong API match, not a padding bug.**

### Filesystem containment

`backend/paths.py` is the only place allowed to turn client input into a path.
Everything the app reads or renames must resolve inside a configured root:
`MEDIA_ROOT` (default `/media`, the container side of the compose bind mount) and,
when the automatic-move feature lands, `LIBRARY_ROOT`. It is a *list* so that
adding the destination library is configuration, not a rewrite.

Do not confuse `MEDIA_ROOT` with the `MEDIA_DIR` in `.env`: the latter is the
**host** path compose mounts onto `/media`, and the backend never reads it.
A local `uvicorn` therefore needs `MEDIA_ROOT` set explicitly — see the `dev`
skill — or every scan returns `400`.

Containment is checked on the **resolved** path, which is what makes it hold
against `..`, against an absolute path from the client, and against a symlink out
of the tree. `resolve_rename_target` additionally requires a bare filename and
returns both ends of the rename, so the caller cannot re-derive the source from
the unchecked string.

## The UI

Rebuilt from nothing in the redesign, because the tool it replaced was a Google
Sheet: not pretty, but operable entirely from the keyboard, and that fluency is
the feature. MUI, `@mui/x-data-grid`, emotion, framer-motion and dnd-kit are all
gone; the runtime dependencies are React plus `@tanstack/react-table` and
`@tanstack/react-virtual`. The bundle went from ~1 MB to 258 kB.

One screen, full-bleed, no sidebar: a 44px command bar over the grid. Everything
else — triage, settings, keymap, command palette, the rename confirmation — is an
overlay that `Esc` returns from.

**The keyboard model is spreadsheet, not modal.** Bare printable keys always type
into the focused cell, so every command is a modifier chord (`Ctrl+K` palette,
`Ctrl+Enter` rename, `Ctrl+R` scan, `Ctrl+D` fill-down, `Ctrl+G` triage,
`Ctrl+Shift+G` triage this row, `Ctrl+,` settings, `Ctrl+/` keymap). The one place
bare letters and digits are free is **triage**, where nothing is being typed:
`1`–`9` pick a candidate, `A` toggles apply-to-series, `S` skips. Chords are matched
and rendered from the same string (`lib/keymap.ts`, `lib/shortcuts.ts`), so the help
cannot drift from the behaviour.

**A chord the browser keeps is not a chord.** Triage was on `Ctrl+T`, which Chrome
and Firefox answer with a new tab *without delivering the event*, so
`preventDefault()` never runs and there is nothing the page can do about it. It is on
`Ctrl+G` now — nominally "find again", preventable, and meaningless with no find bar
open. `lib/shortcuts.test.ts` fails if any of the reserved chords comes back. The
opposite failure is just as real and has no feature test either: scan was also bound
to `Ctrl+Shift+S`, which never arrives at all on this user's keyboard layout, so the
"safe" alternative was the one that did not work. Scan is `Ctrl+R` alone.

**Status is a dot, never a word** (`StatusDot.tsx`), and the dots differ by *fill*
as well as hue — solid, hollow, dashed, crossed, ticked — so the state survives a
colour-blind reader and a bad monitor. The word is still there as the accessible
name. Selection is a 3px amber left edge, which keeps the dot the only circle on
the row and removes the need for a checkbox column.

**Triage is where a season gets settled in one keystroke.** The pick travels back
as `forced_key`, not as a finished name, so the backend still builds the title,
padding and episode titles: one decision across twenty-four files cannot produce
twenty-four subtly different conventions. Movies are deliberately not grouped. It is
a window over the grid, not a screen — the rows behind it are the context for the
decision, and a full-bleed takeover hid them.

**`Ctrl+Shift+G` triages the focused row whatever the scoring made of it.** The
queue only holds what the scoring *admitted* it could not settle, and the match most
in need of correcting is often the one it was sure of: `One Piece - 1015.mkv` is
`matched` at 1.00 and wrong. So the row-local entry ignores status and asks only
whether there is anything to choose between (`candidates`, which is populated on
every analyzed row). `openTriage` falls back to it when the row under the cursor is
not in the queue, so `Enter` on a settled status dot does the useful thing.

**There is one bulk action, and it is the rescan.** No "match everything again"
button exists, and none should be added. A match can now be changed by hand —
triage picks a candidate, editing a cell re-derives the row — and a bulk re-match
would walk over exactly those decisions, handing a chosen answer back to the
scoring that had already got it wrong. What remains is deliberate and narrow:

- `Ctrl+R` rescans, which re-reads the directory and matches what it finds. It
  starts from nothing and says so; a scan never leaves rows unmatched, because
  with the bulk re-match gone there would be no way to match them afterwards.
- Editing an input cell drops the row to `pending` and re-matches **that row**,
  on the edited value. The reducer reports which rows went stale
  (`GridState.staleRowIds`) and the shell drains it; fill-down therefore
  re-matches every row it filled. Editing `proposed_name` does not — writing the
  name by hand is a decision, not staleness.

**The settings panel refuses what it cannot detect later.** Four sections, and each
one is a way to be wrong that produces no error anywhere downstream:

- **Languages** are tokens, not a comma-separated string, and each is checked against
  ISO 639-1 as it is typed (`lib/languages.ts`). A bad code is silent otherwise —
  TMDB answers an unknown `language` with untranslated results and TVDB 404s the
  translation and falls through — so `en,itt` just quietly stops being Italian.
  Clicking a chip promotes it to the front, which is the only ordering that matters
  in a fallback chain. Apply is disabled while a code is bad or the list is empty.
- **Confidence** is one track with two thumbs that cannot cross (`lib/bands.ts`,
  `ThresholdSlider.tsx`). `review > match` is a `400` from `/api/analyze` on every
  row, which reads as "the app is broken"; making it unreachable beats validating it.
  The three bands are painted in the colours of the row states they produce.
- **API keys** are one icon each, checked live against `GET /api/keys` on open and on
  demand. `/api/config` only ever said whether a key was *set*, and a set-but-revoked
  key presents as "Could not find a match" on every row — indistinguishable from a
  genuine no-match. Four states, because `unreachable` must never be read as
  "rotate your key"; DNS on this network has failed exactly that way.
- **Cache** is a readout and a button.

There is no **Behaviour** section any more. "Tick confident matches" duplicated what
the match threshold already means, and two controls over one behaviour let the
threshold describe something the app was not doing. "Ignore the cache" was a
permanent switch for a one-off need — emptying the cache is the same thing, done
once, instead of making every future scan pay for one stale answer. `bypass_cache`
survives as a backend parameter; the frontend no longer sends it.

Design tokens are in `src/styles/tokens.css` and are the only place a raw colour
is written. The shape language is squared — 3px corners, no pills — and amber is
the single accent, so amber always means "the thing you are acting on". The one
exception to "amber is the only accent" is the confidence track, where the three
bands *are* the information.

## Roadmap

Planned, not yet built. Design new code so it doesn't have to be undone:

1. **Automatic rename on download** — a watcher that processes new files
   without a user in the loop.
2. **Automatic move into the existing Plex library** — derive the destination
   folder (`Show/Season 01/`, `Movies/Title (Year)/`) and move the file there.
3. **Rollback journal** — every automatic rename and move must be recorded in
   a durable, machine-readable log so the whole operation can be reversed.
   This is the safety net for 1 and 2 and should land with them, not after.
4. ~~**UI/UX redesign**~~ — done; see **The UI** above.

Consequence for today's code: prefer pure functions that compute a target path
from a `MediaItem` over code that renames inline. Anything that mutates the
filesystem should be one thin, easily journaled layer.

## Measured behaviour against the live APIs

Run `live-check` (`.claude/skills/live-check/`) to reproduce. Against the sixteen
media fixtures in `test_media/`, on 2026-08-12, with `lang=it,en`, through the
**container**: **7 auto-selected, 7 held for review, 2 unmatched — and nothing is
confidently wrong.** That last clause is the number that matters; an earlier run
proposed more names but two of them were wrong *and* labelled `"matched"`.

| Fixture | Proposed | Status |
| --- | --- | --- |
| `Breaking Bad S02E10-12.mkv` | `Breaking Bad - S02E10-E12 - Game Over - Mandala - Phoenix.mkv` | `matched` 1.00 — correct |
| `The Matrix \| Reloaded \| 2003.mkv` | `Matrix Reloaded (2003).mkv` | `matched` 1.00 — correct; the year now outranks the shorter *The Matrix* |
| `Star Wars The Empire Strikes Back - 1980.mp4` | `L'Impero Colpisce Ancora (1980).mp4` | `matched` 0.91 — correct; scored against `original_title`, since the IT title no longer resembles the filename |
| `Le Fabuleux Destin d'Amélie Poulain (2001).mkv` | `Il Favoloso Mondo di Amélie (2001).mkv` | `matched` 1.00 — correct, and the same `original_title` path: the IT title shares no word with the filename |
| `Stargate SG-1/Season 1/Stargate SG-1 S01E01.mkv` | `Stargate SG-1 - S01E01 - I Figli degli dei (1).mkv` | `matched` 1.00 — renamed in place, inside the subdirectory. Was `Stargate Sg-1` until the acronym rule landed |
| `The.Office.US.S03E11.…-GROUP.mkv` | `The Office (US) - S03E11 - Rientro dalle Vacanze.mkv` | `matched` 1.00 — guessit strips the whole release tail *and* the `US`, so the UK original is not excluded by the search; the year in the API's name is what settles it |
| `One Piece - 1015.mkv` | `One Piece - S10E15 - Le Interferenze di Foxy.mkv` | `matched` 1.00 — **and wrong.** guessit reads absolute episode 1015 as S10E15, the API answers about S10E15, and confidence is high because nothing downstream can know better. Fix season and episode in the grid and the row re-matches |
| `Doctor Who S05E01.mkv` … `S05E04.mkv` | `Doctor Who - S05E0n - The Tomb of the Cybermen (n).mkv` | `review` 0.50 ×4 — 1963 and 2005 are indistinguishable from these filenames. One triage pick settles all four |
| `One Piece S01E10 I'm Luffy.mkv` | `One Piece (2023) - S01E10 - I'm Luffy.mkv` | `review` 0.50 — anime and live action tie. Was silently wrong |
| `SpongeBob SquarePants S01E01-03.mkv` | `Spongebob - S01E01-E03 - Cercasi Aiuto - L'Aspira Reef - Tè Sotto l'Albero.mkv` | `review` 0.50 — two TVDB records tie, the second being the RU-named duplicate. Was `matched` |
| `Il Trionfo dell'Amore (1998).mp4` | `Il Trionfo dell'Amore (2001).mp4` | `review` 0.55 — found by retrying without the year filter. Flags the 1998/2001 disagreement |
| `BrBa S01E02.mkv` | — | `error` — the closest thing to `BrBa` is *La Brea*, and the scoring says so instead of renaming to it |
| `all'ombra dell'olmo (2010).avi` | — | `error` — TMDB returns no candidate at all |

`One Piece - 1015.mkv` is the one row here that is confidently wrong, and it is
worth keeping that way: it is the only fixture that demonstrates what the UI is
*for*. No amount of scoring recovers it — the parse is wrong before the API is
ever asked — so the answer has to come from the user, and the grid is where it
comes from.

### Capitalisation

`format_smart_title` title-cases, so it used to destroy acronyms: TVDB returns
`Stargate SG-1` and the file was renamed `Stargate Sg-1`, into a folder Plex does
not have. A word the *source* wrote in full capitals is now left alone — `SG-1`,
`(US)`, `Rocky II` — unless the whole title is capitals, which is shouting rather
than an acronym and is still title-cased (`THE MATRIX` → `The Matrix`).

### How the scoring works

`matching.py`, and it is deliberately dull: `score = title_similarity ×
year_factor`. Titles are compared accent-folded and punctuation-stripped, across
*every* name a candidate is known by — TMDB's `original_title`, TVDB's aliases
and translations. The anime One Piece is only reachable that way: its primary
TVDB name is `ワンピース`.

Confidence is the leader's score **damped by how close the runner-up is**. That
is the whole idea: being sure of the title is not being sure of the series, and
two candidates called *Doctor Who* cancel each other out however good they look
alone. A tie halves the score, which lands it in `review`.

Three bands: `≥ 0.75` → `matched` and auto-selected; `0.45–0.75` → `review`,
name proposed but the row must be ticked by hand; below → no name, with the
reason in `message`.

**The year is evidence, not a hint.** It multiplies rather than boosts, so a
disagreement scales a perfect title down (`0.55` at two years out). TMDB's `year`
parameter is a *filter*, so when it excludes everything the search is retried
without it and the year is judged by scoring instead — which is how the *Trionfo
dell'Amore* fixture found a candidate at all. The parsed year is still overwritten
by the API's, but only after it has been scored against, so a disagreement costs
confidence instead of being laundered into a self-consistent wrong name. It is
also reported in `message`.

**Episode presence is weak evidence, and is fenced accordingly.** When candidates
tie on title, up to three are checked for whether they actually carry the
requested season/episode. Two rules keep that from backfiring, both learned the
hard way on live data:

- A failed `get_series_extended` is **not** evidence of absence. Counting it as
  one lets a network blip hand the match to whichever candidate answered.
- Evidence may break a tie between equals but may **never promote a weaker
  title**. Without that rule, One Piece matched a parody called *None Piece* at
  0.95 — the anime's season 1 stops at episode 8 under TVDB's default order, so
  the *correct* series was the one eliminated. That was strictly worse than the
  defect being fixed.

Padding remains a useful tell: unexpected padding usually means a wrong match,
not a padding bug. It is a quieter tell than it was — per-season counts put
almost everything at 2 digits.

## Known defects

Tracked so they aren't rediscovered. Each has a test.

- Nothing calls `load_dotenv()`. The keys reach the app only through
  `docker-compose.yml`, so a locally started `uvicorn` has none — and
  `enrich_media_item` guards on `if ... and tmdb_key`, so every row comes back
  `status="error"` with `"Could not find a match"`. That message is
  indistinguishable from a genuine no-match, which is why a missing key
  presents as an API problem rather than a configuration one. Source `.env`
  manually; see the `dev` skill.
- `diskcache` is created at the relative path `.cache`, so in the container it
  resolves to `/app/.cache`, which is not a volume — **the API cache is lost
  on every redeploy.**
- `_search_locks` grows without bound.
- `CORSMiddleware` uses `allow_origins=["*"]` together with
  `allow_credentials=True`, which the CORS spec disallows.

`T201` (no `print()`) is muted in `pyproject.toml` because `api_clients.py`
still logs via `print`. Converting to structured logging is a prerequisite for
the rollback journal; re-enable the rule in that commit.

## Conventions

- Python: ruff-formatted, 120 columns, double quotes. Type hints on new public
  functions. `dict[str, X]` / `X | None`, not `Dict` / `Optional`.
- TypeScript: 4-space indent, `strict` on. Don't reintroduce `any` — the
  eslint rule is off, that isn't an invitation.
- Tests live next to the code: `backend/test_*.py`, `frontend/src/**/*.test.ts`.
- `.env` may be **read** — real TMDB/TVDB calls are how the naming pipeline
  gets validated against live data. It must never be **written**, and a key
  must never reach a tracked file, a log, a commit or a chat message. Both are
  enforced: `Edit`/`Write` on `.env` are denied in `.claude/settings.json`, and
  `.claude/hooks/guard-bash.sh` blocks shell redirects into it and any
  `git add` that names it. Add new configuration keys to `.env.example`,
  `docker-compose.yml` and the `README.md` table together.
- The version string now lives **only** in `frontend/package.json`. The
  redesigned shell does not print one — the two copies had drifted (`v1.9.0` vs
  `1.0.0`) and a version rendered in the corner of a single-user home-lab app
  was not worth a second source of truth. Releases are cut by pushing a `v*`
  tag, which triggers the GHCR build and the Portainer webhook.

## Testing this app for real

`test_media/` holds sixteen deliberately awkward media files and one that is
deliberately not media. Each one is there to break something specific:

| Fixture | What it exercises |
| --- | --- |
| `Breaking Bad S02E10-12.mkv`, `SpongeBob SquarePants S01E01-03.mkv` | multi-episode ranges, and the padding derived from the season's own count |
| `The Matrix \| Reloaded \| 2003.mkv` | a pipe splitting the title into `alternative_title` |
| `Star Wars The Empire Strikes Back - 1980.mp4` | a year with no parentheses; a match found through `original_title` |
| `Il Trionfo dell'Amore (1998).mp4`, `all'ombra dell'olmo (2010).avi` | elided Italian articles, and a year the API disagrees with |
| `Le Fabuleux Destin d'Amélie Poulain (2001).mkv` | accents, an elision, and an IT title that shares nothing with the filename |
| `Doctor Who S05E01.mkv` … `S05E04.mkv` | **a series.** Four rows, one ambiguity (1963 vs 2005), settled by one triage pick applied to the whole series |
| `One Piece S01E10 I'm Luffy.mkv` | an anime/live-action tie, and a season 1 that stops at episode 8 |
| `One Piece - 1015.mkv` | absolute numbering, which guessit misreads as S10E15 — fixed by hand in the grid, not by the scoring |
| `BrBa S01E02.mkv` | an abbreviation nothing can resolve; the title is corrected in the grid and the row re-matches |
| `The.Office.US.S03E11.1080p.WEB-DL.x264-GROUP.mkv` | scene naming — dots, resolution, source, codec, release group — and an acronym |
| `Stargate SG-1/Season 1/Stargate SG-1 S01E01.mkv` | a nested directory: the scan recurses and the rename stays put |
| `appunti.txt` | not media. The magic-byte filter must skip it whatever its extension says |

**It is a committed fixture directory: never let a rename run against it.**
`backend/test_parser.py` pins the exact `parse_filename` output for every media
fixture and asserts the scan sees exactly those files, so a rename that rewrote
them would show up as a failing suite rather than as a quietly changed fixture
set. Adding a fixture without adding its expectation fails
`test_every_fixture_is_pinned`, which is deliberate. If you do rename against it
by accident, `git checkout test_media/`.

### Trying the container against the fixtures

Rename it *is* the thing worth testing, so the container gets a throwaway copy
instead:

```
scripts/sandbox-media.sh                                  # reset sandbox/media from test_media/
MEDIA_DIR="$PWD/sandbox/media" docker compose up -d --build
```

`sandbox/` is gitignored. The `MEDIA_DIR` override is not optional and not
cosmetic: without it compose reads the one in `.env`, which points at the real
Plex library. Re-run the script to start from clean fixtures again; the app is
on <http://localhost:8080>.

### Naming cases — the ones found while using it

`naming_cases.toml` at the repo root is a hand-edited list of `file` → `expect`
pairs. The fixtures above test what we thought of; this file is where a name
that came out wrong **during real use** is written down, in one `[[case]]`
block, before anything is fixed. It is the user's own input channel — treat an
entry there as a bug report with the reproduction already attached.

```
[[case]]
file   = "One Piece - 1015.mkv"
expect = "One Piece - S20E63 - ….mkv"
note   = "absolute numbering; guessit reads it as S10E15"
status = "review"          # optional: matched | review | error
lang   = ["it", "en"]      # optional, default it,en
forced_key = "81797"       # optional: replays a triage pick
```

`expect = ""` is a real expectation — "the app must refuse to name this" — and
is often the right one. Two consumers share one loader (`backend/naming_cases.py`),
so a case cannot mean one thing offline and another live:

| | Command | Answers |
| --- | --- | --- |
| Offline, in the suite | `.venv/bin/python -m pytest backend/test_naming_cases.py` | *Could* this case pass? |
| Live, on demand | `.venv/bin/python scripts/check-naming-cases.py` | Does it? |

The split is the point. The offline test never touches the network; it catches
the unsatisfiable case — a `?` or `:` that `sanitize_name` strips, a changed
extension, an episode name expected from a filename guessit reads as a movie.
Those look exactly like a wrong API match in a live run, and the hunt then
starts in the wrong file. The live script sources `.env` itself (nothing in
`backend/` calls `load_dotenv`), runs the cases serially, exits non-zero on any
mismatch, and on failure prints the ranked candidates with their keys — so a
case that only needs `forced_key` can be closed by pasting one number.

Neither one touches the filesystem: a case is a filename, never a file, so it
may describe something that only exists on the NAS.
