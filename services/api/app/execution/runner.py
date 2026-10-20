"""Runs student Python code in an isolated child process and returns its trace.

The tracer (app/tracing/tracer.py) always executes in a separate process so a
crash, infinite loop or runaway allocation in student code cannot take down
the API server. This module enforces a hard wall-clock backstop on top of the
tracer's own, friendlier in-process limits (which preserve partial traces).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from app.execution.toolchain import augment_path_env, find_tool, kotlin_home

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


def run_traced(language: str, source: str, *, stdin: str | None = None) -> dict[str, Any]:
    """Dispatch a trace request to the language-specific isolated tracer."""
    if language == "python":
        return run_python(source, stdin=stdin)
    if language in {"javascript", "typescript"}:
        return _run_javascript(source, stdin=stdin, language=language)
    if language == "java":
        return _run_jdi_trace(source, stdin=stdin, main_class="Main", source_filename="Main.java")
    if language == "kotlin":
        return _run_kotlin(source, stdin=stdin)
    if language == "ruby":
        return _run_ruby(source, stdin=stdin)
    if language == "go":
        return _run_go(source, stdin=stdin)
    if language in {"c", "cpp"}:
        return _run_gdb(source, stdin=stdin, language=language)
    return _failure(
        "crashed",
        "UnsupportedLanguage",
        f"Tracing is not supported for {language}. {language.capitalize()} can still Run.",
    )


def _run_javascript(source: str, *, stdin: str | None, language: str = "javascript") -> dict[str, Any]:
    node = find_tool("node") or shutil.which("node")
    if not node:
        return _failure("crashed", "ToolchainUnavailable", "Node.js is required for JavaScript tracing.")
    tracer = Path(__file__).resolve().parent.parent / "tracing" / "javascript_tracer.cjs"
    job = json.dumps({"source": source, "stdin": stdin or "", "language": language})
    env = _safe_trace_env()
    # Keep Node's own warnings (e.g. experimental stripTypeScriptTypes) out of
    # the student's captured stdout — console.* output still shows.
    env["NODE_NO_WARNINGS"] = "1"
    try:
        with tempfile.TemporaryFile(mode="w+t", encoding="utf-8", newline="") as job_file:
            job_file.write(job)
            job_file.seek(0)
            proc = subprocess.run([node, str(tracer)], stdin=job_file, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", timeout=HARD_TIMEOUT_SECONDS,
                                  env=env)
    except subprocess.TimeoutExpired:
        return _failure("timeout", "TimeoutError", "JavaScript trace exceeded 10s and was stopped.")
    return _parse_trace_process(proc)


def _run_ruby(source: str, *, stdin: str | None) -> dict[str, Any]:
    ruby = find_tool("ruby") or shutil.which("ruby")
    if not ruby:
        return _failure("crashed", "ToolchainUnavailable", "Ruby is required for Ruby tracing.")
    tracer = Path(__file__).resolve().parent.parent / "tracing" / "ruby_tracer.rb"
    job = json.dumps({"source": source, "stdin": stdin or ""})
    try:
        proc = subprocess.run([ruby, str(tracer)], input=job, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=HARD_TIMEOUT_SECONDS,
                              env=_safe_trace_env())
    except subprocess.TimeoutExpired:
        return _failure("timeout", "TimeoutError", "Ruby trace exceeded 10s and was stopped.")
    return _parse_trace_process(proc)


def _run_go(source: str, *, stdin: str | None) -> dict[str, Any]:
    go = find_tool("go") or shutil.which("go")
    if not go:
        return _failure("crashed", "ToolchainUnavailable", "Go is required for Go tracing.")
    env = _safe_trace_env()
    # The sandboxed env strips LOCALAPPDATA, so Go can't find its default
    # cache — give it explicit temp dirs (warm cache = fast repeat traces).
    go_root = Path(tempfile.gettempdir()) / "prizm-go"
    go_cache = go_root / "cache"
    go_cache.mkdir(parents=True, exist_ok=True)
    env["GOCACHE"] = str(go_cache)
    env["GOPATH"] = str(go_root / "gopath")
    env["GOFLAGS"] = "-mod=mod"
    tool_src = Path(__file__).resolve().parent.parent / "tracing" / "go_tracer.go"
    tool_dir = Path(tempfile.gettempdir()) / "prizm-go-tracer"
    tool_exe = tool_dir / "go_tracer.exe"
    # Build the instrumenter once and reuse it (stale-source check mirrors Java).
    if not tool_exe.exists() or tool_exe.stat().st_mtime < tool_src.stat().st_mtime:
        tool_dir.mkdir(parents=True, exist_ok=True)
        built = subprocess.run([go, "build", "-o", str(tool_exe), str(tool_src)], capture_output=True,
                               text=True, encoding="utf-8", errors="replace", timeout=60,
                               env=env)
        if built.returncode:
            return _failure("crashed", "TracerBuildError", built.stderr[-3000:])
    job = json.dumps({"source": source, "stdin": stdin or "", "go": go})
    try:
        with tempfile.TemporaryFile(mode="w+t", encoding="utf-8", newline="") as job_file:
            job_file.write(job)
            job_file.seek(0)
            # 75s: cold `go build` of the instrumented module dominates the first trace.
            proc = subprocess.run([str(tool_exe)], stdin=job_file, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", timeout=75, env=env)
    except subprocess.TimeoutExpired:
        return _failure("timeout", "TimeoutError", "Go trace exceeded its time budget and was stopped.")
    return _parse_trace_process(proc)


def _run_kotlin(source: str, *, stdin: str | None) -> dict[str, Any]:
    kotlinc, java, javac = find_tool("kotlinc"), find_tool("java"), find_tool("javac") or shutil.which("javac")
    if not (kotlinc and java and javac):
        return _failure("crashed", "ToolchainUnavailable", "The Kotlin compiler and a JDK are required for Kotlin tracing.")
    stdlib = kotlin_home() / "lib" / "kotlin-stdlib.jar" if kotlin_home() else None
    if not stdlib or not stdlib.is_file():
        return _failure("crashed", "ToolchainUnavailable", "kotlin-stdlib.jar not found next to kotlinc.")
    # The JDI driver itself + the Kotlin stdlib both go on the trace classpath.
    driver_cp = _ensure_jdi_driver(javac, Path(__file__).resolve().parent.parent / "tracing" / "JavaTraceDriver.java")
    if not driver_cp:
        return _failure("crashed", "TracerBuildError", "Could not compile the JDI trace driver.")
    compile_env = augment_path_env(_safe_trace_env())
    with tempfile.TemporaryDirectory(prefix="prizm-kotlin-") as tmp:
        source_path = Path(tmp) / "Main.kt"
        source_path.write_text(source, encoding="utf-8")
        try:
            compiled = subprocess.run([kotlinc, "-nowarn", "-d", tmp, str(source_path)],
                                      capture_output=True, text=True, encoding="utf-8", errors="replace",
                                      timeout=60, cwd=tmp, env=compile_env)
        except subprocess.TimeoutExpired:
            return _failure("timeout", "TimeoutError", "Kotlin compilation exceeded 60s and was stopped.")
        if compiled.returncode:
            return {"status": "syntax_error", "events": [], "output": "", "error": {
                "type": "CompileError", "message": (compiled.stderr or compiled.stdout).strip()[-4000:]}}
        return _jdi_trace_driver(java=java, classes=tmp, stdin=stdin, main_class="MainKt",
                                 extra_classpath=os.pathsep.join([driver_cp, str(stdlib)]))


def _ensure_jdi_driver(javac: str, tracer_src: Path) -> str | None:
    """Compile the JDI driver once into the temp dir; returns its classpath."""
    tracer_classes = Path(tempfile.gettempdir()) / "prizm-java-tracer"
    tracer_class = tracer_classes / "JavaTraceDriver.class"
    if not tracer_class.exists() or tracer_class.stat().st_mtime < tracer_src.stat().st_mtime:
        tracer_classes.mkdir(parents=True, exist_ok=True)
        compiled_driver = subprocess.run([javac, "--add-modules", "jdk.jdi", "-g", "-d", str(tracer_classes), str(tracer_src)],
                                         capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        if compiled_driver.returncode:
            return None
    return str(tracer_classes)


def _jdi_trace_driver(*, java: str, classes: str, stdin: str | None, main_class: str,
                      extra_classpath: str | None = None) -> dict[str, Any]:
    tracer = Path(__file__).resolve().parent.parent / "tracing" / "java_tracer.py"
    job = json.dumps({"java": java, "classes": classes, "stdin": stdin or "", "mainClass": main_class})
    try:
        with tempfile.TemporaryFile(mode="w+t", encoding="utf-8", newline="") as job_file:
            job_file.write(job)
            job_file.seek(0)
            proc = subprocess.run([sys.executable, str(tracer)], stdin=job_file, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", timeout=25.0,
                                  env=_safe_trace_env(extra_classpath=extra_classpath))
    except subprocess.TimeoutExpired:
        return _failure("timeout", "TimeoutError", f"{main_class} trace exceeded its time budget and was stopped.")
    return _parse_trace_process(proc)


def _run_jdi_trace(source: str, *, stdin: str | None, main_class: str, source_filename: str) -> dict[str, Any]:
    javac, java = find_tool("javac") or shutil.which("javac"), find_tool("java") or shutil.which("java")
    if not javac or not java:
        return _failure("crashed", "ToolchainUnavailable", "A JDK is required for Java tracing.")
    # The JDI tracer is compiled once and kept outside the repo under the OS temp directory.
    tracer_src = Path(__file__).resolve().parent.parent / "tracing" / "JavaTraceDriver.java"
    tracer_classes = _ensure_jdi_driver(javac, tracer_src)
    if not tracer_classes:
        return _failure("crashed", "TracerBuildError", "Could not compile the JDI trace driver.")
    with tempfile.TemporaryDirectory(prefix="prizm-java-") as tmp:
        source_path = Path(tmp) / source_filename
        source_path.write_text(source, encoding="utf-8")
        compiled = subprocess.run([javac, "-g", "-d", tmp, str(source_path)], capture_output=True,
                                  text=True, encoding="utf-8", errors="replace", timeout=30)
        if compiled.returncode:
            return {"status": "syntax_error", "events": [], "output": "", "error": {
                "type": "CompileError", "message": (compiled.stderr or compiled.stdout).strip()[-4000:]}}
        return _jdi_trace_driver(java=java, classes=tmp, stdin=stdin, main_class=main_class,
                                 extra_classpath=tracer_classes)


def _run_gdb(source: str, *, stdin: str | None, language: str) -> dict[str, Any]:
    """C/C++ step-through via modern GDB's Python API."""
    from app.tracing.gdb_tracer import trace_with_gdb

    return trace_with_gdb(source, stdin=stdin, language=language)


def _safe_trace_env(extra_classpath: str | None = None) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
                              "LOCALAPPDATA", "USERPROFILE", "PROGRAMFILES", "PROGRAMFILES(X86)"}}
    # Registry PATH (post-install winget entries) + modern MinGW + portable tools.
    env = augment_path_env(env)
    if extra_classpath:
        env["PRIZM_JAVA_TRACER_CLASSPATH"] = extra_classpath
    return env


def _parse_trace_process(proc: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    if proc.returncode:
        detail = (proc.stderr or "").strip()[-3000:] or "Trace engine failed without a message."
        return _failure("crashed", "InternalError", detail)
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return _failure("crashed", "InternalError", f"Trace engine returned invalid output: {proc.stdout[:300]!r}")
    result.setdefault("status", "ok")
    result.setdefault("events", [])
    result.setdefault("output", "")
    result.setdefault("error", None)
    return result


def _failure(status: str, error_type: str, message: str) -> dict[str, Any]:
    return {"status": status, "events": [], "output": "", "error": {"type": error_type, "message": message}}
