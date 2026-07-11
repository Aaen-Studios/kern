# File Editor Enhancement Implementation Plan

## Overview
Three missing features needed for the kern file editor:
1. **Project-wide search** - None exists currently
2. **Diff view** - Only has syntax highlighting for `.patch/.diff` files  
3. **Preview support** - Binary files blocked, no image/markdown/JSON preview

## Feature 1: Project-Wide Search

### Backend (`src-tauri/src/commands.rs`)
- Add `search_files` command accepting:
  - `id: String` (server instance)
  - `query: String` (search term)
  - `mode: "filenames" | "contents"` (search scope)
  - `include: Option<String>` (glob pattern, e.g., "*.ts")
  - `exclude: Option<String>` (files to skip, e.g., "node_modules/**")
- Use `walkdir` crate (already a dependency) to walk instance directory
- For content mode: read files matching pattern, search for query
- Return `Vec<SearchMatch>` with { relPath, lineNumber?, linePreview? }
- Reuse existing `resolve_path` for security

### Frontend (`src/hooks/useFileSearch.ts`)
- New hook returning { results, loading, error, search }
- Debounced search (200ms) using `useCallback`
- Follows `useFileEditor` patterns for consistency

### UI Components
- `FileSearchInput.tsx` - Search input with mode toggle (⌘F shortcut)
- Search results integrated into `FileEditorPanel.tsx` as collapsible panel
- Results show file path + matching line preview
- Clicking opens file and jumps to line

## Feature 2: Diff View

### Backend (`src-tauri/src/commands.rs`)
- Add `get_file_from_backup(backup_name, rel_path)` command
- Extract file from backup zip archive (reuse `zip` crate from backup code)
- Return file content for comparison
- Add `create_file_diff(original, modified)` for generating unified diff

### Frontend (`src/components/servers/DiffViewer.tsx`)
- Use Monaco's `DiffEditor` component
- Accept two content strings and language
- Show insertions in green, deletions in red
- Match kern dark theme styling

### Integration
- Add "Compare with Backup" to `FileTree.tsx` context menu
- Add diff button in `EditorTabBar` for files with backup equivalents
- Show diff inline or as modal overlay

## Feature 3: Image/Markdown/JSON Preview

### Backend (`src-tauri/src/commands.rs`)
- Add `read_file_bytes(id, relPath)` returning base64 for binary files
- Or leverage Tauri's `asset://` protocol to serve files directly

### Frontend Components
- `FilePreview.tsx` - Container for all preview types
- `ImagePreview.tsx` - `<img>` tag with base64/src URL
- `MarkdownPreview.tsx` - Reuse Monaco's markdown tokenizer (render to HTML)
- `JsonPreview.tsx` - Collapsible tree view of JSON structure

### Integration
- Modify `useFileEditor.ts` to detect previewable types:
  - Images: png, jpg, jpeg, gif, webp, svg
  - Markdown: md, markdown, mdx
  - JSON: json (tree view instead of raw text)
- Add "Preview" tab alongside editor tab when file is previewable
- Read-only view, switchable between editor and preview

## Styling Consistency
All components use existing Tailwind classes:
- `matrix-border` for borders
- `signal-high` for accents (green)
- `signal-low` for secondary text
- `fault-vector` for errors (red)
- `bg-core`, `bg-surface` for backgrounds
- Monospace font stack: `"JetBrains Mono", "Cascadia Code", "Fira Code", monospace`

## Commands to Register in `lib.rs`
```rust
search_files,
get_file_from_backup,
read_file_bytes,
```