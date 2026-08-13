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
| Container, against that copy | `GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build` |

The dev backend runs on **:8001** (Vite proxies `/api` there, see
`frontend/vite.config.ts`); the production container serves both on **:8000**
internally and is **published on :8080** (`PORT` in `.env`, left side of the
compose mapping only — the `EXPOSE`/`CMD` port in the image stays 8000).

**The library is a mount, not a variable, and its container side is fixed at
`/media`.** There is no `MEDIA_DIR` any more: it was a host path in `.env`, it
pointed at the real Plex library, and every `docker compose up` that forgot to
override it mounted that library read-write. The rule was "never run the command
without the override", which is a rule a person has to remember every single time.

The committed `docker-compose.yml` now mounts `./sandbox/media` — the throwaway copy
of `test_media/` — so the default is the safe one and touching the real library takes
a deliberate `docker-compose.override.yml` (gitignored, merged automatically,
volumes merged by target). Do not add one here. See *Trying the container against
the fixtures* below.

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
| `github` | remote HTTP, `api.githubcopilot.com/mcp/` | A PAT in `GITHUB_MCP_PAT`, sent as `Authorization: Bearer`. A **fine-grained** PAT works — verified, 52 tools, scoped to this repo only. Toolsets pinned via `X-MCP-Toolsets`; `actions`, `dependabot`, `code_security` and `secret_protection` are *not* in the default set and must stay listed explicitly. |
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

**Dependabot, code scanning and secret scanning are all live on this repo** and
the PAT already reads all three — verified 2026-08-13. The `security-review`
agent starts from them rather than from `npm audit`. Read the triage rule in
`.claude/agents/security-review.md` before quoting a count at anyone: on that
date 26 of the 27 open Dependabot alerts were `scope: development` in
`frontend/package-lock.json`, and the image ships the built bundle, so they are
not in the running container. The number that meant something was **one**.

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
                     └ TVDBClientV4.search_series()   series
                       TVDBClientV4.get_episode_names() every episode title,
                                                      one request per series
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

`/api/analyze` takes four overrides as query parameters: `forced_key`,
`absolute_episode`, `match_threshold` and `review_threshold`. The thresholds are
per-request rather than server state, so two concurrent analyses cannot disagree
about which bands were in force; an impossible pair is a `400` rather than being
clamped, because a silently corrected threshold makes the UI report a band that is
not the one applied. `absolute_episode` below 1 is a `400` for the same reason.

The frontend calls `/api/analyze` **once per file**, through a pool whose size
is a setting (`Settings.analyzeConcurrency`, default **10**, `lib/pool.ts`). The
backend has no cap of its own and `api_clients.py` opens a fresh
`httpx.AsyncClient` per request, so that one number is the only thing bounding
the fan-out — which is why it is validated rather than clamped
(`isPoolSize`, `POOL_LIMITS` = 1–100, in `lib/settings.ts`) and why the panel
refuses a value instead of correcting it. Keep it in mind before adding more
per-item network calls: each one multiplies by the pool size.

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
says `Scelto a mano: …`, so a row settled by a human stays distinguishable from
one the scoring was sure of. A key that is no longer in the results is a
**rejection**, never a silent re-score — falling back to whatever the scoring now
prefers would rename the file to a title nobody chose.

Replaying one choice across a whole series is therefore free: the search is
cached on the title and `get_series_extended` on the id, so the second and
subsequent episodes make no request at all.

That last sentence used to be true only in serial. The replay goes through the
same pool as everything else, so N episodes hit the same *empty* cache entry at
once and all N fetched it — the entry is read before the request and written
after, and nothing held that window. Every cached lookup in `api_clients.py` is
now wrapped in `single_flight(cache_key)`: the first caller fetches, the rest
wait on its lock and then read what it stored. It matters most for
`get_series_extended`, which paginates the whole episode list and is asked for up
to `MAX_DISAMBIGUATION_CANDIDATES` times per row — a 24-file pack fetched it 72
times. The lock entries are refcounted and dropped by the last waiter out.

It is a **request-count** fix, not a latency one: the rows that wait would
otherwise have fetched in parallel and finished at about the same time. The
latency shows up indirectly, in not tripping the provider's rate limit and the
five-attempt exponential backoff behind it. `backend/test_single_flight.py`
pins the counts, gating the first request open so the assertion cannot pass with
the lock removed.

