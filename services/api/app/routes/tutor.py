"""AI tutor: trace-grounded explanations served through OpenRouter.

OpenRouter speaks the OpenAI chat-completions protocol, so this route is a
thin adapter: it assembles a system prompt that embeds the student's real
program + the currently selected execution step (from the tracer), forwards
the conversation, and returns plain Markdown.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import (
    OPENROUTER_API_KEY,
    OPENROUTER_URL,
    TUTOR_FALLBACK_MODELS,
    TUTOR_MAX_TOKENS,
    TUTOR_MODEL,
    TUTOR_TIMEOUT_SECONDS,
)

router = APIRouter(prefix="/api/tutor", tags=["tutor"])

# Below this a credit-capped answer would be uselessly truncated — fall back
# to the next model instead.
_MIN_TUTOR_TOKENS = 120
# Output budget for a single round-trip. Answers longer than this are stitched
# together by continuation calls (_MAX_CONTINUATIONS of them), so a free-tier
# key that can only afford a few hundred tokens per call still delivers a
# complete whole-file answer — in slices.
_PER_CALL_MAX_TOKENS = TUTOR_MAX_TOKENS
_MAX_CONTINUATIONS = 3

# Sent after a cut-off reply: the model resumes mid-stream, so it must not
# repeat, preamble, or reopen a fence that is already open.
_CONTINUATION_PROMPT = """\
Your previous reply was cut off at the token limit. Continue it EXACTLY from \
the point where it stopped: do not repeat any text, do not add a preamble or \
apology, and do not close and reopen any code fence — if a code block was \
open, keep writing inside it and close it only when the code ends."""

# Free-tier throttling is short-lived but self-reinforcing: rapid retries
# extend the window. Shown instead of a generic 502 when models keep 429ing.
_RATE_LIMIT_DETAIL = (
    "The free model pool is rate-limiting requests right now — wait about a "
    "minute and try again."
)

# Free models have a hard per-request cap; OpenRouter appends this notice to
# the message CONTENT when it trips. Strip it so it never lands mid-code.
_CUTOFF_MARKER = re.compile(r"\s*⚠\s*Cut off at the token limit[^\n]*\n?")

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


async def _stream_chat(payload: dict, api_key: str) -> AsyncIterator[tuple[str, str | None]]:
    """Streaming twin of _post_chat (seam for tests to patch).

    Yields ("delta", text) tuples as tokens arrive and a final
    ("done", finish_reason) tuple once the provider signals completion.
    HTTP errors raise on the first iteration, exactly like _post_chat.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "PRIZM AI Tutor",
    }
    finish: str | None = None
    async with httpx.AsyncClient(timeout=TUTOR_TIMEOUT_SECONDS) as client:
        async with client.stream("POST", OPENROUTER_URL, json=payload, headers=headers) as response:
            if response.status_code >= 400:
                # The stream closes when this block exits — read the error
                # body NOW, while it is open, so handlers can still inspect
                # .text after the exception (a later read raises StreamClosed).
                await response.aread()
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except ValueError:
                    continue
                choice = (obj.get("choices") or [{}])[0]
                delta = (choice.get("delta") or {}).get("content")
                if isinstance(delta, str) and delta:
                    yield ("delta", delta)
                reason = choice.get("finish_reason")
                if isinstance(reason, str):
                    finish = reason
    yield ("done", finish)


def _affordable_tokens(body: str) -> int | None:
    """Parse OpenRouter's credit-cap message: '… can only afford 322 …'."""
    match = re.search(r"can only afford (\d+)", body)
    return int(match.group(1)) if match else None


def _body_text(response: httpx.Response) -> str:
    """Error-response body as text, '' when a stream closed unread.

    Guards the retry policy against exactly one failure mode: an upstream
    error whose body could not be captured in time must degrade the
    credit-budget detection, never crash the route. StreamError derives
    from RuntimeError — not httpx.HTTPError — so catch both.
    """
    try:
        return response.text
    except (httpx.StreamError, httpx.HTTPError):
        return ""


def _content_of(data: dict) -> str | None:
    """Message content of a chat response, or None when malformed."""
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None
    return content if isinstance(content, str) else None


def _finish_of(data: dict) -> str | None:
    try:
        return data["choices"][0].get("finish_reason")
    except (KeyError, IndexError, TypeError):
        return None


