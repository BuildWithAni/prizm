// Step storytelling: turns one trace event + the real source into a grounded,
// teaching narrative (headline, what/why/next, chips).
//
// Everything here is derived from the actual trace — the real source line, the
// real variable values, real loop/recursion detection — so the story can never
// invent behavior. It renders instantly and offline; the AI insight layer
// (hooks/useStepInsight.ts) enhances it asynchronously on top.

import type { SerializedValue, TraceEvent } from "./types";
import { formatValue } from "./format";

export interface StoryChip {
  label: string;
  tone?: "iter" | "out" | "rec" | "val";
  title?: string;
}

export interface StepStory {
  /** Kinetic one-liner: what this step IS, using real values. */
  headline: string;
  /** The real source line for this event (for the code spotlight). */
  codeLine: string | null;
  codeLineNo: number | null;
  chips: StoryChip[];
  /** What just happened — concrete, quotes actual values. */
  what: string;
  /** The concept behind it — why a learner should care. */
  why: string | null;
  /** Preview of the very next event, or null at end of trace. */
  next: string | null;
}

export interface VarDelta {
  name: string;
  before: SerializedValue | null;
  after: SerializedValue;
  isNew: boolean;
  isRemoved: boolean;
}

const clip = (text: string, n: number): string =>
  text.length > n ? `${text.slice(0, n - 1)}…` : text;

export function frameLabel(name: string): string {
  return name === "<module>" || name === "<main>" || name === "main" ? "the program" : `${name}()`;
}

/* --------------------------------------------------------------------------
   Trace helpers
   -------------------------------------------------------------------------- */

function sourceLine(code: string, n: number | null): string | null {
  if (!code || n == null || n < 1) return null;
  const line = code.split(/\r?\n/)[n - 1];
  return line?.trim() || null;
}

/** Frames open at `step` (a return event at `step` still counts — it is mid-flight). */
function openFrames(events: TraceEvent[], step: number): TraceEvent[] {
  const stack: TraceEvent[] = [];
  for (let i = 0; i <= step && i < events.length; i++) {
    const ev = events[i];
    if (ev.event === "call") {
      stack.push(ev);
    } else if (ev.event === "return" && i < step) {
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].frameId === ev.frameId) {
          stack.splice(j, 1);
          break;
        }
      }
    }
  }
  return stack;
}

/** Line the parent frame was on when it entered the callee (works for every tracer). */
function callerLineAt(events: TraceEvent[], step: number, ev: TraceEvent): number | null {
  if (!ev.parentFrameId) return null;
  for (let i = step - 1; i >= 0; i--) {
    if (events[i].frameId === ev.parentFrameId && events[i].line != null) return events[i].line;
  }
  return null;
}

function parentNameAt(events: TraceEvent[], step: number, ev: TraceEvent): string | null {
  if (!ev.parentFrameId) return null;
  for (let i = step - 1; i >= 0; i--) {
    if (events[i].frameId === ev.parentFrameId) return events[i].functionName;
  }
  return null;
}

/** How many times this exact line has run in this frame: {current visit, total}. */
function visitStats(events: TraceEvent[], step: number, line: number | null, frameId: string) {
  if (line == null) return null;
  let before = 0;
  let total = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.event === "line" && e.line === line && e.frameId === frameId) {
      total++;
      if (i < step) before++;
    }
  }
  return total > 1 ? { current: before + 1, total } : null;
}

/**
 * Variable changes THIS step makes inside its frame.
 *
 * Line events snapshot locals BEFORE the line runs, so the line's effect only
 * appears in the next snapshot of the same frame — comparing current against
 * that gives changes attributable to this exact step (not the previous one).
 */
export function frameDeltas(events: TraceEvent[], step: number): VarDelta[] {
  const ev = events[step];
  if (!ev) return [];
  let post: Record<string, SerializedValue> | null = null;
  for (let i = step + 1; i < events.length; i++) {
    if (events[i].frameId === ev.frameId) {
      post = events[i].locals;
      break;
    }
  }
  const before = ev.locals;
  const after = post ?? ev.locals;
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const deltas: VarDelta[] = [];
  for (const name of names) {
    const prev = before[name] ?? null;
    const next = after[name] ?? null;
    if (prev === null && next === null) continue;
    if (prev !== null && next !== null && JSON.stringify(prev) === JSON.stringify(next)) continue;
    deltas.push({
      name,
      before: prev,
      after: next ?? { type: "null", value: null },
      isNew: prev === null,
      isRemoved: next === null,
    });
  }
  return deltas;
}

