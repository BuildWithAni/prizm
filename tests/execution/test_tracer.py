"""Tests for the execution engine: tracing, snapshots, limits and error paths."""

from __future__ import annotations

from app.execution.runner import run_python

SQUARE_SOURCE = """\
def square(n):
    result = n * n
    return result

x = 4
y = square(x)
print(y)
"""

FACTORIAL_SOURCE = """\
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(3))
"""


def test_square_example_produces_expected_trace():
    result = run_python(SQUARE_SOURCE)

    assert result["status"] == "ok"
    assert result["output"] == "16\n"
    events = result["events"]
    assert events, "trace should not be empty"

    # The call into square binds n = 4 and is parented to the module frame.
    call = next(e for e in events if e["event"] == "call" and e["functionName"] == "square")
    assert call["locals"]["n"] == {"type": "number", "value": 4}
    assert call["parentFrameId"] is not None

    # The return carries the return value 16.
    ret = next(e for e in events if e["event"] == "return" and e["functionName"] == "square")
    assert ret["value"] == {"type": "number", "value": 16}

    # By the time line 7 (`print(y)`) is about to run, y is visible.
    before_print = next(e for e in events if e["event"] == "line" and e["line"] == 7)
    assert before_print["locals"]["y"] == {"type": "number", "value": 16}
    assert before_print["locals"]["x"] == {"type": "number", "value": 4}

    # Steps are 1-based and strictly ordered.
    assert [e["step"] for e in events] == list(range(1, len(events) + 1))


def test_recursion_builds_nested_frames():
    result = run_python(FACTORIAL_SOURCE)

    assert result["status"] == "ok"
    assert result["output"] == "6\n"
    events = result["events"]

    calls = [e for e in events if e["event"] == "call" and e["functionName"] == "factorial"]
    assert len(calls) == 3  # factorial(3), factorial(2), factorial(1)

    returns = [e for e in events if e["event"] == "return" and e["functionName"] == "factorial"]
    assert [r["value"] for r in returns] == [
        {"type": "number", "value": 1},
        {"type": "number", "value": 2},
        {"type": "number", "value": 6},
    ]  # base case returns first; results unwind in reverse order

    # Each nested call is parented to the previous one.
    by_frame = {e["frameId"]: e["parentFrameId"] for e in calls}
    frame_ids = list(by_frame)
    assert by_frame[frame_ids[1]] == frame_ids[0]
    assert by_frame[frame_ids[2]] == frame_ids[1]


def test_syntax_error_reported_without_events():
    result = run_python("def broken(:\n    pass\n")

    assert result["status"] == "syntax_error"
    assert result["events"] == []
    assert result["error"]["type"] == "SyntaxError"


def test_runtime_error_recorded_in_trace_and_result():
    result = run_python("x = 1\ny = x / 0\n")

    assert result["status"] == "error"
    assert result["error"]["type"] == "ZeroDivisionError"
    assert any(e["event"] == "exception" and e["exception"]["type"] == "ZeroDivisionError" for e in result["events"])
    # The trace still replays up to the failing line.
    assert any(e["locals"].get("x") == {"type": "number", "value": 1} for e in result["events"])


def test_infinite_loop_hits_time_limit():
    result = run_python("counter = 0\nwhile True:\n    counter += 1\n", time_limit=0.3, max_events=1_000_000)

    assert result["status"] == "timeout"
    assert result["error"]["type"] == "ExecutionAborted"
    assert result["events"], "a partial trace should survive the timeout"


def test_event_cap_stops_runaway_traces():
    result = run_python("total = 0\nfor i in range(100000):\n    total += i\n", max_events=60)

    assert result["status"] == "event_limit"
    assert len(result["events"]) <= 60


def test_containers_and_functions_serialize_safely():
    result = run_python(
        "def helper(v):\n"
        "    return v\n"
        "data = [1, 'two', 3.0, None, True]\n"
        "mapping = {'items': data}\n"
        "helper(data)\n"
    )

    assert result["status"] == "ok"
    line = next(e for e in result["events"] if e["event"] == "line" and e["line"] == 5)
    assert line["locals"]["data"] == {
        "type": "array",
        "value": [
            {"type": "number", "value": 1},
            {"type": "string", "value": "two"},
            {"type": "number", "value": 3.0},
            {"type": "null", "value": None},
            {"type": "boolean", "value": True},
        ],
    }
    assert line["locals"]["mapping"]["type"] == "object"
    assert line["locals"]["helper"] == {"type": "function", "name": "helper"}


def test_traced_run_reads_stdin_and_echoes_it():
    result = run_python(
        "name = input('n? ')\n"
        "n = int(input())\n"
        "print('hi', name, n * 2)\n",
        stdin="Ada\n21\n",
    )

    assert result["status"] == "ok"
    # Prompt, echoed lines and the program's answer — in console order.
    assert "n? Ada" in result["output"]
    assert "hi Ada 42" in result["output"]
    # The read values are real trace snapshots too.
    final_line = [e for e in result["events"] if e["event"] == "line"][-1]
    assert final_line["locals"]["name"] == {"type": "string", "value": "Ada"}
    assert final_line["locals"]["n"] == {"type": "number", "value": 21}


def test_traced_run_without_stdin_still_reports_eof_error():
    result = run_python("x = int(input())\n")

    assert result["status"] == "error"
    assert result["error"]["type"] == "EOFError"
