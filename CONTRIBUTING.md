# Contributing

Thanks for your interest in contributing! This document covers local setup, the build/test commands, and what's expected in a PR.

## Required tools

- **Node 20+** (LTS) — extension build, tests, lint
- **git** — both packages depend on it
- **bash 4+** — CLI is bash; macOS ships bash 3, install via `brew install bash` if you want to develop the CLI on macOS
- **fzf**, **bat**, **delta** — runtime dependencies of the CLI; install via `brew` / `apt`
- **shellcheck** _(optional, recommended)_ — bash linting; CI runs it strictly. Install: `brew install shellcheck` or `apt install shellcheck`
- **bats-core** is installed automatically as a workspace dev dependency

## Setup

```bash
git clone https://github.com/mattgle/meta-repo-source-control.git
cd meta-repo-source-control
npm install
```

`npm install` resolves dependencies for both workspaces (`packages/extension`, `packages/cli`) and creates the `node_modules/.bin/metarepo-sc` symlink so you can run the CLI from the workspace.

## Common commands

All commands work from the repository root.

| Command                | Effect                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm run build`        | Bundle the extension via esbuild (`packages/extension/dist/extension.js`) |
| `npm run lint`         | ESLint on the extension TS, shellcheck on the CLI bash                    |
| `npm run lint:fix`     | Apply ESLint auto-fixes                                                   |
| `npm run format`       | Apply Prettier to all source files                                        |
| `npm run format:check` | Verify all files match Prettier style (CI uses this)                      |
| `npm run test`         | Run extension Mocha tests + CLI bats tests                                |

To run only one workspace's tests:

```bash
npm run test --workspace metarepo-sc      # extension
npm run test --workspace metarepo-sc-cli  # CLI
```

## Testing the extension locally

The extension test suite uses [`@vscode/test-electron`](https://github.com/microsoft/vscode-test) to download a pristine VSCode and run inside it. The first run downloads VSCode (~120 MB) into `packages/extension/.vscode-test/` (gitignored).

To install your in-development extension into your real VSCode:

```bash
cd packages/extension
npm run build               # produces dist/extension.js
npx vsce package --no-dependencies --out /tmp/metarepo-sc.vsix
code --install-extension /tmp/metarepo-sc.vsix
```

Then `Cmd+Shift+P → Developer: Reload Window` to pick it up.

## Testing the CLI locally

The CLI is a bash script. The bats tests cover its non-interactive behavior:

```bash
npm run test --workspace metarepo-sc-cli
```

For interactive testing, point it at any directory containing sibling git repos:

```bash
METAREPO_SC_ROOT=/path/to/meta-repo node_modules/.bin/metarepo-sc
```

## Code style

- **TypeScript**: strict mode (`tsconfig.base.json`). Run `npm run lint:fix && npm run format` before committing.
- **Bash**: `shellcheck` clean. The CLI script targets bash 4+ syntax.
- **Formatting**: Prettier with `printWidth: 110`; everything else is Prettier defaults.
- **Comments**: explain _why_, not _what_. Don't add comments for things a reader can infer from well-named code.

## PR guidelines

Before opening a PR:

1. `npm run format:check` passes.
2. `npm run lint` passes (locally — shellcheck warnings are acceptable if shellcheck isn't installed; CI will catch them).
3. `npm run test` passes (both workspaces).
4. Add tests for new behavior. Bug fixes should include a regression test.
5. Update the relevant `CHANGELOG.md` entry under `## [Unreleased]`.

PR descriptions should explain _what_ changed and _why_, written for reviewers without context. Don't include conversation history or step-by-step development logs.

## Releasing

Releases are triggered by pushing a tag matching `v*.*.*` (handled by `.github/workflows/release.yml`). The workflow packages the extension VSIX and attaches it to the GitHub Release. Marketplace publishing (`vsce publish`) requires a `VSCE_PAT` repository secret — see [the VSCode publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Reporting bugs

Open an issue at <https://github.com/mattgle/meta-repo-source-control/issues> with:

- VSCode version
- OS and version
- A minimal repro: the workspace structure (number of repos, mix of clean/dirty), the action you took, what you expected, what happened