/** Value of `name` as first observed after `step` inside the same frame. */
export function valueAfter(events: TraceEvent[], step: number, name: string): SerializedValue | null {
  const cur = events[step];
  if (!cur) return null;
  for (let i = step + 1; i < events.length; i++) {
    const e = events[i];
    if (e.frameId !== cur.frameId) continue;
    const v = e.locals[name];
    if (v !== undefined) return v;
  }
  return null;
}

/* --------------------------------------------------------------------------
   Mini expression evaluator — conservative, returns null whenever unsure.
   Lets us claim `n <= 1 → False` because we KNOW n.
   -------------------------------------------------------------------------- */

function truthy(v: SerializedValue): boolean {
  switch (v.type) {
    case "null":
      return false;
    case "boolean":
      return v.value;
    case "number":
      return v.value !== 0;
    case "string":
      return v.value.length > 0;
    case "array":
      return v.value.length > 0;
    default:
      return true;
  }
}

function operand(token: string, locals: Record<string, SerializedValue>): SerializedValue | null {
  const t = token.trim();
  if (!t) return null;
  if (/^(True|true)$/.test(t)) return { type: "boolean", value: true };
  if (/^(False|false)$/.test(t)) return { type: "boolean", value: false };
  if (/^(None|null|nil|undefined|NULL)$/.test(t)) return { type: "null", value: null };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { type: "number", value: Number(t) };
  const str = /^"([^"\\]*)"$|^'([^']*)'$/.exec(t);
  if (str) return { type: "string", value: str[1] ?? str[2] ?? "" };
  const ident = /^[A-Za-z_]\w*$/.test(t);
  if (ident) return locals[t] ?? null;
  const lenCall = /^len\(\s*([A-Za-z_]\w*)\s*\)$/.exec(t);
  if (lenCall) {
    const inner = locals[lenCall[1]];
    if (!inner) return null;
    if (inner.type === "array") return { type: "number", value: inner.value.length };
    if (inner.type === "string") return { type: "number", value: inner.value.length };
    return null;
  }
  return null;
}

/** Find a top-level occurrence of `sep` (quote + paren aware). */
function topLevelIndex(src: string, sep: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && src.startsWith(sep, i)) return i;
  }
  return -1;
}

function sameValue(a: SerializedValue, b: SerializedValue): boolean {
  if (a.type === "number" && b.type === "number") return a.value === b.value;
  if (a.type === "string" && b.type === "string") return a.value === b.value;
  if (a.type === "boolean" && b.type === "boolean") return a.value === b.value;
  if (a.type === "null" && b.type === "null") return true;
  return formatValue(a) === formatValue(b);
}

