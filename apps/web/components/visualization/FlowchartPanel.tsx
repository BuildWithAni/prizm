"use client";

/**
 * Priority 2 placeholder. The real implementation will run a separate
 * static-analysis module over the source AST to build control-flow nodes and
 * edges (if/else, loops, function calls), rendered with React Flow — then
 * overlay the executed path from the trace.
 */
export default function FlowchartPanel() {
  return (
    <section className="panel placeholder-panel">
      <header className="panel-header">
        <span>Flowchart</span>
        <span className="panel-header-sub">Priority 2</span>
      </header>
      <div className="panel-body">
        <p className="empty">
          AST-based control flow with the executed route highlighted lands next.
          The graph will show all possible branches; the trace overlays the path
          this run actually took.
        </p>
      </div>
    </section>
  );
}