**Episode titles are fetched per series, not per episode.** The single flight
above fixed the calls that *repeat*; this was the one that genuinely *scaled* —
`/episodes/{id}/translations/{lang}` ran once for every episode being renamed, so
a season pack paid it once per file. `get_episode_names()` uses TVDB's
`/series/{id}/episodes/default/{lang}`, which serves the whole series' localised
list from one paginated endpoint, keyed by episode id.

Verified against live TVDB before the swap, because three things had to hold and
none of them is documented: the translated payload is field-for-field the
untranslated one (`absoluteNumber`, `id`, `seasonNumber` all present, so
`episodes_raw` and `locate_absolute_episode` are untouched); an untranslated
episode comes back `name: null` rather than silently falling back to English; and
that null falls exactly where the per-episode endpoint answered 404. So the
language chain is preserved rather than approximated — a later language fills
only the titles an earlier one left blank, and an id absent from the map means the
default name off `episodes_raw` stands, which is what a `None` used to mean.

Measured A/B on thirteen `Doctor Who S05E*` rows, cold cache, pool of 10 —
identical proposed names both times:

| | Before | After |
| --- | --- | --- |
| `/episodes/{id}/translations/{lang}` | 26 | 0 |
| `/series/{id}/episodes/default/{lang}` | 0 | 4 |
| **Total TVDB requests** | **38** | **16** |

Note the 26: thirteen episodes × two languages, because classic Who has no Italian
titles, so every episode paid the fallback too. The four are one series × two
languages × two pages.

`enrich_media_item` builds the map once for the *chosen* series, after the
absolute-number check — so a refused row spends nothing, and the candidates the
scoring rejected never trigger it. One asymmetry is deliberately preserved: a
*translated* title goes through `format_smart_title`, a default name off
`episodes_raw` does not. It predates this change and it decides the exact string
on disk, so `test_episode_names.py` pins both sides of it.

### Absolute episode numbers

`absolute_episode` is the other correction that can only be made once the series is
known. `One Piece - 1015.mkv` is S21E124 — but only in *that* One Piece, so the number
cannot be resolved in the parser, in the grid or anywhere before a candidate has been
chosen. It therefore travels with the pick, and `locate_absolute_episode()`
(`analyzer.py`) looks it up in the chosen series' own `episodes_raw`.

Three properties, each with a test in `test_candidates.py`:

- It is resolved **after** the match and **before** the padding, because the padding
  is sized from the season the number turns out to fall in.
- A number the series does not carry is an `error`, never the nearest episode.
  Renaming to a neighbouring episode is the one outcome worse than not renaming.
- **Specials are skipped.** Season 0 shares the absolute sequence in some TVDB
  records, so an absolute number can land on a recap special; that is never what the
  filename meant.

The resolved season and episode are written back onto the item, so the grid's `S` and
`E` columns show the numbers the name was built from rather than the ones guessit
misread. And because an absolute number names exactly one episode, it stands the
apply-to-series replay down — the checkbox goes dead while the field holds a number.

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
- `backend/api_clients.py` — TMDB/TVDB clients, `diskcache`, retry,
  `single_flight()`, `get_episode_names()` and `calculate_padding()`.
- `backend/parser.py` — thin `guessit` wrapper; normalises multi-episode
  lists to a `"10-12"` string and rejoins `alternative_title` onto the title.
- `naming_cases.toml` / `backend/naming_cases.py` — the hand-written
  `file → expect` list and its loader. See **Naming cases** below.
- `frontend/src/lib/validation.ts` — row validation. A row that fails
  `isRowValid` cannot be selected, so it cannot be renamed. This is the last
  gate before the filesystem; keep these functions pure and tested. It is one
  function, `rowRefusal`, returning the sentence the grid prints — `isRowValid`
  is `rowRefusal(row) === null`. A boolean plus a message written elsewhere
  drifts, and the refusals do not share a fix.
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

`MEDIA_ROOT` is the **container** side of the mount and is pinned to `/media` by
`docker-compose.yml`, which is why the host path is chosen in the `volumes:` entry
and nowhere else. It stays a variable for exactly one case: a local `uvicorn`, where
`/media` does not exist and every scan would return `400` — see the `dev` skill.

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

