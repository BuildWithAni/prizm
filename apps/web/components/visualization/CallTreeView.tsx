"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Frame, TraceEvent } from "../../lib/types";
import { formatValue } from "../../lib/format";

const PILL_W = 168;
const PILL_H = 54;
const STEP_X = 196;
const STEP_Y = 92;
const MAX_NODES = 90;

interface CallTreeViewProps {
  events: TraceEvent[];
  stack: Frame[]; // active frames at the current step
  activeFrameId: string | null;
  onSelectStep: (stepIndex: number) => void;
}

interface TreeNode {
  frameId: string;
  functionName: string;
  parentFrameId: string | null;
  callStep: number;
  endStep: number | null;
  returnValue: string | null;
  children: TreeNode[];
  x: number;
  y: number;
}

/** Build a tree of function calls from the trace events. */
function buildTree(events: TraceEvent[]): { roots: TreeNode[]; total: number } {
  const nodes = new Map<string, TreeNode>();
  let total = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.event === "call") {
      total += 1;
      if (nodes.size >= MAX_NODES) continue;
      const node: TreeNode = {
        frameId: event.frameId,
        functionName: event.functionName,
        parentFrameId: event.parentFrameId,
        callStep: i,
        endStep: null,
        returnValue: null,
        children: [],
        x: 0,
        y: 0,
      };
      nodes.set(event.frameId, node);
      const parent = event.parentFrameId ? nodes.get(event.parentFrameId) : undefined;
      if (parent) parent.children.push(node);
    } else if (event.event === "return") {
      const node = nodes.get(event.frameId);
      if (node) {
        node.endStep = i;
        node.returnValue = event.value ? formatValue(event.value) : null;
      }
    }
  }

  const roots = [...nodes.values()].filter(
    (node) => !node.parentFrameId || !nodes.has(node.parentFrameId),
  );

  // Tidy-ish layout: leaves advance a cursor; parents center over children.
  let cursor = 0;
  const place = (node: TreeNode, depth: number) => {
    node.y = depth;
    if (node.children.length === 0) {
      node.x = cursor;
      cursor += 1;
    } else {
      node.children.forEach((child) => place(child, depth + 1));
      node.x = (node.children[0].x + node.children[node.children.length - 1].x) / 2;
    }
  };
  roots.forEach((root) => place(root, 0));
  return { roots, total };
}

function flatten(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const node of nodes) {
    out.push(node);
    flatten(node.children, out);
  }
  return out;
}

/** Recursive call tree — click a call to jump to its step. */
export default function CallTreeView({ events, stack, activeFrameId, onSelectStep }: CallTreeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { roots, total } = useMemo(() => buildTree(events), [events]);
  const flat = useMemo(() => flatten(roots), [roots]);

  const activeSet = useMemo(() => new Set(stack.map((frame) => frame.frameId)), [stack]);

  // Ancestors of the active frame stay highlighted (the "waiting" chain).
  const ancestors = useMemo(() => {
    const result = new Set<string>();
    if (!activeFrameId) return result;
    const byId = new Map(flat.map((node) => [node.frameId, node]));
    let current = byId.get(activeFrameId);
    while (current) {
      result.add(current.frameId);
      current = current.parentFrameId ? byId.get(current.parentFrameId) : undefined;
    }
    return result;
  }, [flat, activeFrameId]);

  const activeEl = activeFrameId ? containerRef.current?.querySelector(`[data-frame="${activeFrameId}"]`) : null;
  useEffect(() => {
    activeEl?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeEl]);

  if (flat.length === 0) {
    return (
      <section className="panel placeholder-panel">
        <header className="panel-header">
          <span>Call Tree</span>
        </header>
        <div className="panel-body">
          <p className="empty">Run Visualize Code to record calls — every invocation appears here as a tree.</p>
        </div>
      </section>
    );
  }

  const width = (Math.max(...flat.map((n) => n.x)) + 1) * STEP_X + 60;
  const height = (Math.max(...flat.map((n) => n.y)) + 1) * STEP_Y + 40;

  return (
    <section className="panel tree-panel">
      <header className="panel-header">
        <span>Call Tree</span>
        <span className="panel-header-sub">
          {flat.length}
          {total > flat.length ? ` of ${total}` : ""} calls
        </span>
      </header>
      <div className="tree-canvas" ref={containerRef}>
        <svg width={width} height={height} className="tree-svg">
          {/* edges */}
          {flat.map((node) =>
            node.children.map((child) => (
              <path
                key={`${node.frameId}-${child.frameId}`}
                d={`M ${30 + node.x * STEP_X + PILL_W / 2} ${20 + node.y * STEP_Y + PILL_H}
                    C ${30 + node.x * STEP_X + PILL_W / 2} ${20 + node.y * STEP_Y + PILL_H + 34},
                      ${30 + child.x * STEP_X + PILL_W / 2} ${20 + child.y * STEP_Y - 34},
                      ${30 + child.x * STEP_X + PILL_W / 2} ${20 + child.y * STEP_Y}`}
                fill="none"
                stroke={
                  ancestors.has(node.frameId) && ancestors.has(child.frameId) ? "#fafafa" : "#3a3a3a"
                }
                strokeWidth={ancestors.has(child.frameId) ? 2 : 1.4}
              />
            )),
          )}

          {/* nodes */}
          {flat.map((node) => {
            const isActive = node.frameId === activeFrameId;
            const onPath = ancestors.has(node.frameId);
            const isLive = activeSet.has(node.frameId);
            return (
              <g
                key={node.frameId}
                data-frame={node.frameId}
                className={[
                  "tree-node",
                  isActive ? "active" : "",
                  onPath ? "on-path" : "",
                  isLive ? "live" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                transform={`translate(${30 + node.x * STEP_X}, ${20 + node.y * STEP_Y})`}
                onClick={() => onSelectStep(node.callStep)}
              >
                <title>
                  {node.functionName === "<module>" ? "(module)" : node.functionName} — call at step{" "}
                  {node.callStep + 1}
                  {node.returnValue ? `, returned ${node.returnValue}` : ""}
                </title>
                <rect width={PILL_W} height={PILL_H} rx={12} />
                <text x={PILL_W / 2} y={22} textAnchor="middle" className="tree-name">
                  {node.functionName === "<module>" ? "(module)" : node.functionName}
                </text>
                <text x={PILL_W / 2} y={40} textAnchor="middle" className="tree-sub">
                  {node.returnValue
                    ? `→ ${node.returnValue.length > 16 ? `${node.returnValue.slice(0, 15)}…` : node.returnValue}`
                    : isLive
                      ? "executing…"
                      : `step ${node.callStep + 1}`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
