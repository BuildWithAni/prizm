"""CodeLens AI — FastAPI entrypoint (modular monolith)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.executions import router as executions_router
from app.routes.sessions import router as sessions_router
from app.routes.tutor import router as tutor_router
from app.routes.visualizations import router as visualizations_router

app = FastAPI(title="CodeLens AI API", version="0.1.0")

# The Next.js dev server runs on :3000 and the prod preview on :3100;
# production would serve both from one origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3100",
        "http://127.0.0.1:3100",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(executions_router)
app.include_router(visualizations_router)
app.include_router(sessions_router)
app.include_router(tutor_router)


@app.get("/api/health")
@app.get("/health")  # local monitors probe /health directly
def health() -> dict:
    return {"status": "ok"}
