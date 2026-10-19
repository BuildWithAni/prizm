"""Isolated execution tracer for CodeLens AI — the heart of the product.

Runs as a separate process. Reads one JSON job from stdin:

    {"source": "...", "time_limit": 3.0, "max_events": 2000, "output_limit": 65536}

Executes the student source with sys.settrace and writes one JSON document to
stdout:

    {"status": "...", "events": [...], "output": "...", "error": {...} | null}

Design notes:

- Only frames compiled from the student source (filename STUDENT_FILENAME) are
  traced, so imports and library internals never pollute the trace.
- Every event carries a full snapshot of the frame's locals, already
  serialized to plain JSON-friendly data. For small educational programs a
  snapshot per step is a reasonable MVP trade-off (memory vs. simple,
  always-correct backward playback).
- Runaway code is stopped three ways: a soft time limit checked on every
  event (preserves a partial trace), an event-count cap, and a hard
  subprocess timeout enforced by the parent runner.
"""

from __future__ import annotations

import io
import json
import sys
import time

STUDENT_FILENAME = "<student_code>"

DEFAULTS = {
    "time_limit": 3.0,
    "max_events": 2000,
    "output_limit": 64 * 1024,
}

MAX_STRING_LEN = 160   # truncate long strings in snapshots
MAX_ITEMS = 12         # truncate long lists/tuples in snapshots
MAX_DEPTH = 3          # stop recursing into deeply nested containers
JSON_INT_LIMIT = 2**53  # beyond this an int is emitted as a string (JS precision)

ABORT_MESSAGES = {
    "timeout": "Execution stopped: time limit exceeded (possible infinite loop).",
    "event_limit": "Execution stopped: too many steps — narrow the input or simplify the program.",
}


