"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { SerializedValue, TraceEvent } from "../../lib/types";
import { formatValue } from "../../lib/format";

interface StepNarratorProps {
  events: TraceEvent[];
  /** 0-based index of the selected step. */
  step: number;
  onJump: (index: number) => void;
}

interface Chip {
  label: string;
  value: string;
  delta?: boolean;
}

const KIND_META: Record<string, { glyph: string; label: string }> = {
  call: { glyph: "↧", label: "call" },
  line: { glyph: "▸", label: "line" },
  return: { glyph: "↰", label: "return" },
  exception: { glyph: "✕", label: "exception" },
};

/** Ticks rendered for one trace; longer traces are sampled to fit the panel. */
const MAX_RIBBON_TICKS = 96;

function short(value: SerializedValue, limit = 40): string {
  const text = formatValue(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function frameLabel(name: string): string {
  return name === "<module>" ? "the program" : name;
}

/** Variables that differ between two snapshots of the same frame. */
function diffLocals(
  before: Record<string, SerializedValue> | null,
  after: Record<string, SerializedValue>,
): Chip[] {
  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  const chips: Chip[] = [];
  for (const name of names) {
    const prev = before?.[name] ?? null;
    const next = after[name] ?? null;
    if (prev === null && next === null) continue;
    if (prev !== null && next !== null && JSON.stringify(prev) === JSON.stringify(next)) continue;
    if (prev === null) chips.push({ label: name, value: `new · ${short(next!)}`, delta: true });
    else if (next === null) chips.push({ label: name, value: `removed · was ${short(prev)}`, delta: true });
    else chips.push({ label: name, value: `${short(prev)} → ${short(next)}`, delta: true });
  }
  return chips;
}

/** Plain-English narration + evidence chips for one trace event. */
export default function StepNarrator({ events, step, onJump }: StepNarratorProps) {
  const reduce = useReducedMotion();
  const event = events.length > 0 ? events[Math.min(step, events.length - 1)] : null;

  const prevLocals = useMemo(() => {
    if (!event) return null;
    for (let i = Math.min(step, events.length - 1) - 1; i >= 0; i--) {
      if (events[i].frameId === event.frameId) return events[i].locals;
    }
    return null;
  }, [events, step, event]);

  const { headline, sub, chips } = useMemo(() => {
    if (!event) return { headline: "", sub: "", chips: [] as Chip[] };

    const fn = frameLabel(event.functionName);
    const changes = diffLocals(prevLocals, event.locals);
    const limit = (list: Chip[]) => list.slice(0, 4);

    switch (event.event) {
      case "call": {
        const args = Object.entries(event.locals)
          .slice(0, 4)
          .map(([name, value]) => ({ label: name, value: short(value) }));
        return {
          headline: event.functionName === "<module>" ? "Program starts" : `Entering ${fn}()`,
          sub:
            event.functionName === "<module>"
              ? "Top-level code runs before any function is called."
              : "A new frame is pushed onto the call stack.",
          chips: limit(
            args.length ? args : [{ label: "scope", value: "no variables bound yet" }],
          ),
        };
      }
      case "line":
        return {
          headline: `Running line ${event.line ?? "?"}`,
          sub: `Inside ${fn} — the interpreter is running this statement now.`,
          chips: limit(
            changes.length ? changes : [{ label: "state", value: "no variable changed here" }],
          ),
        };
      case "return": {
        const value = event.value ?? null;
        return {
          headline: value
            ? `${fn} returns ${short(value)}`
            : `${fn} finished and returned nothing`,
          sub: "The frame is popped and control goes back to the caller.",
          chips: limit(
            changes.length ? changes : [{ label: "state", value: "no variable changed on return" }],
          ),
        };
      }
      case "exception":
      default:
        return {
          headline: `${event.exception?.type ?? "Error"} raised in ${fn}`,
          sub: event.exception?.message || "Execution stopped at this step.",
          chips: limit(
            changes.length ? changes : [{ label: "state", value: "values unchanged when it failed" }],
          ),
        };
    }
  }, [event, prevLocals]);

  const meta = event ? KIND_META[event.event] : null;
  const currentIndex = Math.min(step, Math.max(events.length - 1, 0));

  /**
   * Timeline ticks. Long traces are sampled down to MAX_RIBBON_TICKS so the
   * ribbon always fits the panel — each tick maps back to a real step.
   */
  const ticks = useMemo(() => {
    if (events.length === 0) return [] as { index: number; event: TraceEvent }[];
    if (events.length <= MAX_RIBBON_TICKS) {
      return events.map((item, index) => ({ index, event: item }));
    }
    const out: { index: number; event: TraceEvent }[] = [];
    for (let t = 0; t < MAX_RIBBON_TICKS; t++) {
      const index = Math.round((t * (events.length - 1)) / (MAX_RIBBON_TICKS - 1));
      out.push({ index, event: events[index] });
    }
    return out;
  }, [events]);

  const currentTick =
    ticks.length > 1
      ? Math.round((currentIndex / Math.max(events.length - 1, 1)) * (ticks.length - 1))
      : 0;

  return (
    <section className="panel step-narrator">
      <header className="panel-header">
        <span>This Step</span>
        <span className="panel-header-sub">
          {events.length ? `step ${Math.min(step, events.length - 1) + 1} / ${events.length}` : "no trace"}
        </span>
      </header>

      <div className="panel-body">
        {!event || !meta ? (
          <div className="narr-empty">
            <span className="narr-empty-glyph" aria-hidden="true">
              ◎
            </span>
            <p>
              Press <strong>Visualize</strong> to record every call, line and return — then step
              through the program one moment at a time.
            </p>
          </div>
        ) : (
          <>
            <div className={`narr-head kind-${event.event}`}>
              <motion.span
                key={event.event}
                className="narr-glyph"
                aria-hidden="true"
                initial={reduce ? false : { scale: 0.55, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
              >
                {meta.glyph}
              </motion.span>
              <motion.div
                key={`step-${step}`}
                className="narr-text"
                initial={reduce ? false : { opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
              >
                <span className="narr-kicker">
                  {meta.label}
                  {event.event !== "line" && event.line != null ? ` · line ${event.line}` : ""} ·{" "}
                  {frameLabel(event.functionName)}
                </span>
                <strong className="narr-title">{headline}</strong>
                <span className="narr-sub">{sub}</span>
              </motion.div>
            </div>

            <motion.div
              key={`chips-${step}`}
              className="narr-chips"
              initial={reduce ? false : "hidden"}
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
              }}
            >
              {chips.map((chip) => (
                <motion.span
                  key={`${chip.label}:${chip.value}`}
                  className={`narr-chip${chip.delta ? " delta" : ""}`}
                  variants={
                    reduce
                      ? undefined
                      : {
                          hidden: { opacity: 0, y: 6, scale: 0.96 },
                          show: { opacity: 1, y: 0, scale: 1 },
                        }
                  }
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <span className="narr-chip-label">{chip.label}</span>
                  <span className="narr-chip-value">{chip.value}</span>
                </motion.span>
              ))}
            </motion.div>

            <div className="step-ribbon" role="group" aria-label="Execution timeline">
              {ticks.map((tick, tickIndex) => (
                <button
                  key={tick.index}
                  type="button"
                  className={
                    "ribbon-tick kind-" +
                    tick.event.event +
                    (tickIndex === currentTick ? " current" : "") +
                    (tickIndex < currentTick ? " past" : "")
                  }
                  onClick={() => onJump(tick.index)}
                  title={`Step ${tick.index + 1} · ${tick.event.event} · ${
                    tick.event.functionName === "<module>" ? "(module)" : tick.event.functionName
                  }${tick.event.line != null ? ` · line ${tick.event.line}` : ""}`}
                  aria-label={`Jump to step ${tick.index + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
