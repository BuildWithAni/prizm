"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Logo from "../../../components/landing/Logo";
import CodeEditor from "../../../components/editor/CodeEditor";
import ExecutionControls from "../../../components/execution/ExecutionControls";
import StepNarrator from "../../../components/visualization/StepNarrator";
import VariableInspector from "../../../components/visualization/VariableInspector";
import CallStack from "../../../components/visualization/CallStack";
import EventLog from "../../../components/visualization/EventLog";
import FlowchartView from "../../../components/visualization/FlowchartView";
import CallTreeView from "../../../components/visualization/CallTreeView";
import ValueChart from "../../../components/visualization/ValueChart";
import { useWorkspace } from "../../../components/workspace/WorkspaceProvider";
import HtmlPreview from "../../../components/workspace/HtmlPreview";
import CreditsChip from "../../../components/workspace/CreditsChip";
import { useCredits } from "../../../components/workspace/CreditsProvider";
import { createFlowchart } from "../../../lib/api";
import { KNOWN_TRACE_LANGUAGES, LANGUAGE_CATALOG, PREVIEW_LANGUAGES } from "../../../lib/languages";
import type { Flowchart } from "../../../lib/types";

type Tab = "state" | "flowchart" | "calltree" | "values";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "state", label: "Visual State", hint: "Narration, call stack and variables for the selected step" },
  { id: "flowchart", label: "Flowchart", hint: "Control flow of your program, lit up as it executes" },
  { id: "calltree", label: "Call Tree", hint: "Every function call, as a tree you can click through" },
  { id: "values", label: "Values", hint: "How each variable's value moved over the run" },
];

/**
 * The visualizer: one page devoted to watching a program run.
 *
 * The buffer is shared with the editor, so the trace recorded here always
 * describes exactly the code the student is looking at. Keyboard shortcuts
 * (←/→, space, Home/End) make stepping feel like a media player.
 */
