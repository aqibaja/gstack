# Task 1.1: Build Pipeline Setup
## Technical Execution Plan

**Status**: Ready for implementation
**Priority**: High
**Estimated Effort**: 2 days

---

## Executive Summary

Standardize the Chrome extension on a single `esbuild`-driven pipeline that owns bundling, static asset staging, watch mode, and production packaging for Manifest V3.

This task does **not** extend the existing CLI release path. The root repository currently packages the CLI, while the extension package has an incomplete build contract (`tsc && node scripts/build.js`) and no actual bundler script. The locked recommendation is:

1. use `esbuild` as the only extension bundler
2. keep plain `tsc --noEmit` for type-checking, not artifact generation
3. emit all extension artifacts into `packages/extension/dist/`
4. add a watch mode that rebuilds on source/static changes and supports extension reload
5. add deterministic icon generation/staging into the same build graph

That gives one artifact model for local development, CI validation, and packaging.

---

## Current State Analysis

### What exists now

- `packages/extension/manifest.json` defines MV3 entrypoints and expects:
  - `background/service-worker.js`
  - `content/preview.js`
  - `content/dom-observer.js`
  - `icons/icon16.png`, `icon48.png`, `icon128.png`
- `packages/extension/tsconfig.json` emits JS into `dist/`
- `packages/extension/package.json` declares:
  - `build`: `tsc && node scripts/build.js`
  - `dev`: `tsc --watch`
- root CI in `.github/workflows/ci.yml` builds and releases the CLI, not the extension

### Gaps

1. `scripts/build.js` does not exist, so the extension build contract is broken.
2. `tsc --watch` is not enough for MV3 local development:
   - it does not copy `manifest.json`, HTML, CSS, or icons
   - it does not bundle multi-entry browser code
   - it does not support predictable rebuild hooks for extension reload
3. There is no asset pipeline for icons.
4. CI validates CLI artifacts but not installable extension artifacts.
5. The extension package has mixed expectations about module output:
   - browser runtime code wants ESM-style MV3 entrypoints
   - current build scripts assume raw TypeScript compilation is sufficient

### Hidden assumption made explicit

The repo is a monorepo, but `GST-22` is an extension build-system task, not a monorepo-wide release redesign. The extension needs its own deterministic pipeline first; root CI can then call into it as one job.

---

## Locked Technical Decisions

### 1. Build tool

Use `esbuild` for extension artifact production.

Why:

- MV3 entrypoints are simple and benefit from fast multi-entry bundling
- watch mode is fast enough for extension development
- no framework-specific dev server is needed
- easier to own than webpack for this repo size

Do not use webpack unless future requirements introduce loader/plugin complexity that `esbuild` cannot satisfy.

### 2. TypeScript role

Use TypeScript for type-checking only during extension builds:

- `tsc --noEmit` for validation
- `esbuild` for JS output

This prevents double-emission and keeps one source of runtime artifacts.

### 3. Output contract

All installable extension artifacts live under:

`browserautodrive/packages/extension/dist/`

Required shape:

```text
dist/
  manifest.json
  background/service-worker.js
  content/dom-observer.js
  content/preview.js
  popup/popup.html
  popup/popup.js
  popup/popup.css
  shared/*
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
```

### 4. Static asset handling

The build pipeline must copy or generate:

- `manifest.json`
- popup HTML/CSS assets
- icon assets

Static assets are part of the build graph, not manual post-build steps.

### 5. Dev experience

The extension dev loop is rebuild-and-reload, not true HMR.

Manifest V3 service workers and extension pages do not support standard browser-app hot module replacement in a reliable way. The correct implementation target is:

- file watch
- fast rebuild to `dist/`
- developer-visible message instructing reload of the unpacked extension
- optional helper script for Chrome reload automation later, but not part of this task

### 6. CI boundary

CI for this task must validate the extension as a first-class build target:

- install dependencies
- type-check extension
- build extension
- verify required dist outputs exist
- upload extension artifact bundle for inspection

Release/tag publication remains outside the scope of `GST-22`.

---

## Target Architecture

