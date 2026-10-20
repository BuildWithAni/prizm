"use client";

/**
 * Credits state shared by every workspace surface.
 *
 * The provider loads the plan/usage once, keeps it fresh after each
 * visualization, and exposes the "out of credits" flag both pages gate on.
 * Run mode (sessions) and the tutor are never metered — only visualization.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchCredits, type CreditStatus } from "../../lib/api";

interface CreditsValue {
  status: CreditStatus | null;
  loading: boolean;
  /** True when today's visualization allowance is used up. */
  outOfCredits: boolean;
  /** Re-read the allowance from the API (after a trace, checkout, …). */
  refresh: () => Promise<CreditStatus | null>;
}

const CreditsContext = createContext<CreditsValue | null>(null);

export function CreditsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchCredits();
      setStatus(next);
      return next;
    } catch {
      // Discovery is advisory — a flaky API must not disable the workspace.
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<CreditsValue>(
    () => ({
      status,
      loading,
      outOfCredits: status !== null && status.remaining <= 0,
      refresh,
    }),
    [status, loading, refresh],
  );

  return <CreditsContext.Provider value={value}>{children}</CreditsContext.Provider>;
}

export function useCredits(): CreditsValue {
  const value = useContext(CreditsContext);
  if (!value) throw new Error("useCredits must be used inside a CreditsProvider");
  return value;
}
