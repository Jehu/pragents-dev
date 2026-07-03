# Plan 002: Add CI test/typecheck gates and pin the Node version

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 867809f..HEAD -- .github/ package.json server/package.json web/package.json`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live files before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (do 001 first if batching, but not a hard dependency)
- **Category**: dx
- **Planned at**: commit `867809f`, 2026-07-03

## Why this matters

The only CI workflow is `.github/workflows/lighthouse.yml` — it builds the web
app and runs Lighthouse. Nothing runs `tsc --noEmit` or the test suites on a PR.
A type error or a failing test can merge undetected. Separately, there is no
`.nvmrc` and no `engines` field anywhere, while the server depends on the native
module `better-sqlite3`. That native module is compiled per Node ABI version; on
a machine whose Node differs from the one that built `node_modules`, the server
tests fail hard with `NODE_MODULE_VERSION` mismatch (observed: module built for
Node 24 / ABI 141, run under Node 22 / ABI 127). Pinning the Node version and
running the suites in CI closes both gaps: contributors get a consistent runtime
and regressions are caught before merge.

## Current state

- `.github/workflows/lighthouse.yml` — the sole CI workflow; builds web + runs
  Lighthouse. No test or typecheck job.
- No `.nvmrc` at repo root (confirmed absent).
- No `engines` field in root `package.json`, `server/package.json`, or
  `web/package.json` (confirmed absent).
- `README.md` states "Node.js 20+" in prose but nothing enforces it.
- Verified working local commands (use these verbatim in CI):
  - Server typecheck: `cd server && npx tsc --noEmit` → exit 0
  - Server tests: `cd server && npm test` (vitest) → green **only** when the
    native `better-sqlite3` build matches the running Node ABI
  - Web typecheck + tests: `cd web && npx tsc --noEmit && npx vitest run` → 411 tests pass
  - Web build: `cd web && npm run build`
- Install is npm workspaces: `npm install` at the root wires up `server/` and
  `web/`. `better-sqlite3` must be (re)built against the CI Node version — a
  clean `npm install` in CI does this automatically; a cached `node_modules`
  restored under a different Node will not, so **do not cache `node_modules`
  across Node versions** in the CI job (cache `~/.npm` instead).

Existing workflow file to model the new one after (read it before writing):
`.github/workflows/lighthouse.yml` — copy its `actions/checkout` +
`actions/setup-node` preamble and Node version source.

## Commands you will need

| Purpose             | Command                                        | Expected on success     |
|---------------------|------------------------------------------------|-------------------------|
| Install (root)      | `npm install`                                   | exit 0, builds native   |
| Server typecheck    | `cd server && npx tsc --noEmit`                 | exit 0                  |
| Server tests        | `cd server && npm test`                         | all pass                |
| Web typecheck       | `cd web && npx tsc --noEmit`                    | exit 0                  |
| Web tests           | `cd web && npx vitest run`                      | 411 tests pass          |
| Web build           | `cd web && npm run build`                        | exit 0                  |

## Scope

**In scope** (the only files you should modify/create):
- `.nvmrc` (create)
- `package.json` (root) — add `engines` field only
- `.github/workflows/ci.yml` (create) — new test/typecheck workflow

**Out of scope** (do NOT touch):
- `.github/workflows/lighthouse.yml` — leave the existing workflow as is.
- `server/package.json` / `web/package.json` scripts — do not rename or rewrite
  the existing `dev`/`build`/`test` scripts; CI calls them as they are.
- Any application source. This plan adds tooling only.

## Git workflow

- Branch: `advisor/002-ci-gates-and-node-pinning`
- One commit. Message style: conventional commits. Example from `git log`:
  `feat(server): settings update endpoints`. Suggested:
  `ci: add typecheck+test workflow and pin Node version`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Choose the Node version and pin it

Pick the current active LTS that supports the declared deps (Node 22 LTS is a
safe choice; the repo README says "20+"). Create `.nvmrc` at the repo root with
just the major version line:

```
22
```

Add an `engines` field to the **root** `package.json` (merge into the existing
top-level object, do not remove other keys):

```json
"engines": { "node": ">=20" }
```

Keep `>=20` (not `>=22`) in `engines` so existing Node 20 contributors are not
locked out; `.nvmrc` expresses the *preferred* version for CI and local `nvm use`.

**Verify**: `cat .nvmrc` → prints `22`. `node -e "console.log(require('./package.json').engines.node)"` → prints `>=20`.

### Step 2: Write the CI workflow

Create `.github/workflows/ci.yml`. It must:
- Trigger on `push` and `pull_request`.
- Use `actions/checkout@v4` and `actions/setup-node@v4` with
  `node-version-file: '.nvmrc'` and `cache: 'npm'` (cache npm, NOT `node_modules`).
- Run `npm install` at the root (this rebuilds `better-sqlite3` for the CI Node).
- Run these steps, each as its own `run:` so a failure is attributable:
  - `cd server && npx tsc --noEmit`
  - `cd server && npm test`
  - `cd web && npx tsc --noEmit`
  - `cd web && npx vitest run`
  - `cd web && npm run build`

Target shape (adapt names to match repo conventions in `lighthouse.yml`):

```yaml
name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'
      - run: npm install
      - run: cd server && npx tsc --noEmit
      - run: cd server && npm test
      - run: cd web && npx tsc --noEmit
      - run: cd web && npx vitest run
      - run: cd web && npm run build
