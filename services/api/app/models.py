"""Shared API contracts.

These Pydantic models are the backend half of the trace schema. The frontend
mirror lives in apps/web/lib/types.ts. Keeping both sides explicit means the
timeline, variable inspector and call-stack viewer always agree on the meaning
of every step.
"""

from __future__ import annotations

from typing import Annotated, List, Literal, Optional, Union

from pydantic import BaseModel, Field


# --- SerializedValue ---------------------------------------------------------

class NullValue(BaseModel):
    type: Literal["null"]
    value: None = None


class NumberValue(BaseModel):
    type: Literal["number"]
    value: Union[int, float]


class StringValue(BaseModel):
    type: Literal["string"]
    value: str


class BooleanValue(BaseModel):
    type: Literal["boolean"]
    value: bool


class ArrayValue(BaseModel):
    type: Literal["array"]
    value: List["SerializedValue"]


class FunctionValue(BaseModel):
    type: Literal["function"]
    name: str


class ObjectValue(BaseModel):
    """Non-primitive values (dicts, sets, objects, modules) as an id + label."""

    type: Literal["object"]
    id: str
    label: str


SerializedValue = Annotated[
    Union[
        NullValue,
        NumberValue,
        StringValue,
        BooleanValue,
        ArrayValue,
        FunctionValue,
        ObjectValue,
    ],
    Field(discriminator="type"),
]

ArrayValue.model_rebuild()


# --- Trace events ------------------------------------------------------------

class ExceptionInfo(BaseModel):
    type: str
    message: str


class TraceEvent(BaseModel):
    step: int
    event: Literal["call", "line", "return", "exception"]
    line: Optional[int] = None
    functionName: str
    frameId: str
    parentFrameId: Optional[str] = None
    locals: dict[str, SerializedValue]
    output: str = ""
    value: Optional[SerializedValue] = None
    exception: Optional[ExceptionInfo] = None


# --- Requests / responses ----------------------------------------------------

class ExecutionRequest(BaseModel):
    language: Literal[
        "python", "javascript", "typescript", "java", "kotlin",
        "c", "cpp", "go", "rust", "csharp", "php", "ruby", "html",
    ] = "python"
    source: str = Field(min_length=1, max_length=20_000)
    # Lines the traced program may read via input()/sys.stdin (one-shot).
    stdin: Optional[str] = Field(default=None, max_length=4000)


class ErrorInfo(BaseModel):
    type: str
    message: str


ExecutionStatus = Literal["ok", "error", "timeout", "syntax_error", "event_limit", "crashed"]


class ExecutionResponse(BaseModel):
    id: str
    status: ExecutionStatus
    events: List[TraceEvent]
    output: str
    error: Optional[ErrorInfo] = None


# --- Run mode (interactive sessions, any language) --------------------------

class SessionRequest(BaseModel):
    language: str = Field(min_length=1, max_length=20)
    source: str = Field(min_length=1, max_length=20_000)
    stdin: Optional[str] = Field(default=None, max_length=4000)


class SessionInput(BaseModel):
    line: str = Field(default="", max_length=2000)


# --- Credits & billing (Free vs Pro) ------------------------------------------

Plan = Literal["free", "pro"]


class CreditStatus(BaseModel):
    client_id: str
    plan: Plan
    used: int
    limit: int
    remaining: int
    resets_at: str


class CheckoutRequest(BaseModel):
    """Demo checkout — no payment processor is wired up in this MVP."""

    client_id: Optional[str] = Field(default=None, max_length=64)
    plan: Literal["pro"] = "pro"
    # Accepted and ignored (present so the form has a real contract to post).
    card_number: Optional[str] = Field(default=None, max_length=25)
    card_name: Optional[str] = Field(default=None, max_length=80)


class CheckoutResponse(BaseModel):
    status: CreditStatus
    message: str


class SessionResponse(BaseModel):
    id: str
    language: str
    status: Literal["running", "exited", "timeout", "stopped", "compile_error", "error"]
    output: str
    exit_code: Optional[int] = None


class LanguageInfo(BaseModel):
    id: str
    name: str
    available: bool
    run: bool
    trace: bool
    detail: Optional[str] = None


class LanguagesResponse(BaseModel):
    languages: List[LanguageInfo]


# --- Flowchart (static analysis) -------------------------------------------

class FlowNode(BaseModel):
    id: str
    kind: Literal["start", "statement", "decision", "loop", "function", "return", "jump", "end"]
    label: str
    line: Optional[int] = None
    x: float
    y: float


class FlowEdge(BaseModel):
    id: str
    source: str = Field(validation_alias="from", serialization_alias="from")
    target: str = Field(validation_alias="to", serialization_alias="to")
    label: str = ""
    kind: Literal["normal", "subflow"] = "normal"

    model_config = {"populate_by_name": True}


class FlowchartResponse(BaseModel):
    nodes: List[FlowNode]
    edges: List[FlowEdge]
    truncated: bool = False
    error: Optional[ErrorInfo] = None
