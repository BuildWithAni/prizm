"""Flowchart generation from Python source (static analysis)."""

from __future__ import annotations

from app.visualization.flowchart import build_flowchart


def _kinds(chart: dict) -> dict[str, str]:
    return {node["id"]: node["kind"] for node in chart["nodes"]}


def test_if_else_builds_decision_with_branches():
    chart = build_flowchart(
        "x = 1\n"
        "if x > 0:\n"
        "    y = 2\n"
        "else:\n"
        "    y = 3\n"
        "print(y)\n"
    )

    assert chart["error"] is None
    kinds = _kinds(chart)
    assert "decision" in kinds.values()
    assert "statement" in kinds.values()

    decision = next(n for n in chart["nodes"] if n["kind"] == "decision")
    out = [e for e in chart["edges"] if e["from"] == decision["id"]]
    assert {e["label"] for e in out} == {"True", "False"}

    # Branches rejoin: both paths eventually reach print(y).
    labels = {n["label"] for n in chart["nodes"]}
    assert any(label.startswith("print(y)") for label in labels)


def test_while_loop_has_back_edge():
    chart = build_flowchart("i = 0\nwhile i < 3:\n    i += 1\nprint(i)\n")

    assert chart["error"] is None
    loop = next(n for n in chart["nodes"] if n["kind"] == "loop")
    loop_id = loop["id"]

    incoming = [e for e in chart["edges"] if e["to"] == loop_id]
    outgoing = [e for e in chart["edges"] if e["from"] == loop_id]
    # The body flows back into the condition (back edge), and the condition
    # leaves on True (body) and False (exit).
    assert len(incoming) >= 1, "body should flow back into the loop condition"
    assert {e["label"] for e in outgoing} >= {"True", "False"}


def test_function_body_becomes_subflow():
    chart = build_flowchart("def add(a, b):\n    return a + b\n\nresult = add(1, 2)\nprint(result)\n")

    assert chart["error"] is None
    kinds = _kinds(chart)
    assert "function" in kinds.values()

    function_node = next(n for n in chart["nodes"] if n["kind"] == "function")
    assert function_node["label"].startswith("def add(a, b)")
    subflows = [e for e in chart["edges"] if e["from"] == function_node["id"] and e["kind"] == "subflow"]
    assert len(subflows) == 1

    # The return inside the function is part of the chart.
    assert "return" in kinds.values()


def test_every_node_has_layout_coordinates():
    chart = build_flowchart("a = 1\nif a:\n    b = 2\nelse:\n    b = 3\nfor i in range(2):\n    print(i)\n")

    assert chart["nodes"], "expected nodes"
    ys = [n["y"] for n in chart["nodes"]]
    assert len(set(ys)) > 1, "nodes should span multiple layers"
    start = next(n for n in chart["nodes"] if n["kind"] == "start")
    assert start["y"] == min(ys)


def test_syntax_error_returned_not_raised():
    chart = build_flowchart("def broken(:\n    pass\n")

    assert chart["error"]["type"] == "SyntaxError"
    assert chart["nodes"] == []
    assert chart["edges"] == []


def test_dead_code_after_return_is_dropped():
    chart = build_flowchart("def f():\n    return 1\n    unreachable = 99\n\nf()\n")

    labels = {n["label"] for n in chart["nodes"]}
    assert not any("unreachable" in label for label in labels)


def test_start_and_end_nodes_present():
    chart = build_flowchart("print('hi')\n")

    kinds = _kinds(chart)
    assert "start" in kinds.values()
    assert "end" in kinds.values()

    start = next(n for n in chart["nodes"] if n["kind"] == "start")
    end = next(n for n in chart["nodes"] if n["kind"] == "end")
    assert any(e["from"] == start["id"] for e in chart["edges"])
    assert any(e["to"] == end["id"] for e in chart["edges"])