function evalCondition(src: string, locals: Record<string, SerializedValue>): boolean | null {
  const s = src.trim();
  if (!s) return null;

  const orAt = topLevelIndex(s, " or ");
  if (orAt >= 0) {
    const l = evalCondition(s.slice(0, orAt), locals);
    const r = evalCondition(s.slice(orAt + 4), locals);
    if (l === null || r === null) return null;
    return l || r;
  }
  const andAt = topLevelIndex(s, " and ");
  if (andAt >= 0) {
    const l = evalCondition(s.slice(0, andAt), locals);
    const r = evalCondition(s.slice(andAt + 5), locals);
    if (l === null || r === null) return null;
    return l && r;
  }
  if (s.startsWith("!") && !s.startsWith("!=")) {
    const r = evalCondition(s.slice(1), locals);
    return r === null ? null : !r;
  }
  if (/^not\s+/.test(s)) {
    const r = evalCondition(s.slice(4), locals);
    return r === null ? null : !r;
  }

  const cmp = /^(.+?)\s+(<=|>=|==|!=|<|>|not in|in)\s+(.+)$/.exec(s);
  if (cmp) {
    const [, leftRaw, op, rightRaw] = cmp;
    const left = operand(leftRaw, locals);
    const right = operand(rightRaw, locals);

    if (op === "in" || op === "not in") {
      let result: boolean | null = null;
      if (left && right?.type === "array") {
        result = right.value.some((item) => sameValue(left, item));
      } else if (left?.type === "string" && right?.type === "string") {
        result = right.value.includes(left.value);
      } else if (left?.type === "number") {
        const range = /^range\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?)?\)$/.exec(rightRaw.trim());
        if (range) {
          const a = range[2] !== undefined ? Number(range[1]) : 0;
          const b = range[2] !== undefined ? Number(range[2]) : Number(range[1]);
          const stepN = range[3] !== undefined ? Number(range[3]) : 1;
          result = stepN > 0 ? left.value >= a && left.value < b : left.value <= a && left.value > b;
        }
      }
      if (result === null) return null;
      return op === "in" ? result : !result;
    }

    if (!left || !right) return null;
    if (op === "==") return sameValue(left, right);
    if (op === "!=") return !sameValue(left, right);
    if (left.type !== "number" || right.type !== "number") return null;
    if (op === "<") return left.value < right.value;
    if (op === ">") return left.value > right.value;
    if (op === "<=") return left.value <= right.value;
    return left.value >= right.value; // >=
  }

  const bare = operand(s, locals);
  return bare ? truthy(bare) : null;
}

/** Condition text of `if`/`elif`/`while` lines (Python, C-family, Go/Ruby-ish). */
function extractCondition(text: string): string | null {
  const py = /^(?:el)?(?:if|while)\s+(.+)\s*:\s*$/.exec(text);
  if (py) return py[1];
  const paren = /^(?:el)?(?:if|while)\s*\((.+)\)\s*\{?\s*$/.exec(text);
  if (paren) return paren[1];
  const bare = /^(?:el)?(?:if|while)\s+(.+?)\s*\{\s*$/.exec(text);
  if (bare) return bare[1];
  return null;
}

/** `for x in seq` (Python/Ruby) header parts. */
function extractFor(text: string): { target: string; seq: string } | null {
  const py = /^for\s+([A-Za-z_]\w*)\s+in\s+(.+?)\s*:\s*$/.exec(text);
  if (py) return { target: py[1], seq: py[2] };
  return null;
}

/** Length of range(...) when args are literals. */
function rangeLength(seq: string): number | null {
  const m = /^range\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?)?\)$/.exec(seq.trim());
  if (!m) return null;
  const a = m[2] !== undefined ? Number(m[1]) : 0;
  const b = m[2] !== undefined ? Number(m[2]) : Number(m[1]);
  const stepN = m[3] !== undefined ? Number(m[3]) : 1;
  if (stepN === 0) return null;
  const len = Math.ceil((b - a) / stepN);
  return len > 0 ? len : 0;
}

/** Identifiers inside a condition that exist in locals — for showing live values. */
function conditionOperands(src: string, locals: Record<string, SerializedValue>): string {
  const ids = new Set<string>();
  for (const m of src.matchAll(/[A-Za-z_]\w*/g)) {
    if (m[0] in locals) ids.add(m[0]);
    if (ids.size >= 3) break;
  }
  return [...ids].map((k) => `${k} = ${clip(formatValue(locals[k]), 14)}`).join(", ");
}

/* --------------------------------------------------------------------------
   The story builder
   -------------------------------------------------------------------------- */

