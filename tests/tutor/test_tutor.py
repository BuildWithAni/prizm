from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import tutor as tutor_module
from app.routes.tutor import StepContext, TutorRequest, _build_system, router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


# --- prompt assembly ---------------------------------------------------------


def test_build_system_embeds_source_and_trace_step() -> None:
    req = TutorRequest(
        question="why is total 6?",
        source="total = 0\nfor k in range(1, 4):\n    total += k\n",
        context=StepContext(
            line=3,
            function="<module>",
            event_kind="line",
            locals={"total": "6", "k": "3"},
            stdout="",
        ),
    )
    system = _build_system(req)
    assert "PRIZM AI Tutor" in system
    assert "total += k" in system
    assert "Highlighted line: 3" in system
    assert "`total` = `6`" in system
    assert "`k` = `3`" in system


def test_build_system_without_step_explains_generally() -> None:
    system = _build_system(TutorRequest(question="hi", source="x = 1"))
    assert "has not" in system  # "student has not run/selected a step"


# --- endpoint behaviour ------------------------------------------------------


def test_missing_key_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "")
    response = client.post(
        "/api/tutor/explain", json={"question": "what is a loop?"}
    )
    assert response.status_code == 503
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


def test_explain_happy_path_forwards_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {}

    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        captured["payload"] = payload
        captured["api_key"] = api_key
        return {
            "model": "anthropic/claude-fable-5.1",
            "choices": [
                {"message": {"role": "assistant", "content": "  Because `total` **6**.  "}}
            ],
        }

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)

    response = client.post(
        "/api/tutor/explain",
        json={
            "question": "why is total 6?",
            "source": "total += k",
            "language": "python",
            "context": {"line": 3, "locals": {"total": "6"}},
            "history": [{"role": "user", "content": "earlier question"}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "Because `total` **6**."
    assert body["model"] == "anthropic/claude-fable-5.1"
    assert body["truncated"] is False
    assert captured["api_key"] == "test-key"

    payload = captured["payload"]
    assert payload["model"] == tutor_module.TUTOR_MODEL
    assert payload["max_tokens"] == tutor_module._PER_CALL_MAX_TOKENS
    assert "```prizm" in payload["messages"][0]["content"]  # workspace-write protocol
    roles = [m["role"] for m in payload["messages"]]
    assert roles == ["system", "user", "user"]
    assert "earlier question" in payload["messages"][1]["content"]
    assert payload["messages"][2]["content"] == "why is total 6?"
    assert "Highlighted line: 3" in payload["messages"][0]["content"]


def test_explain_maps_upstream_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom(payload: dict, api_key: str) -> dict:
        raise tutor_module.httpx.ConnectError("nope")

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "TUTOR_FALLBACK_MODELS", [])  # single-model chain
    monkeypatch.setattr(tutor_module, "_post_chat", boom)
    response = client.post("/api/tutor/explain", json={"question": "hi"})
    assert response.status_code == 502
    assert "OpenRouter" in response.json()["detail"]


def test_transient_5xx_is_retried_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []

    async def flaky(payload: dict, api_key: str) -> dict:
        calls.append(payload)
        if len(calls) == 1:
            request = tutor_module.httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
            response = tutor_module.httpx.Response(503, request=request, text="upstream hiccup")
            raise tutor_module.httpx.HTTPStatusError("503", request=request, response=response)
        return {
            "model": payload["model"],
            "choices": [{"message": {"content": "recovered answer"}}],
        }

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", flaky)

    response = client.post("/api/tutor/explain", json={"question": "hi"})
    assert response.status_code == 200
    assert response.json()["answer"] == "recovered answer"
    assert len(calls) == 2
    assert calls[0]["model"] == calls[1]["model"]  # same model, transient retry


def test_explain_rejects_empty_question() -> None:
    assert client.post("/api/tutor/explain", json={"question": ""}).status_code == 422


def test_explain_rejects_bad_history_role() -> None:
    response = client.post(
        "/api/tutor/explain",
        json={"question": "hi", "history": [{"role": "system", "content": "x"}]},
    )
    assert response.status_code == 422


def _chat(content: str, finish: str | None = None) -> dict:
    choice: dict = {"message": {"content": content}}
    if finish is not None:
        choice["finish_reason"] = finish
    return {"model": "anthropic/claude-fable-5.1", "choices": [choice]}


def test_truncated_flag_follows_finish_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every slice cut off and continuations exhausted → still flagged."""

    calls: list[dict] = []

    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        calls.append(payload)
        return _chat("half an answer", finish="length")

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)

    response = client.post("/api/tutor/explain", json={"question": "hi"})
    assert response.status_code == 200
    assert response.json()["truncated"] is True
    # 1 initial call + _MAX_CONTINUATIONS continuation attempts, all cut off.
    assert len(calls) == 1 + tutor_module._MAX_CONTINUATIONS


def test_truncated_answer_is_stitched_by_continuation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A cut-off reply is resumed and joined into one complete answer."""

    calls: list[dict] = []

    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        calls.append(payload)
        if len(calls) == 1:
            return _chat("def add(a, b):\n    retu", finish="length")
        return _chat("rn a + b\n", finish="stop")

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)

    response = client.post("/api/tutor/explain", json={"question": "write add()"})
    assert response.status_code == 200
    body = response.json()
    # .strip() trims the trailing newline of the stitched whole.
    assert body["answer"] == "def add(a, b):\n    return a + b"
    assert body["truncated"] is False
    assert len(calls) == 2

    # The continuation call carries the partial reply and the resume instruction.
    continuation = calls[1]["messages"]
    assert continuation[-2]["role"] == "assistant"
    assert continuation[-2]["content"] == "def add(a, b):\n    retu"
    assert continuation[-1]["role"] == "user"
    assert "cut off at the token limit" in continuation[-1]["content"]
    assert "do not repeat" in continuation[-1]["content"]


def test_continuation_stops_after_max_rounds(monkeypatch: pytest.MonkeyPatch) -> None:
    """Endless cut-offs stop after the continuation budget, flagged truncated."""

    calls: list[dict] = []

    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        calls.append(payload)
        return _chat("x", finish="length")

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)

    response = client.post("/api/tutor/explain", json={"question": "hi"})
    assert response.status_code == 200
    assert response.json()["truncated"] is True
    assert len(calls) == 1 + tutor_module._MAX_CONTINUATIONS