```

**Verify**: the file is valid YAML — `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))"` (the `yaml` package is already a server dep; run from repo root after `npm install`) → no error.

### Step 3: Prove the CI commands pass locally on the pinned Node

Before relying on CI, run the full sequence locally under the Node version from
`.nvmrc` (use `nvm use` if available). This is also the fix for the native-module
mismatch: a clean `npm install` rebuilds `better-sqlite3` for the current Node.

**Verify** (run from repo root):
- `npm install` → exit 0
- `cd server && npx tsc --noEmit` → exit 0
- `cd server && npm test` → all pass (if this still fails with `NODE_MODULE_VERSION`,
  run `npm rebuild better-sqlite3` and retry; if it still fails, that is a STOP condition)
- `cd web && npx tsc --noEmit && npx vitest run` → 411 tests pass
- `cd web && npm run build` → exit 0

## Test plan

No new unit tests — this plan *is* the test infrastructure. The verification is
that every CI command passes locally under the pinned Node (Step 3) and that the
workflow file parses as valid YAML (Step 2). If the executor has access to push
to a fork/branch, confirming the Actions run goes green is the ideal final check,
but do not push unless the operator asked.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.nvmrc` exists and contains a Node major version
- [ ] Root `package.json` has an `engines.node` field
- [ ] `.github/workflows/ci.yml` exists and is valid YAML
- [ ] `cd server && npx tsc --noEmit` exits 0
- [ ] `cd server && npm test` passes (after `npm install`/`npm rebuild` on the pinned Node)
- [ ] `cd web && npx tsc --noEmit && npx vitest run` passes
- [ ] `cd web && npm run build` exits 0
- [ ] `.github/workflows/lighthouse.yml` is unchanged (`git diff` shows no changes to it)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `cd server && npm test` still fails with `NODE_MODULE_VERSION` after a clean
  `npm install` and `npm rebuild better-sqlite3` on the pinned Node — this means
  a deeper native-build issue that needs investigation, not a config tweak.
- The server test suite has failures unrelated to the native module (i.e. real
  test failures) — report them; do not "fix" tests to make CI green.
- Adding `engines` causes `npm install` to hard-error (a dependency declares an
  incompatible `engines` of its own).

## Maintenance notes

- Once CI is green, consider making these checks required status checks on the
  default branch (repo-settings change — flag for the operator, do not attempt).
- When plan 001 (dependency audit) lands, add `npm audit --audit-level=high` as a
  non-blocking CI step so new advisories surface on PRs.
- If the team later adds a repo-root `test`/`typecheck` script, simplify the
  workflow to call those instead of the per-workspace commands.
- Reviewer should confirm the workflow caches `~/.npm` (via `cache: 'npm'`) and
  NOT `node_modules`, so the native module is always rebuilt for the CI Node ABI.