### Component Diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                 Extension Build Pipeline                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Source Files                                               │
│  ├─ background/*.ts                                         │
│  ├─ content/*.ts                                            │
│  ├─ popup/*.ts                                              │
│  ├─ popup/*.html, *.css                                     │
│  ├─ manifest.json                                           │
│  └─ icon source assets                                      │
│                │                                            │
│                ▼                                            │
│  Build Orchestrator (`scripts/build.mjs`)                   │
│  ├─ validate build mode                                     │
│  ├─ run esbuild multi-entry bundle                          │
│  ├─ copy static assets                                      │
│  ├─ generate/stage icons                                    │
│  └─ emit dist manifest + output checks                      │
│                │                                            │
│                ▼                                            │
│  dist/ installable unpacked extension                       │
│                │                                            │
│                ├─ local Chrome "Load unpacked"              │
│                └─ CI artifact upload                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Package-level boundaries

- `packages/extension/package.json`
  Owns public commands: `typecheck`, `build`, `dev`, `package`
- `packages/extension/scripts/build.mjs`
  Owns bundling and asset staging
- `packages/extension/scripts/dev.mjs`
  Optional thin wrapper around watch mode and reload logging
- `.github/workflows/ci.yml`
  Calls extension targets from root without embedding extension-specific shell logic everywhere

---

## Data Flow

### Production build sequence

```text
Developer/CI
   |
   | npm run build --workspace @browserautodrive/extension
   v
TypeScript check (`tsc --noEmit`)
   |
   v
Build orchestrator
   |
   +--> esbuild bundles TS entrypoints
   |
   +--> static assets copied to dist
   |
   +--> icons generated/staged to dist/icons
   |
   +--> output verification runs
   v
Installable unpacked extension in dist/
```

### Watch-mode sequence

```text
Developer saves file
   |
   v
watcher detects source/static change
   |
   +--> esbuild incremental rebuild for TS entries
   |
   +--> static asset recopy if manifest/html/css/icon sources changed
   |
   +--> output verification
   |
   v
console message: rebuild complete, reload extension
```

---

## State Model

### Build state transitions

```text
idle
  -> validating
  -> bundling
  -> staging_assets
  -> verifying_outputs
     -> success
     -> failed
```

### Watch-mode state transitions

```text
booting
  -> initial_build
     -> ready
     -> failed
ready
  -> rebuilding
     -> ready
     -> failed
failed
  -> rebuilding
     -> ready
     -> failed
```

Behavioral rule:

- `failed` in watch mode must not exit immediately on recoverable source errors; it should stay alive and rebuild on the next change.

---

## Implementation Spec

### 1. Package scripts

Target commands for `packages/extension/package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "npm run typecheck && node ./scripts/build.mjs",
    "dev": "node ./scripts/build.mjs --watch",
    "package": "node ./scripts/package.mjs"
  }
}
```

Notes:

- `package` should zip `dist/` into a reproducible artifact only if the team needs a distributable uploadable bundle now.
- If packaging is deferred, omit `package` from implementation and keep the CI upload on raw `dist/`.

### 2. esbuild entrypoints

Build these explicit entries:

- `background/service-worker.ts`
- `content/dom-observer.ts`
- `content/preview.ts`
- `popup/popup.ts`

Rules:

- preserve relative folder structure in `dist/`
- bundle each entry independently
- output browser-targeted ESM where MV3 supports it
- externalize nothing unless a dependency proves incompatible

### 3. Asset staging

Copy as-is:

- `manifest.json`
- `popup/popup.html`
- `popup/popup.css`
- any additional static files referenced by the manifest later

Manifest handling:

- copy from source
- optionally rewrite version from root/package metadata only if release tooling requires it
- do not mutate permissions or entrypoint paths during build in this task

### 4. Icon generation

Required output files:

- `dist/icons/icon16.png`
- `dist/icons/icon48.png`
- `dist/icons/icon128.png`

Implementation options, in order:

1. commit a single high-resolution source asset and generate sizes during build
2. if no source asset exists yet, commit the three required PNGs directly and make the build verify/publish them

Recommendation:

- use option 2 for this task unless branded source artwork already exists
- do not block the build system on image processing complexity

### 5. Output verification

The build script must fail if any required artifact is missing:

- manifest
- all manifest-referenced JS files
- popup HTML/CSS
- three icons

This prevents silent green builds that produce unusable unpacked extensions.

### 6. Root integration

Root `Makefile` and CI should add extension-aware targets without breaking current CLI flows.

Minimum additions:

- `make build-extension`
- `make test-extension` or `make check-extension`

CI should add an `extension-build` job and keep CLI jobs separate.

---

## Failure Modes And Handling

### 1. Manifest points to missing artifact

Cause:

- entrypoint renamed without updating manifest
- asset copy step skipped

Handling:

- build verifier reads manifest references and asserts files exist in `dist/`
- fail build with a concrete missing-path message

### 2. Watch mode exits on TypeScript or bundler error

Cause:

- build wrapper treats any error as terminal

Handling:

- in watch mode, log the error and remain alive
- next filesystem change triggers a rebuild

### 3. Build emits CJS or incompatible output for MV3

Cause:

- default TypeScript/CommonJS assumptions leak into extension build

Handling:

- force browser-targeted ESM output in `esbuild`
- verify service worker script loads without Node-only globals

### 4. Static assets drift from source

Cause:

- TS rebuild succeeds but HTML/CSS/manifest changes are not propagated

Handling:

- watch static directories as first-class inputs
- run asset recopy on relevant file changes

### 5. Icon files are missing or wrong dimensions

Cause:

- manual asset copy with no validation

Handling:

- verify existence during build
- QA validates actual dimensions in browser install flow

### 6. Root CI reports success while extension is broken

Cause:

- extension is not a required CI job

Handling:

- add dedicated extension build job
- require it on PRs touching extension paths or keep it always-on

---

## Trust Boundaries

### Boundary 1: Source tree to dist

Only the build orchestrator is allowed to define what lands in `dist/`.

Implication:

- no undocumented manual copy steps in README-only workflows
- CI and local development use the same build command

### Boundary 2: Manifest to runtime

`manifest.json` is the contract Chrome enforces. Any build output not aligned with manifest paths is a broken release, even if tests pass.

### Boundary 3: Root CI to package implementation

Root workflows should invoke package scripts, not duplicate package internals with ad hoc shell commands. The package owns its build logic.

---

## Test Matrix

### Automated checks

| Area | Check | Expected Result |
|------|-------|-----------------|
| Type safety | `npm run typecheck --workspace @browserautodrive/extension` | zero TS errors |
| Build | `npm run build --workspace @browserautodrive/extension` | dist created successfully |
| Output integrity | build verifier | all manifest targets and icons exist |
| Watch mode | modify TS file | rebuild completes without process restart |
| Watch mode static | modify popup CSS or manifest | asset restaged to dist |
| CI artifact | workflow upload | dist artifact available for inspection |

### Manual QA

| Scenario | Steps | Expected Result |
|----------|-------|-----------------|
| Unpacked install | Load `packages/extension/dist` in Chrome | extension installs with no missing-file errors |
| Popup render | Open popup | popup HTML/CSS/JS loads correctly |
| Service worker boot | Open extension service worker devtools | worker loads without module/runtime errors |
| Content scripts | Open arbitrary page | content scripts inject without missing-resource errors |
| Icons | Check toolbar, extension page | 16/48/128 assets resolve correctly |

---

## Rollout And Handoff

### Implementation owner

Assign implementation to the **Release Engineer**.

Scope:

- extension build scripts
- package script cleanup
- root `Makefile` and CI integration for extension validation
- extension artifact upload in CI

### QA owner

Assign verification to the **QA Engineer** after implementation lands.

Scope:

- unpacked install validation
- popup/service worker/content-script smoke test
- artifact integrity confirmation
- regression check that CLI CI still passes

### Review path

When the implementation branch is ready, route it to the **Staff Engineer** for review.

Current gap:

- no Staff Engineer agent is currently available in Paperclip

Until that role exists, use the next available technical reviewer rather than leaving the work unreviewed.

---

## Definition Of Done

`GST-22` is complete when all of the following are true:

1. the extension package builds from a single documented command
2. `dist/` is a valid unpacked MV3 extension
3. watch mode rebuilds TS and static asset changes
4. required icon assets are present
5. CI validates and uploads extension artifacts
6. implementation and QA ownership are explicitly assigned

---

## Recommendation

Proceed with a narrow implementation: establish the `esbuild`-based extension pipeline first, keep CLI release logic untouched except for additive CI wiring, and treat branded icon sophistication as secondary to build determinism.