async def _call_model(model: str, messages: list[dict], max_tokens: int) -> tuple[dict | None, int, int, str]:
    """One model call under the credit/transient retry policy.

    Returns (data, max_tokens, last_status, last_detail). `data` is None when
    the call gave up. `max_tokens` reflects any budget shrink discovered on a
    402, so follow-up continuation calls stay within what the key can afford.
    """
    credit_detail = (
        "Out of OpenRouter credits for the available models — top up at "
        "https://openrouter.ai/settings/credits."
    )
    # OpenRouter providers occasionally 5xx / reset; absorb a couple of
    # transients before giving up on this model. 429 is handled separately —
    # it needs a patient pause, not rapid retries.
    transient_statuses = {408, 500, 502, 503, 504}

    last_status, last_detail = 502, credit_detail
    for attempt in range(4):  # credit-retry + transient retries
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": max_tokens,
        }
        try:
            return await _post_chat(payload, OPENROUTER_API_KEY), max_tokens, last_status, last_detail
        except httpx.TimeoutException:
            last_status, last_detail = 504, "The tutor model timed out — try again."
            if attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
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
            elif status == 404:  # unknown/disabled model — skip to next
                last_status, last_detail = 502, f"Model {model!r} is not available on OpenRouter."
            elif status == 429:
                # One patient pause for the throttle window, then give this
                # model up — rapid re-trips only extend the window. The route
                # aborts entirely once a second model reports the same limit.
                last_status, last_detail = 429, _RATE_LIMIT_DETAIL
                if attempt == 0:
                    # Honor Retry-After, but never below 15s — a sub-second
                    # header just re-trips the free-tier window — capped at 30s.
                    header = exc.response.headers.get("Retry-After", "")
                    delay = 15.0
                    if header and header.replace(".", "", 1).isdigit():
                        delay = min(max(float(header), 15.0), 30.0)
                    await asyncio.sleep(delay)
                    continue
                break
            elif status in transient_statuses:
                last_status = 502
                last_detail = f"The model provider returned {status}."
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
            else:  # deterministic client/auth error
                raise HTTPException(
                    status_code=502,
                    detail=f"The model provider returned {status}.",
                ) from exc
        except httpx.HTTPError:
            last_status, last_detail = 502, "Could not reach OpenRouter."
            if attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
        break
    return None, max_tokens, last_status, last_detail


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

    last_status, last_detail = 502, "The tutor model is unavailable — try again."
    consecutive_429 = 0
    for model in model_chain:
        data, max_tokens, status, detail = await _call_model(model, messages, _PER_CALL_MAX_TOKENS)
        last_status, last_detail = status, detail
        if data is None:
            if status == 429:
                consecutive_429 += 1
                if consecutive_429 >= 2:
                    # A *different* model hitting the same limit means the
                    # throttle is IP/key-scoped — sweeping more models only
                    # extends the window. Stop and say so honestly.
                    break
            continue
        consecutive_429 = 0

        first = _content_of(data)
        if first is None:
            last_status, last_detail = 502, "Unexpected response from the model provider."
            continue

        # Stitch continuation slices while the provider keeps cutting us off:
        # a free-tier key that can only afford a few hundred tokens per call
        # still delivers the complete answer — in slices, seamlessly joined.
        parts = [_CUTOFF_MARKER.sub("", first)]
        truncated = _finish_of(data) == "length"
        for _ in range(_MAX_CONTINUATIONS):
            if not truncated:
                break
            convo = messages + [
                {"role": "assistant", "content": "".join(parts)},
                {"role": "user", "content": _CONTINUATION_PROMPT},
            ]
            more, max_tokens, _, _ = await _call_model(model, convo, max_tokens)
            if more is None:
                break  # out of credits or unreachable — keep what we have
            chunk = _content_of(more)
            if chunk is None:
                break
            parts.append(_CUTOFF_MARKER.sub("", chunk))
            truncated = _finish_of(more) == "length"

        answer = "".join(parts).strip()
        if not answer:
            last_status, last_detail = 502, "The model returned an empty answer."
            continue
        return TutorResponse(
            answer=answer,
            model=str(data.get("model") or TUTOR_MODEL),
            truncated=truncated,
        )

    raise HTTPException(status_code=last_status, detail=last_detail)


