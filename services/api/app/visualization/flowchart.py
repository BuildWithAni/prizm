"""AST-based control-flow graph builder with a layered layout.

The AST describes the *possible* structure of the program; the execution trace
shows what actually happened. The frontend overlays the trace on this graph so
students see both: all branches, plus the path this run took.

Layout strategy (deliberately simple, education-scale):

- Continuation-passing build: each statement is built backwards with an
  explicit "next" node, which makes if/else joins and loop back-edges natural.
- Function bodies are built as separate subflows attached to their ``def``
  node (weight-3 edges push them below the main flow).
- Layers = longest path from Start over forward edges (DFS back-edge
  detection first, so loops don't break the DAG); x = visit order within the
  layer. Good enough for the small programs students step through.
"""

from __future__ import annotations

import ast

MAX_NODES = 140
H_SPACING = 210
V_SPACING = 96
SUBFLOW_LAYER_WEIGHT = 3  # extra layers below a def for its body
MAX_LABEL = 36

_NODE_KINDS = ("start", "statement", "decision", "loop", "function", "return", "jump", "end")


def _short(text: str, limit: int = MAX_LABEL) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


class _Builder:
    def __init__(self, source_lines: list[str]) -> None:
        self.lines = source_lines
        self.nodes: list[dict] = []
        self.edges: list[dict] = []
        self.truncated = False
        self._node_counter = 0
        self._edge_counter = 0
        self.loop_stack: list[tuple[str | None, str | None]] = []  # (break target, continue target)
        self.def_queue: list[tuple[str, list[ast.stmt]]] = []

    # --- primitives ---------------------------------------------------------

    def add_node(self, kind: str, label: str, line: int | None) -> str | None:
        if len(self.nodes) >= MAX_NODES:
            self.truncated = True
            return None
        self._node_counter += 1
        node_id = f"n{self._node_counter}"
        self.nodes.append({"id": node_id, "kind": kind, "label": _short(label), "line": line, "x": 0.0, "y": 0.0})
        return node_id

    def add_edge(self, source: str | None, target: str | None, label: str = "", kind: str = "normal") -> None:
        if source is None or target is None:
            return
        if len(self.edges) >= MAX_NODES * 4:
            self.truncated = True
            return
        self._edge_counter += 1
        self.edges.append({"id": f"e{self._edge_counter}", "from": source, "to": target, "label": label, "kind": kind})

    def snippet(self, stmt: ast.stmt) -> str:
        lineno = getattr(stmt, "lineno", None)
        if lineno and 1 <= lineno <= len(self.lines):
            return self.lines[lineno - 1].strip()
        return type(stmt).__name__

    @staticmethod
    def unparse(node: ast.AST | None) -> str | None:
        if node is None:
            return None
        try:
            return ast.unparse(node)
        except Exception:
            return None

    # --- build --------------------------------------------------------------

    def build_seq(self, stmts: list[ast.stmt], nxt: str | None) -> str | None:
        """Build statements backwards; returns the entry id of the sequence."""
        entry = nxt
        for stmt in reversed(stmts):
            entry = self.build_stmt(stmt, entry)
        return entry

    def build_stmt(self, stmt: ast.stmt, nxt: str | None) -> str | None:
        # Decision: if / elif
        if isinstance(stmt, ast.If):
            test = self.unparse(stmt.test) or "?"
            node = self.add_node("decision", f"if {test}", stmt.lineno)
            if node is None:
                return nxt
            body_entry = self.build_seq(stmt.body, nxt)
            else_entry = self.build_seq(stmt.orelse, nxt) if stmt.orelse else None
            true_target = body_entry
            false_target = else_entry if stmt.orelse else nxt
            if true_target is not None and false_target is not None and true_target != false_target:
                self.add_edge(node, true_target, "True")
                self.add_edge(node, false_target, "False")
            elif true_target is not None:
                self.add_edge(node, true_target, "True" if stmt.orelse else "")
            elif false_target is not None:
                self.add_edge(node, false_target, "False" if stmt.orelse else "")
            return node

        # Loops: while / for (+ async variants)
        if isinstance(stmt, (ast.While, ast.For, ast.AsyncFor)):
            if isinstance(stmt, ast.While):
                label = f"while {self.unparse(stmt.test) or '?'}"
            else:
                target = self.unparse(stmt.target) or "?"
                label = f"for {target} in {self.unparse(stmt.iter) or '?'}"
            node = self.add_node("loop", label, stmt.lineno)
            if node is None:
                return nxt
            self.loop_stack.append((nxt, node))
            body_entry = self.build_seq(stmt.body, node)  # body flows back into the condition
            self.loop_stack.pop()
            if body_entry is not None and body_entry != node:
                self.add_edge(node, body_entry, "True")
            exit_target = None
            if stmt.orelse:
                exit_target = self.build_seq(stmt.orelse, nxt)
            else:
                exit_target = nxt
            if exit_target is not None:
                self.add_edge(node, exit_target, "False")
            return node

        # Function definitions: the def continues into the surrounding flow;
        # the body is attached later as a separate subflow.
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = ", ".join(a.arg for a in stmt.args.args)
            node = self.add_node("function", f"def {stmt.name}({args})", stmt.lineno)
            if node is None:
                return nxt
            self.def_queue.append((node, stmt.body))
            self.add_edge(node, nxt)
            return node

        if isinstance(stmt, (ast.Return,)):
            value = self.unparse(stmt.value)
            node = self.add_node("return", f"return {value}" if value else "return", stmt.lineno)
            return node if node is not None else nxt

        if isinstance(stmt, (ast.Break, ast.Continue)):
            kind_word = "break" if isinstance(stmt, ast.Break) else "continue"
            node = self.add_node("jump", kind_word, stmt.lineno)
            if node is None:
                return nxt
            if self.loop_stack:
                break_target, continue_target = self.loop_stack[-1]
                self.add_edge(node, break_target if isinstance(stmt, ast.Break) else continue_target)
            return node

        # Everything else: a plain statement node.
        node = self.add_node("statement", self.snippet(stmt), getattr(stmt, "lineno", None))
        if node is None:
            return nxt
        self.add_edge(node, nxt)
        return node

    def drain_defs(self) -> None:
        """Build pending function bodies as subflows under their def nodes."""
        index = 0
        while index < len(self.def_queue):
            parent_id, body = self.def_queue[index]
            index += 1
            entry = self.build_seq(body, None)
            if entry is not None:
                self.add_edge(parent_id, entry, "body", kind="subflow")

    # --- graph finishing ----------------------------------------------------

    def finish(self, start_id: str, end_id: str | None) -> None:
        # Reachability from Start (subflow edges included). End is seeded
        # because it has no incoming edges until terminals connect below.
        outgoing: dict[str, list[str]] = {}
        for edge in self.edges:
            outgoing.setdefault(edge["from"], []).append(edge["to"])

        reachable = {start_id}
        frontier = [start_id]
        if end_id is not None:
            reachable.add(end_id)
            frontier.append(end_id)
        while frontier:
            current = frontier.pop()
            for target in outgoing.get(current, ()):
                if target not in reachable:
                    reachable.add(target)
                    frontier.append(target)

        # Drop dead code — a flowchart of live paths only.
        self.nodes = [n for n in self.nodes if n["id"] in reachable]
        self.edges = [e for e in self.edges if e["from"] in reachable and e["to"] in reachable]

        # Connect terminals (no outgoing edges) to End.
        if end_id is not None:
            has_out = {e["from"] for e in self.edges}
            for node in self.nodes:
                if node["id"] in (start_id, end_id):
                    continue
                if node["id"] not in has_out:
                    self.add_edge(node["id"], end_id)


