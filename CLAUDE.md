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
is `venv/` at the root. (A duplicate `backend/venv/` used to exist and was
removed — if it reappears, something recreated it in the wrong directory.)

| Task | Command |
| --- | --- |
| Full quality gate | `/check` (or see the four commands below) |
| Backend lint | `venv/bin/python -m ruff check .` |
| Backend format | `venv/bin/python -m ruff format .` |
| Backend tests | `venv/bin/python -m pytest` |
| Frontend lint | `cd frontend && npm run lint` |
| Frontend types | `cd frontend && npm run typecheck` |
| Frontend tests | `cd frontend && npm test` |
| Dev servers | `/dev` |
| Install dev deps | `venv/bin/python -m pip install -r requirements-dev.txt` |

The dev backend runs on **:8001** (Vite proxies `/api` there, see
`frontend/vite.config.ts`); the production container serves both on **:8000**.

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
them into one with different SHAs. There are deliberately **no stored git
credentials on this machine**: no helper, no SSH key, no Git Credential
Manager, and `~/.git-credentials` is removed after use. A push therefore needs
a credential supplied for that one invocation and erased straight after with
`git credential reject`. That is the user's credential and their decision:
**ask which method they want, and do not pick one for them.**

For a single-file change that has no history worth preserving (a doc fix, a
version bump), skip all of that: commit it straight to the branch with the
MCP's `create_or_update_file`, then `git pull --ff-only` locally. The repo is
public, so fetching and pulling need no credential at all.

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
POST /api/scan     → scanner.get_media_files()  walk + magic-byte filter
                   → parser.parse_filename()    guessit → title/year/S/E
                   ← MediaItem[] (no network calls, fast)

POST /api/analyze  → analyzer.enrich_media_item()
                     ├ TMDBClient.search_movie()      movies
                     └ TVDBClientV4.search_series()   series + per-episode
                                                      translations
                     → format_smart_title() → sanitize_name()
                   ← MediaItem with proposed_name

POST /api/rename   → Path.rename(), one item at a time, per-item status
```

The frontend calls `/api/analyze` **once per file, all in parallel**
(`App.tsx`, `handleScan`). There is no concurrency cap on either side, and
`api_clients.py` opens a fresh `httpx.AsyncClient` per request. Keep this in
mind before adding more per-item network calls.

### Files that matter

- `backend/analyzer.py` — the naming pipeline. `LOWERCASE_WORDS`,
  `format_smart_title()`, `sanitize_name()`. **Highest-risk file in the repo.**
- `backend/api_clients.py` — TMDB/TVDB clients, `diskcache`, retry, per-key
  `asyncio.Lock`, and `calculate_padding()`.
- `backend/parser.py` — thin `guessit` wrapper; normalises multi-episode
  lists to a `"10-12"` string.
- `frontend/src/lib/validation.ts` — row validation. A row that fails
  `isRowValid` cannot be selected, so it cannot be renamed. This is the last
  gate before the filesystem; keep these functions pure and tested.
- `frontend/src/components/MediaTable.tsx` — editable DataGrid, keyboard
  handling (space to select, F2 to edit, ctrl+C/V).

### Padding rule

Episode zero-padding is derived from the series' total episode count, not from
a constant: `calculate_padding()` returns 2 below 100 episodes, otherwise
`len(str(total))`. One Piece (1100 episodes) yields `S01E0001`. Season is
always 2 digits.

## Roadmap

Planned, not yet built. Design new code so it doesn't have to be undone:

1. **Automatic rename on download** — a watcher that processes new files
   without a user in the loop.
2. **Automatic move into the existing Plex library** — derive the destination
   folder (`Show/Season 01/`, `Movies/Title (Year)/`) and move the file there.
3. **Rollback journal** — every automatic rename and move must be recorded in
   a durable, machine-readable log so the whole operation can be reversed.
   This is the safety net for 1 and 2 and should land with them, not after.
4. **UI/UX redesign** — full rework of the visual language and of the
   interaction model, prioritising usability.

Consequence for today's code: prefer pure functions that compute a target path
from a `MediaItem` over code that renames inline. Anything that mutates the
filesystem should be one thin, easily journaled layer.

## Measured behaviour against the live APIs

Run `live-check` (`.claude/skills/live-check/`) to reproduce. Against the eight
fixtures in `test_media/`, on 2026-08-07, with `lang=it,en`:
**6 proposed, 2 unmatched — and of the 6, only 3 are correct.**

| Fixture | Proposed | Verdict |
| --- | --- | --- |
| `Breaking Bad S02E10-12.mkv` | `Breaking Bad - S02E10-12 - Game Over - Mandala - Phoenix.mkv` | correct (bar the `E12` vs Plex's `E-E12`) |
| `Star Wars The Empire Strikes Back - 1980.mp4` | `L'Impero Colpisce Ancora (1980).mp4` | correct — year-less filename and IT translation both handled |
| `SpongeBob SquarePants S01E01-03.mkv` | `Spongebob - S01E001-003 - Cercasi Aiuto - L'Aspira Reef - Tè Sotto l'Albero.mkv` | correct-ish; TVDB's IT series name drops "SquarePants", which will not match an existing Plex folder |
| `Doctor Who S05E01.mkv` | `Doctor Who - S05E001 - The Tomb of The Cybermen (1).mkv` | **wrong series** — matched the 1963 classic run, not the 2005 revival. Also shows the `The` defect |
| `One Piece S01E10 I'm Luffy.mkv` | `One Piece (2023) - S01E10 - I'M Luffy.mkv` | **wrong series** — the Netflix live-action, not the 1999 anime. Also shows the apostrophe defect |
| `The Matrix \| Reloaded \| 2003.mkv` | `Matrix (1999).mkv` | **wrong film** — `parse_filename` drops everything after the first pipe, so it searches `The Matrix` and loses 2003 |
| `Il Trionfo dell'Amore (1998).mp4` | — | unmatched |
| `all'ombra dell'olmo (2010).avi` | — | unmatched |

