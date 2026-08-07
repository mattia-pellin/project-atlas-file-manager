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
venv/bin/python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8001
```

**The `. ./.env` is required.** Nothing in `backend/` calls `load_dotenv()` —
in production the keys are injected by `docker-compose.yml`, so a bare
`uvicorn` starts with none of them. `enrich_media_item()` guards on
`if ... and tmdb_key`, so with no key it silently leaves every row `pending`
and reports no error at all. That failure looks exactly like "the API is
down".

8001 is not arbitrary: `frontend/vite.config.ts` proxies `/api` to
`http://127.0.0.1:8001`. If you change the port, change the proxy too.

Port 8000 is what the container serves in production, where the built
frontend is mounted as static files by `backend/main.py`. In dev, Vite serves
the frontend instead, so 8000 stays free.

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
- `MEDIA_DIR` decides what the app scans. Make sure it does **not** point at
  the real Plex library during a manual test; `test_media/` is the fixture
  directory, and it must never be renamed against.

## Report

The two URLs, the health-check result, and how to stop the processes.
