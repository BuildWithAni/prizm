from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.execution.sessions import detect_languages, get_manager
from app.models import LanguagesResponse, SessionInput, SessionRequest, SessionResponse

router = APIRouter()


@router.get("/api/languages", response_model=LanguagesResponse)
def languages() -> LanguagesResponse:
    """Which languages can run (and trace) on this machine."""
    return LanguagesResponse(languages=detect_languages())


@router.post("/api/sessions", response_model=SessionResponse)
def create_session(request: SessionRequest) -> SessionResponse:
    """Start running code; returns a session id. Poll GET for output."""
    session = get_manager().create(request.language, request.source, request.stdin)
    return SessionResponse(**session.to_dict())


@router.get("/api/sessions/{session_id}", response_model=SessionResponse)
def get_session(session_id: str) -> SessionResponse:
    session = get_manager().get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(**session.to_dict())


@router.post("/api/sessions/{session_id}/input", response_model=SessionResponse)
def send_input(session_id: str, body: SessionInput) -> SessionResponse:
    session = get_manager().send_input(session_id, body.line)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(**session.to_dict())


@router.delete("/api/sessions/{session_id}", response_model=SessionResponse)
def stop_session(session_id: str) -> SessionResponse:
    session = get_manager().stop(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(**session.to_dict())