export function buildStepStory(
  events: TraceEvent[],
  step: number,
  code: string,
): StepStory | null {
  const idx = Math.min(Math.max(step, 0), events.length - 1);
  const ev = events[idx];
  if (!ev) return null;

  const text = sourceLine(code, ev.line);
  const fn = frameLabel(ev.functionName);
  const isModule = ev.functionName === "<module>" || ev.functionName === "<main>";
  const deltas = frameDeltas(events, idx);
  // Output attaches to the event recorded AFTER the print — a line's own
  // output lives on the next event (other events never claim it).
  const printed = (ev.event === "line" ? events[idx + 1]?.output ?? "" : "").trim();
  const frames = openFrames(events, idx);
  const sameFnDepth = frames.filter((f) => f.functionName === ev.functionName).length;
  const visits = ev.event === "line" ? visitStats(events, idx, ev.line, ev.frameId) : null;
  const chips: StoryChip[] = [];
  if (visits) {
    chips.push({
      label: `visit ${visits.current}/${visits.total}`,
      tone: "iter",
      title: `this exact line runs ${visits.total} times in this frame`,
    });
  }
  if (printed) {
    chips.push({ label: `🖨 ${clip(printed.replace(/\n/g, " "), 22)}`, tone: "out", title: "printed to the console" });
  }
  if (sameFnDepth > 1 && ev.event === "call") {
    chips.push({ label: `recursion ${sameFnDepth}`, tone: "rec", title: `${ev.functionName} is ${sameFnDepth} frames deep right now` });
  }

  let headline = "";
  let what = "";
  let why: string | null = null;

  switch (ev.event) {
    case "call": {
      const callerLine = callerLineAt(events, idx, ev);
      const parent = parentNameAt(events, idx, ev);
      const args = Object.entries(ev.locals)
        .slice(0, 3)
        .map(([k, v]) => `${k} = ${clip(formatValue(v), 14)}`);
      if (isModule) {
        headline = "🚀 Program starts";
        what = "Execution begins at the top of your file. Every variable created here lives in the global frame.";
        why = "This global frame is the outermost stack frame — it stays alive until the program ends.";
      } else {
        headline = args.length ? `${ev.functionName}(${args.map((a) => a.split(" = ")[1]).join(", ")})` : `${ev.functionName}() called`;
        what = `A new stack frame for ${fn} is pushed${
          args.length ? ` with ${clip(args.join(", "), 64)}` : " — no arguments were passed"
        }. ${parent ? `${frameLabel(parent)} pauses${callerLine != null ? ` on line ${callerLine}` : ""} until it returns.` : ""}`;
        why =
          sameFnDepth > 1
            ? `${ev.functionName} is calling itself — recursion depth ${sameFnDepth}. Each frame keeps its OWN copy of the arguments, so the values never collide.`
            : "A stack frame keeps this call's variables separate from the caller's; the caller resumes only when this returns.";
      }
      break;
    }

    case "line": {
      const cond = text ? extractCondition(text) : null;
      const condResult = cond ? evalCondition(cond, ev.locals) : null;
      const forHead = text ? extractFor(text) : null;
      const isLoopHeader = forHead !== null || (text !== null && /^(?:el)?while\s/.test(text));

      if (cond && condResult !== null) {
        headline = clip(`${cond} → ${condResult ? "True" : "False"}`, 46);
        const live = conditionOperands(cond, ev.locals);
        what = `Branch check on line ${ev.line}: ${cond} evaluates to ${condResult ? "True" : "False"}${
          live ? ` — live values: ${live}` : ""
        }.`;
        if (isLoopHeader) {
          why = condResult
            ? "The loop condition is TRUE, so the body runs another pass."
            : "The loop condition is FALSE — the loop exits and execution continues after it.";
        } else {
          why = condResult
            ? "The condition is TRUE, so the indented body under it runs."
            : "The condition is FALSE, so the body under it is skipped this time.";
        }
      } else if (cond) {
        headline = clip(text ?? cond, 46);
        const live = conditionOperands(cond, ev.locals);
        what = `Condition check on line ${ev.line}${live ? ` with ${live}` : ""}. The trace doesn't expose the result directly — watch which line runs next to see the branch it took.`;
        why = "Conditionals are the program's decision points: the value on this line chooses the path.";
      } else if (forHead) {
        const len = rangeLength(forHead.seq);
        headline = clip(text ?? "", 46);
        what =
          len !== null
            ? `Loop header: ${forHead.target} walks ${forHead.seq} — ${len} value${len === 1 ? "" : "s"}.`
            : `Loop header: ${forHead.target} takes each value from ${forHead.seq}.`;
        why = visits
          ? `Pass ${visits.current} of ${visits.total} visits to this line in this frame.`
          : "Each pass re-checks the header before running the loop body again.";
      } else if (deltas.length === 1) {
        const d = deltas[0];
        const value = clip(formatValue(d.after), 30);
        if (d.after.type === "function") {
          headline = `def ${d.name}()`;
          what = `Line ${ev.line} defines the function ${d.name}. Nothing inside it runs yet — a fresh stack frame is pushed only when something calls ${d.name}().`;
          why = "Defining a function just stores it; its body executes later, at each call site.";
        } else {
          headline = d.isNew ? `${d.name} = ${value}` : clip(`${d.name} → ${value}`, 46);
          what = `Line ${ev.line} runs in ${fn}. ${d.name} is now ${value}${
            d.isNew ? " (first time this name is bound)" : d.isRemoved ? "" : d.before ? ` — it was ${clip(formatValue(d.before), 22)}` : ""
          }.`;
          why = `From here on, every read of ${d.name} inside ${fn} sees ${value}.`;
        }
      } else if (deltas.length > 1) {
        headline = `${deltas.length} variables changed`;
        what = `Line ${ev.line} runs in ${fn}, updating ${deltas
          .slice(0, 3)
          .map((d) => `${d.name} = ${clip(formatValue(d.after), 14)}`)
          .join(", ")}${deltas.length > 3 ? ` and ${deltas.length - 3} more` : ""}.`;
        why = "Compound statements like this can update several names at once — check the cards below for every change.";
      } else if (printed) {
        headline = `printed ${clip(printed.replace(/\n/g, " "), 34)}`;
        what = `Line ${ev.line} runs in ${fn} and writes to the console: “${clip(printed.replace(/\n/g, " "), 48)}”.`;
        why = "print() has no effect on variables — it only sends text to the output stream below.";
      } else {
        headline = clip(text ?? `line ${ev.line}`, 46);
        what = `Line ${ev.line} executes in ${fn}. No variables changed here — this is a condition check, a function call, or a statement whose effect lives elsewhere.`;
        why = text && /^return\b/.test(text) ? "This return hands a value back to the caller." : null;
      }
      break;
    }

    case "return": {
      const value = ev.value ? clip(formatValue(ev.value), 32) : null;
      const callerLine = callerLineAt(events, idx, ev);
      const parent = parentNameAt(events, idx, ev);
      if (isModule) {
        headline = "🏁 Program finishes";
        what = "The global frame ends — the program has run to completion.";
        why = null;
      } else {
        headline = value ? `${ev.functionName} → ${value}` : `${ev.functionName} finished`;
        what = `${fn} ${value ? `hands ${value} back` : "finishes without returning a value (None)"}${
          parent ? ` to ${frameLabel(parent)}${callerLine != null ? `, which resumes on line ${callerLine}` : ""}` : ""
        }. Its frame pops off the stack.`;
        why =
          sameFnDepth > 1
            ? `Recursion unwinds one level — depth ${sameFnDepth - 1} continues with this result.`
            : "The expression that called this function now evaluates to the returned value.";
      }
      break;
    }

    case "exception":
    default: {
      const type = ev.exception?.type ?? "Error";
      const message = ev.exception?.message ?? "";
      headline = clip(message ? `${type}: ${message}` : type, 46);
      what = `Raised at line ${ev.line ?? "?"} in ${fn}. Execution stops here and unwinds the stack looking for an except/finally that handles it.`;
      why = "If nothing catches it, the program ends with a traceback pointing at this line.";
      break;
    }
  }

  // Next-event preview ------------------------------------------------------
  const nextEv = events[idx + 1];
  let next: string | null = null;
  if (nextEv) {
    const nextText = sourceLine(code, nextEv.line);
    switch (nextEv.event) {
      case "call": {
        const args = Object.entries(nextEv.locals)
          .slice(0, 2)
          .map(([, v]) => clip(formatValue(v), 10));
        next = `enters ${nextEv.functionName}(${args.join(", ")})`;
        break;
      }
      case "line":
        next = `L${nextEv.line} · ${clip(nextText ?? "", 52)}`;
        break;
      case "return": {
        next = `${frameLabel(nextEv.functionName)} returns${nextEv.value ? ` ${clip(formatValue(nextEv.value), 24)}` : ""}`;
        break;
      }
      default:
        next = `${nextEv.exception?.type ?? "error"} at line ${nextEv.line ?? "?"}`;
    }
  }

  return {
    headline,
    codeLine: text,
    codeLineNo: ev.line,
    chips,
    what,
    why,
    next,
  };
}

