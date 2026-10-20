"""Credits metering + the Free/Pro plan flow.

Each test runs against a fresh temp database (PRIZM_CREDITS_DB), so the
counters never leak between tests or touch the machine-local file.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fastapi import Response


@pytest.fixture()
def client(tmp_path: Path):
    """TestClient with an isolated credits database per test."""
    os.environ["PRIZM_CREDITS_DB"] = str(tmp_path / "credits.db")
    try:
        # Import inside the fixture so the env var lands before any module
        # resolves a path (the db path is read lazily per connection).
        from app.main import app

        with TestClient(app) as test_client:
            yield test_client
    finally:
        os.environ.pop("PRIZM_CREDITS_DB", None)


def _trace(client: TestClient, client_id: str | None = None) -> Response:
    headers = {"X-Client-Id": client_id} if client_id else {}
    return client.post(
        "/api/executions",
        json={"language": "python", "source": "print('hi')"},
        headers=headers,
    )


def test_anonymous_status_defaults_to_free_batch(client: TestClient):
    response = client.get("/api/credits")
    assert response.status_code == 200
    body = response.json()
    assert body["plan"] == "free"
    assert body["limit"] == 20
    assert body["used"] == 0
    assert body["remaining"] == 20
    assert body["resets_at"]


def test_trace_costs_one_credit_per_client(client: TestClient):
    first = _trace(client, "alice")
    assert first.status_code == 200

    status = client.get("/api/credits", headers={"X-Client-Id": "alice"}).json()
    assert status["used"] == 1
    assert status["remaining"] == 19

    # A different browser bucket keeps its own allowance.
    other = client.get("/api/credits", headers={"X-Client-Id": "bob"}).json()
    assert other["used"] == 0


def test_exhausted_allowment_returns_402(client: TestClient):
    # Drain the free batch directly, then try one more visualization.
    from app import credits

    for _ in range(credits.FREE_DAILY_CREDITS):
        assert _trace(client, "carol").status_code == 200

    blocked = _trace(client, "carol")
    assert blocked.status_code == 402
    assert "credits" in blocked.json()["detail"].lower()

    # Nothing was charged for the refused request.
    status = client.get("/api/credits", headers={"X-Client-Id": "carol"}).json()
    assert status["used"] == credits.FREE_DAILY_CREDITS
    assert status["remaining"] == 0


def test_checkout_activates_pro_and_raises_the_limit(client: TestClient):
    from app import credits

    # Burn the whole free batch first so Pro is the only way to keep tracing.
    for _ in range(credits.FREE_DAILY_CREDITS):
        assert _trace(client, "dave").status_code == 200
    assert _trace(client, "dave").status_code == 402

    checkout = client.post(
        "/api/billing/checkout",
        json={"plan": "pro", "card_number": "4242 4242 4242 4242"},
        headers={"X-Client-Id": "dave"},
    )
    assert checkout.status_code == 200
    status = checkout.json()["status"]
    assert status["plan"] == "pro"
    assert status["limit"] == credits.PRO_DAILY_CREDITS

    # Still usable immediately — the same day, same usage counter.
    assert _trace(client, "dave").status_code == 200


def test_cancel_returns_to_free_plan(client: TestClient):
    client.post("/api/billing/checkout", json={"plan": "pro"},
                headers={"X-Client-Id": "erin"})
    cancelled = client.post("/api/billing/cancel", json={},
                            headers={"X-Client-Id": "erin"})
    assert cancelled.status_code == 200
    assert cancelled.json()["status"]["plan"] == "free"
    assert cancelled.json()["status"]["limit"] == 20


def test_daily_rollover_resets_the_counter(client: TestClient):
    from app import credits

    for _ in range(credits.FREE_DAILY_CREDITS):
        assert _trace(client, "frank").status_code == 200
    assert _trace(client, "frank").status_code == 402

    # Pretend the batch was last seen yesterday -> lazy reset on next read.
    credits._age_rows(days=1)

    status = client.get("/api/credits", headers={"X-Client-Id": "frank"}).json()
    assert status["used"] == 0
    assert status["remaining"] == credits.FREE_DAILY_CREDITS
    assert _trace(client, "frank").status_code == 200


def test_toolchain_failure_refunds_the_credit(client: TestClient):
    # PHP is valid but run-only: the trace request can never reach an engine,
    # so the credit must be given back instead of draining the daily batch.
    response = client.post(
        "/api/executions",
        json={"language": "php", "source": "<?php echo 1;"},
        headers={"X-Client-Id": "grace"},
    )
    assert response.status_code == 200  # the request itself succeeded
    body = response.json()
    assert body["status"] == "crashed"  # but nothing ran
    assert body["error"]["type"] == "UnsupportedLanguage"

    status = client.get("/api/credits", headers={"X-Client-Id": "grace"}).json()
    assert status["used"] == 0, "a trace that never ran must not cost a credit"


def test_client_id_is_sanitized(client: TestClient):
    from app import credits

    assert credits.sanitize_client_id(None) == credits.ANONYMOUS_CLIENT
    assert credits.sanitize_client_id("  ") == credits.ANONYMOUS_CLIENT
    assert credits.sanitize_client_id("ab;<script>") == "abscript"
    assert credits.sanitize_client_id("x" * 200) == "x" * 64
