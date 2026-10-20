"""CodeLens AI — FastAPI entrypoint (modular monolith)."""

import os
import re

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.billing import router as billing_router
from app.routes.executions import router as executions_router
from app.routes.sessions import router as sessions_router
from app.routes.tutor import router as tutor_router
from app.routes.visualizations import router as visualizations_router

app = FastAPI(title="CodeLens AI API", version="0.1.0")

def _allowed_origins() -> list[str]:
    configured = os.getenv("CORS_ALLOW_ORIGINS", "")
    extra = [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    vercel_project = os.getenv("VERCEL_PROJECT_PRODUCTION_URL", "").strip()
    vercel_url = os.getenv("VERCEL_URL", "").strip()
    for host in (vercel_project, vercel_url):
        if host and re.fullmatch(r"[A-Za-z0-9.-]+(?::\d+)?", host):
            extra.append(f"https://{host}")
    defaults = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3100",
        "http://127.0.0.1:3100",
    ]
    return list(dict.fromkeys([*defaults, *extra]))


# The Next.js dev server runs on :3000 and the prod preview on :3100;
# production would serve both from one origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(executions_router)
app.include_router(visualizations_router)
app.include_router(sessions_router)
app.include_router(tutor_router)
app.include_router(billing_router)


@app.get("/api/health")
@app.get("/health")  # local monitors probe /health directly
def health() -> dict:
    return {"status": "ok"}
