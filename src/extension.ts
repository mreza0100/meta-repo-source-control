// metarepo-sc — Source control UX for meta-repo workspaces.
//
// Contributes a "Workspace Changes" view to the SCM sidebar that lists only
// repos with uncommitted changes, expandable to their changed files. Click a
// file to open its working-tree-vs-HEAD diff in the editor.

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

const TMP_DIR_NAME = "metarepo-sc-tmp";
const LOG_PREFIX = "metarepo-sc";
const TREE_REFRESH_DEBOUNCE_MS = 500;

const VIEW_ID = "metarepoSc.changes";

const CMD = {
  refresh: "metarepoSc.refresh",
  openDiff: "metarepoSc.openDiff",
  openFile: "metarepoSc.openFile",
  expandAll: "metarepoSc.expandAll",
  discardChanges: "metarepoSc.discardChanges",
  discardAllChanges: "metarepoSc.discardAllChanges",
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
  // Working-tree path (destination of a rename/copy, otherwise just the path).
  file: string;
  // HEAD-side path for renamed/copied rows. Undefined for non-rename rows.
  // Needed because `git show HEAD:<file>` fails when `file` is the new
  // path of a rename — HEAD doesn't have it; HEAD has the old path.
  sourcePath?: string;
}

// Parse one line of `git status --porcelain` into status + file (+ sourcePath
// for renames/copies). Porcelain v1 reports renames as "R  old -> new".
function parseStatusLine(line: string): FileStatus {
  const status = line.slice(0, 2);
  const filePart = line.slice(3);
  const arrowIdx = filePart.indexOf(" -> ");
  if (arrowIdx >= 0) {
    return {
      status,
      sourcePath: filePart.slice(0, arrowIdx),
      file: filePart.slice(arrowIdx + 4),
    };
  }
  return { status, file: filePart };
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
    .map(parseStatusLine);
}

async function getBranch(repoPath: string): Promise<string> {
  const stdout = await execGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

// How deep to walk a workspace folder looking for nested git repos. Submodules
// under an aggregator live a few levels down (e.g. `gtd-dns/<repo>` is depth 2);
// 3 covers grouped layouts without an unbounded crawl.
const MAX_SCAN_DEPTH = 3;

// Discover git repos under a workspace folder.
//
// The folder root is the *aggregator*: if it is itself a git repo (an
// aggregator/superproject, or a linked worktree whose `.git` is a FILE), it is
// recorded AND descended into — so its nested submodules are still found. This
// is the critical difference from a naive "found .git, stop" scan, which would
// short-circuit on the root and never see the submodules inside it.
//
// Any NESTED dir containing `.git` (file or dir) is a leaf repo — recorded, not
// descended into. Dot-dirs (`.git`, `.worktrees`, `.claude`), `node_modules`,
// and common build outputs are skipped so the walk stays cheap (it stops at
// each repo and never enters one).
async function discoverRepos(
  root: string,
): Promise<{ aggregator: string | null; subRepos: string[] }> {
  const skip = new Set(["node_modules", "dist", "out", "build", "coverage", "target", "vendor"]);
  const subRepos: string[] = [];
  const aggregator = fs.existsSync(path.join(root, ".git")) ? root : null;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".")) continue; // .git, .worktrees, .claude, …
      if (skip.has(e.name)) continue;
      const child = path.join(dir, e.name);
      if (fs.existsSync(path.join(child, ".git"))) {
        subRepos.push(child); // leaf repo — record, don't descend into it
      } else {
        await walk(child, depth + 1); // keep looking deeper
      }
    }
  }

  await walk(root, 1);
  return { aggregator, subRepos };
}

// Mutating git commands need their stderr surfaced — `execGit` swallows errors
// (returns "" on failure), which is fine for read-only queries but hides real
// problems for commands like `checkout` / `reset` / `clean`.
function runGitOrThrow(repoPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    cp.execFile("git", ["-C", repoPath, ...args], { encoding: "utf8" }, (err, _stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve();
    });
  });
}

// `git show <ref>:<path>` → file contents, or "" if the path doesn't exist at
// that ref (one side of an add/delete). Errors are swallowed: a missing blob is
// a legitimate empty side of a diff, not a failure.
function gitShowBlob(repoPath: string, ref: string, blobPath: string): Promise<string> {
  return new Promise((resolve) => {
    cp.execFile(
      "git",
      ["-C", repoPath, "show", `${ref}:${blobPath}`],
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
      (err, stdout) => resolve(err ? "" : stdout),
    );
  });
}

