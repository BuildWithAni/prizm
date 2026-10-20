"use client";

import { useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { SerializedValue, TraceEvent } from "../../lib/types";
import { formatValue } from "../../lib/format";

interface VariableInspectorProps {
  frameName: string | null;
  line: number | null;
  locals: Record<string, SerializedValue> | null;
  /** Previous step's locals for the same frame — used to flash changes. */
  prevLocals?: Record<string, SerializedValue> | null;
  /** Trace context, used to draw each variable's value history. */
  events?: TraceEvent[];
  step?: number;
  frameId?: string | null;
}

const TYPE_LABEL: Record<SerializedValue["type"], string> = {
  number: "num",
  string: "str",
  boolean: "bool",
  null: "none",
  array: "list",
  function: "fn",
  object: "obj",
};

const MAX_ARRAY_CHIPS = 10;

function short(value: SerializedValue, limit = 34): string {
  const text = formatValue(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Tiny inline line-chart of a numeric variable across the steps so far. */
function Sparkline({ points }: { points: number[] }) {
  const reduce = useReducedMotion();
  if (points.length < 3) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const width = 64;
  const height = 18;
  const coords = points.map((value, index) => {
    const x = (index / (points.length - 1)) * (width - 4) + 2;
    const y = height - 3 - ((value - min) / span) * (height - 6);
    return [x, y] as const;
  });
  const last = coords[coords.length - 1];
  const drawn = points.length; // re-draws the line whenever a new sample lands

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <title>{`${points[0]} → ${points[points.length - 1]} over ${points.length} steps`}</title>
      <motion.polyline
        key={`line-${drawn}`}
        points={coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={reduce ? false : { pathLength: 0, opacity: 0.4 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
      <motion.circle
        key={`dot-${drawn}`}
        cx={last[0]}
        cy={last[1]}
        r="2.2"
        fill="currentColor"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      />
    </svg>
  );
}

/** Shows the selected frame's variables as of the selected step. */
export default function VariableInspector({
  frameName,
  line,
  locals,
  prevLocals,
  events,
  step,
  frameId,
}: VariableInspectorProps) {
  const reduce = useReducedMotion();
  const entries = locals ? Object.entries(locals) : [];

  const isChanged = (name: string, value: SerializedValue): boolean => {
    if (!prevLocals) return false;
    const before = prevLocals[name];
    if (before === undefined) return false;
    return JSON.stringify(before) !== JSON.stringify(value);
  };

  /** Per-variable value trail for the active frame (numbers only). */
  const history = useMemo(() => {
    const trail = new Map<string, number[]>();
    if (!events || step == null) return trail;
    const limit = Math.min(step, events.length - 1);
    for (let i = 0; i <= limit; i++) {
      const event = events[i];
      if (frameId && event.frameId !== frameId) continue;
      for (const [name, value] of Object.entries(event.locals)) {
        if (value.type !== "number" || !Number.isFinite(value.value)) continue;
        const list = trail.get(name) ?? [];
        list.push(value.value);
        trail.set(name, list);
      }
    }
    return trail;
  }, [events, step, frameId]);

  const hasTrace = (events?.length ?? 0) > 0;

  return (
    <section className="panel variable-inspector">
      <header className="panel-header">
        <span>Variables</span>
        <span className="panel-header-sub">
          {frameName
            ? `${frameName}${line != null ? ` · line ${line}` : ""}`
            : hasTrace
              ? "no frame selected"
              : "idle"}
        </span>
      </header>
      <div className="panel-body">
        {!hasTrace ? (
          <p className="empty">
            Visualize a trace and every variable lights up here — with its type, its last change,
            and a sparkline of how its value moved.
          </p>
        ) : entries.length === 0 ? (
          <p className="empty">No variables in scope at this step.</p>
        ) : (
          <motion.ul className="var-list" layout={!reduce}>
            <AnimatePresence initial={false}>
              {entries.map(([name, value]) => {
                const changed = isChanged(name, value);
                const before = prevLocals?.[name] ?? null;
                const trail = (history.get(name) ?? []).slice(-60);
                const distinct = new Set(trail).size > 1;
                const display = formatValue(value);
                return (
                  <motion.li
                    key={name}
                    layout={!reduce}
                    className={`var-card${changed ? " changed" : ""}`}
                    initial={reduce ? false : { opacity: 0, y: 10, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduce ? {} : { opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                  >
                    <div className="var-card-head">
                      <span className="var-card-name">{name}</span>
                      <span className={`type-badge type-${value.type}`}>
                        {TYPE_LABEL[value.type]}
                      </span>
                      {changed && <span className="var-flag">changed</span>}
                    </div>

                    <div className="var-card-value">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={display}
                          className="var-value-slot"
                          initial={reduce ? false : { opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={reduce ? {} : { opacity: 0, y: -5 }}
                          transition={{ duration: 0.16, ease: "easeOut" }}
                        >
                          {value.type === "array" ? (
                            <span className="array-chips">
                              {value.value.slice(0, MAX_ARRAY_CHIPS).map((element, index) => (
                                <span key={index} className="array-chip">
                                  <span className="array-index">{index}</span>
                                  {short(element, 18)}
                                </span>
                              ))}
                              {value.value.length > MAX_ARRAY_CHIPS && (
                                <span className="array-chip more">
                                  +{value.value.length - MAX_ARRAY_CHIPS}
                                </span>
                              )}
                            </span>
                          ) : (
                            <code className="value-text">{display}</code>
                          )}
                        </motion.span>
                      </AnimatePresence>

                      {distinct && trail.length >= 3 && <Sparkline points={trail} />}
                    </div>

                    {changed && (
                      <motion.div
                        key={`delta-${step}-${name}`}
                        className="var-delta"
                        initial={reduce ? false : { opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                      >
                        <span className="delta-was">
                          {before === null ? "undefined" : short(before)}
                        </span>
                        <span className="delta-arrow">→</span>
                        <span className="delta-now">{short(value)}</span>
                      </motion.div>
                    )}
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