def test_continuation_credit_exhaustion_keeps_partial_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If continuations run out of credits, the partial answer is still served."""

    calls: list[dict] = []

    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        calls.append(payload)
        if len(calls) == 1:
            return _chat("partial code her", finish="length")
        raise _credit_402("This request requires more credits.")

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)

    response = client.post("/api/tutor/explain", json={"question": "hi"})
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "partial code her"
    assert body["truncated"] is True


def test_openrouter_cutoff_marker_is_stripped(monkeypatch: pytest.MonkeyPatch) -> None:
    """OpenRouter's appended ⚠ notice never reaches the chat (or the code)."""

    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        return _chat(
            "answer text\n\n⚠ Cut off at the token limit — any code above may "
            "be incomplete. Ask for a shorter answer, or add OpenRouter "
            "credits for longer ones.\n",
            finish="stop",
        )

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)

    response = client.post("/api/tutor/explain", json={"question": "hi"})
    assert response.status_code == 200
    assert response.json()["answer"] == "answer text"
    assert "⚠" not in response.json()["answer"]


# --- credit-aware model fallback --------------------------------------------


def _credit_402(message: str) -> tutor_module.httpx.HTTPStatusError:
    request = tutor_module.httpx.Request(
        "POST", "https://openrouter.ai/api/v1/chat/completions"
    )
    response = tutor_module.httpx.Response(402, request=request, text=message)
    return tutor_module.httpx.HTTPStatusError("402", request=request, response=response)


