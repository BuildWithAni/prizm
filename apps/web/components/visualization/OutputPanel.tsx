"use client";

import type { ExecutionStatus } from "../../lib/types";

interface OutputPanelProps {
  output: string;
  status: ExecutionStatus | null;
}

/** Program output as of the selected step (rebuilt from per-step deltas). */
export default function OutputPanel({ output, status }: OutputPanelProps) {
  return (
    <section className="panel output-panel">
      <header className="panel-header">
        <span>Output</span>
        {status && <span className="panel-header-sub">status: {status}</span>}
      </header>
      <div className="panel-body">
        {output.length === 0 ? (
          <p className="empty">No output yet.</p>
        ) : (
          <pre className="output-pre">{output}</pre>
        )}
      </div>
    </section>
  );
}
