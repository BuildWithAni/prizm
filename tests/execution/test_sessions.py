"""Run-mode tests: language detection and interactive sessions."""

from __future__ import annotations

import time

from app.execution.sessions import detect_languages, get_manager
from app.models import LanguagesResponse

POLL_SECONDS = 6.0


def _wait_for(predicate, timeout: float = POLL_SECONDS):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.1)
    return None


def test_languages_reports_python_with_trace():
    response = LanguagesResponse(languages=detect_languages())
    by_id = {lang.id: lang for lang in response.languages}

    assert by_id["python"].available and by_id["python"].trace
    # This machine has Node installed (hard requirement of the repo toolchain).
    assert by_id["javascript"].run
    assert set(by_id) == {"python", "javascript", "cpp", "java"}


def test_python_session_runs_and_finishes():
    manager = get_manager()
    session = manager.create("python", "print('hello from run mode')\n")

    final = _wait_for(lambda: (session.to_dict() if session.to_dict()["status"] != "running" else None))
    assert final is not None, "session should finish"
    assert final["status"] == "exited"
    assert "hello from run mode" in final["output"]
    assert final["exit_code"] == 0


def test_interactive_stdin_flows_both_ways():
    manager = get_manager()
    session = manager.create("python", "n = int(input())\nprint(n * 2)\n")

    # The process waits on input(); feed it and expect the computed answer.
    time.sleep(0.4)
    manager.send_input(session.id, "21")

    def finished():
        data = session.to_dict()
        return data if "42" in data["output"] or data["status"] != "running" else None

    final = _wait_for(finished)
    assert final is not None, f"expected output, got: {session.to_dict()}"
    assert "42" in final["output"]
    # The echoed input line simulates a console.
    assert "21" in final["output"]


def test_javascript_session_runs_when_node_present():
    manager = get_manager()
    session = manager.create("javascript", "console.log(6 * 7)\n")

    final = _wait_for(lambda: (session.to_dict() if session.to_dict()["status"] != "running" else None))
    assert final is not None
    assert final["status"] == "exited"
    assert "42" in final["output"]


def test_unknown_language_fails_cleanly():
    manager = get_manager()
    session = manager.create("cobol", "IDENTIFICATION DIVISION.")

    data = session.to_dict()
    assert data["status"] == "error"
    assert "not available" in data["output"]


def test_stop_kills_a_runaway_process():
    manager = get_manager()
    session = manager.create("python", "while True:\n    pass\n")

    time.sleep(0.5)
    manager.stop(session.id)

    final = _wait_for(lambda: (session.to_dict() if session.to_dict()["status"] == "running" else None))
    assert final is None
    assert session.to_dict()["status"] == "stopped"
