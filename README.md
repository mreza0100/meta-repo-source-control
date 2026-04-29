# meta-repo source control

A VSCode extension for **meta-repo workspaces** — directories that contain many independent git checkouts side-by-side instead of one monorepo.

Contributes a "Workspace Changes" view to the SCM sidebar that lists only repos with uncommitted changes, expandable to their changed files. Click a file → diff opens in the editor. Clean tree, no per-repo commit clutter, hides empty repos that the native panel can't.

## Why this exists

VSCode's native Source Control panel was designed for monorepos: one workspace, one git repo, one commit input. When the workspace contains _many_ git repos as siblings (a meta-repo pattern common in microservice shops, ROS workspaces, and similar layouts), the native panel renders one full SCM provider per repo — including the commit message input box, Commit button, and changes list, _for every repo_ — even repos with no changes.

There's no native VSCode setting to hide repos with no changes ([microsoft/vscode#33334](https://github.com/microsoft/vscode/issues/33334), open since 2017) and no setting to hide the commit input. Extensions cannot modify the native SCM panel because VSCode's renderer DOM is not part of the extension API surface.

This extension's solution: a separate tree view that does what the native panel won't — show only dirty repos, no commit clutter, real file-type icons, click-to-diff.

## Install

```bash
code --install-extension mattgle.metarepo-sc
```

Or search **"Meta-Repo Source Control"** in the Extensions sidebar.

For devcontainer setup and recommended settings, see the [extension README](packages/extension/README.md#devcontainer-setup).

## Repository layout

```
meta-repo-source-control/
├── packages/
│   └── extension/          # VSCode extension (TypeScript, esbuild-bundled)
├── eslint.config.mjs       # shared ESLint flat config
├── tsconfig.base.json      # shared TS strict base config
└── package.json            # npm workspaces root
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, build/test commands, and PR guidelines.

## License

[MIT](LICENSE)