// A submodule "bump": its checked-out HEAD has advanced past the commit the
// superproject records for it (the gitlink), with no uncommitted files. The
// change to review is the commit range recorded..HEAD.
interface BumpRef {
  baseRef: string; // gitlink the superproject records (range start)
  headRef: string; // submodule's current HEAD (range end)
  basePath: string; // path at baseRef (== file unless renamed in range)
}

// SHA the superproject records for a submodule, read from its HEAD tree.
// Empty if relPath isn't a gitlink (type "commit") there.
async function getRecordedGitlink(aggregatorPath: string, relPath: string): Promise<string> {
  const out = await execGit(aggregatorPath, ["ls-tree", "HEAD", "--", relPath]);
  const m = out.match(/^\S+ commit (\S+)\t/);
  return m?.[1] ?? "";
}

// Parse one `git diff --name-status -M` line: "M\tfile", "A\tfile", "D\tfile",
// "R100\told\tnew". Tab-separated, no leading space (unlike porcelain). The
// status is normalised to a 2-char code so statusBadge() renders it like a
// working-tree row.
function parseNameStatusLine(line: string): FileStatus {
  const parts = line.split("\t");
  const letter = (parts[0] ?? "").charAt(0);
  if ((letter === "R" || letter === "C") && parts.length >= 3) {
    return { status: ` ${letter}`, sourcePath: parts[1] ?? "", file: parts[2] ?? "" };
  }
  return { status: ` ${letter}`, file: parts[1] ?? "" };
}

// Files changed across a bump range — the contents of the bump.
async function getBumpFiles(repoPath: string, base: string, head: string): Promise<FileStatus[]> {
  const out = await execGit(repoPath, ["diff", "--name-status", "-M", base, head]);
  if (!out) return [];
  return out
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map(parseNameStatusLine);
}

// ─────────────────────────────────────────────────────────────────────
// Diff opening — invoked when the user clicks a file row in the tree.
// ─────────────────────────────────────────────────────────────────────

async function openDiffForFile(
  repoPath: string,
  file: string,
  status: string,
  sourcePath?: string,
  bump?: BumpRef,
): Promise<void> {
  const showOptions = { preserveFocus: false, preview: true };

  // Bump row: diff the two COMMITTED blobs (recorded gitlink ↔ current HEAD).
  // Both sides are materialised; an add/delete in the range yields an empty
  // side. No working-tree file is involved — a clean bump has none.
  if (bump) {
    const basePath = bump.basePath || file;
    const baseTmp = path.join(repoPath, ".git", TMP_DIR_NAME, "bump-base", file);
    const headTmp = path.join(repoPath, ".git", TMP_DIR_NAME, "bump-head", file);
    fs.mkdirSync(path.dirname(baseTmp), { recursive: true });
    fs.mkdirSync(path.dirname(headTmp), { recursive: true });
    fs.writeFileSync(baseTmp, await gitShowBlob(repoPath, bump.baseRef, basePath));
    fs.writeFileSync(headTmp, await gitShowBlob(repoPath, bump.headRef, file));
    const title = `${path.basename(file)} (bump ${bump.baseRef.slice(0, 8)} ↔ ${bump.headRef.slice(0, 8)})`;
    await vscode.commands.executeCommand(
      "vscode.diff",
      vscode.Uri.file(baseTmp),
      vscode.Uri.file(headTmp),
      title,
      showOptions,
    );
    return;
  }

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

  // For renamed/copied rows, HEAD knows the file under the OLD path
  // (sourcePath) — looking up `git show HEAD:<file>` for the new path
  // returns nothing. Use sourcePath for the HEAD blob; this gives a
  // semantically correct diff (clean rename → no content diff).
  const headPath = sourcePath ?? file;

  // Materialise HEAD blob inside the repo's .git/metarepo-sc-tmp/ so VSCode's
  // default `**/.git` exclusion keeps it out of Explorer/search/TS service.
  const tmpPath = path.join(repoPath, ".git", TMP_DIR_NAME, file);
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
  fs.writeFileSync(tmpPath, await gitShowBlob(repoPath, "HEAD", headPath));

  const fileName = path.basename(file);
  const sourceName = sourcePath ? path.basename(sourcePath) : null;
  // Show "old → new" in the tab title for renames where the basename
  // actually changed (skip the arrow when only the directory moved, since
  // both basenames are the same).
  const title =
    sourceName && sourceName !== fileName
      ? `${sourceName} → ${fileName} (HEAD ↔ Working)`
      : `${fileName} (HEAD ↔ Working)`;

  await vscode.commands.executeCommand(
    "vscode.diff",
    vscode.Uri.file(tmpPath),
    vscode.Uri.file(target),
    title,
    showOptions,
  );
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
    // Aggregator nodes filter their gitlink rows when expanded; submodule
    // nodes with a bump range carry its endpoints so file children rebuild.
    public readonly isAggregator: boolean = false,
    public readonly bumpBase?: string,
    public readonly bumpHead?: string,
  ) {
    super(repoName, vscode.TreeItemCollapsibleState.Expanded);
    // Stable id so VSCode preserves expansion state across refreshes AND
    // matches the item in tree.reveal() calls.
    this.id = `repo:${repoPath}`;
    const isBump = !!(bumpBase && bumpHead);
    this.description = isBump ? `↑ bump${branch ? ` · ${branch}` : ""}` : branch;
    this.tooltip =
      `${repoPath}\n${branch || "(detached)"} · ${changeCount} change${changeCount === 1 ? "" : "s"}` +
      (isBump ? `\nbump ${bumpBase.slice(0, 8)} → ${bumpHead.slice(0, 8)}` : "");
    this.iconPath = new vscode.ThemeIcon(isBump ? "arrow-up" : "repo");
    this.contextValue = "repo";
  }
}

class FileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly repoPath: string,
    public readonly filePath: string,
    public readonly gitStatus: string,
    // For renamed/copied rows: the HEAD-side path. Used when looking up
    // the HEAD blob for diffing — without it the lookup fails because
    // HEAD doesn't have the new path.
    public readonly sourcePath?: string,
    // Set for bump rows (a committed-range change). Undefined for working-tree
    // rows. Drives the diff (committed blobs) and a distinct id/contextValue.
    public readonly bump?: BumpRef,
  ) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);
    const dir = path.dirname(filePath);
    // Distinct id prefix so a file that is BOTH a working change and in the
    // bump range yields two non-colliding rows.
    this.id = `${bump ? "bumpfile" : "file"}:${repoPath}:${filePath}`;
    this.description = dir === "." ? "" : dir;
    const renameNote = sourcePath ? `\nrenamed from ${sourcePath}` : "";
    const bumpNote = bump ? `\nbump ${bump.baseRef.slice(0, 8)} ↔ ${bump.headRef.slice(0, 8)}` : "";
    this.tooltip = `${filePath}\n${gitStatus.trim()} (${statusBadge(gitStatus)})${renameNote}${bumpNote}`;
    // Intentionally NOT setting iconPath: when only resourceUri is set,
    // VSCode hands the file URI to the active icon theme (Material Icon
    // Theme, etc.) and renders the matching file-type icon. Setting
    // iconPath would override and force a generic codicon.
    this.resourceUri = vscode.Uri.file(path.join(repoPath, filePath));
    // "bumpfile" (vs "file") suppresses the discard/open-file inline buttons —
    // a committed-range row has no working-tree change to discard.
    this.contextValue = bump ? "bumpfile" : "file";
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
      const { aggregator, subRepos } = await discoverRepos(root);

      // Submodule paths relative to the aggregator root — used to drop the
      // aggregator's gitlink "pointer" rows. A changed submodule surfaces in
      // the aggregator's `git status` as an opaque ` M <path>` line; we hide
      // that and show the submodule as its own node (working files and/or bump).
      const subRel = new Set(subRepos.map((p) => path.relative(root, p)));

      type Cand = { name: string; path: string; isAggregator: boolean };
      const candidates: Cand[] = [];
      if (aggregator) candidates.push({ name: folder.name, path: aggregator, isAggregator: true });
      for (const sub of subRepos) {
        candidates.push({ name: path.relative(root, sub), path: sub, isAggregator: false });
      }

      // Parallel scan. Each repo: working-tree status, plus (for a submodule)
      // its bump range — committed work the superproject's gitlink hasn't
      // caught up to. A repo is shown if it has working changes OR a bump.
      const built = await Promise.all(
        candidates.map(async (c) => {
          let working = await getStatus(c.path);
          if (c.isAggregator) {
            working = working.filter((s) => !subRel.has(s.file));
            return { ...c, working, bumpBase: "", bumpHead: "", bumpCount: 0 };
          }
          const recorded = aggregator ? await getRecordedGitlink(aggregator, c.name) : "";
          const head = (await execGit(c.path, ["rev-parse", "HEAD"])).trim();
          const isBump = !!recorded && !!head && recorded !== head;
          const bumpCount = isBump ? (await getBumpFiles(c.path, recorded, head)).length : 0;
          return {
            ...c,
            working,
            bumpBase: isBump ? recorded : "",
            bumpHead: isBump ? head : "",
            bumpCount,
          };
        }),
      );

      const dirty = built.filter((c) => c.working.length + c.bumpCount > 0);
      const items = await Promise.all(
        dirty.map(async (c) => {
          const branch = await getBranch(c.path);
          return new RepoTreeItem(
            c.name,
            c.path,
            c.working.length + c.bumpCount,
            branch,
            c.isAggregator,
            c.bumpBase || undefined,
            c.bumpHead || undefined,
          );
        }),
      );
      items.sort((a, b) => a.repoName.localeCompare(b.repoName));
      allRepos.push(...items);
    }

    return allRepos;
  }

  private async _buildFileNodes(repoNode: RepoTreeItem): Promise<FileTreeItem[]> {
    let working = await getStatus(repoNode.repoPath);
    if (repoNode.isAggregator) {
      // Re-derive the gitlink paths to filter (cheap: stops at each repo).
      const { subRepos } = await discoverRepos(repoNode.repoPath);
      const subRel = new Set(subRepos.map((p) => path.relative(repoNode.repoPath, p)));
      working = working.filter((s) => !subRel.has(s.file));
    }
    const workingItems = working.map(
      ({ status, file, sourcePath }) => new FileTreeItem(repoNode.repoPath, file, status, sourcePath),
    );

    let bumpItems: FileTreeItem[] = [];
    if (repoNode.bumpBase && repoNode.bumpHead) {
      const base = repoNode.bumpBase;
      const head = repoNode.bumpHead;
      const files = await getBumpFiles(repoNode.repoPath, base, head);
      bumpItems = files.map(
        ({ status, file, sourcePath }) =>
          new FileTreeItem(repoNode.repoPath, file, status, sourcePath, {
            baseRef: base,
            headRef: head,
            basePath: sourcePath ?? file,
          }),
      );
    }
    return [...workingItems, ...bumpItems];
  }
}

