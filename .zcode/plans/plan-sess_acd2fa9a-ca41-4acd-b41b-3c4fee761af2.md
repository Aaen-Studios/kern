Fixes for the 5 bugs found in my previous changes:

1. **CRITICAL — FileTree infinite loop** (`FileTree.tsx`): Remove `children` from the effect's deps (it's set inside the effect → infinite re-fetch). Replace the stale-cache guard with a `lastRefreshKey` ref so children refetch only when `refreshKey` advances or the directory expands. This restores normal editor operation.

2. **Watcher deadlock** (`watcher.rs`): Reorder `unwatch_server_directory` to lock `debouncer` before `watched`, matching `watch_server_directory`'s order.

3. **Watcher recreates deleted dirs** (`watcher.rs`): Remove the `create_dir_all` side-effect from `watch_server_directory`. Let it error/log if the path is missing — don't silently resurrect folders.

4. **`.env` guard + typo** (`commands.rs` / `watcher.rs`): Replace the mid-function `return Ok(instance)` with an `if !env_path.exists()` guard around the write. Fix the missing closing quote in `unwatch_server_directory`'s error string.

5. **Verify**: `cargo check` + `npm run build` / `tsc --noEmit`.

Files: `src/components/servers/FileTree.tsx`, `src-tauri/src/watcher.rs`, `src-tauri/src/commands.rs`.