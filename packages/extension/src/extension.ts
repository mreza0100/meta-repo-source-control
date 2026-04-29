// metarepo-sc — Source control UX for meta-repo workspaces.
//
// TWO RESPONSIBILITIES:
//   1. CLI BRIDGE: watches ~/.config/metarepo-sc/cmd; when an external tool
//      (e.g. the companion `metarepo-sc` shell script) writes a diff/open
//      command there, runs it via the VSCode API silently — no focus steal,
//      no dock bounce, no app activation.
//   2. TREE VIEW: contributes a "Workspace Changes" view in the SCM sidebar
//      that lists only repos with uncommitted changes, expandable to their
//      changed files. Click a file to diff/open it (uses the same in-process
//      pathway as the CLI bridge — same code, no IPC).
//
// COMMAND FILE FORMAT (single tab-separated line, overwritten per command):
//   diff\t<leftPath>\t<rightPath>\t<title>
//   open\t<path>
//   close

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const COMMAND_FILE = path.join(os.homedir(), ".config", "metarepo-sc", "cmd");
const TMP_DIR_NAME = "metarepo-sc-tmp";
const LOG_PREFIX = "metarepo-sc";
const DEBOUNCE_MS = 30;
const TREE_REFRESH_DEBOUNCE_MS = 500;

const VIEW_ID = "metarepoSc.changes";

const CMD = {
  refresh: "metarepoSc.refresh",
  openDiff: "metarepoSc.openDiff",
  openFile: "metarepoSc.openFile",
  expandAll: "metarepoSc.expandAll",
  discardChanges: "metarepoSc.discardChanges",
} as const;

// ─────────────────────────────────────────────────────────────────────
// Git helpers
// ─────────────────────────────────────────────────────────────────────

function execGit(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    cp.execFile("git", ["-C", repoPath, ...args], { encoding: "utf8" }, (err, stdout) => {
      resolve(err ? "" : stdout);
    });
  });
}

interface FileStatus {
  status: string;
  file: string;
}

async function getStatus(repoPath: string): Promise<FileStatus[]> {
  // --untracked-files=all expands untracked directories to their individual
  // files, matching VSCode's native SCM panel. Default is `normal` which
  // would collapse e.g. `coverage/` into one row hiding its 50 inner files.
  const stdout = await execGit(repoPath, ["status", "--porcelain", "--untracked-files=all"]);
  if (!stdout) return [];
  return stdout
    .split("\n")
    .filter((l) => l.length > 3)
    .map((l) => ({ status: l.slice(0, 2), file: l.slice(3) }));
}

async function getBranch(repoPath: string): Promise<string> {
  const stdout = await execGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

// ─────────────────────────────────────────────────────────────────────
// Diff opening — shared by tree-view clicks and CLI bridge
// ─────────────────────────────────────────────────────────────────────

interface OpenDiffOptions {
  preserveFocus?: boolean;
}

async function openDiffForFile(
  repoPath: string,
  file: string,
  status: string,
  options: OpenDiffOptions = {},
): Promise<void> {
  const showOptions = {
    preserveFocus: options.preserveFocus !== false,
    preview: true,
  };

  const target = path.join(repoPath, file);

  // Untracked file or directory: just open it (no HEAD to diff against).
  if (status.includes("?")) {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      // Don't disturb VSCode for untracked directories.
      return;
    }
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(target), showOptions);
    return;
  }

  // Materialise HEAD blob inside the repo's .git/metarepo-sc-tmp/ so VSCode's
  // default `**/.git` exclusion keeps it out of Explorer/search/TS service.
  const tmpPath = path.join(repoPath, ".git", TMP_DIR_NAME, file);
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });

  const head = await new Promise<string>((resolve) => {
    cp.execFile(
      "git",
      ["-C", repoPath, "show", `HEAD:${file}`],
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
      (err, stdout) => resolve(err ? "" : stdout),
    );
  });
  fs.writeFileSync(tmpPath, head);

  const fileName = path.basename(file);
  await vscode.commands.executeCommand(
    "vscode.diff",
    vscode.Uri.file(tmpPath),
    vscode.Uri.file(target),
    `${fileName} (HEAD ↔ Working)`,
    showOptions,
  );
}

