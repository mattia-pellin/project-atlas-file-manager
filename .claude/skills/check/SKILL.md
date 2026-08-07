---
name: check
description: Run the full quality gate - ruff lint and format check, backend pytest, frontend eslint, tsc and vitest - and report exactly what passed and what failed. Use before committing, before a release, and whenever asked to verify the repo is green.
argument-hint: "[backend|frontend]  (default: both)"
allowed-tools: Bash, Read, Grep, Glob
---

# Quality gate

Run every check, then report. Do **not** stop at the first failure — a red
lint must not hide a red test.

`$ARGUMENTS` may narrow the scope to `backend` or `frontend`. Empty means both.

## Backend

Run from the repo root. The interpreter is the root `.venv/`, managed by uv
from `uv.lock` — not the system python. If it is missing, `.venv/bin/uv sync`
recreates it (bootstrap in CLAUDE.md).

```bash
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m pytest
```

Expected baseline: ruff clean, and pytest reporting **33 passed, 2 xfailed**.

The two `xfailed` are correct. They are strict markers pinning two known
`format_smart_title` defects (the missing `"the"` in `LOWERCASE_WORDS`, and
`str.title()` breaking the saxon genitive). If either flips to `XPASS` the
suite fails — that means someone changed naming behaviour, which is a finding,
not something to paper over by deleting the marker.

## Frontend

```bash
cd frontend && npm run lint
cd frontend && npm run typecheck
cd frontend && npm test
```

Expected baseline: all clean, 32 vitest tests passing.

If `node_modules` is missing, run `npm ci` first and say so in the report —
don't silently skip the frontend half.

## Report

State each command's result on its own line with the actual counts. Then:

- If everything is green, say so in one sentence and stop.
- If something failed, quote the relevant part of the output, name the
  `file:line`, and diagnose. Fix only what the user asked you to fix; a gate
  run on its own is a report, not a licence to change code.
- Never call the suite green without having run it. Never infer a result from
  a previous run in the conversation.