**The bar has one gap, `--space-2`, and everything in it is that far apart** — brand,
path box, each of the three verbs, each of the two icons. The slack goes to the path
box (`.bar-path { flex: 1 1 auto }`), which is the only thing in the bar that can use
it: a directory is long, a verb is as wide as its word.

Two other distributions were tried and are wrong. `margin-left: auto` on the verbs is
the first: an auto margin swallows the whole free space *before* flex-grow is
considered, so the path box never grows and the slack piles up as one gap in front of
Scansiona. `justify-content: space-evenly` on a grown `.bar-actions` is the second —
it does make every opening equal, but spreading three buttons across half the bar
reads as three unrelated controls that happen to share a row rather than as a group.

Scansiona is *outside* the path form and reaches it with `form="scan-form"`:
associating by id rather than moving the input keeps `Enter` in the path box scanning,
which is how the directory is normally submitted. The two icon buttons are `.bar-tools`,
pinned right and out of the verbs' rhythm — they open a panel, they are not verbs.

**Progress is shown inside the verb that started it, and nowhere else.** While the pool
is running, Scansiona reads `Analisi 07/16`, turns amber (`.button.is-busy:disabled`) and
is disabled; Riabbina and Rinomina do the same for their own work (`Busy.verb` in
`CommandBar.tsx` says which button owns the label, `App.tsx` sets and clears it). The
button is therefore both the indicator and the interlock: a second scan cannot be started
over the first, and there is no separate progress element.

That element existed and was wrong. A `.bar-busy` div between the path box and the verbs
appeared when work started and disappeared when it ended, so the three buttons slid
sideways twice per scan — and `.bar-busy:empty { display: none }` was needed on top,
because an empty flex item still costs the bar's gap on both of its sides.

Nothing moves now, and the mechanism is **not** a hand-measured `min-width` — that was
the first attempt and it was already too narrow for `Analisi 100/236`, so the button
grew mid-scan and pushed the two beside it sideways, which is the reflow the whole
change was meant to end. Each verb instead renders **every state it can be in**
underneath the real one, hidden, in the same grid cell (`Verb` in `CommandBar.tsx`,
`.verb` / `.verb-ghost`): the box is the widest of them by construction and cannot fall
out of date when a label is reworded. Every count in that list is `888` — three digits,
so a library up to 999 files never resizes the bar — and the running count is padded to
the total's width (`padStart`, `white-space: pre`), so `9/16 → 10/16` does not widen it
either. Amber rather than the disabled grey, because grey says "there is nothing here to
press" and this says "it is working".

**The idle labels move too**, which the first version of that list missed: it held only
the busy labels, so Triage still grew as its pip appeared and went one digit to two while
the scan filled the grid behind it, and Rinomina grew as the confident rows were ticked.
The face and the ghost are built by one function per verb (`scanFace`, `triageFace`,
`renameFace`) called with the real count and with `888`, so the two cannot drift, and
`CommandBar.test.tsx` counts the reserved slots.

**The third icon is Informazioni** (`AboutOverlay.tsx`), and it exists for one check: a
container was just rebuilt, so is the tab in front of me the new bundle? The version
alone cannot answer that — the image is rebuilt far more often than it is tagged — so the
panel leads with the **build number**, which moves on every change, and prints the commit
and the build time beside it. Deliberately no chord: it is consulted after a deploy, not
during the work, and the free `Ctrl`+letter chords are spent.

**The UI is in Italian**, because its one user is. Only what the user reads is
translated: code, comments, commit messages and test names stay English. The
backend's `message` and `detail` strings *are* read by the user — they are printed on
the row and in triage — so they are Italian too, and the pytest assertions that pin
them were translated in the same commit. That is the rule: a message is part of the
naming pipeline's contract, so it changes **in the backend with its test**, never by
being rewritten in the frontend. Every score inside one goes through
`matching.percent()`, which mirrors `frontend/src/lib/format.ts` half-up rounding
included, so a message and the `C.S.` column cannot print one confidence two ways.

