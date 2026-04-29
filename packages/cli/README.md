# metarepo-sc-cli

Companion CLI for the [`metarepo-sc`](https://marketplace.visualstudio.com/items?itemName=mattgle.metarepo-sc) VSCode extension. Provides a terminal-side fzf picker that lists every uncommitted change across every git repo in a meta-repo workspace, and shows live diffs in VSCode as you arrow through them — without focus theft or dock bounces.

## Installation

```bash
npm install -g metarepo-sc-cli
```

You also need the companion VSCode extension installed and enabled:

```bash
code --install-extension mattgle.metarepo-sc
```

## Runtime dependencies

- **`git`**
- **`fzf`** — interactive picker
- **[`bat`](https://github.com/sharkdp/bat)** — preview pane for untracked files
- **[`delta`](https://github.com/dandavison/delta)** — preview pane for tracked diffs
- **`bash` 4+** — macOS ships bash 3, install via `brew install bash` if needed

Install on macOS:

```bash
brew install fzf bat git-delta
```

Install on Debian/Ubuntu:

```bash
sudo apt install fzf bat git-delta
```

## Usage

```bash
cd /path/to/meta-repo-workspace
metarepo-sc
```

Or with an explicit root:

```bash
METAREPO_SC_ROOT=/path/to/meta-repo-workspace metarepo-sc
```

### Key bindings

| Key      | Action                                                                              |
| -------- | ----------------------------------------------------------------------------------- |
| ↑ / ↓    | Move selection — automatically opens the highlighted file's diff in VSCode silently |
| `enter`  | Reload the list (use after editing in VSCode to refresh)                            |
| `ctrl-r` | Reload the list manually                                                            |
| `ctrl-e` | Open the file in `$EDITOR` inside the terminal (no diff)                            |
| `esc`    | Quit                                                                                |

### Recommended VSCode setting

Add to your user `settings.json` so older diff tabs auto-close as you arrow through files:

```jsonc
{
  "workbench.editor.limit.enabled": true,
  "workbench.editor.limit.value": 1,
  "workbench.editor.limit.perEditorGroup": false,
}
```

## How it works

The CLI walks every immediate subdirectory containing a `.git`, runs `git status --porcelain` against each, and pipes the unified list into `fzf`. Each cursor move writes a single tab-separated line to `~/.config/metarepo-sc/cmd`; the VSCode extension watches that file via `fs.watch` and runs `vscode.diff()` with `preserveFocus: true` — silently, without ever activating the VSCode app.

## Contributing

This package is part of the [meta-repo-source-control](https://github.com/mattgle/meta-repo-source-control) repo. See [CONTRIBUTING.md](https://github.com/mattgle/meta-repo-source-control/blob/main/CONTRIBUTING.md) for setup, build/test commands, and PR guidelines.

## License

[MIT](https://github.com/mattgle/meta-repo-source-control/blob/main/LICENSE)
