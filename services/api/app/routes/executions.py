from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.execution.runner import run_python
from app.models import ExecutionRequest, ExecutionResponse

router = APIRouter()

# MVP store: traces live in memory only. The doc's guidance applies — don't
# retain huge trace payloads in core relational tables; add persistence later.
_STORE: dict[str, dict] = {}
_STORE_LIMIT = 50


@router.post("/api/executions", response_model=ExecutionResponse)
def create_execution(request: ExecutionRequest) -> ExecutionResponse:
    """Submit source code and receive an execution id, output and full trace."""
    result = run_python(request.source, stdin=request.stdin)
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
