/**
 * Client identity for the credits meter.
 *
 * There is no sign-up in this MVP: the browser mints a random id once and
 * keeps it in localStorage, sending it as `X-Client-Id` so the API can count
 * visualizations against a stable bucket.
 */

const STORAGE_KEY = "prizm_client_id";

function mint(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `web_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  }
  return `web_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

let cached: string | null = null;

/** Stable per-browser client id (created on first use). */
export function getClientId(): string {
  if (cached) return cached;
  if (typeof window === "undefined") return "ssr";
  try {
    cached = window.localStorage.getItem(STORAGE_KEY) ?? mint();
    window.localStorage.setItem(STORAGE_KEY, cached);
  } catch {
    cached = mint(); // private mode / storage blocked — session-scoped id
  }
  return cached;
}
