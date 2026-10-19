"use client";

import { useRef } from "react";
import type { Flowchart, FlowNode } from "../../lib/types";

const NODE_W = 190;
const NODE_H = 58;
const PAD = 46;

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
  // Sideways or back edge: route around the right of both nodes.
  const side = Math.max(sx, tx) + NODE_W / 2 + 52;
  return {
    d: `M ${sx + NODE_W / 2} ${from.y} C ${side} ${from.y}, ${side} ${to.y}, ${tx + NODE_W / 2} ${to.y}`,
    labelX: side - 8,
    labelY: (from.y + to.y) / 2 - 6,
  };
}

/** SVG flowchart with executed-path overlay from the trace. */
export default function FlowchartView({
  chart,
  executedLines,
  activeLine,
  traversedEdges,
  onSelectLine,
}: FlowchartViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

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
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: scroller.scrollLeft,
      top: scroller.scrollTop,
      moved: false,
    };
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
            <marker id="arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#4a4a4a" />
            </marker>
            <marker id="arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#fafafa" />
            </marker>
          </defs>

          {/* edges */}
          {chart.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const path = edgePath(from, to);
            const hot = traversedEdges.has(edge.id);
            return (
              <g key={edge.id}>
                <path
                  d={path.d}
                  fill="none"
                  stroke={hot ? "#fafafa" : "#3a3a3a"}
                  strokeWidth={hot ? 2.4 : 1.4}
                  strokeDasharray={edge.kind === "subflow" ? "5 5" : undefined}
                  markerEnd={`url(#${hot ? "arrow-hot" : "arrow-dim"})`}
                  className={hot ? "flow-edge hot" : "flow-edge"}
                />
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

          {/* nodes */}
          {chart.nodes.map((node) => {
            const executed = node.line != null && executedLines.has(node.line);
            const active = node.line != null && activeLine === node.line;
            const clickable = node.line != null;
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
              >
                <title>{node.label}</title>
                <rect width={NODE_W} height={NODE_H} rx={node.kind === "start" || node.kind === "end" ? 29 : 12} />
                <text x={NODE_W / 2} y={node.line != null ? 26 : 33} textAnchor="middle" className="flow-label">
                  {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
                </text>
                {node.line != null && (
                  <text x={NODE_W / 2} y={43} textAnchor="middle" className="flow-lineno">
                    line {node.line}
                  </text>
                )}
                {active && <circle cx={NODE_W - 12} cy={12} r={4} className="flow-pulse" />}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
