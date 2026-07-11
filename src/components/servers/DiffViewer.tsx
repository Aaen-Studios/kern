/**
 * Diff viewer component using Monaco's DiffEditor.
 *
 * Compares two file contents and shows the differences with green/red highlights.
 * Used for comparing current files with backup versions.
 */

import { useCallback, useMemo } from "react";
import DiffEditor, { loader, type OnMount } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import * as monacoEditor from "monaco-editor";
import { KERN_THEME } from "./editorTheme";
import { registerCustomLanguages } from "./monarchLanguages";

loader.config({ monaco: monacoEditor });

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

// Register theme once at module level
monacoEditor.editor.defineTheme("kern-dark", KERN_THEME);
registerCustomLanguages(monacoEditor);

/**
 * Monaco-based diff viewer showing deletions (red) and insertions (green).
 */
export function DiffViewer({ original, modified, language, height = "400px" }: DiffViewerProps) {
  const originalModel = useMemo(() => {
    const m = monacoEditor.editor.createModel(original, language);
    return m;
  }, [original, language]);

  const modifiedModel = useMemo(() => {
    const m = monacoEditor.editor.createModel(modified, language);
    return m;
  }, [modified, language]);

  const handleMount: OnMount = useCallback(
    (ed: monacoEditor.editor.IStandaloneCodeEditor) => {
      // The editor is a DiffEditor, need to set models
      const diffEd = ed as unknown as monacoEditor.editor.IStandaloneDiffEditor;
      diffEd.setModel({
        original: originalModel,
        modified: modifiedModel,
      });
      monacoEditor.editor.setTheme("kern-dark");
    },
    [originalModel, modifiedModel],
  );

  return (
    <div style={{ height }} className="border-t border-grid-bounds bg-bg-core">
      <DiffEditor
        onMount={handleMount}
        options={{
          theme: "kern-dark",
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