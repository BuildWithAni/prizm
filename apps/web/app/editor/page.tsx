"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Logo from "../../components/landing/Logo";
import CodeEditor from "../../components/editor/CodeEditor";
import ExecutionControls from "../../components/execution/ExecutionControls";
import VariableInspector from "../../components/visualization/VariableInspector";
import CallStack from "../../components/visualization/CallStack";
import EventLog from "../../components/visualization/EventLog";
import FlowchartView from "../../components/visualization/FlowchartView";
import CallTreeView from "../../components/visualization/CallTreeView";
import ValueChart from "../../components/visualization/ValueChart";
import ConsolePanel from "../../components/visualization/ConsolePanel";
import TutorPanel from "../../components/tutor/TutorPanel";
import { useExecution } from "../../hooks/useExecution";
import { useSession } from "../../hooks/useSession";
import { createFlowchart } from "../../lib/api";
import type { Flowchart } from "../../lib/types";

type Tab = "state" | "flowchart" | "calltree" | "values" | "tutor";

/** Starter programs per language — swapped on language change (unless edited). */
const TEMPLATES: Record<string, string> = {
  python: `def square(n):
    result = n * n
    return result

x = 4
y = square(x)
print(y)
`,
  javascript: `function square(n) {
  return n * n;
}

const x = 4;
const y = square(x);
console.log(y);
`,
  cpp: `#include <iostream>
using namespace std;

int main() {
  int x = 4;
  int y = x * x;
  cout << y << endl;
  return 0;
}
`,
  java: `public class Main {
  public static void main(String[] args) {
    int x = 4;
    int y = x * x;
    System.out.println(y);
  }
}
`,
};

