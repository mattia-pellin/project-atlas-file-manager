---
name: dev
description: Start the local development environment - the FastAPI backend with reload on port 8001 and the Vite dev server on 5173 - and report the URLs. Use when the user wants to run or manually try the app locally.
allowed-tools: Bash, Read
---

# Start the dev environment

Two processes. Start both **in the background** and report the URLs; do not
block the session waiting on either.

## 1. Backend — port 8001

```bash
set -a; . ./.env; set +a
MEDIA_ROOT="$PWD" .venv/bin/python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8001
```

**`MEDIA_ROOT` is required locally.** `backend/paths.py` refuses any scan or
rename outside it, and it defaults to `/media` — the container path, which does
not exist on this machine. Without it every scan returns `400`. Pointing it at
the repo root lets you scan `test_media/`; point it at a real directory to try
the app against real files.

**The `. ./.env` is required.** Nothing in `backend/` calls `load_dotenv()` —
in production the keys are injected by `docker-compose.yml`, so a bare
`uvicorn` starts with none of them. `enrich_media_item()` guards on
`if ... and tmdb_key`, so with no key every row comes back `status="error"`
with `"Could not find a match"` — indistinguishable from a genuine no-match,
which is why a missing key looks exactly like "the API is down".

8001 is not arbitrary: `frontend/vite.config.ts` proxies `/api` to
`http://127.0.0.1:8001`. If you change the port, change the proxy too.

Port 8000 is what the container serves in production, where the built
frontend is mounted as static files by `backend/main.py` — published on the
host as 8080. In dev, Vite serves the frontend instead, so both stay free.

## 2. Frontend — port 5173

```bash
cd frontend && npm run dev
```

Run `npm ci` first if `node_modules` is absent.

## Before reporting success

- Confirm the backend actually came up: `curl -s http://127.0.0.1:8001/api/health`.
  A backend that died on a missing env var fails silently otherwise.
- Reading `.env` is allowed, so you can diagnose a missing or malformed key
  directly. **Never echo a value** — into the terminal, a file, or your reply.
  Report `TVDB_PIN is empty`, not the key itself.
- `MEDIA_ROOT` bounds what the app can scan and rename. Make sure it does
  **not** point at the real Plex library during a manual test; `test_media/`
  is the fixture directory, and it must never be renamed against. (`MEDIA_DIR`
  in `.env` is a different thing: the host path compose bind-mounts onto
  `/media`. It has no effect on a local `uvicorn`.)
- To try a **rename**, run `scripts/sandbox-media.sh` and point `MEDIA_ROOT` at
  the `sandbox/media` copy it prints. That is the whole reason the copy exists:
  a rename against `test_media/` rewrites committed fixtures.

## Report

The two URLs, the health-check result, and how to stop the processes.
