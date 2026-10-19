"""Interactive execution sessions — run code in any supported language.

Unlike the tracing pipeline (Python-only, snapshot-per-step), sessions are a
plain "real console": spawn the toolchain, stream stdout, accept stdin lines,
and stop on request. A background reader thread drains the child's merged
stdout/stderr one character at a time so prompts without trailing newlines
("Enter n: ") show up immediately.

Safety: children run in their own temp directory with a minimal environment,
a 90-second lifetime cap, a 128 KB output cap, and no inherited secrets. For
production, move this into a container/sandbox — see the README security notes.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

MAX_OUTPUT_BYTES = 128 * 1024
MAX_SESSION_LIFETIME_SECONDS = 90.0
SESSION_RETENTION_SECONDS = 300.0
COMPILE_TIMEOUT_SECONDS = 30.0

SOURCE_FILES = {
    "python": "main.py",
    "javascript": "main.js",
    "cpp": "main.cpp",
    "java": "Main.java",
}


def _cpp_compiler() -> str | None:
    for candidate in ("g++", "clang++", "gcc"):
        found = shutil.which(candidate)
        if found:
            return found
    return None


def detect_languages() -> list[dict]:
    """Report which languages can run here, and which can be traced."""
    javac = shutil.which("javac")
    java = shutil.which("java")
    cpp = _cpp_compiler()

    languages = [
        {
            "id": "python",
            "name": "Python",
            "available": True,
            "run": True,
            "trace": True,
            "detail": "Run + full step-through visualization",
        },
        {
            "id": "javascript",
            "name": "JavaScript",
            "available": bool(shutil.which("node")),
            "run": True,
            "trace": False,
            "detail": "Run + console" if shutil.which("node") else "Node.js not found on PATH",
        },
        {
            "id": "cpp",
            "name": "C++",
            "available": bool(cpp),
            "run": True,
            "trace": False,
            "detail": f"Compile & run ({Path(cpp).name})" if cpp else "g++ not found on PATH",
        },
        {
            "id": "java",
            "name": "Java",
            "available": bool(javac and java),
            "run": True,
            "trace": False,
            "detail": "Compile & run (class Main)" if javac and java else "JDK not found on PATH",
        },
    ]
    return languages


def _child_env() -> dict[str, str]:
    """Minimal environment — no API keys or backend secrets reach student code."""
    keep = (
        "PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
        "TEMP", "TMP", "USERPROFILE", "HOME", "LANG", "LC_ALL", "JAVA_HOME",
    )
    return {key: os.environ[key] for key in keep if key in os.environ}


@dataclass
class Session:
    id: str
    language: str
    status: str = "running"  # running | exited | timeout | stopped | compile_error | error
    created: float = field(default_factory=time.monotonic)
    workdir: str = ""
    proc: subprocess.Popen | None = None
    exit_code: int | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    _chunks: list[str] = field(default_factory=list)

    def append(self, text: str) -> None:
        with self.lock:
            if sum(len(c) for c in self._chunks) < MAX_OUTPUT_BYTES:
                self._chunks.append(text)

    def output(self) -> str:
        with self.lock:
            return "".join(self._chunks)

    def set_status(self, status: str, exit_code: int | None = None) -> None:
        with self.lock:
            if self.status in ("timeout", "stopped", "compile_error", "error"):
                return  # terminal states set by manager/kill win
            self.status = status
            if exit_code is not None:
                self.exit_code = exit_code

    def to_dict(self) -> dict:
        with self.lock:
            return {
                "id": self.id,
                "language": self.language,
                "status": self.status,
                "output": "".join(self._chunks),
                "exit_code": self.exit_code,
            }


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    # --- lifecycle ----------------------------------------------------------

    def create(self, language: str, source: str, initial_stdin: str | None = None) -> Session:
        self._sweep()
        session = Session(id=uuid.uuid4().hex[:12], language=language)
        # Register immediately so GET/DELETE work for every outcome, including
        # compile errors and unavailable languages.
        with self._lock:
            self._sessions[session.id] = session

        language_ids = {lang["id"]: lang for lang in detect_languages()}
        info = language_ids.get(language)
        if info is None or not info["available"]:
            session.status = "error"
            session.append(
                f"Language '{language}' is not available on this machine.\n"
                + (info["detail"] if info else "Unknown language.")
            )
            return session

        workdir = tempfile.mkdtemp(prefix="prizm_run_")
        session.workdir = workdir
        source_path = Path(workdir) / SOURCE_FILES[language]
        source_path.write_text(source, encoding="utf-8")

        # Compile step for compiled languages.
        if language == "cpp":
            compiler = _cpp_compiler()
            exe = str(Path(workdir) / "main.exe")
            result = subprocess.run(
                [compiler, str(source_path), "-o", exe],  # type: ignore[list-item]
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=COMPILE_TIMEOUT_SECONDS, cwd=workdir, env=_child_env(),
            )
            if result.returncode != 0:
                session.status = "compile_error"
                session.append(result.stderr or result.stdout or "Compilation failed.")
                return session
            command = [exe]
        elif language == "java":
            result = subprocess.run(
                ["javac", "-d", workdir, str(source_path)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=COMPILE_TIMEOUT_SECONDS, cwd=workdir, env=_child_env(),
            )
            if result.returncode != 0:
                session.status = "compile_error"
                session.append(result.stderr or result.stdout or "Compilation failed.")
                return session
            command = ["java", "-cp", workdir, "Main"]
        elif language == "javascript":
            command = [shutil.which("node") or "node", str(source_path)]
        else:
            command = [sys.executable, "-u", str(source_path)]

        if os.name == "nt":
            command[0] = shutil.which(Path(command[0]).name) or command[0]

        try:
            proc = subprocess.Popen(
                command,
                cwd=workdir,
                env=_child_env(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError as exc:
            session.status = "error"
            session.append(f"Failed to start {language}: {exc}")
            return session

        session.proc = proc
        if initial_stdin and proc.stdin:
            try:
                proc.stdin.write(initial_stdin)
                if not initial_stdin.endswith("\n"):
                    proc.stdin.write("\n")
                proc.stdin.flush()
            except (BrokenPipeError, OSError):
                pass

        thread = threading.Thread(target=_reader, args=(session,), daemon=True)
        thread.start()
        return session

    def get(self, session_id: str) -> Session | None:
        self._sweep()
        with self._lock:
            return self._sessions.get(session_id)

    def send_input(self, session_id: str, line: str) -> Session | None:
        session = self.get(session_id)
        if session is None:
            return None
        if session.status != "running" or session.proc is None or session.proc.stdin is None:
            return session
        try:
            session.proc.stdin.write(line + "\n")
            session.proc.stdin.flush()
            session.append(line + "\n")  # piped stdin isn't echoed — simulate the console
        except (BrokenPipeError, OSError):
            session.append("\n[process is no longer accepting input]\n")
            session.set_status("exited")
        return session

    def stop(self, session_id: str) -> Session | None:
        session = self.get(session_id)
        if session is None:
            return None
        with session.lock:
            session.status = "stopped" if session.status == "running" else session.status
        _kill(session)
        return session

    # --- housekeeping -------------------------------------------------------

    def _sweep(self) -> None:
        now = time.monotonic()
        with self._lock:
            sessions = list(self._sessions.items())
        for session_id, session in sessions:
            age = now - session.created
            if session.status == "running" and age > MAX_SESSION_LIFETIME_SECONDS:
                with session.lock:
                    session.status = "timeout"
                    session._chunks.append("\n⏱ Execution stopped: 90s lifetime limit.")
                _kill(session)
            elif age > SESSION_RETENTION_SECONDS:
                with self._lock:
                    self._sessions.pop(session_id, None)
                if session.workdir:
                    shutil.rmtree(session.workdir, ignore_errors=True)


def _kill(session: Session) -> None:
    proc = session.proc
    if proc and proc.poll() is None:
        try:
            proc.kill()
        except OSError:
            pass


def _reader(session: Session) -> None:
    """Drain the child's merged stdout/stderr char-by-char (keeps prompts live)."""
    proc = session.proc
    if proc is None or proc.stdout is None:
        return
    try:
        while True:
            chunk = proc.stdout.read(1)
            if not chunk:
                break
            session.append(chunk)
    except (ValueError, OSError):
        pass
    finally:
        try:
            exit_code = proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _kill(session)
            exit_code = -1
        session.set_status("exited", exit_code)


_manager = SessionManager()


def get_manager() -> SessionManager:
    return _manager