def _layout(nodes: list[dict], edges: list[dict], start_id: str) -> None:
    """Layered layout: longest path from Start (back edges excluded), x = visit order."""
    if not nodes:
        return
    adjacency: dict[str, list[tuple[str, int]]] = {}
    for edge in edges:
        weight = SUBFLOW_LAYER_WEIGHT if edge["kind"] == "subflow" else 1
        adjacency.setdefault(edge["from"], []).append((edge["to"], weight))

    # DFS to find back edges (edges into the current recursion stack).
    back_edges: set[tuple[str, str]] = set()
    color: dict[str, int] = {node["id"]: 0 for node in nodes}  # 0 white, 1 gray, 2 black

    def mark(u: str) -> None:
        color[u] = 1
        for v, _w in adjacency.get(u, ()):  # noqa: B023
            if v not in color:
                continue
            if color[v] == 1:
                back_edges.add((u, v))
            elif color[v] == 0:
                mark(v)
        color[u] = 2

    if start_id in color:
        mark(start_id)

    dag_adj = {
        u: [(v, w) for (v, w) in targets if (u, v) not in back_edges]
        for u, targets in adjacency.items()
    }

    # Topological order via DFS post-order (DAG now).
    order: list[str] = []
    seen: set[str] = set()

    def topo(u: str) -> None:
        seen.add(u)
        for v, _w in dag_adj.get(u, ()):
            if v not in seen and v in color:
                topo(v)
        order.append(u)

    if start_id in color:
        topo(start_id)
    order.reverse()

    layer: dict[str, int] = {start_id: 0}
    for u in order:
        for v, w in dag_adj.get(u, ()):
            layer[v] = max(layer.get(v, 0), layer.get(u, 0) + w)

    # X order: BFS from Start in edge order, grouped per layer.
    per_layer: dict[int, list[str]] = {}
    visited: set[str] = set()
    queue = [start_id]
    while queue:
        nxt_queue: list[str] = []
        for u in queue:
            if u in visited:
                continue
            visited.add(u)
            per_layer.setdefault(layer.get(u, 0), []).append(u)
            for v, _w in adjacency.get(u, ()):
                if v not in visited and v in color:
                    nxt_queue.append(v)
        queue = nxt_queue
    # Anything not BFS-visited (shouldn't happen post-reachability) gets a layer.
    for node in nodes:
        if node["id"] not in visited:
            per_layer.setdefault(layer.get(node["id"], 0), []).append(node["id"])

    for layer_id, ids in per_layer.items():
        count = len(ids)
        for index, node_id in enumerate(ids):
            x = (index - (count - 1) / 2) * H_SPACING
            y = layer_id * V_SPACING
            for node in nodes:
                if node["id"] == node_id:
                    node["x"] = round(x, 1)
                    node["y"] = round(y, 1)
                    break


def build_flowchart(source: str) -> dict:
    """Build a flowchart {nodes, edges, truncated, error?} for Python source."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return {
            "nodes": [],
            "edges": [],
            "truncated": False,
            "error": {"type": "SyntaxError", "message": f"{exc.msg} (line {exc.lineno})"},
        }

    lines = source.splitlines()
    builder = _Builder(lines)

    start_id = builder.add_node("start", "Start", None)
    first = builder.build_seq(tree.body, None)
    builder.add_edge(start_id, first)
    builder.drain_defs()
    end_id = builder.add_node("end", "End", None)
    builder.finish(start_id, end_id)

    _layout(builder.nodes, builder.edges, start_id)
    return {"nodes": builder.nodes, "edges": builder.edges, "truncated": builder.truncated, "error": None}
