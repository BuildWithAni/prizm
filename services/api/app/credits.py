"""Daily visualization credits — the metering layer behind Free vs Pro.

Every step-through trace costs 1 credit. Free accounts get a fresh batch every
day; Pro raises the daily allowance. Running code (sessions), the console and
the AI tutor are NOT metered — only visualization is.

There is no auth system in this MVP, so an account is identified by a client-
generated id sent in the ``X-Client-Id`` header (persisted in the browser's
localStorage). State lives in a small SQLite file so counters survive API
restarts. Daily reset happens lazily on read: when the stored day is behind
the local date, the used counter rolls over — no cron needed.

Set ``PRIZM_CREDITS_DB`` to relocate the database (tests use a temp file).
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timedelta, timezone, tzinfo
from pathlib import Path
from typing import Any

FREE_DAILY_CREDITS = 5
PRO_DAILY_CREDITS = 30

_CLIENT_ID_RE = re.compile(r"[^A-Za-z0-9_-]")
ANONYMOUS_CLIENT = "anonymous"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS credits (
    client_id TEXT PRIMARY KEY,
    plan      TEXT NOT NULL DEFAULT 'free',
    used      INTEGER NOT NULL DEFAULT 0,
    day       TEXT NOT NULL
);
"""

# Asia/Calcutta is the operator's zone; harmless elsewhere (pure offset math).
try:
    _LOCAL_TZ: tzinfo = timezone(timedelta(hours=5, minutes=30), name="Asia/Calcutta")
except Exception:  # pragma: no cover - exotic platforms
    _LOCAL_TZ = timezone.utc

_write_lock = threading.Lock()


def _db_path() -> Path:
    configured = os.getenv("PRIZM_CREDITS_DB", "").strip()
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[1] / "data" / "credits.db"


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(path), timeout=10)
    # Autocommit: every writer holds the process lock, and `closing()` manages
    # the handle lifecycle, so per-statement commits are both safe and simple.
    connection.isolation_level = None
    connection.execute(_SCHEMA)
    return connection


def sanitize_client_id(raw: str | None) -> str:
    """Fold a caller-supplied id into a safe bucket key."""
    if not raw:
        return ANONYMOUS_CLIENT
    cleaned = _CLIENT_ID_RE.sub("", raw.strip())[:64]
    return cleaned or ANONYMOUS_CLIENT


def _today() -> str:
    return datetime.now(_LOCAL_TZ).date().isoformat()


def _resets_at() -> str:
    """ISO timestamp of the next local midnight (when credits refresh)."""
    now = datetime.now(_LOCAL_TZ)
    next_midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return next_midnight.isoformat()


def _limit_for(plan: str) -> int:
    return PRO_DAILY_CREDITS if plan == "pro" else FREE_DAILY_CREDITS


def _load_row(connection: sqlite3.Connection, client_id: str) -> sqlite3.Row | None:
    connection.row_factory = sqlite3.Row
    return connection.execute(
        "SELECT client_id, plan, used, day FROM credits WHERE client_id = ?", (client_id,)
    ).fetchone()


def _ensure_row(connection: sqlite3.Connection, client_id: str) -> sqlite3.Row:
    row = _load_row(connection, client_id)
    if row is None:
        connection.execute(
            "INSERT INTO credits (client_id, plan, used, day) VALUES (?, 'free', 0, ?)",
            (client_id, _today()),
        )
        row = _load_row(connection, client_id)
    assert row is not None
    # Lazy daily reset: a new local day starts a fresh allowance.
    if row["day"] != _today():
        connection.execute("UPDATE credits SET used = 0, day = ? WHERE client_id = ?",
                           (_today(), client_id))
        row = _load_row(connection, client_id)
        assert row is not None
    return row


def status(client_id: str | None) -> dict[str, Any]:
    """Current plan + usage for a client (idempotent, creates the row)."""
    client_id = sanitize_client_id(client_id)
    with _write_lock, closing(_connect()) as connection:
        row = _ensure_row(connection, client_id)
        limit = _limit_for(row["plan"])
        used = int(row["used"])
        return {
            "client_id": client_id,
            "plan": row["plan"],
            "used": used,
            "limit": limit,
            "remaining": max(limit - used, 0),
            "resets_at": _resets_at(),
        }


def charge(client_id: str | None, cost: int = 1) -> tuple[bool, dict[str, Any]]:
    """Spend credits. Returns (allowed, status) — allowed=False when broke.

    Atomic within the lock: the allowance check and the increment happen
    together, so parallel tabs can't overdraw the daily limit.
    """
    client_id = sanitize_client_id(client_id)
    with _write_lock, closing(_connect()) as connection:
        row = _ensure_row(connection, client_id)
        limit = _limit_for(row["plan"])
        used = int(row["used"])
        if used + cost > limit:
            return False, {
                "client_id": client_id,
                "plan": row["plan"],
                "used": used,
                "limit": limit,
                "remaining": max(limit - used, 0),
                "resets_at": _resets_at(),
            }
        connection.execute("UPDATE credits SET used = used + ? WHERE client_id = ?", (cost, client_id))
        return True, {
            "client_id": client_id,
            "plan": row["plan"],
            "used": used + cost,
            "limit": limit,
            "remaining": max(limit - used - cost, 0),
            "resets_at": _resets_at(),
        }


def refund(client_id: str | None, cost: int = 1) -> None:
    """Give credits back (used when the tracer could not actually run)."""
    client_id = sanitize_client_id(client_id)
    with _write_lock, closing(_connect()) as connection:
        connection.execute(
            "UPDATE credits SET used = MAX(used - ?, 0) WHERE client_id = ?",
            (cost, client_id),
        )


def set_plan(client_id: str | None, plan: str) -> dict[str, Any]:
    """Activate or cancel Pro (demo checkout — no payment processor)."""
    if plan not in ("free", "pro"):
        raise ValueError(f"unknown plan: {plan}")
    client_id = sanitize_client_id(client_id)
    with _write_lock, closing(_connect()) as connection:
        _ensure_row(connection, client_id)
        connection.execute("UPDATE credits SET plan = ? WHERE client_id = ?", (plan, client_id))
    return status(client_id)


def _age_rows(days: int) -> None:  # pragma: no cover - exercised via tests by direct day rewrite
    """Test helper: pretend every row was last seen `days` days ago."""
    old_day = (datetime.now(_LOCAL_TZ).date() - timedelta(days=days)).isoformat()
    with _write_lock, closing(_connect()) as connection:
        connection.execute("UPDATE credits SET day = ?", (old_day,))
