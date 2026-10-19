<div align="center">

<!-- Animated title using SVG -->
<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=40&duration=3000&pause=1000&color=A855F7&center=true&vCenter=true&width=600&height=80&lines=✦+prizm;CodeLens+AI;See+your+code+think." alt="Prizm — CodeLens AI" />

<br/>

<img src="https://readme-typing-svg.demolab.com?font=Inter&weight=400&size=18&duration=4000&pause=1000&color=94A3B8&center=true&vCenter=true&multiline=false&width=700&height=40&lines=The+runtime+determines+what+happened.;The+AI+explains+why+it+matters.;Step+through+execution%2C+not+imagination." alt="Tagline" />

<br/><br/>

<!-- Badges -->
[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-A855F7?style=for-the-badge)](LICENSE)

<br/>

<!-- Animated divider -->
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" width="100%">

</div>

<br/>

## ✦ What is Prizm?

> Students write code. Most tools show them **the result**.  
> Prizm shows them the **journey** — every variable mutation, every function call, every branch taken — and then an AI explains *why* each moment matters.

**Prizm** is an educational code execution platform where:

1. 🧠 **The runtime records everything** — a complete, step-by-step execution trace
2. 🎬 **You scrub through time** — like a video player for your code
3. 🔍 **Panels stay perfectly synced** — editor highlight, variable inspector, call stack, event log
4. 🤖 **The AI explains grounded reality** — not hallucinations, but your *actual* trace

<br/>

<div align="center">

<!-- Animated feature wave -->
<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=14&duration=2500&pause=600&color=A855F7&center=true&vCenter=true&width=700&height=30&lines=→+Trace-grounded+AI+Tutor;→+Step-by-step+execution+replay;→+AST+Flowchart+with+live+path+overlay;→+Variable+Inspector+%2B+Call+Stack;→+Monaco+Editor+with+synchronized+highlights" alt="Features" />

</div>

<br/>

---

## 🏗️ Architecture

Two separate but deeply connected pipelines:

```
┌─────────────────────────────────────────────────────────────────┐
│                    DETERMINISTIC PIPELINE                        │
│                                                                   │
│  Source Code  →  Execution  →  Trace  →  Visual State           │
│                                                                   │
│  sys.settrace records every call/line/return/exception event     │
│  Full variable snapshots stored at every step                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓  selected step
┌─────────────────────────────────────────────────────────────────┐
│                     AI LEARNING PIPELINE                         │
│                                                                   │
│  Visual State  →  Student Question  →  Grounded Explanation      │
│                                                                   │
│  OpenRouter (Claude) reads the actual trace, not the source      │
└─────────────────────────────────────────────────────────────────┘
```

### Repository layout

```
prizm/
├── apps/web/                    # Next.js 15 + TypeScript frontend
│   ├── app/editor/              # Three-panel workspace
│   ├── components/
│   │   ├── editor/              # Monaco editor — synced line highlight
│   │   ├── execution/           # Timeline scrubber + transport controls
│   │   ├── visualization/       # Variables, call stack, event log, output
│   │   └── tutor/               # AI tutor chat (trace-grounded answers)
│   ├── hooks/useExecution.ts    # Single shared state: trace + selected step
│   └── lib/                     # API client, trace types, formatting
│
├── services/api/                # FastAPI modular monolith
│   └── app/
│       ├── routes/              # executions · sessions · flowcharts · tutor
│       ├── execution/           # Isolated child-process runner + limits
│       ├── tracing/             # sys.settrace tracer — the heart of prizm
│       ├── visualization/       # AST flowchart engine
│       ├── config.py            # env-backed config (keys in .env, gitignored)
│       └── models.py            # Shared Pydantic trace contracts
│
└── tests/
    ├── execution/               # Tracing, snapshots, limits, error paths
    ├── visualization/           # Flowchart structure
    └── tutor/                   # Prompt assembly, fallback, errors
```

<br/>

---

## ⚡ Features

<table>
<tr>
<td width="50%">

### 🎬 Execution Replay
Step **forward and backward** through every event in your program without re-executing. All state is stored in the trace — Previous is just `stepIndex - 1`.

</td>
<td width="50%">

### 🔬 Variable Inspector
Every step carries a **full snapshot** of local variables in every frame. Deep-inspect lists, dicts, and nested objects at any moment in time.

