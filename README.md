# meta-repo source control

Source control UX for **meta-repo workspaces** — directories that contain many independent git checkouts side-by-side instead of one monorepo.

This repository ships two things that work together:

| Package                                       | What it does                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`metarepo-sc`](packages/extension/) (VSCode) | A "Workspace Changes" tree view in the SCM sidebar that hides empty repos and lets you click any file to open its diff. Plus a silent in-process CLI bridge. |
| [`metarepo-sc-cli`](packages/cli/) (npm CLI)  | A bash/fzf TUI for navigating uncommitted changes across every repo in a workspace. Each arrow keypress opens the live diff in VSCode without focus theft.   |

## Why this exists

VSCode's native Source Control panel was designed for monorepos: one workspace, one git repo, one commit input. When the workspace contains _many_ git repos as siblings (a meta-repo pattern common in microservice shops, ROS workspaces, and similar layouts), the native panel renders one full SCM provider per repo — including the commit message input box, Commit button, and changes list, _for every repo_ — even repos with no changes.

There's no native VSCode setting to hide repos with no changes ([microsoft/vscode#33334](https://github.com/microsoft/vscode/issues/33334), open since 2017) and no setting to hide the commit input. Extensions cannot modify the native SCM panel because VSCode's renderer DOM is not part of the extension API surface.

This project's solution: a separate tree view that shows only dirty repos with no commit clutter, plus a CLI for terminal-side navigation that can drive VSCode's diff editor silently.

## Quick start

```bash
# Install the VSCode extension from the marketplace
code --install-extension mattgle.metarepo-sc

# Install the CLI globally (requires Node 20+)
npm install -g metarepo-sc-cli

# Run the CLI from a meta-repo workspace root
cd ~/code/my-meta-repo
metarepo-sc
```

The CLI requires `git`, `fzf`, [`bat`](https://github.com/sharkdp/bat), and [`delta`](https://github.com/dandavison/delta) on your `PATH`.

See each package's README for the full feature list and configuration options:

- [Extension README](packages/extension/) — Workspace Changes view, command-file format, diff opening details
- [CLI README](packages/cli/) — fzf bindings, env vars, terminal integration

## Repository layout

```
meta-repo-source-control/
├── packages/
│   ├── extension/          # VSCode extension (TypeScript)
│   └── cli/                # bash CLI (npm-installable bin)
├── eslint.config.mjs       # shared ESLint flat config
├── tsconfig.base.json      # shared TS strict base config
└── package.json            # npm workspaces root
```

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, build/test commands, and PR guidelines.

## License

[MIT](LICENSE)