**The keyboard model is spreadsheet, not modal.** Bare printable keys always type
into the focused cell, so every command is a modifier chord (`Ctrl+K` palette,
`Ctrl+Enter` rename, `Ctrl+R` scan, `Ctrl+D` fill-down, `Alt+G` triage,
`Ctrl+G` triage this row, `Alt+C` flip movie/episode, `Ctrl+,` settings,
`Ctrl+/` keymap, `F2` edit the focused cell). The one place
bare letters and digits are free is **triage**, where nothing is being typed:
`1`–`9` pick a candidate, `↑`/`↓` walk the list and `Enter` takes the one under the
cursor, `←`/`→` walk the queue, `A` toggles apply-to-series, `S` skips. Chords are
matched and rendered from the same string (`lib/keymap.ts`, `lib/shortcuts.ts`), so
the help cannot drift from the behaviour.

**Vertical is the candidates, horizontal is the files**, and they used to be one
gesture. That was wrong in the case triage is reached from most: `Ctrl+G` builds a
one-row queue, so the arrows had nowhere to walk and the overlay felt inert. The same
`event.target instanceof HTMLInputElement` guard the grid uses for cells applies —
with the cursor in the search box an arrow is a caret and the overlay stands down.

**An overlay opened by chord has to take the DOM focus with it.** Triage used to
appear while the focus stayed on the grid, which then kept answering the arrows
underneath it. The panel is `tabIndex={-1}` and takes focus on open — into the search
box instead when there is nothing to choose from, since that is the only thing to do
on such a row — and `App.tsx` blurs the grid whenever `mode` leaves `'grid'`.

**A chord something above the page keeps is not a chord**, and two layers do it.
The browser: triage was on `Ctrl+T`, which Chrome and Firefox answer with a new tab
*without delivering the event*, so `preventDefault()` never runs and there is nothing
the page can do about it. And, on this machine, the **AMD driver overlay**, which eats
`Ctrl+Shift+G` the same way — it never reaches the browser at all, so no amount of
web-platform knowledge predicts it. Neither is feature-detectable, because in both
cases nothing arrives; the only defence is the reserved list in
`lib/shortcuts.test.ts`, which fails if any of them comes back. The opposite failure
is just as real: scan was also bound to `Ctrl+Shift+S`, which never arrives at all on
this user's keyboard layout, so the "safe" alternative was the one that did not work.
Scan is `Ctrl+R` alone.

That is why the two triage entries are `Alt+G` (queue) and `Ctrl+G` (this row): the
plain modifier goes to the row-local one because it is the entry reached most often,
and `Ctrl+G` is nominally "find again" — preventable, and meaningless with no find bar
open.

The type flip is `Alt+C` for the same reason from the other side: every useful
unshifted `Ctrl+letter` is gone — `Ctrl+T` the browser keeps, `Ctrl+E` is the omnibox,
`Ctrl+M` mutes the tab in Firefox and `Ctrl+Shift+M` is its responsive-design mode,
which devtools take before the page sees them — and a bare letter is not available
because bare printable keys type into the cell. It flips the focused row from *any*
column (`cycleChoice` takes an explicit `column`), because the cursor is essentially
never parked on Type when the type turns out to be wrong, and the wrong type means the
wrong API was asked entirely.

**Status is a dot, never a word** (`StatusDot.tsx`), and the dots differ by *fill*
as well as hue — solid, hollow, dashed, crossed, ticked — so the state survives a
colour-blind reader and a bad monitor. The word is still there as the accessible
name. Selection is a 3px amber left edge, which keeps the dot the only circle on
the row and removes the need for a checkbox column.

The dot is drawn on a 12-unit grid and painted at 14px, so the geometry stays
comparable with the strokes everywhere else while the glyph grows; `.status-dot` is
`width: 100%; height: 100%`, so what the pointer has to hit is the whole status cell
rather than the circle inside it.

Two of the seven states are **client-side only** and the backend must never be told
about them: `analyzing`, set only on the rows actually in flight through the pool, and
`renaming`. Both spin. `analyzing` is the pending ring set turning, plus a centre dot
pending does not have — motion alone would make the two indistinguishable in a
screenshot, which is the same failure the fill rule exists to prevent. It is steel
rather than amber because it is only asking a question; `renaming` is writing to the
library. `analyzeAll` posts the *untouched* item, so the invented status never leaves
the browser.

