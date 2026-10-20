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

from app.execution.toolchain import (augment_path_env, find_dotnet, find_gcc, find_gdb,
                                     find_tool, kotlin_home)


MAX_OUTPUT_BYTES = 128 * 1024
MAX_SESSION_LIFETIME_SECONDS = 90.0
SESSION_RETENTION_SECONDS = 300.0
COMPILE_TIMEOUT_SECONDS = 30.0
DOTNET_COMPILE_TIMEOUT_SECONDS = 120.0

SOURCE_FILES = {
    "python": "main.py",
    "javascript": "main.js",
    "c": "main.c",
    "typescript": "main.ts",
    "go": "main.go",
    "rust": "main.rs",
    "csharp": "Program.cs",
    "php": "main.php",
    "ruby": "main.rb",
    "html": "index.html",
    "cpp": "main.cpp",
    "java": "Main.java",
    "kotlin": "Main.kt",
}

_DOTNET_PROJECT = """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>disable</ImplicitUsings>
    <Nullable>disable</Nullable>
    <AssemblyName>student</AssemblyName>
    <InvariantGlobalization>true</InvariantGlobalization>
  </PropertyGroup>
</Project>
"""


def _cpp_compiler() -> str | None:
    # WinLibs g++ first (modern), then anything on PATH.
    for candidate in (find_gcc(cpp=True), shutil.which("clang++"), shutil.which("g++")):
        if candidate:
            return candidate
    return None


def _rust_status() -> tuple[bool, str]:
    """Is Rust runnable here, and in what shape? (run-only either way)"""
    rustc = find_tool("rustc")
    if not rustc:
        return False, "Rust not installed"
    try:
        info = subprocess.run([rustc, "-vV"], capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return False, "Rust toolchain failed to respond"
    gnu_std = list((Path.home() / ".rustup" / "toolchains").glob(
        "*/lib/rustlib/x86_64-pc-windows-gnu/lib"))
    if "msvc" in info:
        if shutil.which("link"):
            return True, "Rust (MSVC toolchain); run only — step-through not implemented"
        if gnu_std and find_gcc():
            return True, "Rust (GNU cross-target via MinGW GCC); run only — step-through not implemented"
        return False, "Rust linker not configured (needs link.exe or the x86_64-pc-windows-gnu target)"
    return bool(find_gcc()), ("Rust compiler + MinGW linker; run only — step-through not implemented"
                              if find_gcc() else "MinGW gcc linker not found")


def _compile(session: Session, cmd: list[str], workdir: str, *,
             timeout: int = COMPILE_TIMEOUT_SECONDS, env: dict | None = None) -> bool:
    """Run a compile step, recording compile_error output on the session."""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                                errors="replace", timeout=timeout, cwd=workdir,
                                env=env or _child_env())
    except subprocess.TimeoutExpired:
        session.status = "compile_error"
        session.append(f"Compilation timed out after {timeout}s.")
        return False
    except OSError as exc:
        session.status = "compile_error"
        session.append(f"Could not start the compiler: {exc}")
        return False
    if result.returncode != 0:
        session.status = "compile_error"
        session.append(result.stderr or result.stdout or "Compilation failed.")
        return False
    return True


