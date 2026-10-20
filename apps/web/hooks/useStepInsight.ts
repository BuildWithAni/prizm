"use client";

/**
 * Per-step AI insight for the visualizer.
 *
 * Design rules (the tutor key is a scarce free-tier resource):
 *  - fetch only when the student DWELLS on a step (debounced), never while
 *    playback is advancing;
 *  - cache every outcome (success AND failure) per code+step, so scrubbing
 *    back never re-calls the model;
 *  - cap automatic fetches per program run, and back off automatically after
 *    consecutive failures (rate limit / out of credits);
 *  - always render something: waiting → shimmer → insight or a graceful note.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askTutor, type TutorStepContext } from "../lib/api";
import type { TraceEvent } from "../lib/types";
import { formatValue } from "../lib/format";

export interface StepInsightState {
  status: "waiting" | "loading" | "ready" | "failed";
  text?: string;
  model?: string;
  error?: string;
  /** True when automatic insights are paused (budget/cooldown) — copy adapts. */
  autoOff?: boolean;
}

export interface UseStepInsightArgs {
  events: TraceEvent[];
  step: number;
  code: string;
  language: string;
  playing: boolean;
  enabled: boolean;
}

const SETTLE_MS = 750; // dwell before asking — rapid stepping stays local-only
const AUTO_BUDGET = 12; // automatic AI calls per program run
const FAILURE_COOLDOWN_MS = 30_000; // after repeated failures, pause auto-fetching
const MANUAL_GAP_MS = 4_000; // min spacing between explicit "Deeper" clicks

const AUTO_PROMPT =
  "Explain this ONE execution step in at most 2 short sentences (40 words max): " +
  "what just happened with the actual variable values, and why it matters. " +
  "Plain text only — no Markdown, no lists, no code fences.";

const DEEP_PROMPT =
  "Give a deeper explanation of this execution step in at most 110 words: " +
  "what the statement does with the current values, why the program reached it, " +
  "and what happens immediately after. Plain text only — no Markdown or code fences.";

type CacheEntry = { status: "ready" | "failed"; text?: string; model?: string; error?: string };

/** Module-level: survives tab switches and React remounts within the visit. */
const cache = new Map<string, CacheEntry>();
const budgets = new Map<string, number>();
let failStreak = 0;
let lastFailAt = 0;
let lastManualAt = 0;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** Strip light Markdown so plain-rendered text stays clean. */
function tidy(answer: string): string {
  return answer
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 700);
}

function cooldownActive(): boolean {
  return failStreak >= 2 && Date.now() - lastFailAt < FAILURE_COOLDOWN_MS;
}

export function useStepInsight({
  events,
  step,
  code,
  language,
  playing,
  enabled,
}: UseStepInsightArgs): { state: StepInsightState; deeper: () => void; retry: () => void } {
  const idx = Math.min(Math.max(step, 0), Math.max(events.length - 1, 0));
  const total = events.length;

  const [state, setState] = useState<StepInsightState>({ status: "waiting" });
  const seqRef = useRef(0);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const codeHash = useMemo(() => hash(`${language} ${code}`), [language, code]);

  const ev: TraceEvent | null = total > 0 ? events[idx] : null;
  const key = ev ? `${codeHash} ${total} ${idx} ${ev.event} ${ev.line ?? ""} ${ev.functionName}` : null;

  const buildContext = useCallback((): TutorStepContext | null => {
    if (!ev) return null;
    const stdout = events
      .slice(0, idx + 1)
      .map((e) => e.output)
      .join("")
      .slice(0, 400);
    return {
      line: ev.line,
      function: ev.functionName,
      event_kind: ev.event,
      locals: Object.fromEntries(
        Object.entries(ev.locals)
          .slice(0, 12)
          .map(([k, v]) => [k, formatValue(v)]),
      ),
      stdout: stdout || null,
    };
  }, [ev, events, idx]);

  const request = useCallback(
    async (cacheKey: string, question: string) => {
      const context = buildContext();
      if (!context) return;
      const mySeq = ++seqRef.current;
      setState({ status: "loading" });
      try {
        const res = await askTutor({
          question,
          source: code,
          language,
          student_level: "beginner",
          context,
        });
        if (mySeq !== seqRef.current) return;
        const entry: CacheEntry = { status: "ready", text: tidy(res.answer), model: res.model };
        cache.set(cacheKey, entry);
        failStreak = 0;
        setState({ ...entry });
      } catch (err) {
        if (mySeq !== seqRef.current) return;
        const message = err instanceof Error ? err.message : "The AI tutor is unavailable right now.";
        const entry: CacheEntry = { status: "failed", error: message };
        cache.set(cacheKey, entry);
        failStreak += 1;
        lastFailAt = Date.now();
        setState({ ...entry });
      }
    },
    [buildContext, code, language],
  );

  // Debounced automatic insight when the student settles on a step.
  useEffect(() => {
    if (!enabled || !key) {
      setState({ status: "waiting" });
      return;
    }

    const cached = cache.get(key);
    if (cached) {
      setState({ ...cached });
      return;
    }
    if (playing) {
      setState({ status: "waiting" });
      return;
    }

    const timer = setTimeout(() => {
      if (playingRef.current) return;
      const hit = cache.get(key);
      if (hit) {
        setState({ ...hit });
        return;
      }
      if (cooldownActive() || (budgets.get(codeHash) ?? 0) >= AUTO_BUDGET) {
        setState({ status: "waiting", autoOff: true });
        return;
      }
      budgets.set(codeHash, (budgets.get(codeHash) ?? 0) + 1);
      void request(key, AUTO_PROMPT);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [key, enabled, playing, codeHash, request]);

  /** Explicit, more detailed explanation — user-initiated, bypasses budget. */
  const deeper = useCallback(() => {
    if (!key) return;
    if (Date.now() - lastManualAt < MANUAL_GAP_MS) return;
    lastManualAt = Date.now();
    cache.delete(key);
    void request(key, DEEP_PROMPT);
  }, [key, request]);

  /** Re-attempt a failed step. */
  const retry = useCallback(() => {
    if (!key) return;
    if (Date.now() - lastManualAt < MANUAL_GAP_MS) return;
    lastManualAt = Date.now();
    cache.delete(key);
    void request(key, AUTO_PROMPT);
  }, [key, request]);

  return { state, deeper, retry };
}