**A row with no name to rename to cannot be ticked** — not by hand, not by `Ctrl+A`,
not by `Shift+Arrow`, because all three go through `isRowValid`. Two cases join the
malformed cells there: a `proposed_name` that is empty (the API found nothing, or the
cell was blanked by hand), and one *equal to the name on disk*. The tick is what the
user reads as "this file is going to be written", so a tick that would write nothing is
a lie about the size of the batch — and it also kept the confirmation's tally from being
checkable, which is now the only thing that panel shows. `Ctrl+A` says how many rows it
left out rather than silently ticking fewer.

The refusal names the cause, since only one of the three has a red cell to look at:
`Nessun nome proposto …`, `Il file è già nominato così …`, or `… correggi prima le celle
evidenziate`. `cellIsInvalid` in `Grid.tsx` deliberately does *not* paint a cell for the
first two — nothing in the row is wrong.

**A file already named the way this app would name it comes back `success`, from the
backend** (`enrich_media_item`, `"Già nominato così — niente da rinominare"`). It is a
rename that has already happened, not one that is waiting: `matched` left it sitting in
the same state as the forty rows that do need writing, and it got auto-ticked with them
even though `resolve_rename_target` would refuse it. The confidence is kept — how sure
the match was is still worth reading. The status is part of the analysis answer, so it
is decided in the backend with its test (`backend/test_renaming.py`), never patched into
the frontend.

**The order is one comparator, and it is applied on demand** (`lib/sort.ts`,
`gridReducer` `setRows`/`sort`): movies before episodes, then title, year, season,
episode. The comparator is total — it falls through to the on-disk name and then the id
— so rows cannot swap places on an unrelated re-render. Sorting is *not* done in
`mergeRows`: analysis rewrites the very fields the order is built from (a title becomes
its Italian one, a year is corrected by the API), so re-sorting on each concurrent
answer shuffles the grid under someone typing in it.

It is not done at the end of a batch either, which was the first attempt. Correcting a
title re-matches that one row, and the re-sort that followed jumped it somewhere else
in the grid — the cursor was left on whatever row had slid into that position, so the
next keystroke edited the wrong file. **The only automatic sort is after a scan**, when
every row is new and nothing has been typed yet. Otherwise the reorder is a button in
the **status column header** (`.head-sort`, also in the palette), pressed when the
order is what you want rather than because a row changed.

**Confidence has its own column, `C.S.`, with the explanation attached to it.** It was
a badge floated inside `proposed_name`, competing for the same pixels and vanishing as
soon as the name was long. The info button opens `ConfidenceOverlay`, which is given the
thresholds *in force* rather than the defaults, and which spends most of its length on
the two counter-intuitive parts: a perfect title can score 50% because the runner-up
matched as well, and 100% can still be wrong (`One Piece - 1015.mkv`). Its heading is
right-aligned over the percentages, like `S` and `E`; the specimens inside it
(`.help-example`) are marked as code but stay **inline**, like a backtick in a chat,
because `ワンピース` and a filename are the argument the sentence is making. Lifting
them into boxes of their own — the first attempt — broke the sentences around them.

**Alignment is a property of the quantity, and the heading follows the values** unless
it reads worse there (`ColumnSpec.align` / `headerAlign`, `lib/columns.ts`). The year is
centred on both halves: four digits always, so there are no ragged edges to line up and
nothing is gained by pinning it right, while a heading sitting over a column that does
not share its alignment reads as a mistake. `S`, `E` and `C.S.` stay right-aligned
because their values *are* ragged.

**Editing happens on the text that is already there.** The editor used to be a bordered
input on its own background, inset in the cell, so a second rectangle appeared and its
padding shifted every character one notch right the moment you pressed a key — the value
you were correcting moved as you started correcting it. It is now transparent, borderless
and flush; the focused cell's amber ring and the caret are the whole affordance.