def test_402_retries_same_model_within_credit_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []

    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        calls.append(payload)
        if len(calls) == 1:
            raise _credit_402(
                "This request requires more credits, or fewer max_tokens. "
                "You requested up to 900 tokens, but can only afford 250."
            )
        return {
            "model": payload["model"],
            "choices": [{"message": {"content": "budgeted answer"}}],
        }

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)

    response = client.post("/api/tutor/explain", json={"question": "why?"})
    assert response.status_code == 200
    assert response.json()["answer"] == "budgeted answer"
    assert len(calls) == 2
    assert calls[0]["max_tokens"] == tutor_module._PER_CALL_MAX_TOKENS
    assert calls[1]["max_tokens"] == 240  # affordable 250 - 10 headroom
    assert calls[0]["model"] == calls[1]["model"]  # same flagship, smaller budget


def test_402_falls_back_to_next_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []

    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        calls.append(payload)
        if payload["model"] == tutor_module.TUTOR_MODEL:
            raise _credit_402(
                "This request requires more credits. Please add credits to your account."
            )
        return {
            "model": payload["model"],
            "choices": [{"message": {"content": "fallback answer"}}],
        }

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)

    response = client.post("/api/tutor/explain", json={"question": "why?"})
    assert response.status_code == 200
    assert response.json()["answer"] == "fallback answer"
    assert len(calls) == 2
    assert calls[1]["model"] == tutor_module.TUTOR_FALLBACK_MODELS[0]


def test_all_models_credit_exhausted_returns_402(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        raise _credit_402("This request requires more credits.")

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)

    response = client.post("/api/tutor/explain", json={"question": "why?"})
    assert response.status_code == 402
    assert "credits" in response.json()["detail"]


def _rate_limited(retry_after: str | None = None) -> tutor_module.httpx.HTTPStatusError:
    request = tutor_module.httpx.Request(
        "POST", "https://openrouter.ai/api/v1/chat/completions"
    )
    headers = {"Retry-After": retry_after} if retry_after else {}
    response = tutor_module.httpx.Response(
        429, request=request, headers=headers, text="rate limited"
    )
    return tutor_module.httpx.HTTPStatusError("429", request=request, response=response)


def test_429_pauses_for_the_throttle_window(monkeypatch: pytest.MonkeyPatch) -> None:
    """A rate-limit is retried after a patient, server-requested pause —
    the sub-second transient backoff would just re-trip free-tier limits."""
    from types import SimpleNamespace

    calls: list[dict] = []
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        calls.append(payload)
        if len(calls) == 1:
            raise _rate_limited(retry_after="12")
        return _chat("recovered after the pause")

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)
    monkeypatch.setattr(tutor_module, "asyncio", SimpleNamespace(sleep=fake_sleep))

    response = client.post("/api/tutor/explain", json={"question": "hi"})
    assert response.status_code == 200
    assert response.json()["answer"] == "recovered after the pause"
    # First attempt waits out Retry-After — floored at 15s (a sub-15s header
    # just re-trips the free-tier window), capped at 30s.
    assert sleeps == [15.0]
    assert len(calls) == 2


def test_persistent_429_stops_sweeping_the_model_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two different models 429ing ⇒ IP-scoped throttle: abort with an
    honest rate-limit error instead of hammering every fallback."""
    from types import SimpleNamespace

    calls: list[dict] = []
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    async def fake_post_chat(payload: dict, api_key: str) -> dict:
        calls.append(payload)
        raise _rate_limited()

    monkeypatch.setattr(tutor_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(tutor_module, "_post_chat", fake_post_chat)
    monkeypatch.setattr(tutor_module, "asyncio", SimpleNamespace(sleep=fake_sleep))

    response = client.post("/api/tutor/explain", json={"question": "hi"})
    assert response.status_code == 429
    assert "rate-limiting" in response.json()["detail"]
    # One patient pause per model for the first two models (2 calls each);
    # the third is never touched — sweeping further extends the throttle.
    models_tried = [c["model"] for c in calls]
    assert len(models_tried) == 4
    assert len(set(models_tried)) == 2
    assert sleeps == [15.0, 15.0]
