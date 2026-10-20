"use client";

/**
 * Workspace state shared by the editor and the visualizer pages.
 *
 * The code, the selected language, the queued stdin, the recorded trace and
 * the live run session all live here (in the route-group layout), so moving
 * between "write code" and "watch it execute" never loses state or re-runs
 * a trace the user already has.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useExecution } from "../../hooks/useExecution";
import { useSession } from "../../hooks/useSession";
import { useCredits } from "./CreditsProvider";
import { TEMPLATES, templateFor } from "../../lib/languages";

interface WorkspaceValue {
  code: string;
  setCode: (code: string) => void;
  language: string;
  /** Swap language (and template source), clearing any recorded state. */
  changeLanguage: (language: string) => void;
  /** Stdin lines queued for the next traced run (one line per input()). */
  traceStdin: string;
  addTraceStdin: (line: string) => void;
  clearTraceStdin: () => void;
  /** Source + language the current trace was recorded from (null = none). */
  tracedFor: { code: string; language: string } | null;
  /** Record a trace for the current buffer. Resolves when the trace lands. */
  runTrace: () => Promise<void>;
  /** Step-through trace state (shared by every visual panel). */
  execution: ReturnType<typeof useExecution>;
  /** Live run session state (console on the editor page). */
  runner: ReturnType<typeof useSession>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState(TEMPLATES.python);
  const [language, setLanguage] = useState("python");
  const [traceStdin, setTraceStdin] = useState("");
  const [tracedFor, setTracedFor] = useState<{ code: string; language: string } | null>(null);

  const execution = useExecution();
  const runner = useSession();
  const credits = useCredits();

  const changeLanguage = useCallback(
    (nextLanguage: string) => {
      const sourceIsTemplate = Object.values(TEMPLATES).includes(code);
      if (sourceIsTemplate) setCode(templateFor(nextLanguage));
      setLanguage(nextLanguage);
      execution.reset();
      runner.reset();
      setTraceStdin("");
      setTracedFor(null);
    },
    [code, execution, runner],
  );

  const addTraceStdin = useCallback((line: string) => {
    setTraceStdin((prev) => (prev ? `${prev}\n${line}` : line));
  }, []);

  const clearTraceStdin = useCallback(() => setTraceStdin(""), []);

  const runTrace = useCallback(async () => {
    // Check the meter first (the API also enforces it with a 402) so an empty
    // allowance opens the upgrade path instead of a failed request.
    const status = await credits.refresh();
    if (status && status.remaining <= 0) return;

    await execution.run(code, traceStdin || undefined, language);
    // Remember which buffer the trace describes so the visualizer knows
    // whether it can reuse it or must record a fresh one.
    setTracedFor({ code, language });
    // The trace spent a credit — keep the visible counter honest.
    await credits.refresh();
  }, [execution, code, language, traceStdin, credits]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      code,
      setCode,
      language,
      changeLanguage,
      traceStdin,
      addTraceStdin,
      clearTraceStdin,
      tracedFor,
      runTrace,
      execution,
      runner,
    }),
    [
      code,
      language,
      changeLanguage,
      traceStdin,
      addTraceStdin,
      clearTraceStdin,
      tracedFor,
      runTrace,
      execution,
      runner,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return value;
}
