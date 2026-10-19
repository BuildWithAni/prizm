# PRIZM workflow check samples

Copy any file below into the editor at **http://localhost:3100/editor** and follow the
checklist. Start the servers first:

```powershell
# backend (port 8000)
.\.venv\Scripts\uvicorn app.main:app --port 8000 --app-dir services\api
# frontend (port 3100)
cd apps\web; npm run start
```

## 1. `python_showcase.py` — every visualization at once (press ◎ Visualize)

| Panel | What to verify |
| --- | --- |
| **Visual State** | Stepping highlights lines in the editor; `total`/`value`/`k` flash white when they change |
| **Flowchart** | 20-node graph: decisions, two `for` loops with back edges, `def` nodes with dashed "body" subflows; run Visualize first and the executed path lights white; click a node to jump the stepper |
| **Call Tree** | `factorial` recursion as a tree with return values (5! = 120); click a call to jump |
| **Values** | Chart `total` (1→19) or `value`; past = solid white, future = dimmed |
| **Console** | Shows the traced run's output (`small… / big… / factorial(5) = 120 / final total = 19`) |

## 2. `python_interactive.py` — live console (press ▶ Run)

Answer the prompts in the Console input line (multi-turn stdin):
`Who is playing?` → type a name → `Q1: …` → `7` → `y` → `14` → `n`.
Expect prompt-before-input, echoed lines, and `Bye <name> — you scored 2/2!`.
Try **Stop** mid-run to kill the process.

## 3. Other languages (▶ Run)

| File | Expected console output |
| --- | --- |
| `fib.js` | `fib: 0, 1, 1, 2, 3, 5, 8, 13, 21` and `sum: 54` |
| `sum_input.cpp` | `sum 1..10 = 55`, then `Factorial of:` — type `5` → `5! = 120` |
| `Main.java` | `sum 1..10 = 55` and `fib(10) = 55` (compiles first, ~2 s) |

## 4. Error paths

- `python_crash.py` (▶ Run): exits 1, `ZeroDivisionError` traceback in Console.
- Paste `def broken(:` + `    pass` and open **Flowchart**: SyntaxError card instead of a graph.
- Paste `int main() { oops; }` with language C++ (▶ Run): compiler error text in Console.
- With no session running, the Console shows the *traced* output; after Run, it shows the *live* session.
