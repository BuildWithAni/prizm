"use client";

/**
 * One shared execution state for the whole workspace.
 *
 * Every visual panel (code highlight, variable inspector, call stack, output,
 * event log) derives from the same trace + selected step, so the inspector can
 * never show one moment while the code highlight shows another.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createExecution } from "../lib/api";
import type { ExecutionResult, Frame, FrameState, TraceEvent } from "../lib/types";

const PLAY_INTERVAL_MS = 650;
/** Playback rates offered by the transport — the trace plays like an animation. */
export const PLAY_SPEEDS = [0.5, 1, 2] as const;

/** Rebuild the call stack by replaying call/return events up to `stepIndex`. */
function computeStack(events: TraceEvent[], stepIndex: number): Frame[] {
  const stack: Frame[] = [];
  for (let i = 0; i <= stepIndex && i < events.length; i++) {
    const event = events[i];
    if (event.event === "call") {
      stack.push({ frameId: event.frameId, functionName: event.functionName, line: event.line });
    } else if (event.event === "return") {
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].frameId === event.frameId) {
          stack.splice(j, 1);
          break;
        }
      }
    } else if (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.frameId === event.frameId) {
        top.line = event.line; // frame resumed at a new line
      }
    }
  }
  return stack;
}

/** Locals + line for one frame as of the current step (latest event wins). */
function findFrameState(events: TraceEvent[], stepIndex: number, frameId: string): FrameState | null {
  for (let i = Math.min(stepIndex, events.length - 1); i >= 0; i--) {
    const event = events[i];
    if (event.frameId === frameId) {
      return {
        frameId,
        functionName: event.functionName,
        line: event.line,
        locals: event.locals,
      };
    }
  }
  return null;
}

export function useExecution() {
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);

  const events = result?.events ?? [];
  const total = events.length;

  const run = useCallback(async (code: string, stdin?: string, language = "python") => {
    setBusy(true);
    setRequestError(null);
    setPlaying(false);
    try {
      const execution = await createExecution(code, stdin, language);
      setResult(execution);
      setStep(0);
      setSelectedFrameId(execution.events[0]?.frameId ?? null);
    } catch (error) {
      setResult(null);
      setSelectedFrameId(null);
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const goto = useCallback(
    (target: number) => {
      setStep(Math.max(0, Math.min(target, total - 1)));
    },
    [total],
  );

  const next = useCallback(() => setStep((s) => Math.min(s + 1, total - 1)), [total]);
  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);
  const first = useCallback(() => setStep(0), []);
  const last = useCallback(() => setStep(Math.max(total - 1, 0)), [total]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && step >= total - 1) return false; // already at the end
      return !p;
    });
  }, [step, total]);

  /** 0.5× → 1× → 2× → 0.5× */
  const cycleSpeed = useCallback(() => {
    setSpeed((current) => {
      const index = PLAY_SPEEDS.indexOf(current as (typeof PLAY_SPEEDS)[number]);
      return PLAY_SPEEDS[(index + 1) % PLAY_SPEEDS.length];
    });
  }, []);

  // Auto-advance while playing; stop at the end of the trace.
  useEffect(() => {
    if (!playing) return;
    if (step >= total - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setStep((s) => Math.min(s + 1, total - 1)), PLAY_INTERVAL_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, step, total, speed]);

  const currentEvent = total > 0 ? events[Math.min(step, total - 1)] : null;

  const stack = useMemo(() => computeStack(events, step), [events, step]);

  // If the user-picked frame has returned, fall back to the active frame.
  const activeFrameId = useMemo(() => {
    if (selectedFrameId && stack.some((f) => f.frameId === selectedFrameId)) {
      return selectedFrameId;
    }
    return currentEvent?.frameId ?? null;
  }, [selectedFrameId, stack, currentEvent]);

  const activeFrameState = useMemo(
    () => (activeFrameId ? findFrameState(events, step, activeFrameId) : null),
    [events, step, activeFrameId],
  );

  const selectFrame = useCallback((frameId: string | null) => setSelectedFrameId(frameId), []);

  /** Clear the recorded trace (e.g. when switching languages). */
  const reset = useCallback(() => {
    setResult(null);
    setStep(0);
    setSelectedFrameId(null);
    setPlaying(false);
  }, []);

  /** Console output as of the selected step (each event carries a delta). */
  const visibleOutput = useMemo(
    () => events.slice(0, step + 1).map((e) => e.output).join(""),
    [events, step],
  );

  return {
    result,
    events,
    total,
    step,
    busy,
    requestError,
    playing,
    currentEvent,
    stack,
    activeFrameId,
    activeFrameState,
    visibleOutput,
    run,
    goto,
    next,
    prev,
    first,
    last,
    togglePlay,
    selectFrame,
    reset,
    speed,
    cycleSpeed,
  };
}
