"use client";

import type { Frame } from "../../lib/types";

interface CallStackProps {
  frames: Frame[]; // innermost frame first
  activeFrameId: string | null;
  onSelect: (frameId: string) => void;
}

/**
 * Live call stack. Frames waiting on a child (e.g. recursion) show the line
 * they are suspended on — this is far more instructive than a chatbot merely
 * stating that "recursion calls itself".
 */
export default function CallStack({ frames, activeFrameId, onSelect }: CallStackProps) {
  return (
    <section className="panel call-stack">
      <header className="panel-header">
        <span>Call Stack</span>
        <span className="panel-header-sub">{frames.length} active</span>
      </header>
      <div className="panel-body">
        {frames.length === 0 ? (
          <p className="empty">No active frames — run the code to see the stack.</p>
        ) : (
          <ul className="stack-list">
            {[...frames].reverse().map((frame, index) => (
              <li key={frame.frameId}>
                <button
                  className={
                    "stack-frame" + (frame.frameId === activeFrameId ? " active" : "")
                  }
                  onClick={() => onSelect(frame.frameId)}
                >
                  <span className="stack-depth">{index === 0 ? "●" : "○"}</span>
                  <span className="stack-name">
                    {frame.functionName === "<module>" ? "(module)" : frame.functionName}
                  </span>
                  {frame.line != null && <span className="stack-line">line {frame.line}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
