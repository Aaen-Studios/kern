/**
 * Diff viewer component using Monaco's DiffEditor.
 *
 * Compares two file contents and shows the differences with green/red
 * highlights. Used for comparing the working copy against a backup version.
 *
 * Implementation note: we use `@monaco-editor/react`'s `DiffEditor` in its
 * declarative form — passing `original` / `modified` / `language` as props and
 * letting the wrapper own model lifecycle. The previous version manually
 * created models via `editor.createModel` and called `setModel` on a cast
 * editor handle, which crashed on this Monaco version ("model.getLanguageId
 * is not a function") and — because it ran setup at module scope — took down
 * the entire view that imported it.
 */

import { DiffEditor, loader } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor";
import type * as monaco from "monaco-editor";
import { KERN_THEME } from "./editorTheme";
import { registerCustomLanguages } from "./monarchLanguages";

loader.config({ monaco: monacoEditor });

// Register the theme + custom languages once. defineTheme is idempotent, and
// registerCustomLanguages guards against double-registration internally, so
// importing this module multiple times (e.g. via code-splitting) is safe.
monacoEditor.editor.defineTheme("kern-dark", KERN_THEME);
registerCustomLanguages(monacoEditor);

interface DiffViewerProps {
  /** Original content (left side). */
  original: string;
  /** Modified content (right side). */
  modified: string;
  /** Language identifier for syntax highlighting. */
  language: string;
  /** Height of the editor. */
  height?: string;
}

/**
 * Monaco-based diff viewer showing deletions (red) and insertions (green).
 *
 * Read-only and side-by-side. The wrapper manages models from the props, so
 * updating `original`/`modified` re-diffs automatically.
 */
export function DiffViewer({ original, modified, language, height = "400px" }: DiffViewerProps) {
  return (
    <div style={{ height }} className="border-t border-grid-bounds bg-bg-core">
      <DiffEditor
        original={original}
        modified={modified}
        language={language}
        theme="kern-dark"
        options={{
          readOnly: true,
          renderSideBySide: true,
          ignoreWhitespace: false,
          fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
          fontSize: 12,
          lineHeight: 1.5,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "off",
          renderWhitespace: "boundary",
          bracketPairColorization: { enabled: true },
          guides: { indentation: true },
        } as monaco.editor.IDiffEditorOptions}
      />
    </div>
  );
}
