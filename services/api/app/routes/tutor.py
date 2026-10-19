"""AI tutor: trace-grounded explanations served through OpenRouter.

OpenRouter speaks the OpenAI chat-completions protocol, so this route is a
thin adapter: it assembles a system prompt that embeds the student's real
program + the currently selected execution step (from the tracer), forwards
the conversation, and returns plain Markdown.
"""

from __future__ import annotations

import asyncio
import re

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import (
    OPENROUTER_API_KEY,
    OPENROUTER_URL,
    TUTOR_FALLBACK_MODELS,
    TUTOR_MODEL,
    TUTOR_TIMEOUT_SECONDS,
)

router = APIRouter(prefix="/api/tutor", tags=["tutor"])

# Below this a credit-capped answer would be uselessly truncated — fall back
# to the next model instead.
_MIN_TUTOR_TOKENS = 120
# Headroom for whole-file code blocks (the tutor can write the workspace).
_DEFAULT_MAX_TOKENS = 1400

TUTOR_SYSTEM_PROMPT = """\
You are the PRIZM AI Tutor, embedded in an educational code-visualization IDE.
Students watch their own program execute step by step: the highlighted line,
function frame, and variable snapshots provided with each question come from a
REAL runtime trace of their code — never guesswork.

How to teach:
- Ground every claim in the supplied trace. Quote the actual values and line
  numbers, e.g. "right now `total` is 6 because line 9 just added `k` = 3".
- Answer the question that was asked first, then give only the context needed
  to understand it. Short paragraphs, concrete examples, step-by-step reasoning
  for loops and recursion.
- Match depth to the stated student level. Beginner: plain language, define
  jargon inline. Advanced: precise terminology is fine.
- Use Markdown: fenced code blocks for code, **bold** for key terms, lists for
  sequences. Never use Markdown tables — the chat panel is narrow; a bullet
  list or a fenced block conveys the same comparison. Keep answers under
  ~200 words unless the student asks for depth.
- Never invent variable values, line numbers, or program behavior. If no step
  context was provided, say you can still explain the code generally.
- When the student's code is buggy, show a corrected version in a fenced block
  and explain the single change that matters.

Writing code for the workspace:
- The student can apply your code directly to their editor. When they ask you
  to write, fix, refactor, or extend their program, put ONE fenced block
  tagged `prizm` near the TOP of your answer — right after a single short
  intro sentence — containing the COMPLETE new contents of the workspace
  file: open the fence with ```prizm and close it with ```.
- Prose explanations go AFTER the block, so the code survives even when an
  answer gets cut short by a token limit.
- That block must be a whole, runnable file: no placeholders, no
  "...rest of the file", no omitted imports, and keep every part of their
  program you were not asked to change.
- Emit at most one prizm block. Never emit a prizm block for purely
  conceptual questions ("why does recursion terminate?") — answer those in
  prose; include an ordinary ```python snippet only if showing changed lines
  helps.
- Ordinary ```python blocks are illustrative snippets and are NOT applied to
  the workspace; only the prizm block is.
"""


class ChatTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class StepContext(BaseModel):
    """The selected execution step — built by the frontend from the trace."""

    line: int | None = None
    function: str | None = None
    event_kind: str | None = None
    locals: dict[str, str] = Field(default_factory=dict)
    stdout: str | None = None


class TutorRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    source: str = Field(default="", max_length=24000)
    language: str = "python"
    student_level: str = "beginner"
    context: StepContext | None = None
    history: list[ChatTurn] = Field(default_factory=list, max_length=24)


class TutorResponse(BaseModel):
    answer: str
    model: str
    # True when the provider cut the answer off at max_tokens — any code in it
    # may be incomplete, so the UI must not offer to apply it without warning.
    truncated: bool = False