def detect_languages() -> list[dict]:
    """Report which languages can run here, and which can be traced.

    `trace` is only True where a real step-through engine exists — the
    visualizer never invents events for languages without one.
    """
    javac = find_tool("javac")
    java = find_tool("java")
    cpp = _cpp_compiler()
    c_compiler = find_gcc()
    gdb = find_gdb()
    node = find_tool("node")
    go = find_tool("go")
    php = find_tool("php")
    ruby = find_tool("ruby")
    dotnet = find_dotnet()
    kotlinc = find_tool("kotlinc")
    kotlin_stdlib = kotlinc is not None
    rust_ok, rust_detail = _rust_status()
    c_ok = bool(c_compiler and gdb)

    languages = [
        {"id": "python", "name": "Python", "available": True, "run": True, "trace": True,
         "detail": "Run + full step-through visualization"},
        {"id": "javascript", "name": "JavaScript", "available": bool(node), "run": bool(node), "trace": bool(node),
         "detail": "Run + full step-through visualization" if node else "Node.js not found"},
        {"id": "typescript", "name": "TypeScript", "available": bool(node), "run": bool(node), "trace": bool(node),
         "detail": "Run + step-through (types stripped, then traced as JS)" if node else "Node.js not found"},
        {"id": "java", "name": "Java", "available": bool(javac and java), "run": bool(javac and java),
         "trace": bool(javac and java),
         "detail": "Run + step-through via the JVM debugger" if javac and java else "JDK not found"},
        {"id": "kotlin", "name": "Kotlin", "available": bool(kotlinc and java and javac and kotlin_stdlib),
         "run": bool(kotlinc and java and javac and kotlin_stdlib),
         "trace": bool(kotlinc and java and javac and kotlin_stdlib),
         "detail": "Run + step-through via the JVM debugger" if kotlinc and java and javac
         else "Kotlin compiler not found (tools/kotlin)"},
        {"id": "c", "name": "C", "available": bool(c_compiler and gdb), "run": bool(c_compiler),
         "trace": c_ok,
         "detail": "Run + GDB step-through" if c_ok else
         ("Compile & run (no GDB with Python for tracing)" if c_compiler else "gcc not found")},
        {"id": "cpp", "name": "C++", "available": bool(cpp and gdb), "run": bool(cpp), "trace": c_ok,
         "detail": "Run + GDB step-through" if c_ok else
         ("Compile & run (no GDB with Python for tracing)" if cpp else "g++ not found")},
        {"id": "go", "name": "Go", "available": bool(go), "run": bool(go), "trace": bool(go),
         "detail": "Run + step-through via AST instrumentation" if go else "Go not installed"},
        {"id": "ruby", "name": "Ruby", "available": bool(ruby), "run": bool(ruby), "trace": bool(ruby),
         "detail": "Run + step-through via TracePoint" if ruby else "Ruby not installed"},
        {"id": "rust", "name": "Rust", "available": rust_ok, "run": rust_ok, "trace": False,
         "detail": rust_detail},
        {"id": "csharp", "name": "C#", "available": bool(dotnet), "run": bool(dotnet), "trace": False,
         "detail": "Run (isolated .NET project) — step-through not implemented" if dotnet
         else ".NET SDK not installed"},
        {"id": "php", "name": "PHP", "available": bool(php), "run": bool(php), "trace": False,
         "detail": "Run (PHP CLI) — step-through not implemented" if php else "PHP not installed"},
        {"id": "html", "name": "HTML/CSS/JS", "available": True, "run": True, "trace": False,
         "detail": "Live browser preview (rendered client-side, nothing to execute on the server)"},
    ]
    return languages


