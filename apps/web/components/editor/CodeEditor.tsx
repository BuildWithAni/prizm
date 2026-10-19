"use client";

import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Source line of the currently selected execution step, if any. */
  activeLine: number | null;
}

/**
 * Monaco editor with a synchronized execution highlight. The highlight comes
 * purely from the selected trace step — the editor never executes anything.
 */
export default function CodeEditor({ value, onChange, activeLine }: CodeEditorProps) {
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
    });
  };

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
  }, [activeLine, value]);

  return (
    <Editor
      height="100%"
      language="python"
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
      }}
    />
  );
}