/* --------------------------------------------------------------------------
   Step VISUALS — data for the per-step micro-diagrams (StepVisual.tsx).

   Each spec describes a small animated picture of what this step IS: a stack
   push with the real argument values, an assignment with identifiers
   substituted by their live values, a condition fork with the taken path
   known, loop iteration pips, an exception unwinding the stack. Rendering
   stays in the component; every number here comes from the real trace.
   -------------------------------------------------------------------------- */

export type VisualToken =
  | { t: "code"; s: string }
  | { t: "val"; s: string; name: string; vtype: SerializedValue["type"] };

export interface VisualFrame {
  name: string;
  line: number | null;
}

export interface VisualArg {
  name: string;
  value: string;
  vtype: SerializedValue["type"];
}

export type StepVisualSpec =
  | {
      kind: "stack";
      frames: VisualFrame[];
      /** Index (into frames) of the frame being pushed this step; -1 if unknown. */
      newFrameIndex: number;
      args: VisualArg[];
      hiddenBelow: number;
      printed: string | null;
    }
  | {
      kind: "return";
      frames: VisualFrame[];
      returningIndex: number;
      value: string | null;
      vtype: SerializedValue["type"] | null;
      caller: string | null;
      callerLine: number | null;
      isModule: boolean;
      printed: string | null;
    }
  | {
      kind: "expr";
      target: string;
      op: string;
      tokens: VisualToken[];
      result: string | null;
      vtype: SerializedValue["type"] | null;
    }
  | { kind: "branch"; tokens: VisualToken[]; result: boolean | null; isLoop: boolean }
  | {
      kind: "loop";
      target: string;
      value: string | null;
      vtype: SerializedValue["type"] | null;
      seq: VisualToken[];
      visited: number;
      total: number | null;
    }
  | { kind: "print"; text: string | null; tokens: VisualToken[] | null }
  | { kind: "error"; type: string; message: string; frames: VisualFrame[]; printed: string | null }
  | { kind: "plain"; tokens: VisualToken[] };