def _build_system(req: TutorRequest) -> str:
    """Embed the program + current step into the system prompt."""
    parts = [TUTOR_SYSTEM_PROMPT, f"\n## Student's program ({req.language})\n"]
    if req.source.strip():
        fence = "```" + ("python" if req.language == "python" else "")
        parts.append(f"{fence}\n{req.source.rstrip()}\n```")
    else:
        parts.append("(no source provided for this question)")

    if req.context is not None:
        ctx = req.context
        parts.append("\n## Currently selected execution step (from the real trace)\n")
        if ctx.line is not None:
            parts.append(f"- Highlighted line: {ctx.line}")
        if ctx.function:
            parts.append(f"- Function frame: {ctx.function}")
        if ctx.event_kind:
            parts.append(f"- Event: {ctx.event_kind}")
        if ctx.locals:
            rendered = ", ".join(f"`{k}` = `{v}`" for k, v in ctx.locals.items())
            parts.append(f"- Variables: {rendered}")
        if ctx.stdout:
            parts.append(f"- Output so far: {ctx.stdout.strip()[:800]}")
    else:
        parts.append(
            "\n## Currently selected execution step\n(None — the student has not "
            "run/selected a step; explain the code in general terms.)"
        )
    return "\n".join(parts)


async def _post_chat(payload: dict, api_key: str) -> dict:
    """Single outbound call to OpenRouter (seam for tests to patch)."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "PRIZM AI Tutor",
    }
    async with httpx.AsyncClient(timeout=TUTOR_TIMEOUT_SECONDS) as client:
        response = await client.post(OPENROUTER_URL, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()


def _affordable_tokens(body: str) -> int | None:
    """Parse OpenRouter's credit-cap message: '… can only afford 322 …'."""
    match = re.search(r"can only afford (\d+)", body)
    return int(match.group(1)) if match else None


@router.post("/explain", response_model=TutorResponse)
async def explain(req: TutorRequest) -> TutorResponse:
    if not OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "OPENROUTER_API_KEY is not configured — add it to the "
                "repo-root .env file and restart the API server."
            ),
        )

    history = req.history[-12:]
    messages: list[dict] = [{"role": "system", "content": _build_system(req)}]
    messages += [{"role": t.role, "content": t.content} for t in history]
    messages.append({"role": "user", "content": req.question})

    model_chain = [TUTOR_MODEL] + [m for m in TUTOR_FALLBACK_MODELS if m and m != TUTOR_MODEL]
    credit_detail = (
        "Out of OpenRouter credits for the available models — top up at "
        "https://openrouter.ai/settings/credits."
    )
    # OpenRouter providers occasionally 5xx / reset; absorb a couple of
    # transients per model before moving down the chain.
    transient_statuses = {408, 429, 500, 502, 503, 504}

    data: dict | None = None
    last_status, last_detail = 502, credit_detail
    for model in model_chain:
        max_tokens = _DEFAULT_MAX_TOKENS
        for attempt in range(4):  # credit-retry + transient retries
            payload = {
                "model": model,
                "messages": messages,
                "temperature": 0.4,
                "max_tokens": max_tokens,
            }
            try:
                data = await _post_chat(payload, OPENROUTER_API_KEY)
                break
            except httpx.TimeoutException:
                last_status, last_detail = 504, "The tutor model timed out — try again."
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                break
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                if status == 402:
                    # Credit-capped. Rejections cost nothing, so retry the same
                    # model within whatever budget the key can still afford
                    # (free-tier keys cap the flagship at a few hundred tokens).
                    budget = _affordable_tokens(exc.response.text)
                    if budget is not None and _MIN_TUTOR_TOKENS <= budget < max_tokens:
                        max_tokens = budget - 10
                        continue
                    last_status, last_detail = 402, credit_detail
                    break
                if status == 404:  # unknown/disabled model — skip to next
                    last_status, last_detail = 502, f"Model {model!r} is not available on OpenRouter."
                    break
                if status in transient_statuses:
                    last_status = 502
                    last_detail = f"The model provider returned {status}."
                    if attempt < 2:
                        await asyncio.sleep(0.5 * (attempt + 1))
                        continue
                    break
                raise HTTPException(  # deterministic client/auth error
                    status_code=502,
                    detail=f"The model provider returned {status}.",
                ) from exc
            except httpx.HTTPError:
                last_status, last_detail = 502, "Could not reach OpenRouter."
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                break
        if data is not None:
            break

    if data is None:
        raise HTTPException(status_code=last_status, detail=last_detail)

    try:
        answer = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Unexpected response from the model provider.") from exc
    if not isinstance(answer, str) or not answer.strip():
        raise HTTPException(status_code=502, detail="The model returned an empty answer.")

    finish = data["choices"][0].get("finish_reason")
    return TutorResponse(
        answer=answer.strip(),
        model=str(data.get("model") or TUTOR_MODEL),
        truncated=finish == "length",
    )