**Shift+Arrow draws a vertical cell range, and one paste fills all of it**
(`rangeRowIds`, `writeRange`, the `pasteCell` action). Twenty-four episodes of the same
show mean the same title typed twenty-four times otherwise. The range is anchor-to-focus
in the *focused column only* — there is no horizontal range, because the columns hold
unrelated quantities and a rectangular paste across them has no meaning here. `writeRange`
refuses a non-editable column outright rather than dropping the write silently, since it
is the last gate before a value that reaches the backend. Paste and `Delete` act on the
range; fill-down prefers it when it spans more than one row and otherwise falls back to
the ticked rows. Every write in a range is **one undo**.

The same `Shift+Arrow` still ticks the valid rows it passes, so the range and the rename
queue are drawn by one gesture but stay two things: the ticks are what will be renamed
and can hold rows nowhere near the cursor, the range is what was just drawn. The range is
painted `--signal-amber-dim` and only when it spans more than one row — a single cell
already has its focus ring, and the ring must keep winning in the cascade.

**Columns are draggable from the header** (6px handle, double-click restores the model's
width) and every value is clipped with an ellipsis and repeated in a `title`, so a
truncated Plex name is still readable. A dragged column stops growing — the user asked
for that many pixels. Widths are component state and are deliberately not persisted.

**Triage is where a season gets settled in one keystroke.** The pick travels back
as `forced_key`, not as a finished name, so the backend still builds the title,
padding and episode titles: one decision across twenty-four files cannot produce
twenty-four subtly different conventions. Movies are deliberately not grouped. It is
a window over the grid, not a screen — the rows behind it are the context for the
decision, and a full-bleed takeover hid them.

**`Ctrl+G` triages the focused row whatever the scoring made of it.** The
queue only holds what the scoring *admitted* it could not settle, and the match most
in need of correcting is often the one it was sure of: `One Piece - 1015.mkv` is
`matched` at 1.00 and wrong. So the row-local entry ignores status and asks only
whether the row has been analyzed at all. `openTriage` falls back to it when the row
under the cursor is not in the queue, so `Enter` on a settled status dot does the
useful thing.

**Triage also searches by hand, and a row with no candidates is precisely why.**
`BrBa S01E02.mkv` and `all'ombra dell'olmo (2010).avi` come back with an empty list
and used to arrive here with nothing to do about it — so `needsTriage` queues every
`review` and `error` row, candidates or not, and the overlay opens with the cursor in
the search box when there is nothing to choose from. The query is not a new endpoint:
it re-runs `/api/analyze` with the typed title and year (`api.searchCandidates`) and
keeps only `candidates`, so the ranking, the scores, the posters and the blurbs stay
one implementation and the row's own `media_type` is the provider filter for free —
TMDB for a movie, TVDB for an episode, which the overlay names. A row whose type is
`unknown` disables the search and points at `Alt+C`, because `enrich_media_item`
would re-parse the filename and discard the typed title.

**The typed title travels with the pick.** `forced_key` is resolved *inside the
results of a search on the row's own `clean_title`*, so a key found under
"Breaking Bad" is simply absent from the results for "BrBa" and would be treated as a
rejection. `TitleOverride` is therefore sent alongside the candidate and written onto
the affected rows before re-analysis. The converse matters as much: picking from the
row's *own* candidate list must not carry an override, or triage would rewrite a title
nobody asked to change. Both directions are pinned in `TriageOverlay.test.tsx`.

**The absolute episode number is the third field, and it is here for the same reason
the pick is.** `One Piece - 1015.mkv` cannot be corrected in the grid — S21E124 is only
true of the One Piece the user is about to choose — so the number is typed in triage
and sent as `absolute_episode` with the pick. It is deliberately *outside* the search
form: it is not a query, it is part of the answer. Both corrections travel in one
`PickExtras` and stay distinct inside it — `override` is row fields, spread onto the
items before re-analysis; `absolute` is a question only the backend can answer. See
**Absolute episode numbers** above for what happens to it there.

**The confirmation is a tally, not a list** (`ConfirmRename.tsx`). It counts the batch
by kind — two tiles, an icon each, the number at 26px — and warns, in rust, that the
rename cannot be undone. That is the whole panel.

