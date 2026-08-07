---
name: live-check
description: Run the naming pipeline against the live TMDB and TVDB APIs and report the names it would actually produce. Use to validate a naming change against real API data, to check the match rate, or when a proposed name looks wrong and you need to know whether the parser or the API match is at fault. Read-only - it never renames.
argument-hint: "[directory]  (default: test_media)"
allowed-tools: Bash, Read, Grep, Glob
---

# Live pipeline check

`backend/test_naming.py` pins pure string transforms. It cannot catch a wrong
**match** — the API returning the 2023 live-action series instead of the 1999
anime produces a perfectly well-formed name for the wrong show. This is the
only check that catches that class of error.

## Run it

```bash
set -a; . ./.env; set +a
.venv/bin/python ${CLAUDE_SKILL_DIR}/probe.py $ARGUMENTS
```

Sourcing `.env` is required — nothing in `backend/` calls `load_dotenv()`, and
with no key the analyzer returns every row as `status="error"` / `"Could not
find a match"`, which reads as a genuine no-match. The probe checks for the
three keys up front and refuses to run without them.

Reading `.env` is allowed. **Never print a value**, here or in your reply.

`--cache` reuses `diskcache` instead of forcing fresh calls. Default is a real
round trip, which is what you want after changing anything in the pipeline.

## Interpreting the output

Each entry shows the parse before the API call and the proposal after it, so
the two failure modes are distinguishable:

- **`parsed:` is wrong** → the defect is in `backend/parser.py` or `guessit`.
  Season, episode or title were lost before any network call happened.
- **`parsed:` is right and the name is still wrong** → the defect is the API
  match or the formatting. `analyzer.py` takes `results[0]` with no confidence
  scoring and marks the item `matched` regardless, so a wrong series looks
  exactly like a right one.

Watch specifically for:

- A series matched to the wrong adaptation or the wrong era. Compare the year
  in the proposal against the year in the original filename.
- `The` capitalised mid-title, and `'S` / `'M` after an apostrophe. Both are
  known `format_smart_title` defects with `xfail` tests; seeing them here
  confirms they reach real filenames.
- Episode padding wider than expected — that is `calculate_padding()` working
  from the matched series' total episode count, so unexpected padding is
  usually evidence of a wrong match rather than a padding bug.

## Rules

- **Never point it at the real Plex library** with any intent to rename. It is
  read-only by construction, but the directory argument is the only guard.
- `test_media/` is safe: the probe only reads. `guard-bash.sh` blocks anything
  that would write to it.
- Report the match rate (`N proposed, M without a usable name`) and list each
  wrong proposal with the correct expected name. Don't fix anything unless
  asked — a change to the naming pipeline goes through `naming-guardian`.
