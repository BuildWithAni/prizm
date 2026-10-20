from __future__ import annotations

import uuid

from fastapi import APIRouter, Header, HTTPException

from app import credits
from app.execution.runner import run_traced
from app.models import ExecutionRequest, ExecutionResponse

router = APIRouter()

# MVP store: traces live in memory only. The doc's guidance applies — don't
# retain huge trace payloads in core relational tables; add persistence later.
_STORE: dict[str, dict] = {}
_STORE_LIMIT = 50

# Traces that never reached a real engine — the credit is refunded so a
# missing toolchain or a run-only language can never drain the daily batch.
_UNMETERED_FAILURES = {"ToolchainUnavailable", "UnsupportedLanguage"}


@router.post("/api/executions", response_model=ExecutionResponse)
def create_execution(
    request: ExecutionRequest,
    x_client_id: str | None = Header(default=None),
) -> ExecutionResponse:
    """Submit source code and receive an execution id, output and full trace.

    Each visualization costs 1 credit from the caller's daily allowance.
    """
    allowed, _ = credits.charge(x_client_id)
    if not allowed:
        raise HTTPException(
            status_code=402,
            detail=(
                "Out of visualization credits for today. "
                "Get Pro for a much larger daily allowance, or come back after the reset."
            ),
        )

    result = run_traced(request.language, request.source, stdin=request.stdin)

    error = result.get("error") or {}
    if result.get("status") == "crashed" and error.get("type") in _UNMETERED_FAILURES:
        credits.refund(x_client_id)

    execution_id = uuid.uuid4().hex[:12]
    _STORE[execution_id] = result
    while len(_STORE) > _STORE_LIMIT:
        _STORE.pop(next(iter(_STORE)))
    return ExecutionResponse(id=execution_id, **result)


@router.get("/api/executions/{execution_id}/trace", response_model=ExecutionResponse)
def get_trace(execution_id: str) -> ExecutionResponse:
    """Retrieve a recorded execution's events and snapshots for playback."""
    if execution_id not in _STORE:
        raise HTTPException(status_code=404, detail="Execution not found")
    return ExecutionResponse(id=execution_id, **_STORE[execution_id])
