"""Multi-language run + trace coverage (the full language matrix).

Every test is guarded by toolchain discovery so the suite stays green on
machines that don't have the optional runtimes installed.
"""

from __future__ import annotations

import pytest

from app.execution.runner import run_traced
from app.execution.sessions import detect_languages, get_manager  # noqa: E402
from app.execution.toolchain import find_dotnet, find_gdb, find_gcc, find_tool  # noqa: E402

# --- capability discovery -----------------------------------------------------

HAS_NODE = bool(find_tool("node"))
HAS_RUBY = bool(find_tool("ruby"))
HAS_GO = bool(find_tool("go"))
HAS_KOTLIN = bool(find_tool("kotlinc") and find_tool("java"))
HAS_GCC = bool(find_gcc())
HAS_GDB = bool(find_gdb())
HAS_PHP = bool(find_tool("php"))
HAS_DOTNET = bool(find_dotnet())

ALL_IDS = {
    "python", "javascript", "typescript", "java", "kotlin", "c", "cpp",
    "go", "rust", "csharp", "php", "ruby", "html",
}
TRACE_CAPABLE = {"python", "javascript", "typescript", "java", "kotlin", "c", "cpp", "go", "ruby"}


def _events(result: dict) -> list[dict]:
    return result.get("events") or []


# --- detect_languages ---------------------------------------------------------


def test_language_matrix_is_complete():
    langs = detect_languages()
    ids = {lang["id"] for lang in langs}
    assert ids == ALL_IDS
    by_id = {lang["id"]: lang for lang in langs}
    # Trace flags may only be True where a real engine exists — never lie.
    for lang in langs:
        if lang["trace"]:
            assert lang["id"] in TRACE_CAPABLE, f"{lang['id']} claims trace without an engine"
    assert by_id["python"]["trace"] is True
    assert by_id["html"]["run"] is True
    assert "preview" in by_id["html"]["detail"].lower()
    assert by_id["php"]["trace"] is False
    assert by_id["csharp"]["trace"] is False
    assert by_id["rust"]["trace"] is False


def test_detect_languages_reports_availability_matching_install():
    by_id = {lang["id"]: lang for lang in detect_languages()}
    assert by_id["python"]["available"] is True
    assert by_id["javascript"]["available"] is HAS_NODE
    assert by_id["ruby"]["available"] is HAS_RUBY
    assert by_id["go"]["available"] is HAS_GO
    assert by_id["kotlin"]["available"] is HAS_KOTLIN
    assert by_id["php"]["available"] is HAS_PHP
    assert by_id["csharp"]["available"] is HAS_DOTNET


# --- honest unsupported paths --------------------------------------------------


def test_php_trace_is_an_honest_unsupported_failure():
    result = run_traced("php", "<?php echo 1;")
    assert result["status"] == "crashed"
    assert result["error"]["type"] == "UnsupportedLanguage"
    assert "Run" in result["error"]["message"]
    assert result["events"] == []


def test_html_trace_suggests_the_preview():
    result = run_traced("html", "<html></html>")
    assert result["status"] == "crashed"
    assert result["error"]["type"] == "UnsupportedLanguage"


# --- TypeScript via the JS engine ----------------------------------------------


@pytest.mark.skipif(not HAS_NODE, reason="Node.js not installed")
def test_typescript_traces_through_the_js_engine():
    src = "const x: number = 4;\nfunction square(n: number): number { return n * n; }\nconsole.log(square(x));\n"
    result = run_traced("typescript", src)
    assert result["status"] == "ok"
    assert "16" in result["output"]
    assert len(_events(result)) >= 4
    # No experimental-warning noise in student output.
    assert "ExperimentalWarning" not in result["output"]


@pytest.mark.skipif(not HAS_NODE, reason="Node.js not installed")
def test_typescript_syntax_error_is_reported():
    result = run_traced("typescript", "const x: number = ;")
    assert result["status"] in {"syntax_error", "crashed"}
    assert result["error"] is not None


# --- Ruby via TracePoint --------------------------------------------------------


@pytest.mark.skipif(not HAS_RUBY, reason="Ruby not installed")
def test_ruby_traces_calls_returns_and_locals():
    src = "def square(n)\n  r = n * n\n  r\nend\n\nx = 4\ny = square(x)\nputs y\n"
    result = run_traced("ruby", src)
    assert result["status"] == "ok"
    assert "16" in result["output"]
    events = _events(result)
    kinds = [e["event"] for e in events]
    assert "call" in kinds and "return" in kinds
    square_return = next(e for e in events if e["event"] == "return")
    assert square_return["value"] == {"type": "number", "value": 16}
    # The tracer's own internals must never leak into student locals.
    for event in events:
        assert "raw_stdin" not in event["locals"]
        assert "events" not in event["locals"]


@pytest.mark.skipif(not HAS_RUBY, reason="Ruby not installed")
def test_ruby_runtime_error_is_honest():
    result = run_traced("ruby", "x = 5\ny = x + missing\n")
    assert result["status"] == "error"
    assert "missing" in result["error"]["message"]


# --- Go via AST instrumentation --------------------------------------------------


