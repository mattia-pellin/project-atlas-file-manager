---
name: release
description: Cut a release - sync the version string, verify the gate is green, then tag and push so the GHCR image builds and Portainer redeploys. Only run when the user explicitly asks for a release.
argument-hint: "<version>  e.g. 1.10.0"
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# Cut release `$1`

Pushing a `v*` tag is not a dry run. `.github/workflows/docker-publish.yml`
builds and pushes `ghcr.io/<repo>` and then **calls the Portainer webhook**,
which redeploys the running container. Everything below happens before the
tag exists.

## 1. Resolve the version

`$1` is the target version, without the leading `v`. If it's absent, ask.

Two places disagree today and both must end up at `$1`:

| Where | Current |
| --- | --- |
| `frontend/src/App.tsx:303` — the version chip in the UI | `v1.9.0` |
| `frontend/package.json` — `"version"` | `1.0.0` |

`package.json` was never maintained; `App.tsx` is the number the user
actually sees. Set both to `$1` — `App.tsx` keeps its `v` prefix,
`package.json` does not.

Also `grep -rn "1\.9\.0\|1\.0\.0" --include=*.ts --include=*.tsx --include=*.json --include=*.py .`
outside `node_modules` before you finish, in case a third copy exists.

## 2. Preconditions — all of them, in order

```bash
git status --porcelain          # must be empty apart from the version bump
git rev-parse --abbrev-ref HEAD # must be main
git tag -l "v$1"                # must be empty; never move an existing tag
```

Then run the full gate — see the `check` skill. **A red gate stops the
release.** Do not push a tag to "see if CI passes"; the tag workflow deploys.

Confirm `.dockerignore` still excludes `.env`, `.git`, `venv/`,
`backend/venv/`, `node_modules/` and `.cache/`, so no secret is baked into a
published image.

## 3. Commit, tag, push

```bash
git add frontend/src/App.tsx frontend/package.json
git commit -m "chore(release): v$1"
git tag -a "v$1" -m "v$1"
git push origin main
git push origin "v$1"
```

`git push`, `git tag` and `git commit` are all in the `ask` list in
`.claude/settings.json` — the user approves each one. That is the intended
last line of defence; don't try to route around it.

## 4. After the push

Report the tag, the image tags the workflow will produce
(`{{version}}`, `{{major}}.{{minor}}`, `sha-…`), and that Portainer will be
triggered on success. Then check the run with the **GitHub MCP server** —
`gh` is not installed in this WSL environment, so `gh run list` will fail.
Use the `actions` toolset to list the latest run of `docker-publish.yml` and
report its conclusion.

If the build fails, say so plainly — the container has **not** been
redeployed, and the fix is a new patch version, never a re-pushed tag.
