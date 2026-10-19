const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

import type { ExecutionResult, Flowchart, LanguageInfo, SessionInfo } from "./types";

export async function createExecution(source: string, stdin?: string): Promise<ExecutionResult> {
  const response = await fetch(`${API_URL}/api/executions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "python", source, ...(stdin ? { stdin } : {}) }),
  });
  if (!response.ok) {
    throw new Error(`Execution request failed with status ${response.status}`);
  }
  return response.json();
}

/* --- Run mode (sessions) -------------------------------------------------- */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}: ${path}`);
  }
  return response.json();
}

export function fetchLanguages(): Promise<{ languages: LanguageInfo[] }> {
  return request("/api/languages");
}

export function createSession(language: string, source: string, stdin?: string): Promise<SessionInfo> {
  return request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ language, source, ...(stdin ? { stdin } : {}) }),
  });
}

export function getSession(sessionId: string): Promise<SessionInfo> {
  return request(`/api/sessions/${sessionId}`);
}

export function sendSessionInput(sessionId: string, line: string): Promise<SessionInfo> {
  return request(`/api/sessions/${sessionId}/input`, {
    method: "POST",
    body: JSON.stringify({ line }),
  });
}

export function stopSession(sessionId: string): Promise<SessionInfo> {
  return request(`/api/sessions/${sessionId}`, { method: "DELETE" });
}

/* --- Visualizations (flowchart) ------------------------------------------ */

export function createFlowchart(source: string): Promise<Flowchart> {
  return request("/api/visualizations", {
    method: "POST",
    body: JSON.stringify({ source }),
  });
}

/* --- AI tutor (trace-grounded explanations via OpenRouter) ----------------- */

export interface TutorStepContext {
  line?: number | null;
  function?: string | null;
  event_kind?: string | null;
  locals?: Record<string, string>;
  stdout?: string | null;
}

export interface TutorChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TutorRequest {
  question: string;
  source: string;
  language: string;
  student_level?: string;
  context?: TutorStepContext | null;
  history?: TutorChatTurn[];
}

export interface TutorResponse {
  answer: string;
  model: string;
  /** True when the provider cut the answer off at max_tokens. */
  truncated?: boolean;
}

export async function askTutor(body: TutorRequest): Promise<TutorResponse> {
  const response = await fetch(`${API_URL}/api/tutor/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Surface the backend's human-readable detail (missing key, timeout, ...).
    let detail = `Tutor request failed with status ${response.status}`;
    try {
      const data = await response.json();
      if (data && typeof data.detail === "string") detail = data.detail;
    } catch {
      /* non-JSON error body — keep the default message */
    }
    throw new Error(detail);
  }
  return response.json();
}

export { API_URL };
