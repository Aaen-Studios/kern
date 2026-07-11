## Implementation Plan: Replace prompt() with Inline Input in FileEditorPanel

### Problem
FileEditorPanel.tsx header buttons (lines 456-485) use `window.prompt()` for file/folder creation:
```tsx
const name = prompt("Enter file name:");
if (name && name.trim()) {
  handleCreateFile("", name.trim());
}
```
This is inconsistent with the inline input UI already implemented in FileTree.tsx context menu for "New File…" and "New Folder…" actions.

### Solution

**1. Create `src/components/ui/InlineInput.tsx`** - Extract the InlineInput component from FileTree.tsx (lines 576-641) to a shared location. This component already has:
- Auto-focus on mount
- Enter to submit, Escape to cancel  
- Blur handling (submits if non-empty, cancels otherwise)
- Consistent dark-theme styling

**2. Update FileEditorPanel.tsx**:
- Add `createState` state: `{ type: "file" | "folder" } | null`
- Add `startCreate(type)` handler - sets create state to trigger inline input
- Add `submitCreate(name)` and `cancelCreate()` handlers
- Replace `prompt()` calls with `startCreate("file")` / `startCreate("folder")` 
- Render `InlineInput` inline in the header area when creating (similar to the root-level inline create in FileTree)

**3. Update FileTree.tsx**:
- Remove the inline `InlineInput` component definition (lines 576-641)
- Import InlineInput from the shared UI location

### Styling Consistency
- Match existing patterns: `text-[10px]` text, `border-signal-high/60` border
- Place the inline input below the explorer header, aligned with the file tree items
- Use placeholder `"filename.ext…"` for files and `"folder name…"` for folders