/** Words that must never be swapped for their value lookalikes. */
const NO_SUBSTITUTE = new Set([
  "if", "elif", "else", "while", "for", "in", "not", "and", "or", "return", "def",
  "import", "from", "class", "try", "except", "finally", "raise", "lambda", "is",
  "None", "True", "False", "print", "pass", "break", "continue", "range", "len",
  "self", "this", "null", "undefined", "var", "let", "const", "function", "new",
]);

/** Replace identifiers with their live values, keeping operators as code. */
export function substituteTokens(
  text: string,
  locals: Record<string, SerializedValue>,
): VisualToken[] {
  const tokens: VisualToken[] = [];
  const re =
    /([A-Za-z_]\w*)|(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\s+)|([^\sA-Za-z_0-9]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) {
      const word = m[1];
      const value = locals[word];
      // Functions/objects keep their names — substituting `<function …>` or
      // `<Foo object …>` reprs would read far worse than the identifier.
      if (
        value &&
        value.type !== "function" &&
        value.type !== "object" &&
        !NO_SUBSTITUTE.has(word)
      ) {
        tokens.push({ t: "val", s: clip(formatValue(value), 16), name: word, vtype: value.type });
      } else {
        tokens.push({ t: "code", s: word });
      }
    } else if (m[2] !== undefined) {
      tokens.push({ t: "val", s: m[2], name: "", vtype: "number" });
    } else if (m[3] !== undefined) {
      tokens.push({ t: "val", s: m[3], name: "", vtype: "string" });
    } else if (m[4] !== undefined) {
      tokens.push({ t: "code", s: m[4] });
    } else {
      tokens.push({ t: "code", s: m[5] });
    }
  }
  return tokens;
}

