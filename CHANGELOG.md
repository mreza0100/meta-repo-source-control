# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.3] — 2026-04-29

### Fixed

- **Discard Changes now works on renamed files.** Previously, clicking Discard on a rename row appeared to do nothing — the modal closed but the rename stayed. Root cause: `git checkout HEAD -- <newPath>` errors because HEAD has no entry for the new path, and the shared `execGit` helper was swallowing the error silently. Discard for renames now uses `git restore --source=HEAD --staged --worktree -- <oldPath> <newPath>`, which atomically restores the old path and removes the new one.
- **Discard failures now surface as error messages instead of silently disappearing.** Mutating git commands (rather than read-only ones) get error reporting that includes git's stderr, so future failures show in a notification instead of looking like a non-event.

### Changed

- The Discard modal now uses **"Undo Rename"** as the confirm-button label and a clearer warning message ("the new file will be removed and the original restored") when the row is a rename. Untracked-file delete and regular-file discard messages are unchanged.

## [0.2.2] — 2026-04-29

### Fixed

- **Renamed files now diff against the correct HEAD-side path.** v0.2.1 fixed the "file not found" error when clicking a rename row, but the resulting diff was wrong — it compared an empty HEAD against the working tree (showing every line as added) because `git show HEAD:<newPath>` returns nothing for a file that exists at a different path in HEAD. Now the parser captures the source path (the HEAD-side path), and the diff compares against the file's content there. Clean renames show no content diff, as expected; renames-with-edits show only the actual changes. Rename rows also now display `oldName → newName (HEAD ↔ Working)` in the diff tab title when the basenames differ.

## [0.2.1] — 2026-04-29

### Fixed

- **Renamed files (`R old -> new` rows) can now be opened from the tree view.** The git status parser was stuffing the entire `"old -> new"` string into the file path, so click-to-diff produced "file not found" errors. Now splits on the arrow and uses the destination (current) path.

### Changed

- **Repository structure flattened to a single-package layout.** Dropped the `packages/extension/` nesting and the unused `tsconfig.base.json`. The repo is now a normal VSCode extension repo, not a monorepo. No user-visible behavior change — bundle is identical.

## [0.2.0] — 2026-04-29

### Removed

- **CLI bridge** — the `~/.config/metarepo-sc/cmd` watcher that allowed an external shell tool to drive VSCode's diff editor silently is gone. The extension is now standalone and contains only the Workspace Changes tree view.
- **`metarepo-sc-cli` package** — the companion bash CLI is removed from the repo. It was never published to npm and the workflow it enabled (terminal fzf picker driving live VSCode diffs) is no longer supported.

### Changed

- The marketplace listing has been reframed as a single-purpose extension: "Workspace Changes view for meta-repo workspaces."
- `~80 lines` of bridge code stripped from `extension.ts`. Bundle is leaner.
- README now leads with a prominent **devcontainer setup** section, with a copy-pasteable `devcontainer.json` snippet.

### Migration

If you were using v0.1.x of the CLI: it's gone, no replacement. The `~/.config/metarepo-sc/cmd` directory becomes orphaned after upgrading; safe to `rm -rf ~/.config/metarepo-sc/`. Anyone who built integrations against the CLI bridge protocol (`diff\t...`, `open\t...`, `close`) needs to drive VSCode through the standard extension API instead — there's no in-process replacement.

## [0.1.1] — 2026-04-29

### Fixed

- **CLI bridge no longer replays stale commands on cold start.** Opening a fresh VSCode window via `code <file>` had been popping up the last diff from the previous session, stealing focus from the file you actually wanted. Activation now seeds the bridge with the file's current content as a baseline, so only writes that happen after the extension activates are dispatched.
- **Workspace Changes view now refreshes on external edits.** External tools (terminal git, agents like Claude Code, other editors) that bypass the VSCode API used to leave the view stale until you clicked refresh. A debounced filesystem watcher now catches those changes, with a path filter (`shouldIgnorePath`) that excludes `.git/`, `node_modules/`, build outputs, TS incremental build state, and OS metadata to avoid refresh churn.

## [0.1.0] — 2026-04-29

### Added

- Initial public release as **`metarepo-sc`** (rebrand of the internal `wsdiff Bridge` extension and `wsdiff` CLI).
- Monorepo layout with two npm workspaces:
  - `packages/extension/` — VSCode extension, ported from JavaScript to strict TypeScript, bundled with esbuild.
  - `packages/cli/` — bash CLI, npm-installable as `metarepo-sc-cli` (binary: `metarepo-sc`).
- Mocha + `@vscode/test-electron` test suite for the extension (14 tests).
- bats-core test suite for the CLI (9 tests).
- Shared ESLint flat config + Prettier config across both packages.
- MIT license; full OSS docs (`README.md`, `CONTRIBUTING.md`, this file).

### Changed

- All command IDs renamed `wsdiff.*` → `metarepoSc.*`.
- Tree view ID renamed `wsdiff.changes` → `metarepoSc.changes`.
- Command file path moved from `~/.config/wsdiff/cmd` → `~/.config/metarepo-sc/cmd`.
- Temp HEAD blob directory renamed `<repo>/.git/wsdiff_tmp/` → `<repo>/.git/metarepo-sc-tmp/`.
- CLI environment variable renamed `WSDIFF_ROOT` → `METAREPO_SC_ROOT`.

### Removed

- Dead `STATUS_ICON` table and unused `statusToIcon()` helper from the extension source.
- The legacy "edit-in-place at `~/.vscode/extensions/`" development workflow — replaced with a clone-and-build flow documented in `CONTRIBUTING.md`.

---

## Pre-rebrand history (as `wsdiff Bridge`)

These releases predate the rebrand and were never published to the VSCode marketplace.

### 0.2.4 — Stable TreeItem IDs and `getParent()` so Expand All actually works; expansion state persists across refreshes.

### 0.2.3 — Added Discard Changes inline action; renamed Collapse All custom command to Expand All to coexist with built-in collapse.

### 0.2.2 — Switched broad file watcher to intent-aware events (`onDidSaveTextDocument`, `onDidCreateFiles`, etc.); parallelized git status calls.

### 0.2.1 — File-type icons via icon theme; expanded untracked directories with `git status --untracked-files=all`.

### 0.2.0 — Added Workspace Changes tree view in the SCM sidebar.

### 0.1.0 — Initial CLI bridge only (silent diff-opening from terminal).

[Unreleased]: https://github.com/mattgle/meta-repo-source-control/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mattgle/meta-repo-source-control/releases/tag/v0.1.0
