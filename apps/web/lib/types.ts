// Mirror of the backend trace schema (services/api/app/models.py).
// The runtime determines what happened; these types are how every visual
// panel agrees on what a step means.

export type TraceEventType = "call" | "line" | "return" | "exception";

export type SerializedValue =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "null"; value: null }
  | { type: "array"; value: SerializedValue[] }
  | { type: "function"; name: string }
  | { type: "object"; id: string; label: string };

export interface ExceptionInfo {
  type: string;
  message: string;
}

export interface TraceEvent {
  step: number;
  event: TraceEventType;
  line: number | null;
  functionName: string;
  frameId: string;
  parentFrameId: string | null;
  locals: Record<string, SerializedValue>;
  /** Output printed since the previous step (accumulate to rebuild the console). */
  output: string;
  /** Return value, present on "return" events. */
  value?: SerializedValue | null;
  /** Present on "exception" events. */
  exception?: ExceptionInfo | null;
}

export type ExecutionStatus =
  | "ok"
  | "error"
  | "timeout"
  | "syntax_error"
  | "event_limit"
  | "crashed";

export interface ExecutionResult {
  id: string;
  status: ExecutionStatus;
  events: TraceEvent[];
  output: string;
  error: ExceptionInfo | null;
}

/** A live function frame in the call stack. */
export interface Frame {
  frameId: string;
  functionName: string;
  /** Line the frame is currently suspended on. */
  line: number | null;
}

/** Everything the variable inspector needs for one frame at one step. */
export interface FrameState {
  frameId: string;
  functionName: string;
  line: number | null;
  locals: Record<string, SerializedValue>;
}

/* --------------------------------------------------------------------------
   Flowchart (static analysis of Python source)
   -------------------------------------------------------------------------- */

export type FlowNodeKind =
  | "start"
  | "statement"
  | "decision"
  | "loop"
  | "function"
  | "return"
  | "jump"
  | "end";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  line: number | null;
  x: number; // center coordinates from the server layout
  y: number;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: "normal" | "subflow";
}

export interface Flowchart {
  nodes: FlowNode[];
  edges: FlowEdge[];
  truncated: boolean;
  error: ExceptionInfo | null;
}

/* --------------------------------------------------------------------------
   Run mode (interactive sessions, any language)
   -------------------------------------------------------------------------- */

export type SessionStatus =
  | "running"
  | "exited"
  | "timeout"
  | "stopped"
  | "compile_error"
  | "error";

export interface SessionInfo {
  id: string;
  language: string;
  status: SessionStatus;
  output: string;
  exit_code: number | null;
}

export interface LanguageInfo {
  id: string;
  name: string;
  available: boolean;
  run: boolean;
  trace: boolean;
  detail: string | null;
}