It used to print the exact old and new name of every file, on the grounds that a wrong
name raises no error and the string is the only thing that can actually be checked.
**That check has not gone anywhere: the grid is the list.** `Nome proposto` is one of
its columns, it is sorted, it is where those names were read and corrected in the first
place, and it is still on screen behind the scrim. Reprinting forty lines here only
pushed the count and the warning off the top of the panel, which is the one thing this
screen has that the grid does not. So do not re-add the list — the useful summary is
the one the grid cannot give: "two films and thirty-eight episodes" is checkable
against what the user meant to tick, where "forty files" is not, and a kind with
nothing in it is left out entirely because "0 film" is the one number nobody needs to
read.

The irreversibility warning is shown on **every** batch, not only a doubtful one: a
confident match renamed onto the wrong path is exactly as permanent as a doubtful one.
When rows *are* doubtful it gains a second line, in ochre, saying how many and sending
the user back to the grid to read their names. Confirming is `Ctrl+Enter` — the chord
that opened the dialog also closes it, so a rename decided from the keyboard never
needs the mouse — and `App.tsx` stands its own binding down while `mode === 'confirm'`
so the two cannot both fire. Deliberately not bare `Enter`: the confirm button already
has the focus for anyone who wants that, and a modifier is the right cost for a write
to a Plex library.

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

- **Scan** holds the starting directory and, beside it, **how many files are analysed
  at once**. It sits there rather than in a section of its own because nothing else
  bounds the fan-out: the pool size *is* how hard TMDB and TVDB are hit, and a
  provider that starts rate-limiting produces rows that failed for no visible reason —
  indistinguishable from a genuine no-match, the same failure mode as a revoked key.
  So the field is validated (1–100, whole numbers) and Apply is dead while it is wrong.
  It is held as text while being typed, because a number input is momentarily empty
  when a two-digit value is replaced.
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
- **API keys** and **Cache** share one row, split `1fr 2fr`: two short labels with their
  status icons pushed to the right edge of the box need no more, and the width they give
  up goes to the four cache tiles, laid out two by two so each lines up with a key row
  beside it. The keys are one icon each, checked live against `GET /api/keys` on open and on
  demand. `/api/config` only ever said whether a key was *set*, and a set-but-revoked
  key presents as "Nessuna corrispondenza trovata" on every row — indistinguishable from a
  genuine no-match. Four states, because `unreachable` must never be read as
  "rotate your key"; DNS on this network has failed exactly that way.

Every score the UI prints is a **percentage**, from one helper (`lib/format.ts`). It
used to be `0.50` in the grid, `0.45` on the threshold thumbs and `50%` in triage —
three renderings of one quantity, so the threshold that decided a row could not be
compared by eye with the row's own number.

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
ever asked — so the answer has to come from the user. It now takes one field:
`Ctrl+G`, type `1015` in **N° assoluto**, pick the series, and the backend maps it
to S21E124 off that series' own episode list. Correcting `S` and `E` by hand in the
grid still works and still requires knowing the answer first.

### Capitalisation

`format_smart_title` title-cases, so it used to destroy acronyms: TVDB returns
`Stargate SG-1` and the file was renamed `Stargate Sg-1`, into a folder Plex does
not have. A word the *source* wrote in full capitals is now left alone — `SG-1`,
`(US)`, `Rocky II` — unless the whole title is capitals, which is shouting rather
than an acronym and is still title-cased (`THE MATRIX` → `The Matrix`).

**Every episode title goes through it, whichever of the three sources won** — the
localised name from `get_episode_names`, the default name off `episodes_raw`, or the
one guessit read out of the filename. The default name used to skip it, so a series
TVDB carries in Italian got one convention and the same series without got another:
`DEATH ON THE NILE` was written shouting in English and title-cased in Italian, on
neighbouring rows of the same season. It moves nothing in the sixteen fixtures —
TVDB's default names are already title-cased there — which is exactly why the rule
had to be pinned by a test rather than by a live run
(`test_one_capitalisation_rule_whichever_source_the_title_came_from`).

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
  `status="error"` with `"Nessuna corrispondenza trovata"`. That message is
  indistinguishable from a genuine no-match, which is why a missing key
  presents as an API problem rather than a configuration one. Source `.env`
  manually; see the `dev` skill.
