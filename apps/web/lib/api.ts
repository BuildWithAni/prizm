const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

import { getClientId } from "./credits";

function apiPath(path: string): string {
  // In a Vercel multi-service deployment /api/* is rewritten to FastAPI.
  // Locally Next serves the UI on :3000 and FastAPI separately on :8000.
  if (!API_URL && typeof window !== "undefined" && window.location.port === "3000") {
    return `http://localhost:8000${path}`;
  }
  return `${API_URL}${path}`;
}

import type { ExecutionResult, Flowchart, LanguageInfo, SessionInfo } from "./types";

/** Thrown when the daily visualization allowance is exhausted (HTTP 402). */
export class CreditRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditRequiredError";
  }
}

export async function createExecution(source: string, stdin?: string, language = "python"): Promise<ExecutionResult> {
  const response = await fetch(apiPath("/api/executions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
    credentials: "same-origin",
    body: JSON.stringify({ language, source, ...(stdin ? { stdin } : {}) }),
  });
  if (response.status === 402) {
    throw new CreditRequiredError("Out of visualization credits for today — upgrade to Pro for more.");
  }
  if (!response.ok) {
    throw new Error(`Execution request failed with status ${response.status}`);
  }
  return response.json();
}

/* --- Run mode (sessions) -------------------------------------------------- */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), {
    headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
    // Keep same-origin calls relative when no external API origin is configured.
    // This is compatible with Vercel's /api rewrite and avoids hard-coded localhost.
    credentials: "same-origin",
    ...init,
  });
  if (!response.ok) {
    let detail = `API request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // Keep a useful status message for non-JSON proxy errors.
    }
    throw new Error(`${detail}: ${path}`);
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

/** Surface the backend's human-readable detail (missing key, timeout, ...). */
async function tutorHttpError(response: Response): Promise<Error> {
  let detail = `Tutor request failed with status ${response.status}`;
  try {
    const data = await response.json();
    if (data && typeof data.detail === "string") detail = data.detail;
  } catch {
    /* non-JSON error body — keep the default message */
  }
  return new Error(detail);
}

export async function askTutor(body: TutorRequest): Promise<TutorResponse> {
  const response = await fetch(apiPath("/api/tutor/explain"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!response.ok) throw await tutorHttpError(response);
  return response.json();
}

/**
 * Streaming twin of askTutor: Server-Sent Events from /explain/stream.
 * `onDelta` receives the FULL answer text accumulated so far on every token
 * batch, so callers can just store the latest value. Failures before the
 * first token throw; a mid-stream drop throws after the last good delta was
 * already delivered. Falls through with the answer once `end` is reached.
 */
export async function askTutorStream(
  body: TutorRequest,
  onDelta: (fullText: string) => void,
): Promise<TutorResponse> {
  const response = await fetch(apiPath("/api/tutor/explain/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!response.ok) throw await tutorHttpError(response);
  if (!response.body) throw new Error("The tutor stream returned no body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let model = "";
  let truncated = false;

  const handleFrame = (frame: string) => {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      let event: {
        t?: string;
        text?: string;
        model?: string;
        truncated?: boolean;
        message?: string;
      };
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue; // keepalive or malformed frame — ignore
      }
      if (event.t === "delta" && typeof event.text === "string") {
        answer += event.text;
        onDelta(answer);
      } else if (event.t === "end") {
        if (typeof event.model === "string") model = event.model;
        truncated = event.truncated === true;
      } else if (event.t === "error") {
        throw new Error(event.message || "The tutor stream failed.");
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      handleFrame(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf("\n\n");
    }
  }
  if (!answer.trim()) throw new Error("The tutor returned an empty answer.");
  return { answer, model, truncated };
}

/* --- Credits & Pro plan ----------------------------------------------------- */

export interface CreditStatus {
  client_id: string;
  plan: "free" | "pro";
  used: number;
  limit: number;
  remaining: number;
  /** ISO timestamp of the next daily reset. */
  resets_at: string;
}

export function fetchCredits(): Promise<CreditStatus> {
  return request("/api/credits");
}

export function checkoutPro(): Promise<{ status: CreditStatus; message: string }> {
  return request("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan: "pro" }),
  });
}

export function cancelPro(): Promise<{ status: CreditStatus; message: string }> {
  return request("/api/billing/cancel", {
    method: "POST",
    body: JSON.stringify({ plan: "pro" }),
  });
}

export { API_URL };
