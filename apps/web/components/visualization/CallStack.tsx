"use client";

import { useMemo, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Frame, SerializedValue, TraceEvent } from "../../lib/types";
import { formatValue } from "../../lib/format";

interface CallStackProps {
  frames: Frame[]; // innermost frame first
  activeFrameId: string | null;
  onSelect: (frameId: string) => void;
  /** Full trace, used to summarise each frame's current variables. */
  events: TraceEvent[];
  /** Selected step — summaries freeze at this moment like every other panel. */
  step: number;
}

function short(value: SerializedValue, limit = 22): string {
  const text = formatValue(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Live call stack as a depth ladder: base of the stack on top, the frame that
 * is executing right now at the bottom. Frames waiting on a child (e.g.
 * recursion) show the line they are suspended on plus their live variables —
 * far more instructive than merely stating that "recursion calls itself".
 */
export default function CallStack({
  frames,
  activeFrameId,
  onSelect,
  events,
  step,
}: CallStackProps) {
  const reduce = useReducedMotion();

  // Latest locals seen per frame up to the selected step.
  const summaries = useMemo(() => {
    const latest = new Map<string, Record<string, SerializedValue>>();
    for (let i = 0; i <= step && i < events.length; i++) {
      const event = events[i];
      latest.set(event.frameId, event.locals);
    }
    const out = new Map<string, string>();
    for (const [frameId, locals] of latest) {
      const parts = Object.entries(locals)
        .slice(0, 3)
        .map(([name, value]) => `${name} = ${short(value)}`);
      if (parts.length > 0) out.set(frameId, parts.join("  ·  "));
    }
    return out;
  }, [events, step]);

  const ordered = useMemo(() => [...frames].reverse(), [frames]); // base first

  return (
    <section className="panel call-stack">
      <header className="panel-header">
        <span>Call Stack</span>
        <span className="panel-header-sub">
          {frames.length === 0 ? "idle" : `depth ${frames.length}`}
        </span>
      </header>
      <div className="panel-body">
        {frames.length === 0 ? (
          <p className="empty">No active frames — run the code to watch the stack grow.</p>
        ) : (
          <motion.ul className="stack-list" layout>
            <AnimatePresence initial={false}>
              {ordered.map((frame, index) => {
                const isTop = index === ordered.length - 1;
                const isActive = frame.frameId === activeFrameId;
                const summary = summaries.get(frame.frameId);
                return (
                  <motion.li
                    key={frame.frameId}
                    layout={!reduce}
                    className="stack-item"
                    style={{ "--depth": index } as CSSProperties}
                    initial={reduce ? false : { opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduce ? {} : { opacity: 0, x: -14 }}
                    transition={{ duration: 0.26, ease: "easeOut" }}
                  >
                    <button
                      className={
                        "stack-frame" +
                        (isActive ? " active" : "") +
                        (isTop ? " running" : " waiting")
                      }
                      onClick={() => onSelect(frame.frameId)}
                    >
                      <span className="stack-rail" aria-hidden="true" />
                      <span className="stack-index">{index + 1}</span>
                      <span className="stack-name">
                        {frame.functionName === "<module>" ? "(module)" : frame.functionName}
                      </span>
                      <span className={`stack-badge${isTop ? " running" : ""}`}>
                        {isTop ? "● executing" : "paused"}
                      </span>
                      {frame.line != null && <span className="stack-line">L{frame.line}</span>}
                      {summary && (
                        <motion.span
                          key={summary}
                          className="stack-summary"
                          initial={reduce ? false : { opacity: 0, x: -5 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          {summary}
                        </motion.span>
                      )}
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>
    </section>
  );
}