class _Abort(Exception):
    """Raised from inside the tracer to stop runaway student code."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class _CappedWriter(io.TextIOBase):
    """A stdout stand-in that captures prints up to a size limit."""

    def __init__(self, buffer: io.StringIO, limit: int) -> None:
        self._buffer = buffer
        self._limit = limit
        self.truncated = False

    def write(self, text: str) -> int:  # type: ignore[override]
        remaining = self._limit - len(self._buffer.getvalue())
        if remaining <= 0:
            self.truncated = True
            return 0
        self._buffer.write(text[:remaining])
        if len(text) > remaining:
            self.truncated = True
        return len(text)

    def flush(self) -> None:
        pass


class _EchoingStdin(io.StringIO):
    """A stdin stand-in for traced code that echoes typed lines to the captured
    output, so playback reads like a real console (prompt, echo, result)."""

    def __init__(self, text: str, echo) -> None:
        super().__init__(text)
        self._echo = echo

    def readline(self, size: int = -1) -> str:  # type: ignore[override]
        line = super().readline(size)
        if line:
            self._echo(line if line.endswith("\n") else f"{line}\n")
        return line

    def read(self, size: int = -1) -> str:  # type: ignore[override]
        text = super().read(size)
        if text:
            self._echo(text)
        return text


def _safe_repr(value: object) -> str:
    try:
        text = repr(value)
    except Exception:  # repr itself can raise for hostile objects
        text = f"<unrepresentable {type(value).__name__}>"
    return text if len(text) <= MAX_STRING_LEN else text[:MAX_STRING_LEN] + "…"


def _safe_str(value: object) -> str:
    try:
        text = str(value)
    except Exception:
        text = f"<unstrable {type(value).__name__}>"
    return text if len(text) <= MAX_STRING_LEN else text[:MAX_STRING_LEN] + "…"


class Tracer:
    def __init__(self, time_limit: float, max_events: int, output_limit: int) -> None:
        self.time_limit = time_limit
        self.max_events = max_events
        self.output_limit = output_limit

        self.events: list[dict] = []
        self._frame_ids: dict[int, str] = {}  # id(frame) -> stable frame id
        self._next_frame = 0
        self._objects: dict[int, str] = {}  # id(obj) -> stable object id
        self._output = io.StringIO()
        self._stdout = _CappedWriter(self._output, output_limit)
        self._consumed = 0  # how much of the output buffer is already attached to events
        self._started: float | None = None

    # --- lifecycle -----------------------------------------------------------

    def attach(self) -> None:
        self._started = time.monotonic()
        sys.settrace(self._trace)

    def detach(self) -> None:
        sys.settrace(None)

    # --- value serialization -------------------------------------------------

    def _object_id(self, value: object) -> str:
        key = id(value)
        if key not in self._objects:
            self._objects[key] = f"o{len(self._objects) + 1}"
        return self._objects[key]

    def serialize(self, value: object, depth: int = 0) -> dict:
        # Order matters: bool before int (bool subclasses int).
        if value is None:
            return {"type": "null", "value": None}
        t = type(value)
        if t is bool:
            return {"type": "boolean", "value": value}
        if t is int:
            if abs(value) > JSON_INT_LIMIT:  # type: ignore[arg-type]
                return {"type": "string", "value": repr(value)}
            return {"type": "number", "value": value}
        if t is float:
            if value != value or value in (float("inf"), float("-inf")):  # type: ignore[comparison-overlap]
                return {"type": "string", "value": repr(value)}
            return {"type": "number", "value": value}
        if t is str:
            return {
                "type": "string",
                "value": value if len(value) <= MAX_STRING_LEN else value[:MAX_STRING_LEN] + "…",  # type: ignore[arg-type]
            }
        if t in (list, tuple):
            if depth >= MAX_DEPTH:
                return {"type": "object", "id": self._object_id(value), "label": f"{t.__name__}(len={len(value)})"}  # type: ignore[arg-type]
            items = [self.serialize(item, depth + 1) for item in value[:MAX_ITEMS]]  # type: ignore[arg-type]
            if len(value) > MAX_ITEMS:  # type: ignore[arg-type]
                items.append({"type": "string", "value": f"… {len(value) - MAX_ITEMS} more"})  # type: ignore[arg-type]
            return {"type": "array", "value": items}

        import inspect

        if inspect.isfunction(value) or inspect.isbuiltin(value) or inspect.ismethod(value):
            return {"type": "function", "name": getattr(value, "__name__", _safe_str(value))}
        if inspect.ismodule(value):
            return {"type": "object", "id": self._object_id(value), "label": f"module {getattr(value, '__name__', '?')}"}

        # dicts, sets, custom objects: id + human-readable label
        label = f"{t.__name__} {_safe_repr(value)}"
        return {"type": "object", "id": self._object_id(value), "label": label}

    # --- the trace function --------------------------------------------------

    def _trace(self, frame, event, arg):
        # Ignore imports and library internals entirely.
        if frame.f_code.co_filename != STUDENT_FILENAME:
            return None
        # Our own abort exception propagating through student frames: don't record it.
        if event == "exception" and isinstance(arg[1], _Abort):
            return None

        if time.monotonic() - self._started > self.time_limit:  # type: ignore[operator]
            raise _Abort("timeout")
        if len(self.events) >= self.max_events:
            raise _Abort("event_limit")

        if event == "call":
            self._next_frame += 1
            frame_id = f"f{self._next_frame}"
            self._frame_ids[id(frame)] = frame_id
            self._record(event, frame, frame_id)
            return self._trace

        frame_id = self._frame_ids.get(id(frame))
        if frame_id is None:  # not ours (shouldn't happen) — stop tracing this frame
            return None

        if event == "line":
            self._record(event, frame, frame_id)
        elif event == "return":
            self._record(event, frame, frame_id, value=self.serialize(arg))
            self._frame_ids.pop(id(frame), None)
        elif event == "exception":
            exc_type, exc_value = arg[0], arg[1]
            self._record(
                event,
                frame,
                frame_id,
                exception={
                    "type": getattr(exc_type, "__name__", str(exc_type)),
                    "message": _safe_str(exc_value),
                },
            )
        return self._trace

    def _record(
        self,
        event: str,
        frame,
        frame_id: str,
        value: dict | None = None,
        exception: dict | None = None,
    ) -> None:
        # Output printed since the previous event is attached to this event, so
        # the UI can rebuild the console incrementally during playback.
        output_snapshot = self._output.getvalue()
        delta = output_snapshot[self._consumed:]
        self._consumed = len(output_snapshot)

        locals_snapshot: dict[str, dict] = {}
        for key, val in frame.f_locals.items():
            if key.startswith("__"):  # skip __name__, __builtins__, etc.
                continue
            locals_snapshot[key] = self.serialize(val)

        parent = self._frame_ids.get(id(frame.f_back))
        self.events.append(
            {
                "step": len(self.events) + 1,
                "event": event,
                "line": frame.f_lineno,
                "functionName": frame.f_code.co_name,
                "frameId": frame_id,
                "parentFrameId": parent,
                "locals": locals_snapshot,
                "output": delta,
                "value": value,
                "exception": exception,
            }
        )


def main() -> int:
    try:
        job = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        job = {}

    source = job.get("source", "")
    tracer = Tracer(
        time_limit=float(job.get("time_limit", DEFAULTS["time_limit"])),
        max_events=int(job.get("max_events", DEFAULTS["max_events"])),
        output_limit=int(job.get("output_limit", DEFAULTS["output_limit"])),
    )

    status = "ok"
    error: dict | None = None
    original_stdout = sys.stdout
    original_stdin = sys.stdin

    code = None
    try:
        code = compile(source, STUDENT_FILENAME, "exec")
    except SyntaxError as exc:
        status = "syntax_error"
        error = {"type": "SyntaxError", "message": f"{exc.msg} (line {exc.lineno})"}

    if code is not None:
        sys.stdout = tracer._stdout  # capture student prints
        stdin_text = job.get("stdin")
        if isinstance(stdin_text, str) and stdin_text:
            # input()/sys.stdin read from the supplied lines; echoes are
            # appended to the captured output like a real console.
            sys.stdin = _EchoingStdin(stdin_text, tracer._stdout.write)
        try:
            tracer.attach()
            exec(code, {"__name__": "__main__"})
        except _Abort as exc:
            status = exc.reason
            error = {"type": "ExecutionAborted", "message": ABORT_MESSAGES[exc.reason]}
        except SyntaxError as exc:  # e.g. code that exec()s generated source
            status = "syntax_error"
            error = {"type": "SyntaxError", "message": f"{exc.msg} (line {exc.lineno})"}
        except BaseException as exc:  # noqa: BLE001 — student code can raise anything
            status = "error"
            error = {"type": type(exc).__name__, "message": _safe_str(exc)}
        finally:
            tracer.detach()
            sys.stdout = original_stdout
            sys.stdin = original_stdin

    result = {
        "status": status,
        "events": tracer.events,
        "output": tracer._output.getvalue(),
        "error": error,
    }
    original_stdout.write(json.dumps(result))
    original_stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
