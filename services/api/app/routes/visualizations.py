from __future__ import annotations

from pydantic import BaseModel, Field
from fastapi import APIRouter

from app.models import FlowchartResponse
from app.visualization.flowchart import build_flowchart

router = APIRouter()


class FlowchartRequest(BaseModel):
    source: str = Field(default="", max_length=20_000)


@router.post("/api/visualizations", response_model=FlowchartResponse)
def create_visualization(request: FlowchartRequest) -> FlowchartResponse:
    """Generate control-flow graph data from source code (static analysis).

    The frontend overlays the execution trace on this graph afterwards.
    """
    return FlowchartResponse(**build_flowchart(request.source))