function toFrames(list: TraceEvent[]): VisualFrame[] {
  return list.map((f) => ({ name: f.functionName, line: f.line }));
}

export function buildStepVisual(
  events: TraceEvent[],
  step: number,
  code: string,
): StepVisualSpec | null {
  const idx = Math.min(Math.max(step, 0), events.length - 1);
  const ev = events[idx];
  if (!ev) return null;

  const text = sourceLine(code, ev.line);
  const isModule = ev.functionName === "<module>" || ev.functionName === "<main>";
  const open = openFrames(events, idx);
  // The tracer attaches output to the event recorded AFTER the print, so a
  // line's own output lives on the next event. Other events don't claim it —
  // their carrier output belongs to the print line that produced it.
  const printedRaw = ev.event === "line" ? events[idx + 1]?.output ?? "" : "";
  const printed = printedRaw.trim() ? clip(printedRaw.trim(), 120) : null;

  if (ev.event === "call") {
    return {
      kind: "stack",
      frames: toFrames(open),
      newFrameIndex: open.findIndex((f) => f.frameId === ev.frameId),
      args: Object.entries(ev.locals)
        .slice(0, 3)
        .map(([name, v]) => ({ name, value: clip(formatValue(v), 14), vtype: v.type })),
      hiddenBelow: Math.max(0, open.length - 4),
      printed,
    };
  }

  if (ev.event === "return") {
    return {
      kind: "return",
      frames: toFrames(open),
      returningIndex: open.findIndex((f) => f.frameId === ev.frameId),
      value: ev.value ? clip(formatValue(ev.value), 22) : null,
      vtype: ev.value?.type ?? null,
      caller: parentNameAt(events, idx, ev),
      callerLine: callerLineAt(events, idx, ev),
      isModule,
      printed,
    };
  }

  if (ev.event === "exception") {
    return {
      kind: "error",
      type: ev.exception?.type ?? "Error",
      message: ev.exception?.message ?? "",
      frames: toFrames(open),
      printed,
    };
  }

  // Line events: what kind of statement picture fits?
  if (printed) {
    return { kind: "print", text: printed, tokens: null };
  }
  if (!text) return null;
  const locals = ev.locals;

  if (
    /(?:^|[^\w.])(?:print|println|printf|puts|echo)\s*\(|console\.log\s*\(|fmt\.Println?\s*\(|System\.out\.print/.test(
      text,
    )
  ) {
    return { kind: "print", text: null, tokens: substituteTokens(text, locals) };
  }

  const cond = extractCondition(text);
  if (cond) {
    return {
      kind: "branch",
      tokens: substituteTokens(cond, locals),
      result: evalCondition(cond, locals),
      isLoop: /^\s*while\b/.test(text),
    };
  }

  const forHead = extractFor(text);
  if (forHead) {
    const visits = visitStats(events, idx, ev.line, ev.frameId);
    const targetValue = valueAfter(events, idx, forHead.target) ?? locals[forHead.target] ?? null;
    return {
      kind: "loop",
      target: forHead.target,
      value: targetValue ? clip(formatValue(targetValue), 14) : null,
      vtype: targetValue?.type ?? null,
      seq: substituteTokens(forHead.seq, locals),
      visited: visits?.current ?? 1,
      total: visits?.total ?? rangeLength(forHead.seq),
    };
  }

  const assign = /^\s*([A-Za-z_]\w*)\s*(\*\*=|\/\/=|%=|-=|\*=|\/=|\\+=|=)\s*(.+)$/.exec(text);
  if (assign) {
    const [, target, op, rhs] = assign;
    const delta = frameDeltas(events, idx).find((d) => d.name === target);
    return {
      kind: "expr",
      target,
      op,
      tokens: substituteTokens(rhs, locals),
      result: delta ? clip(formatValue(delta.after), 18) : null,
      vtype: delta ? delta.after.type : null,
    };
  }

  return { kind: "plain", tokens: substituteTokens(text, locals) };
}