async def _open_stream(
    model_chain: list[str], messages: list[dict]
) -> tuple[str, AsyncIterator[tuple[str, str | None]]]:
    """Find the first model that starts streaming, under _call_model's policy.

    Returns (model, iterator) with the first event already consumed and
    prepended, so a stream that opens but yields nothing can still fall
    through to the next model. Raises HTTPException when every model fails —
    the route awaits this BEFORE responding, so failures surface as real
    HTTP statuses the client can fall back on.
    """
    credit_detail = (
        "Out of OpenRouter credits for the available models — top up at "
        "https://openrouter.ai/settings/credits."
    )
    transient_statuses = {408, 500, 502, 503, 504}

    max_tokens = _PER_CALL_MAX_TOKENS
    last_status, last_detail = 502, credit_detail
    consecutive_429 = 0

    for model in model_chain:
        if consecutive_429 >= 2:
            # A second model hitting the same throttle means the window is
            # IP/key-scoped — sweeping more models only extends it.
            break
        for attempt in range(4):
            payload = {
                "model": model,
                "messages": messages,
                "temperature": 0.4,
                "max_tokens": max_tokens,
                "stream": True,
            }
            stream = _stream_chat(payload, OPENROUTER_API_KEY)
            iterator = stream.__aiter__()
            try:
                first = await iterator.__anext__()
            except StopAsyncIteration:
                last_status, last_detail = 502, "The model returned an empty answer."
                break
            except httpx.TimeoutException:
                last_status, last_detail = 504, "The tutor model timed out — try again."
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                break
            except httpx.HTTPStatusError as exc:
                # _stream_chat reads the error body while its stream is open;
                # this is a best-effort no-op for streams that closed unread.
                # StreamError (StreamClosed/ResponseNotRead) is NOT an
                # httpx.HTTPError — it derives from RuntimeError, so both
                # hierarchies must be caught or the route 500s.
                try:
                    await exc.response.aread()
                except (httpx.StreamError, httpx.HTTPError):
                    pass
                status = exc.response.status_code
                if status == 402:
                    budget = _affordable_tokens(_body_text(exc.response))
                    if budget is not None and _MIN_TUTOR_TOKENS <= budget < max_tokens:
                        max_tokens = budget - 10
                        continue
                    last_status, last_detail = 402, credit_detail
                elif status == 404:
                    last_status, last_detail = 502, f"Model {model!r} is not available on OpenRouter."
                elif status == 429:
                    last_status, last_detail = 429, _RATE_LIMIT_DETAIL
                    if attempt == 0:
                        header = exc.response.headers.get("Retry-After", "")
                        delay = 15.0
                        if header and header.replace(".", "", 1).isdigit():
                            delay = min(max(float(header), 15.0), 30.0)
                        await asyncio.sleep(delay)
                        continue
                    consecutive_429 += 1
                elif status in transient_statuses:
                    last_status = 502
                    last_detail = f"The model provider returned {status}."
                    if attempt < 2:
                        await asyncio.sleep(0.5 * (attempt + 1))
                        continue
                else:
                    raise HTTPException(
                        status_code=502,
                        detail=f"The model provider returned {status}.",
                    ) from exc
                break
            except httpx.HTTPError:
                last_status, last_detail = 502, "Could not reach OpenRouter."
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                break

            if first[0] != "delta":
                # Opened but finished before any token — try the next model.
                last_status, last_detail = 502, "The model returned an empty answer."
                break

            async def _with_first(
                _first: tuple[str, str | None] = first,
                _iterator: AsyncIterator[tuple[str, str | None]] = iterator,
            ) -> AsyncIterator[tuple[str, str | None]]:
                yield _first
                async for item in _iterator:
                    yield item

            return model, _with_first()

    raise HTTPException(status_code=last_status, detail=last_detail)


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.post("/explain/stream")
async def explain_stream(req: TutorRequest) -> StreamingResponse:
    """Streaming twin of /explain: Server-Sent Events, one frame per batch of
    tokens. The client paints each delta as it lands and reveals it with a
    writing animation, so the answer appears in well under a second instead
    of popping in after the full generation. Continuation stitching is not
    done here — a length-cut stream ends early and the client shows the
    incomplete-code warning, which the non-stream /explain path handles
    with stitched continuations."""
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

    # Open the stream before any bytes are flushed: 402/429/5xx from the
    # provider chain surface as a real status code the client can fall back
    # on, and the first delta is ready the moment 200 is sent.
    model, iterator = await _open_stream(model_chain, messages)

    async def events() -> AsyncIterator[str]:
        truncated = False
        try:
            async for kind, value in iterator:
                if kind == "delta":
                    if value:
                        yield _sse({"t": "delta", "text": _CUTOFF_MARKER.sub("", value)})
                else:
                    truncated = value == "length"
        except httpx.HTTPError:
            # Mid-stream provider hiccup: keep the partial answer; the client
            # flags it, same as any other incomplete reply.
            yield _sse({"t": "error", "message": "The connection dropped mid-answer."})
            return
        yield _sse({"t": "end", "model": model, "truncated": truncated})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