export default function EditorPage() {
  const [code, setCode] = useState(TEMPLATES.python);
  const [language, setLanguage] = useState("python");
  const [tab, setTab] = useState<Tab>("state");
  const [traceStdin, setTraceStdin] = useState("");
  const [flow, setFlow] = useState<{ source: string; chart: Flowchart | null; loading: boolean }>({
    source: "",
    chart: null,
    loading: false,
  });

  const execution = useExecution();
  const runner = useSession();

  const languageInfo = runner.languages.find((lang) => lang.id === language);
  const traceCapable = languageInfo ? languageInfo.trace : language === "python";
  const languageUnavailable = languageInfo ? !languageInfo.available : false;

  const { currentEvent, stack, activeFrameId, activeFrameState } = execution;
  const total = execution.events.length;

  /* --- flowchart (static analysis, Python) -------------------------------- */

  const loadFlowchart = useCallback(
    async (source: string) => {
      setFlow((prev) => ({ source, chart: prev.source === source ? prev.chart : null, loading: true }));
      try {
        const chart = await createFlowchart(source);
        setFlow({ source, chart, loading: false });
      } catch {
        setFlow({ source, chart: null, loading: false });
      }
    },
    [],
  );

  useEffect(() => {
    if (tab === "flowchart" && language === "python" && flow.source !== code && !flow.loading) {
      loadFlowchart(code);
    }
  }, [tab, language, code, flow.source, flow.loading, loadFlowchart]);

  const runVisualize = useCallback(async () => {
    await execution.run(code, traceStdin || undefined);
    if (language === "python") loadFlowchart(code);
  }, [execution, code, language, loadFlowchart, traceStdin]);

  const runProgram = useCallback(() => {
    runner.run(language, code);
  }, [runner, language, code]);

  const changeLanguage = useCallback(
    (nextLanguage: string) => {
      if (TEMPLATES[language] && code === TEMPLATES[language]) {
        setCode(TEMPLATES[nextLanguage] ?? code);
      }
      setLanguage(nextLanguage);
      execution.reset();
      runner.reset();
      setTraceStdin("");
      if (nextLanguage !== "python") setTab("state");
    },
    [language, code, execution, runner],
  );

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
      if (tab !== "state" && tab !== "calltree") setTab("state");
    },
    [execution, tab],
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

  const tabs: { id: Tab; label: string }[] = [
    { id: "state", label: "Visual State" },
    { id: "flowchart", label: "Flowchart" },
    { id: "calltree", label: "Call Tree" },
    { id: "values", label: "Values" },
    { id: "tutor", label: "AI Tutor" },
  ];

  return (
    <div className="workspace">
      <header className="topbar">
        <a href="/" className="brand" title="Back to home">
          <Logo size={24} showWord />
        </a>

        <select
          className="lang-select"
          value={language}
          onChange={(event) => changeLanguage(event.target.value)}
          aria-label="Language"
        >
          {(runner.languages.length > 0
            ? runner.languages
            : [{ id: "python", name: "Python", available: true, trace: true, run: true, detail: null }]
          ).map((lang) => (
            <option key={lang.id} value={lang.id} disabled={!lang.available}>
              {lang.name}
              {!lang.available ? " (not installed)" : lang.trace ? " · visualize" : " · run"}
            </option>
          ))}
        </select>

        <div className="topbar-right">
          {execution.requestError && (
            <span className="badge badge-error" title={execution.requestError}>
              API unreachable
            </span>
          )}
          {execution.result && (
            <span className={`badge badge-${execution.result.status}`}>{execution.result.status}</span>
          )}
          <button
            className="btn btn-outline"
            onClick={runVisualize}
            disabled={!traceCapable || execution.busy || languageUnavailable}
            title={
              traceCapable
                ? "Record an execution trace and step through it"
                : "Step-through tracing is available for Python — use Run instead"
            }
          >
            ◎ Visualize
          </button>
          <button
            className="btn btn-solid"
            onClick={runProgram}
            disabled={runner.busy || languageUnavailable}
            title="Execute the program and stream its output"
          >
            {runner.busy ? "Starting…" : runner.running ? "● Running" : "▶ Run"}
          </button>
        </div>
      </header>

      <div className="workspace-body">
        <section className="pane pane-editor">
          <div className="editor-wrap">
            <CodeEditor value={code} onChange={setCode} activeLine={currentEvent?.line ?? null} />
          </div>

          <ExecutionControls
            step={execution.step}
            total={total}
            playing={execution.playing}
            busy={execution.busy}
            onFirst={execution.first}
            onPrev={execution.prev}
            onTogglePlay={execution.togglePlay}
            onNext={execution.next}
            onLast={execution.last}
            onScrub={execution.goto}
          />

          <EventLog events={execution.events} step={execution.step} onSelect={execution.goto} />
        </section>

        <aside className="pane pane-side">
          <nav className="tabs">
            {tabs.map((item) => (
              <button
                key={item.id}
                className={"tab" + (tab === item.id ? " active" : "")}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="side-content">
            {tab === "state" && (
              <>
                {execution.result?.error && (
                  <div className="error-card">
                    <strong>{execution.result.error.type}</strong>
                    <span>{execution.result.error.message}</span>
                    {execution.result.error.type === "EOFError" && (
                      <span className="error-hint">
                        This program reads input. Type a line in the Console below — it becomes stdin
                        for the next Visualize run.
                      </span>
                    )}
                  </div>
                )}
                <CallStack frames={stack} activeFrameId={activeFrameId} onSelect={execution.selectFrame} />
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
                />
              </>
            )}

            {tab === "flowchart" && (
              <>
                {language !== "python" ? (
                  <section className="panel placeholder-panel">
                    <header className="panel-header">
                      <span>Flowchart</span>
                    </header>
                    <div className="panel-body">
                      <p className="empty">
                        Flowcharts are generated from Python&apos;s AST right now. Switch to Python to
                        explore control flow — {languageInfo?.name ?? language} can still Run above.
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
                )}
              </>
            )}

            {tab === "calltree" && (
              <CallTreeView
                events={execution.events}
                stack={stack}
                activeFrameId={activeFrameId}
                onSelectStep={execution.goto}
              />
            )}

            {tab === "values" && <ValueChart events={execution.events} step={execution.step} stack={stack} />}

            <div className="tutor-host" hidden={tab !== "tutor"}>
              <TutorPanel
                currentEvent={currentEvent}
                frameState={activeFrameState}
                source={code}
                language={language}
                onApplyCode={setCode}
              />
            </div>
          </div>

          <ConsolePanel
            session={runner.session}
            busy={runner.busy}
            traceOutput={execution.visibleOutput}
            source={runner.session ? "run" : "trace"}
            error={runner.error}
            onSend={(line) => runner.sendInput(line)}
            onStop={() => runner.stop()}
            traceInputEnabled={!runner.session && language === "python" && traceCapable}
            stdinValue={traceStdin}
            onSupplyTraceInput={(line) =>
              setTraceStdin((prev) => (prev ? `${prev}\n${line}` : line))
            }
            onClearTraceInput={() => setTraceStdin("")}
          />
        </aside>
      </div>
    </div>
  );
}
