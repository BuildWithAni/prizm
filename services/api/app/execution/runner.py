"""Runs student Python code in an isolated child process and returns its trace.

The tracer (app/tracing/tracer.py) always executes in a separate process so a
crash, infinite loop or runaway allocation in student code cannot take down
the API server. This module enforces a hard wall-clock backstop on top of the
tracer's own, friendlier in-process limits (which preserve partial traces).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

TRACER_PATH = Path(__file__).resolve().parent.parent / "tracing" / "tracer.py"

# Hard backstop. The tracer normally stops itself via its own time limit and
# returns a partial trace; this only fires if the child process is wedged.
HARD_TIMEOUT_SECONDS = 10.0


def run_python(
    source: str,
    *,
    stdin: str | None = None,
    time_limit: float | None = None,
    max_events: int | None = None,
) -> dict[str, Any]:
    """Execute `source` and return {"status", "events", "output", "error"}."""
    job: dict[str, Any] = {"source": source}
    if stdin:
        job["stdin"] = stdin
    if time_limit is not None:
        job["time_limit"] = time_limit
    if max_events is not None:
        job["max_events"] = max_events

    try:
        proc = subprocess.run(
            [sys.executable, str(TRACER_PATH)],
            input=json.dumps(job),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=HARD_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return _failure(
            "timeout",
            "TimeoutError",
            f"Execution exceeded {HARD_TIMEOUT_SECONDS:.0f}s and the process was killed.",
        )

    if proc.returncode != 0:
        detail = (proc.stderr or "").strip()[-2000:] or "Tracer process failed with no message."
        return _failure("crashed", "InternalError", detail)

    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return _failure("crashed", "InternalError", f"Tracer produced unreadable output: {proc.stdout[:500]!r}")

    result.setdefault("status", "ok")
    result.setdefault("events", [])
    result.setdefault("output", "")
    result.setdefault("error", None)
    return result


def _failure(status: str, error_type: str, message: str) -> dict[str, Any]:
    return {"status": status, "events": [], "output": "", "error": {"type": error_type, "message": message}}
