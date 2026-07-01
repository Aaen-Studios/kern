# kern

A desktop server manager built with Tauri 2 + React 19 + TypeScript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Development

```bash
bun install
bun tauri dev
```

## Building & Releasing

Releases are built locally and distributed through GitHub Releases; the in-app
updater polls `releases/latest/download/update.json` for new versions.

### First-time setup

Generate a signing keypair (the public key is embedded in `tauri.conf.json`,
the private key is gitignored at `src-tauri/updater.key`):

```bash
bun x tauri signer generate -w src-tauri/updater.key -p ""
```

Copy `src-tauri/.env.example` to `src-tauri/.env` and fill in the key path /
password if you set one.

### Cutting a release

```bash
# Cross-platform (Git Bash / Linux / macOS)
./deploy.sh [new_version]      # e.g. ./deploy.sh 0.2.0
```

`deploy.sh` handles: version bumping across `package.json`,
`tauri.conf.json`, and `Cargo.toml` → `bun tauri build` → artifact packaging
(`.exe.zip` / `.tar.gz` / `.dmg.gz`) → minisign signing → `update.json`
generation with multi-platform merge support.

After it finishes, create a `v{version}` GitHub release and upload:

- the installer (`.exe` / `.AppImage` / `.dmg`)
- the signed archive (`.exe.zip` / `.tar.gz` / `.dmg.gz`)
- `update.json`

### Multi-platform releases

Run `./deploy.sh <version>` on each platform with the same version argument.
Each run merges its platform entry into `update.json` (using `update.json.prev`
as the base), so a single `update.json` ends up covering every platform.
