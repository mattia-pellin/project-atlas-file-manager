#!/usr/bin/env bash
# PostToolUse hook: format and lint the single file Claude just edited.
#
# Keeps the tree ruff/eslint-clean incrementally, so `/check` and CI never fail
# on formatting alone. Exits 2 with a message on stderr when a problem cannot
# be auto-fixed, which surfaces it to Claude straight away.
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
FILE=$(jq -r '.tool_input.file_path // empty')

[[ -z "$FILE" || ! -f "$FILE" ]] && exit 0

# Ignore anything outside the project or inside vendored trees.
case "$FILE" in
  "$PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac
case "$FILE" in
  */node_modules/*|*/venv/*|*/.venv/*|*/dist/*|*/.cache/*) exit 0 ;;
esac

cd "$PROJECT_DIR" || exit 0

case "$FILE" in
  *.py)
    PY="$PROJECT_DIR/venv/bin/python"
    [[ -x "$PY" ]] || exit 0
    "$PY" -m ruff --version >/dev/null 2>&1 || exit 0

    "$PY" -m ruff format -q "$FILE"
    "$PY" -m ruff check -q --fix "$FILE"

    if ! remaining=$("$PY" -m ruff check --output-format concise "$FILE" 2>&1); then
      echo "ruff found issues that need a manual fix in $FILE:" >&2
      echo "$remaining" >&2
      exit 2
    fi
    ;;

  *.ts|*.tsx|*.js|*.jsx)
    [[ -d "$PROJECT_DIR/frontend/node_modules" ]] || exit 0
    cd "$PROJECT_DIR/frontend" || exit 0

    if ! out=$(npx --no-install eslint --fix "$FILE" 2>&1); then
      echo "eslint found issues that need a manual fix in $FILE:" >&2
      echo "$out" >&2
      exit 2
    fi
    ;;
esac

exit 0