The three wrong matches are all the same root cause: `results[0]` with no
confidence scoring and **no use of the year the filename already provides**,
while `status` is set to `"matched"` regardless. This is the highest-value fix
available, and it is a prerequisite for the automatic-move roadmap item — an
unattended run would file *Doctor Who* under the wrong series.

Note the padding interaction: `Doctor Who` gets `E001` and `One Piece (2023)`
gets `E10`, both derived from the *matched* series' episode count. Unexpected
padding is usually evidence of a wrong match, not a padding bug.

## Known defects

Tracked so they aren't rediscovered. Each has a failing or `xfail` test.

- `format_smart_title` capitalises **"the"** mid-sentence — the word is
  missing from `LOWERCASE_WORDS` in `analyzer.py`.
  `"the lord of the rings"` → `"The Lord of The Rings"`.
  Test: `backend/test_naming.py::test_the_stays_lowercase_mid_sentence`.
- `format_smart_title` breaks the **English saxon genitive** — `str.title()`
  uppercases the letter after an apostrophe.
  `"a bug's life"` → `"A Bug'S Life"`.
  Test: `backend/test_naming.py::test_saxon_genitive_stays_lowercase`.
- `parser.format_episode` emits `"N-N"` for a single-element episode list,
  which `isEpisodeValid` then rejects because it requires `start < end`.
- `parse_filename` **truncates at the first pipe**. `"The Matrix | Reloaded |
  2003"` yields `clean_title="The Matrix"` with no year, so the search finds
  the 1999 film. `sanitize_name` maps `|` to `" - "` on the way out, but
  nothing preserves it on the way in.
- Nothing calls `load_dotenv()`. The keys reach the app only through
  `docker-compose.yml`, so a locally started `uvicorn` has none — and
  `enrich_media_item` guards on `if ... and tmdb_key`, so it returns every row
  `pending` with no error. Source `.env` manually; see the `dev` skill.
- `POST /api/rename` joins `proposed_name` onto the original parent directory
  without rejecting path separators or `..`, and `/api/scan` accepts any
  directory. Accepted for now: the container sits behind Traefik/Pangolin with
  Google SSO, so this is a correctness risk (a bad path scatters files), not
  an exposure. It becomes blocking the moment the automatic-move feature
  lands.
- `diskcache` is created at the relative path `.cache`, so in the container it
  resolves to `/app/.cache`, which is not a volume — **the API cache is lost
  on every redeploy.**
- API matching always takes `results[0]` with no confidence scoring, and marks
  the item `"matched"` regardless.
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
- The version string appears in `frontend/src/App.tsx` and
  `frontend/package.json`. They are currently out of sync (`v1.9.0` vs
  `1.0.0`); keep them together when bumping. Releases are cut by pushing a
  `v*` tag, which triggers the GHCR build and the Portainer webhook.

## Testing this app for real

`test_media/` holds eight deliberately awkward fixture files — multi-episode
ranges, pipes in the title, elided Italian articles, a year with no
parentheses. Point a scan at it to exercise the parser end to end. **It is a
committed fixture directory: never let a rename run against it** unless you
intend to change the fixtures, and restore them with `git checkout test_media/`
if you do.
