"use client";

/**
 * Run mode: start a session for any supported language, stream its output,
 * feed it stdin lines, and stop it. Polling is kept in one place so the
 * console updates live while the program runs (or waits for input).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createSession, fetchLanguages, getSession, sendSessionInput, stopSession } from "../lib/api";
import type { LanguageInfo, SessionInfo } from "../lib/types";

const POLL_MS = 350;

export function useSession() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<LanguageInfo[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    (sessionId: string) => {
      clearPoll();
      pollRef.current = setInterval(async () => {
        try {
          const data = await getSession(sessionId);
          setSession(data);
          if (data.status !== "running") clearPoll();
        } catch {
          clearPoll();
        }
      }, POLL_MS);
    },
    [clearPoll],
  );

  // Load available languages once.
  useEffect(() => {
    let cancelled = false;
    fetchLanguages()
      .then((data) => {
        if (!cancelled) setLanguages(data.languages);
      })
      .catch(() => {
        if (!cancelled) setLanguages([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    async (language: string, source: string, stdin?: string) => {
      clearPoll();
      setBusy(true);
      setError(null);
      try {
        const started = await createSession(language, source, stdin || undefined);
        setSession(started);
        if (started.status === "running") poll(started.id);
        return started;
      } catch (e) {
        setSession(null);
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [clearPoll, poll],
  );

  const sendInput = useCallback(
    async (line: string) => {
      if (!session || session.status !== "running") return;
      try {
        const updated = await sendSessionInput(session.id, line);
        setSession(updated);
        poll(session.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [session, poll],
  );

  const stop = useCallback(async () => {
    if (!session) return;
    clearPoll();
    try {
      const updated = await stopSession(session.id);
      setSession(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [session, clearPoll]);

  const reset = useCallback(() => {
    clearPoll();
    setSession(null);
    setError(null);
  }, [clearPoll]);

  useEffect(() => clearPoll, [clearPoll]);

  return {
    languages,
    session,
    busy,
    error,
    running: session?.status === "running",
    run,
    sendInput,
    stop,
    reset,
  };
}