@pytest.mark.skipif(not HAS_GO, reason="Go not installed")
def test_go_traces_with_frames_and_return_values():
    src = ('package main\n\nimport "fmt"\n\nfunc square(n int) int {\n'
           "    return n * n\n}\n\nfunc main() {\n    x := 4\n    y := square(x)\n"
           '    fmt.Println(y)\n}\n')
    result = run_traced("go", src)
    assert result["status"] == "ok"
    assert "16" in result["output"]
    events = _events(result)
    kinds = [e["event"] for e in events]
    assert "call" in kinds and "return" in kinds
    returned = next(e for e in events if e["event"] == "return")
    assert returned["value"] == {"type": "number", "value": 16}
    assert returned["functionName"] == "square"
    # Range/loop scoping must not leak into later scopes (compile hygiene).
    src2 = ('package main\n\nimport "fmt"\n\nfunc main() {\n'
            "    nums := []int{3, 1, 2}\n    for _, v := range nums {\n"
            "        _ = v\n    }\n    x := 10\n    fmt.Println(x)\n}\n")
    result2 = run_traced("go", src2)
    assert result2["status"] == "ok", result2.get("error")


# --- Kotlin via the shared JDI driver --------------------------------------------


@pytest.mark.skipif(not HAS_KOTLIN, reason="Kotlin compiler not installed")
def test_kotlin_traces_with_call_ladder():
    src = ("fun square(n: Int): Int {\n    val r = n * n\n    return r\n}\n\n"
           "fun main() {\n    val x = 4\n    val y = square(x)\n    println(y)\n}\n")
    result = run_traced("kotlin", src)
    assert result["status"] == "ok", result.get("error")
    assert "16" in result["output"]
    events = _events(result)
    calls = [e for e in events if e["event"] == "call"]
    assert calls and calls[0]["functionName"] == "square"
    assert calls[0]["parentFrameId"] is not None
    returns = [e for e in events if e["event"] == "return"]
    assert returns and returns[0]["functionName"] == "square"
    # Locals must carry real values.
    line_with_x = next(e for e in events if "x" in e["locals"])
    assert line_with_x["locals"]["x"]["value"] == 4


# --- C/C++ via modern GDB ----------------------------------------------------------


@pytest.mark.skipif(not (HAS_GCC and HAS_GDB), reason="GCC/GDB not installed")
def test_c_traces_lines_call_return():
    src = ("#include <stdio.h>\n\nint square(int n) {\n    int r = n * n;\n"
           "    return r;\n}\n\nint main(void) {\n    int x = 4;\n"
           '    printf("%d\\n", square(x));\n    return 0;\n}\n')
    result = run_traced("c", src)
    assert result["status"] == "ok", result.get("error")
    assert "16" in result["output"]
    events = _events(result)
    assert any(e["event"] == "call" and e["functionName"] == "square" for e in events)
    assert any(e["event"] == "return" and e["functionName"] == "square" for e in events)


@pytest.mark.skipif(not (HAS_GCC and HAS_GDB), reason="GCC/GDB not installed")
def test_cpp_syntax_error_is_compile_error():
    result = run_traced("cpp", "int main() { return }")
    assert result["status"] == "syntax_error"
    assert result["error"]["type"] == "CompileError"


@pytest.mark.skipif(not (HAS_GCC and HAS_GDB), reason="GCC/GDB not installed")
def test_c_segfault_becomes_an_exception_event():
    src = "#include <stdlib.h>\nint main(void) { int *p = (int *)0; *p = 1; return 0; }\n"
    result = run_traced("c", src)
    assert result["status"] == "error"
    assert "SIGSEGV" in result["error"]["type"]


# --- sessions: html + kotlin + csharp run paths --------------------------------------


def test_html_session_explains_the_preview():
    session = get_manager().create("html", "<!doctype html><html><body>hi</body></html>")
    assert session.status == "exited"
    assert session.exit_code == 0
    assert "preview" in session.output().lower()


@pytest.mark.skipif(not HAS_PHP, reason="PHP not installed")
def test_php_session_runs():
    session = get_manager().create("php", "<?php\n$x = 4;\necho $x * $x, \"\\n\";\n")
    import time
    deadline = time.time() + 30
    while session.status == "running" and time.time() < deadline:
        time.sleep(0.2)
    assert session.status == "exited"
    assert session.exit_code == 0
    assert "16" in session.output()


@pytest.mark.skipif(not HAS_KOTLIN, reason="Kotlin compiler not installed")
def test_kotlin_session_runs():
    session = get_manager().create("kotlin", "fun main() { val x = 4; println(x * x) }\n")
    import time
    deadline = time.time() + 90
    while session.status == "running" and time.time() < deadline:
        time.sleep(0.3)
    assert session.status == "exited", session.output()[-500:]
    assert session.exit_code == 0
    assert "16" in session.output()


@pytest.mark.skipif(not HAS_DOTNET, reason=".NET SDK not installed")
def test_csharp_session_runs():
    session = get_manager().create(
        "csharp",
        "using System;\nclass Program { static void Main() { int x = 4; Console.WriteLine(x * x); } }\n")
    import time
    deadline = time.time() + 150
    while session.status == "running" and time.time() < deadline:
        time.sleep(0.3)
    assert session.status == "exited", session.output()[-800:]
    assert session.exit_code == 0
    assert "16" in session.output()
