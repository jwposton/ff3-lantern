#!/usr/bin/env bash
# Create GitHub Releases for git tags that do not have one yet (notes from CHANGELOG at tag).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOTES_SCRIPT="$ROOT/scripts/changelog-release-notes.sh"

cd "$ROOT"

if ! command -v gh >/dev/null 2>&1; then
  echo "backfill-github-releases: gh CLI required" >&2
  exit 1
fi

tags=()
while IFS= read -r tag; do
  tags+=("$tag")
done < <(git tag -l 'v*' --sort=version:refname)

if ((${#tags[@]} == 0)); then
  echo "No v* tags found."
  exit 0
fi

latest_tag="${tags[-1]}"
created=0
skipped=0

for tag in "${tags[@]}"; do
  if gh release view "$tag" >/dev/null 2>&1; then
    echo "skip $tag (release exists)"
    skipped=$((skipped + 1))
    continue
  fi

  version="${tag#v}"
  notes_file="$(mktemp)"
  cleanup_notes() { rm -f "$notes_file" "${notes_file}.full"; }
  trap cleanup_notes RETURN

  if git cat-file -e "${tag}:CHANGELOG.md" 2>/dev/null; then
    git show "${tag}:CHANGELOG.md" > "${notes_file}.full"
    "$NOTES_SCRIPT" "$version" "${notes_file}.full" > "$notes_file" || true
  fi

  if [[ ! -s "$notes_file" ]]; then
    "$NOTES_SCRIPT" "$version" "$ROOT/CHANGELOG.md" > "$notes_file" || true
  fi

  if [[ ! -s "$notes_file" ]]; then
    echo "warn: no CHANGELOG section for $tag; using tag message" >&2
    git tag -l --format='%(contents)' "$tag" > "$notes_file" 2>/dev/null || true
  fi

  latest_flag=()
  if [[ "$tag" == "$latest_tag" ]]; then
    latest_flag=(--latest)
  else
    latest_flag=(--latest=false)
  fi

  echo "create $tag"
  gh release create "$tag" --title "$tag" --notes-file "$notes_file" "${latest_flag[@]}"
  created=$((created + 1))
  trap - RETURN
  cleanup_notes
done

echo "done: created $created, skipped $skipped"