// ─────────────────────────────────────────────────────────────────────
// CLI bridge — watches ~/.config/metarepo-sc/cmd
// ─────────────────────────────────────────────────────────────────────

let lastBridgeContent = "";

async function executeBridgeCommand(line: string): Promise<void> {
  const [type = "", ...args] = line.split("\t");
  const showOptions = { preserveFocus: true, preview: true };

  try {
    if (type === "diff" && args.length >= 2) {
      const [leftPath = "", rightPath = "", title] = args;
      const titleText = title || `${path.basename(rightPath)} (HEAD ↔ Working)`;
      await vscode.commands.executeCommand(
        "vscode.diff",
        vscode.Uri.file(leftPath),
        vscode.Uri.file(rightPath),
        titleText,
        showOptions,
      );
    } else if (type === "open" && args.length >= 1) {
      const [target = ""] = args;
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(target), showOptions);
    } else if (type === "close") {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
  } catch (err) {
    console.error(`${LOG_PREFIX}: bridge command failed`, { line, err });
  }
}

function readAndDispatchBridge(): void {
  let content: string;
  try {
    content = fs.readFileSync(COMMAND_FILE, "utf8");
  } catch {
    return;
  }
  if (content === lastBridgeContent) return;
  lastBridgeContent = content;

  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return;
  const lastLine = lines[lines.length - 1];
  if (lastLine === undefined) return;
  void executeBridgeCommand(lastLine);
}

// ─────────────────────────────────────────────────────────────────────
// Tree view
// ─────────────────────────────────────────────────────────────────────

function statusBadge(s: string): string {
  const trimmed = s.trim();
  if (trimmed === "??") return "U";
  const first = trimmed.charAt(0);
  const second = trimmed.charAt(1);
  return first === " " ? second || "?" : first || "?";
}

class RepoTreeItem extends vscode.TreeItem {
  constructor(
    public readonly repoName: string,
    public readonly repoPath: string,
    public readonly changeCount: number,
    branch: string,
  ) {
    super(repoName, vscode.TreeItemCollapsibleState.Expanded);
    // Stable id so VSCode preserves expansion state across refreshes AND
    // matches the item in tree.reveal() calls.
    this.id = `repo:${repoPath}`;
    this.description = branch;
    this.tooltip = `${repoPath}\n${branch || "(detached)"} · ${changeCount} change${changeCount === 1 ? "" : "s"}`;
    this.iconPath = new vscode.ThemeIcon("repo");
    this.contextValue = "repo";
  }
}

class FileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly repoPath: string,
    public readonly filePath: string,
    public readonly gitStatus: string,
  ) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);
    const dir = path.dirname(filePath);
    this.id = `file:${repoPath}:${filePath}`;
    this.description = dir === "." ? "" : dir;
    this.tooltip = `${filePath}\n${gitStatus.trim()} (${statusBadge(gitStatus)})`;
    // Intentionally NOT setting iconPath: when only resourceUri is set,
    // VSCode hands the file URI to the active icon theme (Material Icon
    // Theme, etc.) and renders the matching file-type icon. Setting
    // iconPath would override and force a generic codicon.
    this.resourceUri = vscode.Uri.file(path.join(repoPath, filePath));
    this.contextValue = "file";
    // Single-click → diff. Focus moves to the editor since this is an
    // explicit click (unlike fzf navigation where preserveFocus matters).
    this.command = {
      command: CMD.openDiff,
      title: "Open Diff",
      arguments: [this],
    };
  }
}

type WorkspaceTreeItem = RepoTreeItem | FileTreeItem;

