# Meta-Repo Source Control

A VSCode extension for **multi-repo workspaces** — whether a flat directory of independent git checkouts side-by-side, or an **aggregator / superproject** with git submodules nested under a parent repo (including linked worktrees).

Contributes a clean **Workspace Changes** tree to the Source Control sidebar that lists _only repos with uncommitted changes_, nested under their workspace folder, expandable to their changed files. No per-repo commit input boxes. No empty-repo clutter. Click a file to open its diff.

> This is the **GTD fork** (`gtd-local.metarepo-sc-gtd`) — it adds aggregator / superproject + nested-worktree support, submodule **bump** rows, and a modular codebase on top of upstream [`mattgle/meta-repo-source-control`](https://github.com/mattgle/meta-repo-source-control).

---

## Why this exists

VSCode's native Source Control panel was designed for monorepos: one workspace, one git repo, one commit input. When the workspace contains _many_ git repos as siblings (a meta-repo pattern common in microservice shops, ROS workspaces, and similar layouts), the native panel renders one full SCM provider per repo — including the commit message input box, Commit button, and changes list, _for every repo_ — even repos with no changes. With twenty sibling repos, that's twenty commit boxes stacked vertically.

There's no native VSCode setting to hide repos with no changes (open feature request: [microsoft/vscode#33334](https://github.com/microsoft/vscode/issues/33334), unimplemented since 2017) and no setting to hide the commit input. Extensions cannot modify the native SCM panel because VSCode's renderer DOM is not part of the extension API surface.

This extension's solution: contribute a **separate tree view** that does what the native panel won't — show only dirty repos, no commit clutter, real file-type icons, click-to-diff. The native panel can stay collapsed.

---

## Features

- **Auto-discovers git repos** under any open workspace folder — flat siblings _and_ submodules nested several levels down. The folder root is treated as an aggregator (a superproject, or a linked worktree whose `.git` is a file): it's both shown and descended into, so the submodules inside it surface.
- **Nested tree** — each changed submodule appears _under_ its workspace folder (worktree / superproject root), with the folder's own changed files directly beneath it. Gitlink "pointer" rows are filtered, so you see real file changes instead of opaque `M submodule/path` entries.
- **Submodule bump rows** — when a submodule's HEAD is ahead of the gitlink the superproject records (committed work, clean worktree), it shows as a `↑ bump` node, expandable to the files changed across `recorded..HEAD`. Click a file → a diff of the two committed blobs.
- **Hides repos with no changes** — empty repos are skipped, not just sorted to the bottom.
- **Per-file rows** with the user's icon theme (Material Icon Theme, etc.) — same icons as Explorer.
- **Expand/Collapse all** buttons in the view header — folders expand to their submodules; expand-all cascades down to files (collapse is built-in).
- **Refresh button** for manual re-scan after terminal-side git operations.
- **Click a file → diff opens** in VSCode's diff editor — working tree vs HEAD for edits, recorded-gitlink vs HEAD for bumps — _focusing the diff_ so you can edit immediately.
- **Discard Changes** inline button on working-tree file rows, with a modal confirmation. Tracked files: `git checkout HEAD -- <file>`. Untracked files: deletes from disk. (Bump rows have no inline discard — there's no working-tree change to revert.)
- **Auto-refreshes on external edits** — when an external tool (terminal git, AI agents like Claude Code, other editors) modifies a file, the view updates within ~500 ms automatically. No need to click refresh.
- **Stable item IDs** so VSCode preserves expansion state across refreshes (collapsing one node doesn't re-expand on save).

---

## Install

This GTD fork isn't published to the marketplace — build and install it from source:

```bash
git clone https://github.com/mreza0100/meta-repo-source-control.git
cd meta-repo-source-control
npm install
npm run package
code --install-extension dist/metarepo-sc-gtd-*.vsix
```

Reload VSCode afterwards (`⌘+⇧+P` → Developer: Reload Window). The only runtime requirement is `git` on `PATH`. To pull future upstream fixes: `git fetch upstream && git merge upstream/main`, then rebuild.

---

## Devcontainer setup

> The steps below install from the marketplace, which works for the **published upstream**. This GTD fork is unpublished — in a devcontainer, run the from-source build above in a `postCreateCommand`, or copy the built `.vsix` in and `code --install-extension` it.

To make the upstream extension load automatically in a devcontainer, add it to `.devcontainer/devcontainer.json`:

```jsonc
{
  "customizations": {
    "vscode": {
      "extensions": ["mattgle.metarepo-sc"],
    },
  },
}
```

When the container is built, VSCode auto-installs the extension. **No Dockerfile changes are needed** — the extension has no native dependencies beyond `git`, which every common base image already has (`mcr.microsoft.com/devcontainers/*`, `ubuntu`, `debian`, `alpine` with `apk add git`, etc.).

If your base image somehow doesn't have git, add it to your Dockerfile:

```dockerfile
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
```

That's the full devcontainer setup. After rebuild, open the **Source Control** sidebar (`⌘+⇧+G G` / `Ctrl+Shift+G G`) — the **WORKSPACE CHANGES** section appears alongside the native Source Control list.

---

## Usage

After install + reload, open the **Source Control** sidebar (`⌘+⇧+G G`). You'll see a new section titled **WORKSPACE CHANGES** above (or below) the native Source Control list.

```
WORKSPACE CHANGES                          ⟳  ⊞  ⊟
───────────────────────────────────────────────────
▼ dlb-mass-failover            worktree/dlb-mass-failover
   settings.local.json  .claude                       M
   ▸ gtd-dlb/balancer    ↑ bump · build/dlb-mass-failover
   ▸ gtd-dlb/ansible     ↑ bump · master
▼ bk-mcp                                  worktree/bk-mcp
   ▼ gtd-others/bk      ↑ bump · build/bk-cli-mcp-plugin
        cli.py           src                           M
        plugin.py        src                           M
```

- **Top level = workspace folders** (a superproject root, or each linked worktree). They expand to the changed repos beneath them.
- **Submodule nodes** sit under their folder, collapsed by default — expand to see files. A `↑ bump` badge means committed work the superproject's gitlink hasn't caught up to yet; the folder's own changed files (e.g. `settings.local.json`) sit directly under it.
- **Header buttons**: ⟳ Refresh, ⊞ Expand All (cascades folder → submodule → files), ⊟ Collapse All.
- **Per-file inline buttons**: 📄 Open File (no diff), ↩ Discard Changes (working-tree rows only).
- **Click a file row** → opens the diff (working tree ↔ HEAD for edits, recorded-gitlink ↔ HEAD for bumps).
- **Status decorations** (M / U / A / D, plus colored text) come from VSCode's git extension applying its FileDecorationProvider to our `resourceUri` — no extra wiring needed.

### Optional: avoid diff tab buildup

By default, every file you click opens its diff in a new editor tab. After clicking through 20 files in the tree, you'll have 20 diff tabs piled up. **Most users find this fine** — you can switch between them, close ones you've reviewed, etc.

If you'd rather have a "click-through" workflow where each new diff replaces the previous one (so the editor pane stays at one diff at a time), VSCode has built-in settings for that. Add to your user `settings.json` (`⌘+⇧+P` → `Preferences: Open User Settings (JSON)`):

```jsonc
{
  // Auto-close older diff tabs as you click through files in the tree
  // view — keeps the editor pane to one diff at a time.
  "workbench.editor.limit.enabled": true,
  "workbench.editor.limit.value": 1,
  "workbench.editor.limit.perEditorGroup": false,
}
```

Or, to apply this only inside a specific devcontainer (without affecting your global VSCode), add it under `customizations.vscode.settings` in `.devcontainer/devcontainer.json`.

These settings are **not part of the extension** — they're VSCode core, and the same settings affect any other tab-opening flow (clicking files in Explorer, going-to-definition, etc.). Try them and see if you like the behavior; if not, just remove them.

---

## Architecture

A small, layered TypeScript codebase bundled to ~11 KB with esbuild. Dependencies flow one way — `config ← git ← model ← tree / commands ← extension` — and the `git` and `model` layers never import `vscode`, so they're unit-testable in isolation.

```
src/
├── config.ts          brand + tuning constants (view id, command ids, scan depth)
├── extension.ts       activate(): wiring only — provider, tree view, watchers, commands
├── git/
│   ├── exec.ts        execGit / showBlob / runGit — the process layer
│   ├── status.ts      FileStatus + BumpRef types, line parsers, status/branch/bump queries
│   └── discover.ts    discoverRepos() — aggregator-aware repo walk
├── model/
│   └── scan.ts        scanWorkspace() → nested Folder → Repo → FileChange model (no vscode)
├── tree/
│   ├── items.ts       Folder / Repo / File TreeItem subclasses
│   └── provider.ts    WorkspaceChangesProvider — maps the model to a 3-level tree
├── commands/
│   ├── diff.ts        openDiffForFile() — working-tree and bump (committed-blob) diffs
│   ├── discard.ts     discardChanges / discardAllChanges
│   └── register.ts    binds command ids to handlers
└── watch/
    └── watcher.ts     shouldIgnorePath() + debounced refresh wiring
```

This is the **GTD fork** (`gtd-local.metarepo-sc-gtd`), tuned for aggregator / superproject workspaces — git submodules nested under a parent repo, including linked worktrees. Beyond the upstream flat-meta-repo behaviour it adds:

- **Aggregator-aware discovery** — the workspace-folder root is treated as an aggregator (recorded _and_ descended into), and nested repos are found as leaves at any depth, instead of short-circuiting on the root's own `.git`.
- **Nested tree** — submodules render _under_ their folder root (worktree / mothership), with the aggregator's own files directly beneath it; gitlink "pointer" rows are filtered.
- **Bump rows** — a submodule whose HEAD is ahead of the recorded gitlink (committed work, clean worktree) surfaces as a `↑ bump` node, expandable to the files changed across `recorded..HEAD`, click-to-diff on the committed blobs.

Key technical decisions:

- **Parallel git status** via `Promise.all` — listing dozens of repos sequentially shows a loading bar; parallel is ~the slowest single repo.
- **Two-source refresh** — VSCode-internal events (`onDidSaveTextDocument`, `onDidCreateFiles`, etc.) fire fast for in-editor saves; a broad `createFileSystemWatcher('**/*')` catches changes from external tools (terminal git, AI agents, other editors). `shouldIgnorePath()` filters out `.git/` internals, `node_modules/`, build outputs, `*.tsbuildinfo`, and OS metadata to prevent refresh churn. Both paths feed a single 500 ms debounced refresh.
- **Stable TreeItem IDs** (`folder:<path>`, `repo:<path>`, `file:<repo>:<file>`) — required for `tree.reveal()` to work and for VSCode to preserve expansion state across refreshes.
- **`getParent()` via parent pointers** — required for `tree.reveal()` / expand-all to function; without it, expand-all silently no-ops.
- **HEAD blobs in `<repo>/.git/metarepo-sc-tmp/`** — VSCode's default `**/.git` exclusion automatically hides them from Explorer, search, and the TypeScript language service. Filename matches the working file so diff tab titles are clean.
- **Untracked directory short-circuit** — `git status --porcelain --untracked-files=all` expands directories to their files, but the click handler still defends against directory targets in case any slip through (e.g. submodules).

---

## Troubleshooting

| Symptom                                   | Cause                                                            | Fix                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Tree view doesn't appear after install    | Reload didn't happen                                             | `⌘+⇧+P` → Developer: Reload Window                                             |
| Tree shows but Workspace Changes is empty | Workspace folder isn't a meta-repo _and_ isn't a single git repo | Open VSCode rooted at the meta-repo directory                                  |
| Diff doesn't open when clicking a file    | Check the extension host console for errors                      | `⌘+⇧+P` → Developer: Toggle Developer Tools → Console; filter by `metarepo-sc` |
| View doesn't refresh after external edits | Broad watcher disabled or the path matches the ignore filter     | Check that the path isn't under `.git/`, `node_modules/`, `dist/`, etc.        |
| Discard accidentally wiped changes        | Confirmation dismissed too quickly                               | None — destructive operations are designed to be confirmed once and committed  |

---

## Contributing

This extension lives in [`mattgle/meta-repo-source-control`](https://github.com/mattgle/meta-repo-source-control). See [CONTRIBUTING.md](https://github.com/mattgle/meta-repo-source-control/blob/main/CONTRIBUTING.md) for setup, build/test commands, and PR guidelines.

## License

[MIT](https://github.com/mattgle/meta-repo-source-control/blob/main/LICENSE)
