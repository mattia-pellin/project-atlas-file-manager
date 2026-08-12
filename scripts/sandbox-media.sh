#!/usr/bin/env bash
# Rebuild the throwaway copy of test_media/ that the container renames against.
#
# test_media/ is a committed fixture directory whose exact filenames are pinned by
# backend/test_parser.py. A rename run against it does not fail — it rewrites the
# fixtures, and the suite then passes or fails on whatever the last manual test
# happened to leave behind. So the container never sees test_media/ itself: it sees
# this copy, which is gitignored and can be thrown away and rebuilt at will.
#
#   scripts/sandbox-media.sh          # reset the copy, print its path
#   scripts/sandbox-media.sh --keep   # create it only if it is not there yet
#
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$root/test_media"
target="$root/sandbox/media"

if [[ "${1:-}" == "--keep" && -d "$target" ]]; then
    echo "$target"
    exit 0
fi

rm -rf "$target"
mkdir -p "$target"
cp -R "$source_dir/." "$target/"
echo "$target"