class WorkspaceChangesProvider implements vscode.TreeDataProvider<WorkspaceTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<WorkspaceTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Cache of the most recently produced repo nodes — used by getParent()
  // when we receive a file element and need to walk up to its repo.
  private _currentRepos: RepoTreeItem[] = [];

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: WorkspaceTreeItem): vscode.TreeItem {
    return element;
  }

  // tree.reveal() requires this. For a file element, return the cached repo
  // node by repoPath. For repo elements (roots), return null. Without this
  // method defined at all, reveal() silently does nothing.
  getParent(element: WorkspaceTreeItem): WorkspaceTreeItem | null {
    if (element instanceof FileTreeItem) {
      return this._currentRepos.find((r) => r.repoPath === element.repoPath) ?? null;
    }
    return null;
  }

  // Convenience for the expand-all command: get the current top-level
  // repos without going through getChildren() (which would re-run all
  // git status calls).
  getCurrentRepos(): RepoTreeItem[] {
    return this._currentRepos;
  }

  async getChildren(element?: WorkspaceTreeItem): Promise<WorkspaceTreeItem[]> {
    if (!element) {
      this._currentRepos = await this._buildRepoNodes();
      return this._currentRepos;
    }
    if (element instanceof RepoTreeItem) {
      return this._buildFileNodes(element);
    }
    return [];
  }

  private async _buildRepoNodes(): Promise<RepoTreeItem[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const allRepos: RepoTreeItem[] = [];

    for (const folder of folders) {
      const root = folder.uri.fsPath;

      // Case 1: workspace folder is itself a single git repo.
      if (fs.existsSync(path.join(root, ".git"))) {
        const status = await getStatus(root);
        if (status.length > 0) {
          allRepos.push(await this._makeRepoItem(folder.name, root, status));
        }
        continue;
      }

      // Case 2: meta-repo — workspace folder's children are git repos.
      // Run git status across all candidate repos in parallel: 19 repos at
      // ~10 ms sequential = ~190 ms; parallel ~= max single repo, ~10 ms.
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }

      const candidates = entries
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, ".git")))
        .map((e) => ({ name: e.name, path: path.join(root, e.name) }));

      const dirty = (
        await Promise.all(candidates.map(async (c) => ({ ...c, status: await getStatus(c.path) })))
      ).filter((c) => c.status.length > 0);

      const items = await Promise.all(dirty.map((c) => this._makeRepoItem(c.name, c.path, c.status)));
      items.sort((a, b) => a.repoName.localeCompare(b.repoName));
      allRepos.push(...items);
    }

    return allRepos;
  }

  private async _makeRepoItem(name: string, repoPath: string, status: FileStatus[]): Promise<RepoTreeItem> {
    const branch = await getBranch(repoPath);
    return new RepoTreeItem(name, repoPath, status.length, branch);
  }

  private async _buildFileNodes(repoNode: RepoTreeItem): Promise<FileTreeItem[]> {
    const status = await getStatus(repoNode.repoPath);
    return status.map(({ status: s, file }) => new FileTreeItem(repoNode.repoPath, file, s));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Activation
// ─────────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // ── CLI bridge ─────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(COMMAND_FILE), { recursive: true });
  if (!fs.existsSync(COMMAND_FILE)) fs.writeFileSync(COMMAND_FILE, "");

  let bridgeDebounce: NodeJS.Timeout | null = null;
  const bridgeWatcher = fs.watch(COMMAND_FILE, () => {
    if (bridgeDebounce) clearTimeout(bridgeDebounce);
    bridgeDebounce = setTimeout(readAndDispatchBridge, DEBOUNCE_MS);
  });
  context.subscriptions.push({
    dispose: () => {
      if (bridgeDebounce) clearTimeout(bridgeDebounce);
      bridgeWatcher.close();
    },
  });
  setTimeout(readAndDispatchBridge, 100);

  // ── Tree view ──────────────────────────────────────────────────────
  const provider = new WorkspaceChangesProvider();
  const tree = vscode.window.createTreeView<WorkspaceTreeItem>(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(tree);

  // Refresh on intent-aware events only — not on every disk wiggle. A
  // broad file watcher (`**/*`) would fire for our own .git/metarepo-sc-tmp
  // writes, TS language service .tsbuildinfo updates, auto-saves, and so
  // on, producing a constant "loading" state. These four sources cover
  // every actual change without the noise.
  let refreshTimer: NodeJS.Timeout | null = null;
  const scheduleRefresh = (delay: number = TREE_REFRESH_DEBOUNCE_MS): void => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => provider.refresh(), delay);
  };

  context.subscriptions.push(
    // User saved a file (the most common trigger).
    vscode.workspace.onDidSaveTextDocument(() => scheduleRefresh(150)),
    // User created or deleted files via Explorer / extension actions.
    vscode.workspace.onDidCreateFiles(() => scheduleRefresh(150)),
    vscode.workspace.onDidDeleteFiles(() => scheduleRefresh(150)),
    vscode.workspace.onDidRenameFiles(() => scheduleRefresh(150)),
    // Workspace folder set changed (rare but worth handling).
    vscode.workspace.onDidChangeWorkspaceFolders(() => scheduleRefresh(0)),
    // User toggled into our view — refresh so what they see is current,
    // even if external changes (terminal git ops) happened while away.
    tree.onDidChangeVisibility((e) => {
      if (e.visible) scheduleRefresh(0);
    }),
  );

  // ── Commands ───────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.refresh, () => provider.refresh()),

    vscode.commands.registerCommand(CMD.openDiff, async (item: unknown) => {
      if (!(item instanceof FileTreeItem)) return;
      await openDiffForFile(item.repoPath, item.filePath, item.gitStatus, {
        preserveFocus: false,
      });
    }),

    vscode.commands.registerCommand(CMD.openFile, async (item: unknown) => {
      if (!(item instanceof FileTreeItem)) return;
      const target = vscode.Uri.file(path.join(item.repoPath, item.filePath));
      await vscode.commands.executeCommand("vscode.open", target, { preview: false });
    }),

    // Expand-all: VSCode has a built-in collapse-all (enabled via
    // `showCollapseAll: true` on createTreeView), but no built-in
    // expand-all. We use tree.reveal() on each top-level repo with
    // `expand: true`, which makes its file children visible.
    //
    // Two requirements for reveal() to work, both met above:
    //   1. provider.getParent() must be implemented.
    //   2. Each TreeItem must have a stable `id` so VSCode can match the
    //      passed-in instance against the one it's tracking internally.
    vscode.commands.registerCommand(CMD.expandAll, async () => {
      // Use the cached repos from the last getChildren() call so we don't
      // re-run all git status calls. If the cache is empty (extension just
      // activated and view never opened), fetch them once.
      let repos: RepoTreeItem[] = provider.getCurrentRepos();
      if (repos.length === 0) {
        const fetched = await provider.getChildren();
        repos = fetched.filter((n): n is RepoTreeItem => n instanceof RepoTreeItem);
      }
      for (const repo of repos) {
        try {
          await tree.reveal(repo, { expand: true, select: false, focus: false });
        } catch (err) {
          console.error(`${LOG_PREFIX}: expandAll reveal failed`, err);
        }
      }
    }),

    // Discard mirrors VSCode's native SCM behaviour:
    //   * Tracked file → `git checkout HEAD -- <file>` (resets index AND
    //     worktree to HEAD in one command, wiping staged + unstaged).
    //   * Untracked file → just delete from disk.
    // A modal warning blocks accidental clicks; cancelling is safe.
    vscode.commands.registerCommand(CMD.discardChanges, async (item: unknown) => {
      if (!(item instanceof FileTreeItem)) return;
      const fileName = path.basename(item.filePath);
      const isUntracked = item.gitStatus.includes("?");

      const message = isUntracked
        ? `Are you sure you want to DELETE the following file?\n\n${fileName}\n\nThis is IRREVERSIBLE!`
        : `Are you sure you want to discard changes in '${fileName}'?\n\nThis is IRREVERSIBLE!`;
      const confirmLabel = isUntracked ? "Delete File" : "Discard Changes";

      const choice = await vscode.window.showWarningMessage(message, { modal: true }, confirmLabel);
      if (choice !== confirmLabel) return;

      const fullPath = path.join(item.repoPath, item.filePath);
      try {
        if (isUntracked) {
          await fs.promises.unlink(fullPath);
        } else {
          await execGit(item.repoPath, ["checkout", "HEAD", "--", item.filePath]);
        }
        provider.refresh();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`${LOG_PREFIX}: discard failed for ${fileName}: ${errorMessage}`);
      }
    }),
  );
}

export function deactivate(): void {
  // Nothing to do — all resources were registered via context.subscriptions
  // and will be disposed automatically by VSCode.
}

// Exported for unit tests; not part of the public extension surface.
export const __testing = {
  statusBadge,
  COMMAND_FILE,
  TMP_DIR_NAME,
  CMD,
  VIEW_ID,
};
