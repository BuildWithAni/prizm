"""C/C++ step-through tracer built on modern GDB's embedded Python API.

Flow: compile with -g using the modern WinLibs GCC → drive gdb in batch mode
with an embedded script that steps line-by-line, writing NDJSON events to a
file *as it goes* (so partial traces survive kills/timeouts) → assemble the
shared Prizm schema.

The script only reports stops inside the student's own translation unit;
when `step` wanders into the C runtime it issues `finish` to come back.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from app.execution.toolchain import augment_path_env, find_gcc, find_gdb

_MAX_STEPS = 2000
_STEP_WALL_BUDGET = 6.0
_HARD_TIMEOUT = 25.0

# Runs INSIDE gdb (gdb's own Python). Writes events incrementally so a kill
# still leaves a usable partial trace on disk.
_GDB_SCRIPT = r'''
import gdb
import json
import os
import re
import time

events_path = os.environ["PRIZM_EVENTS"]
stdin_file = os.environ.get("PRIZM_STDIN_FILE", "")
out_file = os.environ["PRIZM_OUT_FILE"]
source_tag = os.environ.get("PRIZM_SOURCE_TAG", "student")
max_steps = int(os.environ.get("PRIZM_MAX_STEPS", "2000"))
wall_budget = float(os.environ.get("PRIZM_WALL_BUDGET", "6"))

gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set print static-members off")
gdb.execute("set print pretty off")
gdb.execute("set python print-stack none")
gdb.execute("set disable-randomization on")

ef = open(events_path, "w", encoding="utf-8")
started = time.time()
step = 0
frame_stack = []          # frame ids by depth (index 0 -> depth 1)
frame_names = []          # function name per depth (for return events)
state = {"status": "ok", "error": None}


def write(ev):
    ef.write(json.dumps(ev) + "\n")
    ef.flush()


def emit(kind, line, fn, depth, locals_map, value=None, exc=None):
    """Emit an event for a frame depth RELATIVE to the student entry point."""
    global step
    step += 1
    frame_id = frame_stack[depth - 1] if 1 <= depth <= len(frame_stack) else "f1"
    parent = frame_stack[depth - 2] if depth >= 2 else None
    write({
        "step": step, "event": kind, "line": int(line or 0),
        "functionName": fn, "frameId": frame_id, "parentFrameId": parent,
        "locals": locals_map, "output": "", "value": value, "exception": exc,
    })


def serialize(val):
    try:
        tc = val.type.strip_typedefs().code
        if tc == gdb.TYPE_CODE_BOOL:
            return {"type": "boolean", "value": bool(val)}
        if tc == gdb.TYPE_CODE_FLT:
            return {"type": "number", "value": float(val)}
        if tc in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_ENUM):
            return {"type": "number", "value": int(val)}
        if tc == gdb.TYPE_CODE_CHAR:
            return {"type": "number", "value": int(val)}
        if tc == gdb.TYPE_CODE_ARRAY:
            t = val.type
            try:
                if t.target().code == gdb.TYPE_CODE_CHAR:
                    return {"type": "string", "value": val.string(encoding="utf-8", errors="replace")[:160]}
            except Exception:
                pass
            items = []
            for i in range(min(len(val), 8)):
                items.append(serialize(val[i]))
            return {"type": "array", "value": items}
        if tc == gdb.TYPE_CODE_PTR:
            inner = None
            try:
                if t_char_ptr(val):
                    inner = {"type": "string", "value": val.string(encoding="utf-8", errors="replace")[:160]}
            except Exception:
                inner = None
            label = inner if inner else {"type": "object", "id": str(val.type), "label": str(val)[:160]}
            return label
        return {"type": "object", "id": str(val.type).strip()[:80], "label": str(val)[:160]}
    except Exception:
        return {"type": "object", "id": "?", "label": "?"}


def t_char_ptr(val):
    try:
        return val.type.strip_typedefs().target().strip_typedefs().code == gdb.TYPE_CODE_CHAR
    except Exception:
        return False


def locals_of(frame):
    out = {}
    seen = set()
    try:
        block = frame.block()
    except Exception:
        return out
    while block is not None and len(seen) < 40:
        try:
            for sym in block:
                try:
                    if not (sym.is_variable or sym.is_argument):
                        continue
                except Exception:
                    continue
                name = sym.name
                if not name or name in seen or name.startswith("__"):
                    continue
                seen.add(name)
                try:
                    out[name] = serialize(frame.read_var(name))
                except Exception:
                    out[name] = {"type": "object", "id": "Unreadable", "label": "?"}
        except Exception:
            pass
        try:
            block = block.superblock
        except Exception:
            break
    return out


def depth_of(frame):
    d = 0
    f = frame
    while f is not None and d < 32:
        d += 1
        f = f.older()
    return d


def location():
    """(filename, line, fn_name, depth) for the newest frame, or None."""
    try:
        fr = gdb.newest_frame()
    except Exception:
        return None
    if fr is None:
        return None
    try:
        sal = fr.find_sal()
        filename = sal.symtab.filename if sal.symtab else ""
        line = sal.line
    except Exception:
        filename = ""
        line = 0
    try:
        fn = fr.name() or "?"
    except Exception:
        fn = "?"
    return (filename.replace("\\", "/"), line, fn, depth_of(fr))


def in_student(filename):
    return source_tag in filename


cmd = "break main"
try:
    gdb.execute(cmd)
except Exception:
    pass

cmd = "run"
if stdin_file:
    cmd += " < " + stdin_file
cmd += " > " + out_file

try:
    gdb.execute(cmd)
except Exception:
    pass

base_depth = None   # absolute depth of the student entry frame (main)
exited = False
foreign_streak = 0

try:
    while step < max_steps and time.time() - started < wall_budget:
        loc = location()
        if loc is None:
            exited = True
            break
        filename, line, fn, abs_depth = loc

        # Stopped on a fatal signal? Emit an exception and stop stepping.
        try:
            info = gdb.execute("info program", to_string=True)
        except Exception:
            info = ""
        m = re.search(r"with signal (\w+)", info)
        if m:
            sig = m.group(1)
            if sig not in ("SIGINT",):
                state["status"] = "error"
                state["error"] = {"type": sig, "message": "Program stopped with " + sig}
                emit("line", max(line, 1), fn, max(abs_depth - (base_depth or 0) + 1, 1),
                     locals_of(gdb.newest_frame()),
                     exc={"type": sig, "message": "Program stopped with " + sig})
                break

        if not in_student(filename):
            # Try `finish` hops back into student code; if GDB refuses
            # ("outermost frame" quirk in static STL), step through the
            # symbol-less frame instead of aborting the whole trace.
            recovered = False
            gave_up = False
            for _ in range(8):
                try:
                    gdb.execute("finish", to_string=True)
                except Exception:
                    break
                nxt = location()
                if nxt is None:
                    gave_up = True
                    break
                filename, line, fn, abs_depth = nxt
                if in_student(filename):
                    recovered = True
                    break
            if gave_up:
                break
            if not recovered:
                foreign_streak += 1
                if foreign_streak > 12:
                    break
                try:
                    gdb.execute("step", to_string=True)
                except Exception:
                    exited = True
                    break
                continue
            foreign_streak = 0

        if base_depth is None:
            base_depth = abs_depth
        depth = max(abs_depth - base_depth + 1, 1)

        # Maintain the frame-id stack; emit call/return on depth change.
        prev_depth = len(frame_stack)
        while len(frame_stack) < depth:
            frame_stack.append("f%d" % (len(frame_stack) + 1))
            frame_names.append(fn)
        if depth > prev_depth:
            frame_names[depth - 1] = fn
            emit("call", max(line, 1), fn, depth, locals_of(gdb.newest_frame()))
        elif depth < prev_depth:
            left_name = frame_names[prev_depth - 1] if prev_depth <= len(frame_names) else fn
            emit("return", max(line, 1), left_name, prev_depth, locals_of(gdb.newest_frame()))
            del frame_stack[depth:]
            del frame_names[depth:]

        if line:
            emit("line", line, fn, depth, locals_of(gdb.newest_frame()))

        try:
            gdb.execute("step", to_string=True)
        except Exception:
            exited = True
            break
except Exception as e:
    state["error"] = {"type": "TraceScriptNote", "message": "stepping stopped early: %r" % e}

if step >= max_steps and state["status"] == "ok":
    state["status"] = "event_limit"
    state["error"] = {"type": "EventLimit", "message": "Stopped after %d events." % max_steps}
elif time.time() - started >= wall_budget and state["status"] == "ok":
    state["status"] = "timeout"
    state["error"] = {"type": "TimeoutError", "message": "C trace exceeded its time budget and was stopped."}

try:
    gdb.execute("kill", to_string=True)
except Exception:
    pass
try:
    ef.close()
except Exception:
    pass

gdb.set_convenience_variable("prizm_done", 1)
print("PRIZM_TRACE_DONE " + json.dumps(state))
'''


def _failure(status: str, kind: str, message: str) -> dict[str, Any]:
    return {"status": status, "events": [], "output": "", "error": {"type": kind, "message": message}}


def trace_with_gdb(source: str, *, stdin: str | None, language: str) -> dict[str, Any]:
    is_cpp = language == "cpp"
    compiler = find_gcc(cpp=is_cpp) or find_gcc(cpp=False)
    gdb = find_gdb()
    if not compiler:
        return _failure("crashed", "ToolchainUnavailable", "A C/C++ compiler is required for tracing.")
    if not gdb:
        return _failure("crashed", "ToolchainUnavailable", "GDB with Python support is required for C/C++ tracing.")

    with tempfile.TemporaryDirectory(prefix="prizm-gdb-") as tmp:
        tmp_path = Path(tmp)
        src_name = "main.cpp" if is_cpp else "main.c"
        src_path = tmp_path / src_name
        src_path.write_text(source, encoding="utf-8")
        exe_path = tmp_path / "student.exe"
        events_path = tmp_path / "events.ndjson"
        out_path = tmp_path / "out.txt"
        stdin_path = tmp_path / "in.txt"
        script_path = tmp_path / "prizm_gdb.py"

        # Dynamic first (steps through STL cleanly); static as the fallback
        # when the toolchain cannot link dynamically.
        compile_cmd = [compiler, str(src_path), "-g", "-O0", "-o", str(exe_path)]
        if is_cpp:
            compile_cmd[3:3] = ["-std=gnu++17"]
        try:
            compiled = subprocess.run(compile_cmd, capture_output=True, text=True,
                                      encoding="utf-8", errors="replace", timeout=30,
                                      env=augment_path_env(dict(os.environ)))
            if compiled.returncode:
                static_cmd = [compiler, str(src_path), "-g", "-O0", "-static", "-o", str(exe_path)]
                if is_cpp:
                    static_cmd[3:3] = ["-std=gnu++17"]
                compiled = subprocess.run(static_cmd, capture_output=True, text=True,
                                          encoding="utf-8", errors="replace", timeout=30)
        except subprocess.TimeoutExpired:
            return _failure("timeout", "TimeoutError", "Compilation exceeded 30s and was stopped.")
        if compiled.returncode:
            return {"status": "syntax_error", "events": [], "output": "", "error": {
                "type": "CompileError", "message": (compiled.stderr or compiled.stdout).strip()[-4000:]}}

        stdin_path.write_text(stdin or "", encoding="utf-8")
        script_path.write_text(_GDB_SCRIPT, encoding="utf-8")

        env = augment_path_env(dict(os.environ))
        env.update({
            "PRIZM_EVENTS": str(events_path),
            "PRIZM_OUT_FILE": str(out_path),
            "PRIZM_STDIN_FILE": str(stdin_path) if stdin else "",
            "PRIZM_SOURCE_TAG": src_name,
        })
        cmd = [gdb, "-batch", "-nx", "-iex", "set auto-load python-scripts off",
               "-x", str(script_path), "--args", str(exe_path)]
        try:
            proc = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", timeout=_HARD_TIMEOUT, env=env)
        except subprocess.TimeoutExpired:
            proc = None

        events: list[dict] = []
        if events_path.exists():
            for line in events_path.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

        output = out_path.read_text(encoding="utf-8", errors="replace") if out_path.exists() else ""

        # The script's final PRIZM_TRACE_DONE line carries its verdict.
        verdict: dict | None = None
        if proc is not None:
            for line in proc.stdout.splitlines():
                if line.startswith("PRIZM_TRACE_DONE "):
                    try:
                        verdict = json.loads(line[len("PRIZM_TRACE_DONE "):])
                    except json.JSONDecodeError:
                        verdict = None

        if proc is None:
            return {
                "status": "timeout", "events": events, "output": output,
                "error": {"type": "TimeoutError", "message": "C trace exceeded 25s and was stopped."},
            }

        status = "ok"
        error = None
        if verdict:
            status = verdict.get("status", "ok")
            error = verdict.get("error")
        elif not events:
            tail = (proc.stderr or proc.stdout or "").strip()[-2000:]
            return {
                "status": "crashed", "events": [], "output": output,
                "error": {"type": "TraceError", "message": tail or "gdb produced no events."},
            }
        elif proc.returncode:
            status = "crashed"
            error = {"type": "TraceError", "message": (proc.stderr or "").strip()[-2000:]}

        if status == "ok" and not output and not events:
            return {
                "status": "crashed", "events": [], "output": "",
                "error": {"type": "TraceError", "message": (proc.stderr or "").strip()[-2000:]},
            }

        return {"status": status, "events": events, "output": output, "error": error}