export default function VisualizePage() {
  const workspace = useWorkspace();
  const {
    code,
    language,
    traceStdin,
    addTraceStdin,
    clearTraceStdin,
    tracedFor,
    runTrace,
    execution,
  } = workspace;

  const [tab, setTab] = useState<Tab>("state");
  const [flow, setFlow] = useState<{ source: string; chart: Flowchart | null; loading: boolean }>({
    source: "",
    chart: null,
    loading: false,
  });

  const languageInfo = workspace.runner.languages.find((lang) => lang.id === language);
  const traceCapable = languageInfo ? languageInfo.trace : KNOWN_TRACE_LANGUAGES.includes(language);
  /** HTML has no server-side trace — it renders live in a sandboxed preview. */
  const isPreview = PREVIEW_LANGUAGES.includes(language);
  const selectedLanguage = LANGUAGE_CATALOG.find((item) => item.id === language) ?? LANGUAGE_CATALOG[0];

  const { currentEvent, stack, activeFrameId, activeFrameState } = execution;
  const total = execution.events.length;
  const credits = useCredits();

  /* --- record a trace when the buffer changed ----------------------------- */

  const traceIsStale = !tracedFor || tracedFor.code !== code || tracedFor.language !== language;

  useEffect(() => {
    if (!traceCapable || execution.busy) return;
    if (traceIsStale) void runTrace();
  }, [traceCapable, traceIsStale, execution.busy, runTrace]);

  /* --- flowchart (static analysis, Python) -------------------------------- */

  const loadFlowchart = useCallback(async (source: string) => {
    setFlow((prev) => ({ source, chart: prev.source === source ? prev.chart : null, loading: true }));
    try {
      const chart = await createFlowchart(source);
      setFlow({ source, chart, loading: false });
    } catch {
      setFlow({ source, chart: null, loading: false });
    }
  }, []);

  useEffect(() => {
    if (tab === "flowchart" && language === "python" && flow.source !== code && !flow.loading) {
      loadFlowchart(code);
    }
  }, [tab, language, code, flow.source, flow.loading, loadFlowchart]);

  /* --- trace overlay for the flowchart ------------------------------------ */

  const overlay = useMemo(() => {
    const executedLines = new Set<number>();
    execution.events.forEach((event) => {
      if (event.line != null) executedLines.add(event.line);
    });

    const traversedEdges = new Set<string>();
    const chart = flow.chart;
    if (chart && execution.events.length > 0) {
      const lineToNode = new Map<number, string>();
      for (const node of chart.nodes) {
        if (node.line != null && !lineToNode.has(node.line)) lineToNode.set(node.line, node.id);
      }
      const edgeLookup = new Map<string, string>();
      for (const edge of chart.edges) edgeLookup.set(`${edge.from}:${edge.to}`, edge.id);

      const limit = Math.min(execution.step, execution.events.length - 1);
      let previousNode: string | null = null;
      for (let i = 0; i <= limit; i++) {
        const line = execution.events[i].line;
        const nodeId = line != null ? (lineToNode.get(line) ?? null) : null;
        if (previousNode && nodeId) {
          const edgeId = edgeLookup.get(`${previousNode}:${nodeId}`);
          if (edgeId) traversedEdges.add(edgeId);
        }
        if (nodeId) previousNode = nodeId;
      }
    }
    return { executedLines, traversedEdges };
  }, [flow.chart, execution.events, execution.step]);

  const jumpToLine = useCallback(
    (line: number) => {
      const index = execution.events.findIndex((event) => event.line === line);
      if (index >= 0) execution.goto(index);
      setTab("state");
    },
    [execution],
  );

  /* --- previous-step locals (for change flashing) -------------------------- */

  const prevLocals = useMemo(() => {
    if (execution.step <= 0 || !activeFrameId) return null;
    for (let i = execution.step - 1; i >= 0; i--) {
      const event = execution.events[i];
      if (event.frameId === activeFrameId) return event.locals;
    }
    return null;
  }, [execution.events, execution.step, activeFrameId]);

  /* --- keyboard stepping --------------------------------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal keys from inputs, the editor or the tutor chat.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest?.(".monaco-editor"))
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (total === 0) return;

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          execution.next();
          break;
        case "ArrowLeft":
          event.preventDefault();
          execution.prev();
          break;
        case " ":
          event.preventDefault();
          execution.togglePlay();
          break;
        case "Home":
          event.preventDefault();
          execution.first();
          break;
        case "End":
          event.preventDefault();
          execution.last();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [execution, total]);

  const traceFailed = execution.result?.error ?? null;
  const showStdinPrompt = traceFailed && /EOF|input/i.test(`${traceFailed.type} ${traceFailed.message}`);

  return (
    <div className="workspace">
      <header className="topbar">
        <Link href="/" className="brand" title="Back to home">
          <Logo size={24} showWord />
        </Link>
        <span className="topbar-kicker">Visualizer</span>

        <div className="topbar-right">
          <span className="viz-language-chip" title={`Tracing ${selectedLanguage.name}`}>
            <span className={`language-icon language-icon-${selectedLanguage.id}`} aria-hidden="true">
              <img src={`/languages/${selectedLanguage.icon}`} alt="" width="16" height="16" />
            </span>
            {selectedLanguage.name}
          </span>
          {execution.requestError && (
            <span className="badge badge-error" title={execution.requestError}>
              API unreachable
            </span>
          )}
          {execution.result && (
            <span className={`badge badge-${execution.result.status}`}>{execution.result.status}</span>
          )}
          <CreditsChip />
          <button
            className="btn btn-outline"
            onClick={() => void runTrace()}
            disabled={!traceCapable || execution.busy}
            title="Record the trace again from the current code"
          >
            {execution.busy ? "Recording…" : "↻ Re-run"}
          </button>
          <Link href="/editor" className="btn btn-ghost" title="Back to the editor">
            ✎ Editor
          </Link>
        </div>
      </header>

      <div className="workspace-body viz-body">
        <section className="pane pane-editor">
          <div className="editor-wrap">
            <CodeEditor
              value={code}
              onChange={() => {}}
              activeLine={currentEvent?.line ?? null}
              language={language}
              readOnly
            />
          </div>

          <ExecutionControls
            step={execution.step}
            total={total}
            playing={execution.playing}
            busy={execution.busy}
            speed={execution.speed}
            onCycleSpeed={execution.cycleSpeed}
            onFirst={execution.first}
            onPrev={execution.prev}
            onTogglePlay={execution.togglePlay}
            onNext={execution.next}
            onLast={execution.last}
            onScrub={execution.goto}
          />

          <div className="viz-hints" aria-hidden="true">
            <span className="viz-hint">
              <kbd>←</kbd>
              <kbd>→</kbd> step
            </span>
            <span className="viz-hint">
              <kbd>space</kbd> play
            </span>
            <span className="viz-hint">
              <kbd>home</kbd>
              <kbd>end</kbd> ends
            </span>
            {total > 0 && (
              <span className="viz-hint viz-hint-dim">
                {stack.length === 1 ? "1 frame on the stack" : `${stack.length} frames on the stack`}
              </span>
            )}
          </div>

          <EventLog events={execution.events} step={execution.step} onSelect={execution.goto} />
        </section>

        <aside className="pane pane-side">
          <nav className="tabs" aria-label="Visualization views">
            {TABS.map((item) => (
              <button
                key={item.id}
                className={"tab" + (tab === item.id ? " active" : "")}
                onClick={() => setTab(item.id)}
                title={item.hint}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="side-content">
            {!traceCapable && isPreview ? (
              <>
                <section className="panel placeholder-panel">
                  <header className="panel-header">
                    <span>Live preview</span>
                    <span className="panel-header-sub">rendered in your browser</span>
                  </header>
                  <div className="panel-body">
                    <p className="empty">
                      {selectedLanguage.name} doesn&apos;t run on the server, so there is no step trace to play
                      back — it renders directly in a live, sandboxed browser preview below. Use{" "}
                      <strong>▶ Run (Preview)</strong> in the editor to re-render as you edit.
                    </p>
                    <Link href="/editor" className="btn btn-outline">
                      ✎ Back to the editor
                    </Link>
                  </div>
                </section>
                <HtmlPreview source={code} />
              </>
            ) : !traceCapable ? (
              <section className="panel placeholder-panel">
                <header className="panel-header">
                  <span>Run-only language</span>
                </header>
                <div className="panel-body">
                  <p className="empty">
                    {selectedLanguage.name} programs can be executed with ▶ Run, but this build has no step-through
                    tracer for them yet. Python, JavaScript, TypeScript, Java, Kotlin, C, C++, Go and Ruby are fully
                    traceable — switch language in the editor to explore one of those.
                  </p>
                  <Link href="/editor" className="btn btn-outline">
                    ✎ Back to the editor
                  </Link>
                </div>
              </section>
            ) : credits.outOfCredits && total === 0 && !execution.busy ? (
              <section className="panel placeholder-panel">
                <header className="panel-header">
                  <span>Out of credits for today</span>
                  <span className="panel-header-sub">resets at midnight</span>
                </header>
                <div className="panel-body">
                  <p className="empty">
                    You&apos;ve used all {credits.status?.limit ?? ""} visualizations on the Free plan. Get Pro for a
                    much larger daily allowance — running code with ▶ Run, the console and the AI tutor stay free on
                    every plan.
                  </p>
                  <Link href="/pricing" className="btn btn-solid">
                    ⚡ Get Pro
                  </Link>
                </div>
              </section>
            ) : execution.busy && total === 0 ? (
              <section className="panel placeholder-panel">
                <header className="panel-header">
                  <span>Recording execution</span>
                  <span className="panel-header-sub">tracing…</span>
                </header>
                <div className="panel-body">
                  <p className="empty">Running your program under the tracer — the panels light up in a moment.</p>
                </div>
              </section>
            ) : total === 0 && !traceFailed ? (
              <section className="panel placeholder-panel">
                <header className="panel-header">
                  <span>Nothing to visualize yet</span>
                </header>
                <div className="panel-body">
                  <p className="empty">
                    Write a program in the editor, then press ◎ Visualize. Every step it takes shows up here — the
                    narration, the call stack, the variables, the flowchart.
                  </p>
                  <Link href="/editor" className="btn btn-outline">
                    ✎ Back to the editor
                  </Link>
                </div>
              </section>
            ) : (
              <>
                {traceFailed && (
                  <div className="error-card">
                    <strong>{traceFailed.type}</strong>
                    <span>{traceFailed.message}</span>
                    {showStdinPrompt && (
                      <span className="error-hint">
                        This program reads input. Type a line below — it becomes stdin for the next traced run.
                      </span>
                    )}
                  </div>
                )}

                {showStdinPrompt && (
                  <form
                    className="viz-stdin"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const field = event.currentTarget.elements.namedItem("stdin") as HTMLInputElement;
                      const line = field.value.trim();
                      if (!line) return;
                      addTraceStdin(line);
                      field.value = "";
                      void runTrace();
                    }}
                  >
                    <input name="stdin" className="viz-stdin-input" placeholder="a line of input for the program…" />
                    <button type="submit" className="btn btn-outline">
                      Send ⏎
                    </button>
                  </form>
                )}

                {tab === "state" && (
                  <>
                    <StepNarrator events={execution.events} step={execution.step} onJump={execution.goto} />
                    <CallStack
                      frames={stack}
                      activeFrameId={activeFrameId}
                      onSelect={execution.selectFrame}
                      events={execution.events}
                      step={execution.step}
                    />
                    <VariableInspector
                      frameName={
                        activeFrameState
                          ? activeFrameState.functionName === "<module>"
                            ? "(module)"
                            : activeFrameState.functionName
                          : null
                      }
                      line={activeFrameState?.line ?? null}
                      locals={activeFrameState?.locals ?? null}
                      prevLocals={prevLocals}
                      events={execution.events}
                      step={execution.step}
                      frameId={activeFrameId}
                    />
                  </>
                )}

                {tab === "flowchart" &&
                  (language !== "python" ? (
                    <section className="panel placeholder-panel">
                      <header className="panel-header">
                        <span>Flowchart</span>
                      </header>
                      <div className="panel-body">
                        <p className="empty">
                          Flowcharts are generated for Python code. {selectedLanguage.name} is still traced step by
                          step in the Visual State tab.
                        </p>
                      </div>
                    </section>
                  ) : flow.loading ? (
                    <section className="panel placeholder-panel">
                      <header className="panel-header">
                        <span>Flowchart</span>
                        <span className="panel-header-sub">analyzing…</span>
                      </header>
                      <div className="panel-body">
                        <p className="empty">Building control-flow graph from your AST…</p>
                      </div>
                    </section>
                  ) : flow.chart ? (
                    <FlowchartView
                      chart={flow.chart}
                      executedLines={overlay.executedLines}
                      activeLine={currentEvent?.line ?? null}
                      traversedEdges={overlay.traversedEdges}
                      onSelectLine={jumpToLine}
                    />
                  ) : (
                    <section className="panel placeholder-panel">
                      <header className="panel-header">
                        <span>Flowchart</span>
                      </header>
                      <div className="panel-body">
                        <p className="empty">Analyzing your code…</p>
                      </div>
                    </section>
                  ))}

                {tab === "calltree" && (
                  <CallTreeView
                    events={execution.events}
                    stack={stack}
                    activeFrameId={activeFrameId}
                    onSelectStep={execution.goto}
                  />
                )}

                {tab === "values" && <ValueChart events={execution.events} step={execution.step} stack={stack} />}
              </>
            )}
          </div>
        </aside>
      </div>

      {traceStdin && (
        <div className="viz-stdin-queued">
          <span className="stdin-chip" title={`Queued stdin (click to clear):\n${traceStdin}`}>
            stdin: {traceStdin.split("\n").length} lines
          </span>
          <button type="button" className="btn btn-ghost" onClick={clearTraceStdin}>
            Clear input
          </button>
        </div>
      )}
    </div>
  );
}
