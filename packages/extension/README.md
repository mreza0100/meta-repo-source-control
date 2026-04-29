# Meta-Repo Source Control

A VSCode extension for **multi-repo / meta-repo workspaces** — directories that contain many independent git checkouts side-by-side instead of one monorepo. It does two things:

1. **Workspace Changes view** — a clean tree in the Source Control sidebar that lists _only repos with uncommitted changes_, expandable to their changed files. No commit input boxes. No empty-repo clutter. Click a file to open its diff.
2. **Silent CLI bridge** — works with the companion [`metarepo-sc-cli`](https://www.npmjs.com/package/metarepo-sc-cli) shell tool to open diffs in VSCode _without focus stealing or dock bouncing_ as you arrow through files in the terminal.

Both features are powered by the same in-process VSCode API calls, so they share architecture, file watchers, and the diff-opening pipeline.

---

## Why this exists

VSCode's native Source Control panel was designed for monorepos: one workspace, one git repo, one commit input. When the workspace contains _many_ git repos as siblings (a meta-repo pattern common in microservice shops, ROS workspaces, and similar layouts), the native panel renders one full SCM provider per repo — including the commit message input box, Commit button, and changes list, _for every repo_ — even repos with no changes. With twenty sibling repos, that's twenty commit boxes stacked vertically.

There's no native VSCode setting to hide repos with no changes (open feature request: [microsoft/vscode#33334](https://github.com/microsoft/vscode/issues/33334), unimplemented since 2017) and no setting to hide the commit input. Extensions cannot modify the native SCM panel because VSCode's renderer DOM is not part of the extension API surface.

This extension's solution: contribute a **separate tree view** that does what the native panel won't — show only dirty repos, no commit clutter, real file-type icons, click-to-diff. The native panel can stay collapsed.

---

## Features

### Workspace Changes view (in the SCM sidebar)

- **Auto-discovers git repos** as immediate subdirectories of any open workspace folder (also handles single-repo workspaces).
- **Hides repos with no changes** — empty repos are skipped, not just sorted to the bottom.
- **Per-file rows** with the user's icon theme (Material Icon Theme, etc.) — same icons as Explorer.
- **Expand/Collapse all** buttons in the view header (collapse is built-in; expand walks repos and reveals).
- **Refresh button** for manual re-scan after terminal-side git operations.
- **Click a file → diff opens** in VSCode's diff editor (working tree vs HEAD), _focusing the diff_ so you can edit immediately.
- **Discard Changes** inline button on each file row, with a modal confirmation. Tracked files: `git checkout HEAD -- <file>`. Untracked files: deletes from disk.
- **Auto-refresh** on save / file create / delete / rename / view re-show — uses intent-aware events, not a broad file watcher, so the view sits still and doesn't show a constant loading bar.
- **Stable item IDs** so VSCode preserves expansion state across refreshes (collapsing one repo doesn't re-expand on save).

### CLI bridge (for `metarepo-sc-cli`)

- Watches `~/.config/metarepo-sc/cmd` for one-line tab-separated commands written by external tools (specifically the companion `metarepo-sc` CLI).
- Executes commands via the VSCode API with `preserveFocus: true` so VSCode never steals focus from the terminal.
- Three commands: `diff`, `open`, `close`. See [Command file format](#command-file-format) below.

The bridge is what makes the CLI's "live diff while arrowing through files in fzf" experience possible without ever leaving the terminal. Every other approach (`code --diff` from the CLI, `open -g --args`) causes either focus theft or a dock-icon bounce on macOS.

---

## Installation

### From the marketplace (recommended)

```bash
code --install-extension mattgle.metarepo-sc
```

Or search for **"Meta-Repo Source Control"** in the Extensions sidebar.

### From a local VSIX

Useful for testing pre-release builds:

```bash
git clone https://github.com/mattgle/meta-repo-source-control.git
cd meta-repo-source-control
npm install
cd packages/extension
npm run build
npx vsce package --no-dependencies --out /tmp/metarepo-sc.vsix
code --install-extension /tmp/metarepo-sc.vsix
```

Then reload your VSCode window: `⌘+⇧+P` → **Developer: Reload Window**.

---

## Usage

### Workspace Changes view

After install + reload, open the **Source Control** sidebar (`⌘+⇧+G G`). You'll see a new section titled **WORKSPACE CHANGES** above (or below) the native Source Control list.

```
WORKSPACE CHANGES                          ⟳  ⊞  ⊟
─────────────────────────────────────
▼ auth-service                                  main
   routes.ts  src                                 M
▼ payments-api                          feat/refunds
   handler.ts  src                                M
   config.json  src                               U
```

- **Header buttons**: ⟳ Refresh, ⊞ Expand All, ⊟ Collapse All.
- **Per-file inline buttons**: 📄 Open File (no diff), ↩ Discard Changes.
- **Click a file row** → opens the diff editor.
- **Status decorations** (M / U / A / D, plus colored text) come from VSCode's git extension applying its FileDecorationProvider to our `resourceUri` — no extra wiring needed.

### Recommended VSCode settings

Add to your user `settings.json`:

```jsonc
{
  // Auto-close older diff tabs as you click through files in the tree
  // view — keeps the editor pane to one diff at a time.
  "workbench.editor.limit.enabled": true,
  "workbench.editor.limit.value": 1,
  "workbench.editor.limit.perEditorGroup": false,
}
```

---

## CLI bridge — companion `metarepo-sc-cli`

The bridge component exists to support a separate shell tool, [`metarepo-sc-cli`](https://www.npmjs.com/package/metarepo-sc-cli), that does live cross-repo diff navigation in the terminal. The flow:

```
┌──────────────────┐    writes one    ┌────────────────────────────┐
│ metarepo-sc (fzf)│ ─── line ──────> │ ~/.config/metarepo-sc/cmd  │
└──────────────────┘                  └────────────────────────────┘
                                                  │ fs.watch
                                                  v
                                       ┌────────────────────────────┐
                                       │ metarepo-sc extension      │
                                       │ runs vscode.diff with      │
                                       │ preserveFocus: true        │
                                       └────────────────────────────┘
                                                  │
                                                  v
                                       VSCode silently shows the
                                       diff in its existing window
```

No `code` CLI invocation, no Apple Event activation, no dock bounce, no focus theft.

### Command file format

Single tab-separated line, _overwritten_ (not appended) per command, at `~/.config/metarepo-sc/cmd`:

| Type    | Format                                   | Effect                                                                        |
| ------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `diff`  | `diff\t<leftPath>\t<rightPath>\t<title>` | Opens VSCode's diff editor comparing the two files. Title appears in the tab. |
| `open`  | `open\t<path>`                           | Opens a file as a regular tab.                                                |
| `close` | `close`                                  | Closes the active editor (intended for "go away" cleanup).                    |

Example shell write:

```bash
mkdir -p ~/.config/metarepo-sc
printf 'diff\t/tmp/HEAD_blob.ts\t/path/to/working/file.ts\tfile.ts (HEAD ↔ Working)\n' \
  > ~/.config/metarepo-sc/cmd
```

Within ~30 ms (debounced), the bridge picks up the change and renders the diff in your existing VSCode window.

### Handling rapid commands

If the CLI writes 10 commands in quick succession (rapid arrow-key navigation), the bridge only acts on the _most recent_ line. This is intentional — it matches VSCode's SCM panel behavior of "just show me the latest selection," not "queue up 10 diff tabs."

---

## Architecture

The extension is a single TypeScript file (~370 lines) bundled to ~7 KB with esbuild. Two main subsystems share a single `openDiffForFile` helper:

```
src/extension.ts
├── Git helpers                  exec git status / branch lookups
├── openDiffForFile()            shared by tree clicks and CLI bridge
├── CLI bridge                   fs.watch on ~/.config/metarepo-sc/cmd
├── WorkspaceChangesProvider     vscode.TreeDataProvider impl
├── RepoTreeItem / FileTreeItem  typed TreeItem subclasses
└── activate()                   wires everything up
```

Key technical decisions:

- **Parallel git status** via `Promise.all` — listing 19 repos sequentially takes ~190 ms (visible loading bar); parallel is ~10 ms (invisible).
- **Intent-aware refresh events** (`onDidSaveTextDocument`, `onDidCreateFiles`, etc.) instead of `createFileSystemWatcher('**/*')` — avoids loops where the bridge's own writes trigger refresh events.
- **Stable TreeItem IDs** (`repo:<path>` and `file:<repo>:<file>`) — required for `tree.reveal()` to work and for VSCode to preserve expansion state across refreshes.
- **`getParent()` implementation** — required for `tree.reveal()` to function at all; without it, expand-all silently no-ops.
- **HEAD blobs in `<repo>/.git/metarepo-sc-tmp/`** — VSCode's default `**/.git` exclusion automatically hides them from Explorer, search, and the TypeScript language service. Filename matches the working file so diff tab titles are clean.
- **Untracked directory short-circuit** — `git status --porcelain --untracked-files=all` expands directories to their files, but the click handler still defends against directory targets in case any slip through (e.g. submodules).

---

## Troubleshooting

| Symptom                                               | Cause                                                            | Fix                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Tree view doesn't appear after install                | Reload didn't happen                                             | `⌘+⇧+P` → Developer: Reload Window                                             |
| Tree shows but Workspace Changes is empty             | Workspace folder isn't a meta-repo _and_ isn't a single git repo | Open VSCode rooted at the meta-repo directory                                  |
| Diff doesn't open when clicking a file                | Check the extension host console for errors                      | `⌘+⇧+P` → Developer: Toggle Developer Tools → Console; filter by `metarepo-sc` |
| CLI writes to `~/.config/metarepo-sc/cmd` are ignored | Bridge isn't activated                                           | Reload VSCode; verify the extension is enabled in the Extensions list          |
| Discard accidentally wiped changes                    | Confirmation dismissed too quickly                               | None — destructive operations are designed to be confirmed once and committed  |

---

## Contributing

This extension is part of the [meta-repo-source-control](https://github.com/mattgle/meta-repo-source-control) repo. See [CONTRIBUTING.md](https://github.com/mattgle/meta-repo-source-control/blob/main/CONTRIBUTING.md) for setup, build/test commands, and PR guidelines.

## License

[MIT](https://github.com/mattgle/meta-repo-source-control/blob/main/LICENSE)
