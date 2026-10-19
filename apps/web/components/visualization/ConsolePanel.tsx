"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionInfo } from "../../lib/types";

interface ConsolePanelProps {
  session: SessionInfo | null;
  busy: boolean;
  /** Fallback output when no run session exists (traced execution output). */
  traceOutput: string;
  source: "run" | "trace";
  error: string | null;
  onSend: (line: string) => void;
  onStop: () => void;
  /**
   * When true (Python selected, no live session) the input row instead sets
   * stdin for the next Visualize run — so traced programs can use input().
   */
  traceInputEnabled?: boolean;
  /** Stdin already queued for the next traced run (one line per input()). */
  stdinValue?: string;
  onSupplyTraceInput?: (line: string) => void;
  onClearTraceInput?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  running: "running",
  exited: "done",
  timeout: "timeout",
  stopped: "stopped",
  compile_error: "compile error",
  error: "error",
};

/** Live program console: streamed output + stdin line for interactive programs. */
export default function ConsolePanel({
  session,
  busy,
  traceOutput,
  source,
  error,
  onSend,
  onStop,
  traceInputEnabled = false,
  stdinValue = "",
  onSupplyTraceInput,
  onClearTraceInput,
}: ConsolePanelProps) {
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLPreElement | null>(null);

  const output = session ? session.output : traceOutput;
  const status = session?.status ?? null;
  const running = status === "running";
  const stdinLines = stdinValue ? stdinValue.split("\n") : [];

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [output]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (running) {
      onSend(draft);
      setDraft("");
    } else if (traceInputEnabled && draft) {
      // Queue the line as stdin for the next Visualize run (repeat for more lines).
      onSupplyTraceInput?.(draft);
      setDraft("");
    }
  };

  const failed = status === "compile_error" || status === "error";

  return (
    <section className="panel console-panel">
      <header className="panel-header">
        <span>
          Console{" "}
          {source === "run" && session ? <em className="console-src">· {session.language} run</em> : null}
          {source === "trace" && !session ? <em className="console-src">· traced run</em> : null}
          {!session && stdinLines.length > 0 && (
            <button
              type="button"
              className="stdin-chip"
              onClick={() => onClearTraceInput?.()}
              title={`Queued stdin (click to clear):\n${stdinValue}`}
            >
              stdin: {stdinLines.length} {stdinLines.length === 1 ? "line" : "lines"} ✕
            </button>
          )}
        </span>
        <span className="console-right">
          {busy && <span className="console-status starting">starting…</span>}
          {status && !busy && (
            <span className={`console-status ${failed ? "bad" : running ? "live" : ""}`}>
              {STATUS_LABEL[status] ?? status}
              {typeof session?.exit_code === "number" && !running && status === "exited"
                ? ` · exit ${session.exit_code}`
                : ""}
            </span>
          )}
          {running && (
            <button type="button" className="console-kill" onClick={onStop}>
              Stop
            </button>
          )}
        </span>
      </header>

      <pre className="console-body" ref={bodyRef}>
        {error ? <span className="console-error">{error}</span> : null}
        {output ? (
          output
        ) : (
          <>
            {stdinLines.map((line, index) => (
              <span key={index} className="stdin-line">
                {"❯ "}
                {line}
                {"\n"}
              </span>
            ))}
            <span className="empty">
              {stdinLines.length > 0
                ? "queued input — press ◎ Visualize to run with it"
                : "Output appears here. Press ▶ Run — programs can also read input."}
            </span>
          </>
        )}
      </pre>

      <form className="console-input-row" onSubmit={submit}>
        <span className="console-prompt">{running ? "❯" : "›"}</span>
        <input
          className="console-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            running
              ? "send a line of input (stdin)…"
              : traceInputEnabled
                ? stdinLines.length > 0
                  ? "next stdin line — Enter queues it for Visualize…"
                  : "program reads input? type a line here, then Visualize…"
                : "run a program to interact"
          }
          disabled={!running && !traceInputEnabled}
          aria-label="Program input"
        />
        <button
          type="submit"
          className="console-send"
          disabled={running ? draft.length === 0 : !(traceInputEnabled && draft.length > 0)}
        >
          {running ? "Send ⏎" : "Set ⏎"}
        </button>
      </form>
    </section>
  );
}