- `diskcache` is created at the relative path `.cache`, so in the container it
  resolves to `/app/.cache`, which is not a volume — **the API cache is lost
  on every redeploy.**
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
- The version string lives **only** in `frontend/package.json`, and it is read
  from there (`src/buildinfo.ts` imports it) rather than copied. The two copies
  had drifted badly — the published line was already at `v1.9.0` while
  `package.json` still said `1.0.0` — which is why the redesign is versioned
  **2.0.0**, continuing the tags rather than the stale file.
  Note that `v1.0.0`–`v1.9.0` exist as tags only: no GitHub *Release* object was
  ever cut from them. `v2.0.0` is the first with one, so `list_releases` returns
  exactly that one entry and says nothing about the nine before it —
  `git ls-remote --tags origin` remains the honest check for what was tagged.
  Creating a release needs the REST API: the GitHub MCP is read-only there
  (`get_latest_release`, `get_release_by_tag`, `list_releases`, and no create).

### Versioning and commits: bump and commit yourself, tag only when asked

Every change carries its own version bump **and its own commit**, made with the
change rather than swept up later, without being asked:

- **Build.** `BUILD` in `frontend/src/buildinfo.ts`, `+1`, on **every** change
  that reaches the browser. It is the identifier the Informazioni panel leads
  with, and the only thing that tells two builds of one version apart. A change
  that is backend-only does not need it; anything under `frontend/src/` does.
- **SemVer.** `version` in `frontend/package.json`, sized to the change:
  *patch* for a fix or an internal tidy-up, *minor* for anything the user gains
  or that changes how the UI behaves, *major* for a change that invalidates how
  the tool is used or breaks the API contract. Re-run
  `npm install --package-lock-only` so `package-lock.json` follows.
- **Commit.** One local commit per thing the user asked for, as soon as that
  thing works and its gate is green — not one commit at the end of a session.
  The bump belongs *in* that commit: `BUILD 7` and the change that earned it
  are the same fact, and splitting them leaves a build number in history that
  points at nothing. The subject says what changed and why it is different, not
  which files moved (`fix(ui): hold the verb widths so the bar stops jumping`,
  not `update CommandBar.tsx`). Do not push and do not `git add .env`.
- **Reload the container**, so the change can actually be tried. A gate that is
  green says the code does what its tests say; it does not say the thing feels
  right, and a visual change in particular cannot be signed off from a test
  run. Rebuild after every change that reaches the app — frontend *or* backend,
  since one container serves both — and say in the reply that it is up and what
  to look at. A docs-, agent- or CI-only change has nothing to reload; say that
  instead of skipping it silently.

  ```
  GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build
  ```

  The mount needs no flag: the compose file points at `sandbox/media` on its own.
  `GIT_SHA` is optional,
  but pass it anyway: it is what lets the Informazioni panel name the commit,
  which is the whole point of reloading for someone else to check. Do **not**
  re-run `scripts/sandbox-media.sh` as part of a reload — the fixtures are only
  reset when they are dirty, and doing it automatically throws away whatever was
  half-triaged in the tab that is open.

Granularity is the point. This repo's history has several commits worth of work
squashed into one — `feat(ui): the third review round` is sixty-five files —
and that commit cannot be read, reverted, or bisected against. A rename that
scatters a Plex library is found by asking *which change did this*, so the
answer has to be one change.

**Do not tag.** A `v*` tag is a deploy — it triggers the GHCR build and the
Portainer webhook — so cutting one is the user's decision. Say which tag the
current version implies and wait for an explicit yes. Everything up to that
point (bumping, committing, pushing the branch) is ordinary work.

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
docker compose up -d --build
```

`sandbox/` is gitignored, and `./sandbox/media:/media:rw` is what the committed
compose file mounts — so the fixtures copy is the *default* and reaching a real
library takes a deliberate override. Re-run the script to start from clean fixtures
again; the app is on <http://localhost:8080>.

### Naming cases — the ones found while using it

`naming_cases.toml` at the repo root is a hand-edited list of `file` → `expect`
pairs. The fixtures above test what we thought of; this file is where a name
that came out wrong **during real use** is written down, in one `[[case]]`
block, before anything is fixed. It is the user's own input channel — treat an
entry there as a bug report with the reproduction already attached.

```
[[case]]
file   = "One Piece - 1015.mkv"
expect = "One Piece - S21E124 - ….mkv"
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
