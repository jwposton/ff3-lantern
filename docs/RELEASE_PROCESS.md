# Release process

This document mirrors `.cursor/rules/release-and-changelog.mdc` for human readers. Agents should follow the Cursor rule; both stay in sync when the process changes.

## Changelog on every change

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/). **Update it in the same commit as any user-facing code change** — add bullets under `## [Unreleased]`. Do not batch changelog updates only at release time.

## Cutting a release

1. Ensure `[Unreleased]` is complete and tests pass.
2. Finalize `CHANGELOG.md` (new `## [X.Y.Z] - date` section, footer compare links).
3. Bump `frontend/package.json` `version`.
4. Update `frontend/src/pages/AboutPage.test.tsx` version assertion.
5. Commit, then tag and push:

   ```bash
   git tag -a vX.Y.Z -m "release: vX.Y.Z — summary"
   git push origin main
   git push origin vX.Y.Z
   ```

6. Confirm the **Publish Docker images** workflow (`.github/workflows/publish.yml`) succeeds.

On every `v*` tag push the workflow:

- Runs backend pytest and frontend build
- Publishes multi-arch Docker images to `ghcr.io/<owner>/ff3-lantern-{backend,frontend}:X.Y.Z` (and `:latest`)
- Creates a **GitHub Release** with notes from the matching `CHANGELOG.md` section

Release notes are extracted by `scripts/changelog-release-notes.sh` (same format agents use when cutting a release).

## Backfill GitHub Releases for older tags

If tags were pushed before release automation, Docker may exist without a GitHub Release page:

```bash
chmod +x scripts/backfill-github-releases.sh scripts/changelog-release-notes.sh
./scripts/backfill-github-releases.sh
```

Preview one version: `./scripts/changelog-release-notes.sh 2.4.3`
