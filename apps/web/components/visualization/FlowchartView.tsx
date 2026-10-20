"use client";

import { useRef, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { Flowchart, FlowNode } from "../../lib/types";

const NODE_W = 196;
const NODE_H = 60;
const PAD = 52;

interface FlowchartViewProps {
  chart: Flowchart;
  executedLines: Set<number>;
  activeLine: number | null;
  traversedEdges: Set<string>;
  onSelectLine: (line: number) => void;
}

function edgePath(from: FlowNode, to: FlowNode): { d: string; labelX: number; labelY: number } {
  const sx = from.x;
  const sy = from.y + NODE_H / 2;
  const tx = to.x;
  const ty = to.y - NODE_H / 2;

  if (to.y > from.y + NODE_H) {
    const midY = (sy + ty) / 2;
    return {
      d: `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`,
      labelX: (sx + tx) / 2,
      labelY: (sy + ty) / 2,
    };
  }
  const side = Math.max(sx, tx) + NODE_W / 2 + 52;
  return {
    d: `M ${sx + NODE_W / 2} ${from.y} C ${side} ${from.y}, ${side} ${to.y}, ${tx + NODE_W / 2} ${to.y}`,
    labelX: side - 8,
    labelY: (from.y + to.y) / 2 - 6,
  };
}

const NODE_KIND_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  start: { fill: "rgba(167,139,250,0.18)", stroke: "rgba(167,139,250,0.6)", text: "#c4b5fd" },
  end: { fill: "rgba(52,211,153,0.15)", stroke: "rgba(52,211,153,0.5)", text: "#6ee7b7" },
  decision: { fill: "rgba(251,191,36,0.12)", stroke: "rgba(251,191,36,0.45)", text: "#fcd34d" },
  loop: { fill: "rgba(56,189,248,0.12)", stroke: "rgba(56,189,248,0.40)", text: "#7dd3fc" },
  function: { fill: "rgba(167,139,250,0.10)", stroke: "rgba(167,139,250,0.35)", text: "#c4b5fd" },
  return: { fill: "rgba(52,211,153,0.10)", stroke: "rgba(52,211,153,0.35)", text: "#6ee7b7" },
  jump: { fill: "rgba(248,113,113,0.10)", stroke: "rgba(248,113,113,0.35)", text: "#fca5a5" },
  default: { fill: "rgba(255,255,255,0.04)", stroke: "rgba(255,255,255,0.15)", text: "#e5e7eb" },
};

