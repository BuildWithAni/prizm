"""Environment-backed configuration.

Secrets (API keys) live in a `.env` file at the repo root — never in source.
`.env` is gitignored; only `TUTOR_MODEL`-style non-secret knobs are safe to
commit defaults for.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# services/api/app/config.py -> parents[3] == repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]
for candidate in (Path.cwd() / ".env", _REPO_ROOT / ".env"):
    if candidate.is_file():
        load_dotenv(candidate, override=False)
        break

# OpenRouter exposes an OpenAI-compatible chat-completions API.
OPENROUTER_API_KEY: str = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_URL: str = os.environ.get(
    "OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions"
)

# The flagship instruction-tuned model currently served by OpenRouter for the
# tutor (top price tier, 1M context). Override with TUTOR_MODEL to trade
# capability for cost/latency, e.g. "anthropic/claude-sonnet-5.5".
TUTOR_MODEL: str = os.environ.get("TUTOR_MODEL", "anthropic/claude-fable-5.1")
TUTOR_TIMEOUT_SECONDS: float = float(os.environ.get("TUTOR_TIMEOUT_SECONDS", "60"))

# Tried in order when the primary model is out of reach (credit-capped or
# unavailable). Comma-separated.
TUTOR_FALLBACK_MODELS: list[str] = [
    m.strip()
    for m in os.environ.get(
        "TUTOR_FALLBACK_MODELS",
        "anthropic/claude-sonnet-5.5,anthropic/claude-haiku-5.5",
    ).split(",")
    if m.strip()
]
