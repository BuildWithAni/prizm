"use client";

import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Source line of the currently selected execution step, if any. */
  activeLine: number | null;
  language?: string;
  /** Read-only view (used by the visualizer, which displays rather than edits). */
  readOnly?: boolean;
}

/** Monaco language id for a workspace language id. */
function monacoLanguage(language: string): string {
  switch (language) {
    case "cpp":
    case "c":
    case "java":
    case "javascript":
    case "typescript":
    case "go":
    case "rust":
    case "csharp":
    case "php":
    case "ruby":
    case "html":
      return language;
    default:
      return "python";
  }
}

/**
 * Monaco editor with a synchronized execution highlight. The highlight comes
 * purely from the selected trace step — the editor never executes anything.
 */
export default function CodeEditor({ value, onChange, activeLine, language = "python", readOnly = false }: CodeEditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.updateOptions({
      fontSize: 14,
      minimap: { enabled: false },
      glyphMargin: true,
      scrollBeyondLastLine: false,
      renderLineHighlight: "none",
      padding: { top: 12 },
      readOnly,
      // Read-only panes are for watching, not typing.
      domReadOnly: readOnly,
    });
  };

  // Keep read-only in sync when the same editor instance changes role.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    editor.updateOptions({ readOnly, domReadOnly: readOnly });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    const decorations: unknown[] = [];
    if (activeLine && activeLine >= 1 && activeLine <= model.getLineCount()) {
      decorations.push({
        range: new monaco.Range(activeLine, 1, activeLine, model.getLineMaxColumn(activeLine)),
        options: {
          isWholeLine: true,
          className: "active-line-highlight",
          glyphMarginClassName: "active-line-glyph",
        },
      });
      editor.revealLineInCenterIfOutsideViewport(activeLine);
    }
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations as any);
    // Monaco decorations track text edits on their own; rebuilding them on
    // every keystroke would re-trigger the landing animation while typing.
  }, [activeLine]);

  return (
    <Editor
      height="100%"
      language={monacoLanguage(language)}
      theme="vs-dark"
      value={value}
      onChange={(next) => onChange(next ?? "")}
      onMount={handleMount}
      options={{
        fontSize: 14,
        minimap: { enabled: false },
        glyphMargin: true,
        scrollBeyondLastLine: false,
        renderLineHighlight: "none",
        padding: { top: 12 },
        tabSize: 4,
        readOnly,
        domReadOnly: readOnly,
      }}
    />
  );
}