export default function FlowchartView({
  chart,
  executedLines,
  activeLine,
  traversedEdges,
  onSelectLine,
}: FlowchartViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const reduce = useReducedMotion();

  if (chart.error) {
    return (
      <section className="panel placeholder-panel">
        <header className="panel-header">
          <span>Flowchart</span>
          <span className="panel-header-sub">static analysis</span>
        </header>
        <div className="panel-body">
          <p className="empty">
            <strong className="error-strong">{chart.error.type}</strong>: {chart.error.message} — fix
            the code to see its control flow.
          </p>
        </div>
      </section>
    );
  }

  if (chart.nodes.length === 0) {
    return (
      <section className="panel placeholder-panel">
        <header className="panel-header">
          <span>Flowchart</span>
        </header>
        <div className="panel-body">
          <p className="empty">No statements to chart yet — write some code.</p>
        </div>
      </section>
    );
  }

  const byId = new Map(chart.nodes.map((node) => [node.id, node]));
  const xs = chart.nodes.map((n) => n.x);
  const ys = chart.nodes.map((n) => n.y);
  const minX = Math.min(...xs) - NODE_W / 2 - PAD;
  const minY = Math.min(...ys) - NODE_H / 2 - PAD;
  const width = Math.max(...xs) - Math.min(...xs) + NODE_W + PAD * 2;
  const height = Math.max(...ys) - Math.min(...ys) + NODE_H + PAD * 2;

  const onPointerDown = (event: React.PointerEvent) => {
    const scroller = scrollRef.current;
    if (!scroller || event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const scroller = scrollRef.current;
    if (!scroller || !drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.current.moved = true;
    scroller.scrollLeft = drag.current.left - dx;
    scroller.scrollTop = drag.current.top - dy;
  };
  const endDrag = () => {
    const moved = drag.current?.moved;
    drag.current = null;
    (scrollRef.current as unknown as HTMLElement | null)?.setAttribute("data-moved", moved ? "1" : "0");
  };

  // Count how many times each traversed edge was crossed (for animated dash-offset)
  const edgeCrossCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of traversedEdges) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, [traversedEdges]);

  return (
    <section className="panel flow-panel">
      <header className="panel-header">
        <span>Flowchart</span>
        <span className="panel-header-sub">
          {chart.nodes.length} nodes
          {chart.truncated ? " · partial" : ""}
          {" · executed path highlighted"}
        </span>
      </header>
      <div
        className="flow-canvas"
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <svg
          width={width}
          height={height}
          viewBox={`${minX} ${minY} ${width} ${height}`}
          className="flow-svg"
        >
          <defs>
            {/* Dim arrow */}
            <marker id="arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#3a3a3a" />
            </marker>
            {/* Hot arrow — white glow */}
            <marker id="arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#38bdf8" />
            </marker>
            {/* Active arrow */}
            <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#a78bfa" />
            </marker>
            {/* Glow filter for active node */}
            <filter id="node-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Pulse filter for active node */}
            <filter id="pulse-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Edges */}
          {chart.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const path = edgePath(from, to);
            const hot = traversedEdges.has(edge.id);
            const crossCount = edgeCrossCount.get(edge.id) ?? 0;
            // Is the active line heading toward this edge's destination?
            const isActiveEdge = hot && to.line != null && to.line === activeLine;

            return (
              <g key={edge.id}>
                {/* Shadow / glow under hot edges */}
                {hot && (
                  <path
                    d={path.d}
                    fill="none"
                    stroke="rgba(56,189,248,0.18)"
                    strokeWidth={8}
                  />
                )}
                {/* Main edge path */}
                <motion.path
                  d={path.d}
                  fill="none"
                  stroke={isActiveEdge ? "#a78bfa" : hot ? "#38bdf8" : "#2a2a2a"}
                  strokeWidth={isActiveEdge ? 3 : hot ? 2.5 : 1.5}
                  strokeDasharray={edge.kind === "subflow" ? "6 5" : hot ? "none" : "none"}
                  markerEnd={`url(#${isActiveEdge ? "arrow-active" : hot ? "arrow-hot" : "arrow-dim"})`}
                  className={hot ? "flow-edge hot" : "flow-edge"}
                  initial={reduce ? false : hot ? { pathLength: 0 } : false}
                  animate={hot ? { pathLength: 1 } : {}}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
                {/* Animated traveling dot for very-recently-traversed edges */}
                {isActiveEdge && !reduce && (
                  <motion.circle
                    r={4}
                    fill="#a78bfa"
                    filter="url(#pulse-glow)"
                  >
                    <animateMotion
                      dur="0.7s"
                      repeatCount="2"
                      path={path.d}
                      fill="freeze"
                    />
                  </motion.circle>
                )}
                {/* Cross-count badge for repeated traversal */}
                {hot && crossCount > 1 && (
                  <text
                    x={path.labelX}
                    y={path.labelY - 10}
                    textAnchor="middle"
                    className="flow-cross-count"
                  >
                    ×{crossCount}
                  </text>
                )}
                {edge.label && (
                  <text
                    x={path.labelX}
                    y={path.labelY}
                    className={"flow-edge-label" + (hot ? " hot" : "")}
                    textAnchor="middle"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {chart.nodes.map((node) => {
            const executed = node.line != null && executedLines.has(node.line);
            const active = node.line != null && activeLine === node.line;
            const clickable = node.line != null;
            const kindColors = NODE_KIND_COLORS[node.kind] ?? NODE_KIND_COLORS.default;

            return (
              <g
                key={node.id}
                className={[
                  "flow-node",
                  `kind-${node.kind}`,
                  executed ? "executed" : "",
                  active ? "active" : "",
                  clickable ? "clickable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                transform={`translate(${node.x - NODE_W / 2}, ${node.y - NODE_H / 2})`}
                onClick={() => {
                  if (clickable && scrollRef.current?.getAttribute("data-moved") !== "1") {
                    onSelectLine(node.line as number);
                  }
                }}
                filter={active ? "url(#node-glow)" : undefined}
              >
                <title>{node.label}</title>

                {/* Active node glow ring */}
                {active && !reduce && (
                  <motion.rect
                    width={NODE_W + 12}
                    height={NODE_H + 12}
                    x={-6}
                    y={-6}
                    rx={(node.kind === "start" || node.kind === "end" ? 35 : 17)}
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    opacity={0}
                    animate={{ opacity: [0, 0.7, 0], scale: [0.95, 1.05, 0.95] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}

                {/* Node body */}
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={node.kind === "start" || node.kind === "end" ? 30 : 13}
                  fill={active ? "rgba(167,139,250,0.22)" : executed ? kindColors.fill : "rgba(255,255,255,0.03)"}
                  stroke={active ? "#a78bfa" : executed ? kindColors.stroke : "rgba(255,255,255,0.1)"}
                  strokeWidth={active ? 2 : executed ? 1.5 : 1}
                />

                {/* Label */}
                <text
                  x={NODE_W / 2}
                  y={node.line != null ? 27 : 35}
                  textAnchor="middle"
                  className="flow-label"
                  fill={active ? "#e9d5ff" : executed ? kindColors.text : "#9ca3af"}
                  fontWeight={active || executed ? "600" : "400"}
                >
                  {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
                </text>

                {node.line != null && (
                  <text
                    x={NODE_W / 2}
                    y={46}
                    textAnchor="middle"
                    className="flow-lineno"
                    fill={active ? "#c4b5fd" : executed ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.2)"}
                  >
                    line {node.line}
                  </text>
                )}

                {/* Active pulsing dot */}
                {active && (
                  <motion.circle
                    cx={NODE_W - 14}
                    cy={14}
                    r={5}
                    fill="#a78bfa"
                    filter="url(#pulse-glow)"
                    animate={{ opacity: [1, 0.3, 1], scale: [1, 1.4, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
