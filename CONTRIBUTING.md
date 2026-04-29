# Contributing

Thanks for your interest in contributing! This document covers local setup, the build/test commands, and what's expected in a PR.

## Required tools

- **Node 20+** (LTS) — extension build, tests, lint
- **git** — required at runtime by the extension

## Setup

```bash
git clone https://github.com/mattgle/meta-repo-source-control.git
cd meta-repo-source-control
npm install
```

`npm install` resolves dependencies for the extension workspace.

## Common commands

All commands work from the repository root.

| Command                | Effect                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm run build`        | Bundle the extension via esbuild (`packages/extension/dist/extension.js`) |
| `npm run lint`         | ESLint on the extension TS                                                |
| `npm run lint:fix`     | Apply ESLint auto-fixes                                                   |
| `npm run format`       | Apply Prettier to all source files                                        |
| `npm run format:check` | Verify all files match Prettier style (CI uses this)                      |
| `npm run test`         | Run extension Mocha + `@vscode/test-electron` suite                       |

## Testing locally

The test suite uses [`@vscode/test-electron`](https://github.com/microsoft/vscode-test) to download a pristine VSCode and run inside it. The first run downloads VSCode (~120 MB) into `packages/extension/.vscode-test/` (gitignored).

```bash
npm run test
```

To install your in-development extension into your real VSCode:

```bash
cd packages/extension
npm run build               # produces dist/extension.js
npx vsce package --no-dependencies --out /tmp/metarepo-sc.vsix
code --install-extension /tmp/metarepo-sc.vsix
```

Then `Cmd+Shift+P → Developer: Reload Window` to pick it up.

## Code style

- **TypeScript**: strict mode (`tsconfig.base.json`). Run `npm run lint:fix && npm run format` before committing.
- **Formatting**: Prettier with `printWidth: 110`; everything else is Prettier defaults.
- **Comments**: explain _why_, not _what_. Don't add comments for things a reader can infer from well-named code.

## PR guidelines

Before opening a PR:

1. `npm run format:check` passes.
2. `npm run lint` passes.
3. `npm run test` passes.
4. Add tests for new behavior. Bug fixes should include a regression test.
5. Update `CHANGELOG.md` under `## [Unreleased]`.

PR descriptions should explain _what_ changed and _why_, written for reviewers without context. Don't include conversation history or step-by-step development logs.

## Releasing

The marketplace publish flow is **manual upload** via the publisher portal at <https://marketplace.visualstudio.com/manage>. This path needs no Azure DevOps account, no PAT, and no Azure subscription — only your Microsoft account login.

Per release:

1. Bump `version` in `packages/extension/package.json`
2. Move the `## [Unreleased]` notes in `CHANGELOG.md` under a new versioned section
3. Commit and tag:

   ```bash
   git commit -am "chore: release v0.X.Y"
   git tag v0.X.Y
   git push && git push origin v0.X.Y
   ```

4. The `release.yml` workflow auto-builds the VSIX and attaches it to a GitHub Release for the tag (~1 minute)
5. Download the VSIX from the GitHub Release page (or use your local `dist/metarepo-sc-0.X.Y.vsix`) and drag-drop it at <https://marketplace.visualstudio.com/manage>. Marketplace validation takes ~2 minutes.

Total active time per release: ~30 seconds.

### Optional: automated marketplace publish (advanced)

`release.yml` also has a `vsce publish` step that runs automatically when a `VSCE_PAT` repository secret exists, and silently skips otherwise.

Wiring up `VSCE_PAT` requires an Azure DevOps organization linked to an active Azure subscription. As of 2026, Microsoft blocks creating a new Azure DevOps org on a personal Microsoft account without putting a credit card on file (even for the free tier). Most personal-account publishers skip this — the manual drag-drop above is fast enough that automating it isn't worth fighting Azure DevOps for.

If you do want it: register the PAT with `Marketplace > Manage` scope (and `All accessible organizations` selected) at `https://dev.azure.com/<org>/_usersSettings/tokens`, then `gh secret set VSCE_PAT`. The next tag push will publish automatically.

## Reporting bugs

Open an issue at <https://github.com/mattgle/meta-repo-source-control/issues> with:

- VSCode version
- OS and version
- A minimal repro: the workspace structure (number of repos, mix of clean/dirty), the action you took, what you expected, what happened