def _child_env() -> dict[str, str]:
    """Minimal environment — no API keys or backend secrets reach student code.

    PATH is rebuilt from the registry (so tools installed after this server
    started are visible) with the modern MinGW and portable toolchains folded in.
    """
    keep = (
        "PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
        "TEMP", "TMP", "USERPROFILE", "HOME", "LANG", "LC_ALL", "JAVA_HOME", "LOCALAPPDATA", "APPDATA",
        # MSBuild/NuGet refuse to run without these (null path errors).
        "ProgramFiles", "ProgramFiles(x86)", "SystemDrive", "PROCESSOR_ARCHITECTURE",
    )
    # Some hosts (restricted agent shells) strip these entirely — MSBuild
    # crashes with a null path, so fall back to the conventional values.
    defaults = {
        "ProgramFiles": r"C:\Program Files",
        "ProgramFiles(x86)": r"C:\Program Files (x86)",
        "SystemDrive": "C:",
        "PROCESSOR_ARCHITECTURE": "AMD64",
    }
    env: dict[str, str] = {}
    for key in keep:
        value = os.environ.get(key)
        if value is None:
            value = defaults.get(key)
        if value is not None:
            env[key] = value
    return augment_path_env(env)


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
        if info is None:
            session.status = "error"
            session.append(
                f"Language '{language}' is not available on this machine.\n"
                + (info["detail"] if info else "Unknown language.")
            )
            return session

        if info is None:
            session.status = "error"
            session.append(f"Language '{language}' is not supported by this runner.")
            return session

        if not info["available"]:
            session.status = "error"
            session.append(f"Language '{language}' is not available on this machine.\n{info['detail']}")
            return session

        if language == "html":
            # Rendered by the browser preview in the frontend — nothing to run
            # server-side, and saying so keeps the API honest.
            session.status = "exited"
            session.exit_code = 0
            session.append("[HTML/CSS runs as a live browser preview in the editor — nothing to execute on the server.]")
            return session

        workdir = tempfile.mkdtemp(prefix="prizm_run_")
        session.workdir = workdir
        source_path = Path(workdir) / SOURCE_FILES[language]
        source_path.write_text(source, encoding="utf-8")

        # Compile step for compiled languages.
        if language == "cpp":
            compiler = _cpp_compiler()
            if not compiler:
                session.status = "error"
                session.append("g++ not found — install a C++ compiler to run C++.")
                return session
            exe = str(Path(workdir) / "main.exe")
            if not _compile(session, [compiler, str(source_path), "-O0", "-o", exe], workdir):
                return session
            command = [exe]
        elif language == "c":
            compiler = find_gcc()
            if not compiler:
                session.status = "error"
                session.append("gcc not found — install a C compiler to run C.")
                return session
            exe = str(Path(workdir) / "main.exe")
            if not _compile(session, [compiler, str(source_path), "-O0", "-o", exe], workdir):
                return session
            command = [exe]
        elif language == "java":
            javac, java = find_tool("javac"), find_tool("java")
            if not javac or not java:
                session.status = "error"
                session.append("JDK not found — install a JDK to run Java.")
                return session
            if not _compile(session, [javac, "-d", workdir, str(source_path)], workdir):
                return session
            command = [java, "-cp", workdir, "Main"]
        elif language == "kotlin":
            kotlinc, java = find_tool("kotlinc"), find_tool("java")
            home = kotlin_home()
            stdlib = (home / "lib" / "kotlin-stdlib.jar") if home else None
            if not (kotlinc and java and stdlib and stdlib.is_file()):
                session.status = "error"
                session.append("Kotlin compiler or JDK not found (expected tools/kotlin/kotlinc).")
                return session
            if not _compile(session, [kotlinc, "-nowarn", "-d", workdir, str(source_path)],
                            workdir, timeout=90):
                return session
            command = [java, "-cp", os.pathsep.join([workdir, str(stdlib)]), "MainKt"]
        elif language == "javascript":
            command = [find_tool("node") or "node", str(source_path)]
        elif language == "typescript":
            command = [find_tool("node") or "node", "--experimental-strip-types", str(source_path)]
        elif language == "go":
            go_env = _child_env()
            go_root = Path(tempfile.gettempdir()) / "prizm-go"
            go_cache = go_root / "cache"
            go_cache.mkdir(parents=True, exist_ok=True)
            go_env["GOCACHE"] = str(go_cache)
            go_env["GOPATH"] = str(go_root / "gopath")
            exe = str(Path(workdir) / "main.exe")
            if not _compile(session, [find_tool("go") or "go", "build", "-o", exe, str(source_path)],
                            workdir, env=go_env):
                return session
            command = [exe]
        elif language == "rust":
            exe = str(Path(workdir) / "main.exe")
            rustc = find_tool("rustc") or "rustc"
            args = [rustc, str(source_path), "-o", exe]
            try:
                info = subprocess.run([rustc, "-vV"], capture_output=True, text=True,
                                      encoding="utf-8", errors="replace", timeout=10).stdout
            except (OSError, subprocess.TimeoutExpired):
                info = ""
            if "msvc" in info and not shutil.which("link"):
                # Bare env has no MSVC link.exe — cross to the GNU target,
                # linked by the MinGW gcc on the augmented PATH.
                args += ["--target", "x86_64-pc-windows-gnu"]
            if not _compile(session, args, workdir):
                return session
            command = [exe]
        elif language == "csharp":
            dotnet = find_dotnet()
            if not dotnet:
                session.status = "error"
                session.append(".NET SDK not found — install the .NET SDK to run C#.")
                return session
            (Path(workdir) / "Student.csproj").write_text(_DOTNET_PROJECT, encoding="utf-8")
            dotnet_env = _child_env()
            dotnet_env.update({
                "DOTNET_NOLOGO": "1",
                "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
                "DOTNET_SKIP_FIRST_TIME_EXPERIENCE": "1",
                "NUGET_XMLDOC_MODE": "skip",
            })
            if not _compile(session, [dotnet, "build", str(Path(workdir) / "Student.csproj"),
                                      "-v", "q", "--nologo"], workdir,
                            timeout=DOTNET_COMPILE_TIMEOUT_SECONDS, env=dotnet_env):
                return session
            dll = Path(workdir) / "bin" / "Debug" / "net10.0" / "student.dll"
            if not dll.is_file():
                candidates = list((Path(workdir) / "bin" / "Debug").glob("net*/student.dll"))
                if not candidates:
                    session.status = "compile_error"
                    session.append("Build succeeded but student.dll was not produced.")
                    return session
                dll = candidates[0]
            command = [dotnet, str(dll)]
        elif language in {"php", "ruby"}:
            runtime = find_tool(language)
            if not runtime:
                session.status = "error"
                session.append(f"{language} runtime not found on this machine.")
                return session
            command = [runtime, str(source_path)]
        else:
            command = [sys.executable, "-u", str(source_path)]

        if os.name == "nt" and not Path(str(command[0])).exists():
            # Resolve bare names against PATH — but never override an explicit
            # absolute tool path (the modern MinGW must not be shadowed here).
            command[0] = shutil.which(Path(str(command[0])).name) or command[0]

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
