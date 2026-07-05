#!/usr/bin/env bash
# Print the Keep a Changelog section for VERSION (e.g. 2.4.3) from CHANGELOG.md.
set -euo pipefail

VERSION="${1:?usage: changelog-release-notes.sh VERSION [CHANGELOG.md]}"
CHANGELOG="${2:-CHANGELOG.md}"

if [[ ! -f "$CHANGELOG" ]]; then
  echo "changelog-release-notes: file not found: $CHANGELOG" >&2
  exit 1
fi

awk -v ver="$VERSION" '
  /^## \[/ {
    if (found) exit
    if ($0 ~ "^## \\[" ver "\\]") {
      found = 1
      print
      next
    }
  }
  found { print }
' "$CHANGELOG"
