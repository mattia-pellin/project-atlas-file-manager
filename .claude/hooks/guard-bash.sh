#!/usr/bin/env bash
# PreToolUse hook for Bash. Refuses the three shell commands that cause damage
# this project cannot easily undo:
#
#   1. mutating the committed test fixtures,
#   2. running the rename endpoint against a real media library,
#   3. writing .env, or getting a secret into git.
#
# Reading .env is deliberately allowed - real TMDB/TVDB calls are how the
# naming pipeline gets validated. What must never happen is a key landing in a
# tracked file.
set -uo pipefail

CMD=$(jq -r '.tool_input.command // empty')
[[ -z "$CMD" ]] && exit 0

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# 1. Destructive filesystem commands aimed at the fixtures.
if grep -Eq '(rm|mv|rename|truncate|shred)\b[^|;]*test_media' <<<"$CMD"; then
  deny "test_media/ is a committed fixture directory. Renaming or deleting its files silently breaks the parser tests. Copy it to a scratch directory first, or use 'git checkout test_media/' to restore."
fi

# 2. curl against the rename endpoint - the one call that touches the filesystem.
if grep -Eq 'curl[^|;]*/api/rename' <<<"$CMD"; then
  deny "POST /api/rename writes to the filesystem. Exercise it through the UI, or against a scratch copy of test_media/, not with a raw curl from an agent."
fi

# .env.example is the committed template and is meant to be edited and staged.
# Blank it out first so the rules below - which match `.env` and every
# `.env.<suffix>` variant - do not fire on it.
CMD_ENV=${CMD//.env.example/}

# 3a. Any write to .env. Reading is fine; editing is not, and the Edit-tool
#     deny rule in settings.json does not cover a shell redirect.
if grep -Eq '(>>?[[:space:]]*\.?/?\.env\b|tee[[:space:]]+[^|;]*\.env\b|sed[[:space:]]+-i[^|;]*\.env\b|truncate[^|;]*\.env\b)' <<<"$CMD_ENV"; then
  deny ".env is the only copy of the TMDB/TVDB credentials and is not in git - overwriting it loses them. Add new keys to .env.example instead, and ask the user to fill in the real value."
fi

# 3b. Force-adding or committing .env. It is gitignored, so only an explicit
#     -f gets it staged - which is exactly the accident worth blocking.
if grep -Eq 'git[[:space:]]+(add|stage)[^|;]*\.env\b' <<<"$CMD_ENV"; then
  deny ".env holds live API keys and is gitignored on purpose. Committing it publishes the TMDB and TVDB credentials in the repo history, where a later 'git rm' does not remove them."
fi

exit 0
