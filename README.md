# CodeLens AI (repo: prizm)

An educational platform where the **runtime determines what happened** and the **AI explains why it matters**. Students write Python, execute it, step through a recorded execution trace, and watch the code highlight, variable inspector and call stack stay perfectly synchronized — the foundation for a trace-grounded AI tutor.

This repo implements **Priority 1 (visual execution loop), Priority 2 (AST flowchart) and Priority 3 (contextual AI tutor)**, with Priority 4 scaffolded.

## Architecture

Two separate but connected pipelines:

- **Deterministic pipeline** — code → execution → trace → visual state (implemented).
- **AI learning pipeline** — selected visual state + student question → explanation → practice → assessment (explanation implemented via the AI Tutor; practice/assessment scaffolded, Priority 4).

```
prizm/
├── apps/web/                    # Next.js + TypeScript frontend
│   ├── app/editor/              # three-panel workspace page
│   ├── components/
│   │   ├── editor/              # Monaco editor with synced highlight
│   │   ├── execution/           # transport controls + timeline scrubber
│   │   ├── visualization/       # variables, call stack, event log, output
│   │   └── tutor/               # AI tutor chat (trace-grounded OpenRouter answers)
│   ├── hooks/useExecution.ts    # ONE shared state: trace + selected step
│   └── lib/                     # API client, trace types, formatting
│
├── services/api/                # FastAPI (modular monolith)
│   └── app/
│       ├── routes/              # executions, sessions, flowcharts, tutor
│       ├── execution/           # isolated child-process runner + limits
│       ├── tracing/             # sys.settrace-based tracer (the heart)
│       ├── visualization/       # AST flowchart engine
│       ├── config.py            # env-backed config (keys stay in .env)
│       └── models.py            # shared Pydantic trace contracts
│
├── tests/
│   ├── conftest.py
│   ├── execution/               # tracing, snapshots, limits, error paths
│   ├── visualization/           # flowchart structure
│   └── tutor/                   # prompt assembly, fallback, errors
│
└── README.md
```

## How execution tracing works

1. `POST /api/executions` receives source code.
2. The runner spawns `services/api/app/tracing/tracer.py` as a **separate process**.
3. The tracer compiles the student source under a synthetic filename and runs it with `sys.settrace`, recording `call` / `line` / `return` / `exception` events. Only student frames are traced — imports and library internals never pollute the trace.
4. Every event carries a **full snapshot of the frame's locals**, serialized into plain JSON data. Storing a snapshot per step makes backward playback trivially correct for educational-sized programs.
5. The frontend keeps the whole trace and only changes the *selected step*; pressing Previous never re-executes the code.

Runaway code is stopped three ways: a soft time limit checked on every event (keeps a partial trace), an event-count cap, and a hard subprocess timeout in the runner.

## Running locally

### Backend (port 8000)

```bash
python -m venv .venv
.venv/Scripts/pip install -r services/api/requirements.txt     # Windows
.venv/bin/pip install -r services/api/requirements.txt         # macOS/Linux

.venv/Scripts/uvicorn app.main:app --port 8000 --app-dir services/api
```

### Frontend (port 3000)

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000/editor — it redirects there automatically. The API base URL defaults to `http://localhost:8000` and can be overridden with `NEXT_PUBLIC_API_URL`.

### AI Tutor (optional)

The **AI Tutor** tab calls `POST /api/tutor/explain`, which forwards the question + the selected execution step to OpenRouter (OpenAI-compatible). Configure the repo-root `.env` (gitignored — never commit keys):

```bash
OPENROUTER_API_KEY=sk-or-...
TUTOR_MODEL=anthropic/claude-fable-5.1        # default: current flagship
TUTOR_FALLBACK_MODELS=anthropic/claude-sonnet-5.5,anthropic/claude-haiku-5.5
```

If the key's credit can't afford the requested answer length, the route automatically retries the same model within its affordable token budget, then falls back through `TUTOR_FALLBACK_MODELS` — so the tutor keeps working on free-tier keys.

### Tests

```bash
.venv/Scripts/python -m pytest tests -q
```

## API

| Method | Path                             | Purpose                                        |
| ------ | -------------------------------- | ---------------------------------------------- |
| POST   | `/api/executions`                | Run source, get execution id, output and trace |
| GET    | `/api/executions/{id}/trace`     | Retrieve a recorded trace for playback         |
| GET    | `/api/health`                    | Liveness check                                 |

## The shared trace schema

`services/api/app/models.py` (Pydantic) and `apps/web/lib/types.ts` (TypeScript) mirror each other — this contract is why the timeline, variable inspector and call-stack viewer all read the *same* events. Each event:

```ts
{
  step: number;
  event: "call" | "line" | "return" | "exception";
  line: number | null;
  functionName: string;
  frameId: string;
  parentFrameId: string | null;
  locals: Record<string, SerializedValue>;   // full snapshot at this step
  output: string;                            // console delta since last step
  value?: SerializedValue;                   // return values
  exception?: { type, message };
}
```

## Security notes (demo-grade, by design)

The tracer isolates student code in a child process with time, event-count and output-size limits, and the API never exposes credentials. This is **not** a production sandbox: for a real deployment, run executions in containers or a trusted execution service, add memory limits, and treat source code as untrusted input everywhere. Browser-side Pyodide is a lower-infrastructure alternative with its own constraints.

## Roadmap (priorities from the architecture doc)

1. ✅ **Visual execution loop** — trace, stepping, synchronized panels (this repo).
2. ✅ **One excellent flowchart** — AST-based control flow with the executed path overlaid; click a node to jump the stepper.
3. ✅ **Contextual AI tutor** — chat grounded in the selected step's real trace (line, frame, variable snapshots, output) via OpenRouter, with credit-aware model fallback.
4. **Evidence of learning** — prediction questions, exercises, progress tracking (Postgres/Supabase).
