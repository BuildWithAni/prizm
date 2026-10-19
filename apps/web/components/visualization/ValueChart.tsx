"use client";

import { useEffect, useMemo, useState } from "react";
import type { Frame, TraceEvent } from "../../lib/types";

const W = 560;
const H = 240;
const PAD_L = 52;
const PAD_R = 24;
const PAD_T = 26;
const PAD_B = 42;

interface ValueChartProps {
  events: TraceEvent[];
  step: number;
  stack: Frame[];
}

interface Point {
  step: number;
  value: number;
}

/** Track a variable's numeric value across every step of the execution. */
function collectSeries(
  events: TraceEvent[],
  name: string,
): { points: Point[]; seen: number } {
  const points: Point[] = [];
  let seen = 0;
  const stack: string[] = []; // frame ids, innermost last

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.event === "call") stack.push(event.frameId);
    else if (event.event === "return") {
      const index = stack.lastIndexOf(event.frameId);
      if (index >= 0) stack.splice(index, 1);
    }

    // Innermost frame that knows this variable wins.
    for (let f = stack.length - 1; f >= 0; f--) {
      const value = event.locals[name];
      const frameId = stack[f];
      if (event.frameId !== frameId || value === undefined) continue;
      seen += 1;
      if (value.type === "number" && Number.isFinite(value.value)) {
        points.push({ step: i, value: value.value });
      }
      break;
    }
  }
  return { points, seen };
}

/** Line chart of one variable over the execution timeline. */
export default function ValueChart({ events, step, stack }: ValueChartProps) {
  const names = useMemo(() => {
    const all = new Set<string>();
    events.forEach((event) => Object.keys(event.locals).forEach((key) => all.add(key)));
    return [...all].sort();
  }, [events]);

  const numericNames = useMemo(
    () =>
      names.filter((name) => {
        const { points } = collectSeries(events, name);
        return points.length >= 2;
      }),
    [events, names],
  );

  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    if (!selected && numericNames.length > 0) setSelected(numericNames[0]);
    if (selected && !names.includes(selected)) setSelected("");
  }, [names, numericNames, selected]);

  const series = useMemo(
    () => (selected ? collectSeries(events, selected) : null),
    [events, selected],
  );

  if (events.length === 0) {
    return (
      <section className="panel placeholder-panel">
        <header className="panel-header">
          <span>Values Over Time</span>
        </header>
        <div className="panel-body">
          <p className="empty">Visualize a program to chart how its variables change, step by step.</p>
        </div>
      </section>
    );
  }

  if (!series || series.points.length < 2) {
    return (
      <section className="panel placeholder-panel">
        <header className="panel-header">
          <span>Values Over Time</span>
        </header>
        <div className="panel-body">
          <select className="var-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Choose a variable…</option>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <p className="empty">No numeric history yet for this selection — try another variable.</p>
        </div>
      </section>
    );
  }

  const { points } = series;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const maxStep = Math.max(events.length - 1, 1);

  const toX = (s: number) => PAD_L + (s / maxStep) * (W - PAD_L - PAD_R);
  const toY = (v: number) => H - PAD_B - ((v - min) / span) * (H - PAD_T - PAD_B);

  const past = points.filter((p) => p.step <= step);
  const future = points.filter((p) => p.step >= step);
  const current = past[past.length - 1] ?? null;

  const path = (list: Point[]) =>
    list.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.step)} ${toY(p.value)}`).join(" ");

  return (
    <section className="panel chart-panel">
      <header className="panel-header">
        <span>Values Over Time</span>
        <select className="var-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {numericNames.length === 0 ? (
            <option value="">No numeric variables</option>
          ) : (
            numericNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))
          )}
        </select>
      </header>
      <div className="panel-body">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
          {/* axes */}
          <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} className="chart-axis" />
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} className="chart-axis" />
          <text x={PAD_L - 8} y={PAD_T + 4} textAnchor="end" className="chart-tick">
            {max}
          </text>
          <text x={PAD_L - 8} y={H - PAD_B} textAnchor="end" className="chart-tick">
            {min}
          </text>
          <text x={PAD_L} y={H - PAD_B + 18} textAnchor="middle" className="chart-tick">
            step 1
          </text>
          <text x={W - PAD_R} y={H - PAD_B + 18} textAnchor="middle" className="chart-tick">
            step {events.length}
          </text>

          {/* future (dim) then past (white) */}
          {future.length > 1 && <path d={path(future)} className="chart-line future" fill="none" />}
          {past.length > 1 && <path d={path(past)} className="chart-line" fill="none" />}

          {points.map((point) => (
            <circle
              key={point.step}
              cx={toX(point.step)}
              cy={toY(point.value)}
              r={point.step <= step ? 3.4 : 2.4}
              className={point.step <= step ? "chart-dot" : "chart-dot future"}
            />
          ))}

          {current && (
            <circle cx={toX(current.step)} cy={toY(current.value)} r={7} className="chart-current" />
          )}
        </svg>
        <p className="chart-caption">
          {selected}: {min === max ? `constant ${min}` : `${min} → ${max}`} across {points.length}{" "}
          snapshots
          {past.length > 0 && current ? ` · now ${current.value} at step ${current.step + 1}` : ""}
        </p>
      </div>
    </section>
  );
}