</td>
</tr>
<tr>
<td width="50%">

### 🌊 AST Flowchart
An AST-derived control-flow graph with the **executed path overlaid**. Click any node to jump the stepper to that exact moment.

</td>
<td width="50%">

### 🤖 Trace-Grounded Tutor
The AI sees `line`, `frame`, `locals snapshot`, and `stdout delta` for the **selected step** — answers are grounded in reality, not guessing.

</td>
</tr>
<tr>
<td width="50%">

### 🛡️ Safe Execution
Code runs in an **isolated child process** with a soft time limit (partial trace preserved), event-count cap, and a hard subprocess timeout.

</td>
<td width="50%">

### 💸 Credit-Aware Fallback
The tutor retries within an affordable token budget, then falls through `TUTOR_FALLBACK_MODELS` — works on free-tier API keys too.

</td>
</tr>
</table>

<br/>

---

## 🚀 Running Locally

### 1 — Backend (port 8000)

```bash
# Create virtualenv
python -m venv .venv

# Install dependencies
.venv/Scripts/pip install -r services/api/requirements.txt   # Windows
.venv/bin/pip  install -r services/api/requirements.txt      # macOS / Linux

# Start the API
.venv/Scripts/uvicorn app.main:app --port 8000 --app-dir services/api
```

### 2 — Frontend (port 3000)

```bash
cd apps/web
npm install
npm run dev
```

Open **http://localhost:3000/editor** — the landing page redirects there automatically.

> **Override the API URL** with `NEXT_PUBLIC_API_URL` if the backend is on a different host.

### 3 — AI Tutor (optional)

Create a `.env` file at the repo root (gitignored):

```env
OPENROUTER_API_KEY=sk-or-...
TUTOR_MODEL=anthropic/claude-fable-5.1
TUTOR_FALLBACK_MODELS=anthropic/claude-sonnet-5.5,anthropic/claude-haiku-5.5
```

### 4 — Tests

```bash
.venv/Scripts/python -m pytest tests -q
```

<br/>

---

## 🔌 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/executions` | Submit source code → get execution id + trace |
| `GET` | `/api/executions/{id}/trace` | Retrieve a recorded trace for playback |
| `POST` | `/api/tutor/explain` | Ask the AI about the selected trace step |
| `GET` | `/api/health` | Liveness check |

<br/>

---

## 📐 The Trace Schema

`services/api/app/models.py` (Pydantic) and `apps/web/lib/types.ts` (TypeScript) are **mirrors** of each other — this contract keeps the timeline, variable inspector, and call-stack viewer all reading the same events.

```typescript
interface TraceEvent {
  step:          number;
  event:         "call" | "line" | "return" | "exception";
  line:          number | null;
  functionName:  string;
  frameId:       string;
  parentFrameId: string | null;
  locals:        Record<string, SerializedValue>;  // full snapshot
  output:        string;                           // stdout delta
  value?:        SerializedValue;                  // return value
  exception?:    { type: string; message: string };
}
```

<br/>

---

## 🗺️ Roadmap

<div align="center">

| # | Feature | Status |
|---|---------|--------|
| 1 | Visual execution loop — trace, stepping, synchronized panels | ✅ **Done** |
| 2 | AST-based control-flow flowchart with executed path overlay | ✅ **Done** |
| 3 | Contextual AI tutor grounded in the selected trace step | ✅ **Done** |
| 4 | Evidence of learning — prediction questions, exercises, progress tracking | 🔜 **Next** |

</div>

<br/>

---

## 🔒 Security Notes

The tracer isolates student code in a child process with **time, event-count, and output-size limits**, and the API never exposes credentials.

> ⚠️ **Demo-grade only.** For production: run executions in containers or a trusted sandbox, add memory limits, and treat all source code as untrusted input. Browser-side Pyodide is an alternative with its own constraints.

<br/>

---

<div align="center">

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" width="100%">

<br/>

<!-- Animated footer -->
<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=13&duration=3000&pause=1000&color=64748B&center=true&vCenter=true&width=500&height=30&lines=Built+with+%E2%99%A5+by+BuildWithAni;prizm+—+see+your+code+think." alt="Footer" />

<br/><br/>

**[⬆ back to top](#-what-is-prizm)**

</div>