// Path filter for the broad filesystem watcher. We want to refresh on
// real source changes but ignore paths that change constantly without
// affecting `git status` output: our own HEAD-blob writes, dependency
// install churn, build outputs, TS incremental build state, OS cruft.
//
// Returns true if the path should be ignored (refresh suppressed).
function shouldIgnorePath(fsPath: string): boolean {
  const segmentDenylist = ["/.git/", "/node_modules/", "/dist/", "/out/", "/build/", "/coverage/"];
  if (segmentDenylist.some((s) => fsPath.includes(s))) return true;

  const extensionDenylist = [".tsbuildinfo", ".log", ".swp", ".swo"];
  if (extensionDenylist.some((ext) => fsPath.endsWith(ext))) return true;

  const basenameDenylist = [".DS_Store", "Thumbs.db"];
  return basenameDenylist.some((b) => fsPath.endsWith("/" + b));
}

// ─────────────────────────────────────────────────────────────────────
// Activation
// ─────────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const provider = new WorkspaceChangesProvider();
  const tree = vscode.window.createTreeView<WorkspaceTreeItem>(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(tree);

  // Two refresh sources, deduped by a single debounced timer:
  //   1. Intent-aware events (onDidSaveTextDocument etc.) — fire fast for
  //      VSCode-internal file changes; preferred path for in-editor saves.
  //   2. Broad filesystem watcher — catches changes from external tools
  //      (terminal git, agents, other editors) that bypass VSCode's API
  //      events. shouldIgnorePath() filters out the noisy paths that
  //      would otherwise cause constant refresh churn (.git internals,
  //      .tsbuildinfo from the TS daemon, etc.).
  let refreshTimer: NodeJS.Timeout | null = null;
  const scheduleRefresh = (delay: number = TREE_REFRESH_DEBOUNCE_MS): void => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => provider.refresh(), delay);
  };

  const onExternalChange = (uri: vscode.Uri): void => {
    if (shouldIgnorePath(uri.fsPath)) return;
    scheduleRefresh();
  };
  const externalWatcher = vscode.workspace.createFileSystemWatcher("**/*");

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
    // External changes — terminal git, agents, other editors. Filtered
    // through shouldIgnorePath() to avoid TS daemon / build-output churn.
    externalWatcher.onDidChange(onExternalChange),
    externalWatcher.onDidCreate(onExternalChange),
    externalWatcher.onDidDelete(onExternalChange),
    externalWatcher,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD.refresh, () => provider.refresh()),

    vscode.commands.registerCommand(CMD.openDiff, async (item: unknown) => {
      if (!(item instanceof FileTreeItem)) return;
      await openDiffForFile(item.repoPath, item.filePath, item.gitStatus, item.sourcePath, item.bump);
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
    //   * Untracked file → delete from disk.
    //   * Renamed/copied → `git restore --source=HEAD --staged --worktree
    //     -- <oldPath> <newPath>`. This atomically restores the old path
    //     (which exists at HEAD) and removes the new path (which doesn't).
    //     Plain `git checkout HEAD -- <newPath>` would error because HEAD
    //     has no entry for the new path.
    //   * Otherwise tracked → `git checkout HEAD -- <file>` (resets index
    //     AND worktree to HEAD in one command, wiping staged + unstaged).
    // A modal warning blocks accidental clicks; cancelling is safe.
    vscode.commands.registerCommand(CMD.discardChanges, async (item: unknown) => {
      if (!(item instanceof FileTreeItem)) return;
      const fileName = path.basename(item.filePath);
      const isUntracked = item.gitStatus.includes("?");
      const isRename = !!item.sourcePath;

      const message = isUntracked
        ? `Are you sure you want to DELETE the following file?\n\n${fileName}\n\nThis is IRREVERSIBLE!`
        : isRename
          ? `Are you sure you want to undo this rename?\n\n${item.sourcePath} → ${item.filePath}\n\nThe new file will be removed and the original restored. This is IRREVERSIBLE!`
          : `Are you sure you want to discard changes in '${fileName}'?\n\nThis is IRREVERSIBLE!`;
      const confirmLabel = isUntracked ? "Delete File" : isRename ? "Undo Rename" : "Discard Changes";

      const choice = await vscode.window.showWarningMessage(message, { modal: true }, confirmLabel);
      if (choice !== confirmLabel) return;

      const fullPath = path.join(item.repoPath, item.filePath);
      try {
        if (isUntracked) {
          await fs.promises.unlink(fullPath);
        } else if (isRename && item.sourcePath) {
          await runGitOrThrow(item.repoPath, [
            "restore",
            "--source=HEAD",
            "--staged",
            "--worktree",
            "--",
            item.sourcePath,
            item.filePath,
          ]);
        } else {
          await runGitOrThrow(item.repoPath, ["checkout", "HEAD", "--", item.filePath]);
        }
        provider.refresh();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`${LOG_PREFIX}: discard failed for ${fileName}: ${errorMessage}`);
      }
    }),

    // Discard ALL changes in a repo — mirrors VSCode's native SCM
    // "Discard All Changes" on a single repo:
    //   * `git reset --hard HEAD` → wipes index + worktree changes to tracked
    //     files (modifications, deletions, renames, staged or unstaged).
    //   * `git clean -fd` → removes untracked files and directories.
    //     Crucially WITHOUT `-x`, so `.gitignore`d paths (node_modules/,
    //     dist/, etc.) are preserved. The set removed by `clean -fd` thus
    //     corresponds exactly to the `??` rows shown in the tree, since
    //     `getStatus()` already uses `--untracked-files=all` (which excludes
    //     ignored paths).
    // A modal warning lists the repo and change count; cancelling is safe.
    vscode.commands.registerCommand(CMD.discardAllChanges, async (item: unknown) => {
      if (!(item instanceof RepoTreeItem)) return;

      const message =
        `Are you sure you want to DISCARD ALL CHANGES in '${item.repoName}'?\n\n` +
        `${item.changeCount} change${item.changeCount === 1 ? "" : "s"} will be discarded ` +
        `(modifications reset, untracked files deleted). Ignored paths are preserved.\n\n` +
        `This is IRREVERSIBLE!`;

      const confirmLabel = "Discard All Changes";
      const choice = await vscode.window.showWarningMessage(message, { modal: true }, confirmLabel);
      if (choice !== confirmLabel) return;

      try {
        await runGitOrThrow(item.repoPath, ["reset", "--hard", "HEAD"]);
        await runGitOrThrow(item.repoPath, ["clean", "-fd"]);
        provider.refresh();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `${LOG_PREFIX}: discard all failed for ${item.repoName}: ${errorMessage}`,
        );
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
  shouldIgnorePath,
  parseStatusLine,
  TMP_DIR_NAME,
  CMD,
  VIEW_ID,
};
