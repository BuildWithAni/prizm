"""Credits + Pro plan (demo checkout).

The client identifies itself with an ``X-Client-Id`` header (a random id the
browser keeps in localStorage). Visualization costs 1 credit per trace; the
daily allowance depends on the plan. Checkout is a simulated payment — it
flips the plan flag instantly without touching any processor, and the UI
labels it as a demo.
"""

from __future__ import annotations

from fastapi import APIRouter, Header

from app import credits
from app.models import CheckoutRequest, CheckoutResponse, CreditStatus

router = APIRouter()


@router.get("/api/credits", response_model=CreditStatus)
def get_credits(x_client_id: str | None = Header(default=None)) -> CreditStatus:
    """Current plan, usage and time until the daily reset."""
    return CreditStatus(**credits.status(x_client_id))


@router.post("/api/billing/checkout", response_model=CheckoutResponse)
def checkout(request: CheckoutRequest,
             x_client_id: str | None = Header(default=None)) -> CheckoutResponse:
    """Activate Pro for the calling client (simulated payment — instant)."""
    status = credits.set_plan(x_client_id, "pro")
    return CheckoutResponse(
        status=status,
        message="Pro activated — your daily visualization allowance is now much larger.",
    )


@router.post("/api/billing/cancel", response_model=CheckoutResponse)
def cancel(request: CheckoutRequest,
           x_client_id: str | None = Header(default=None)) -> CheckoutResponse:
    """Drop back to the Free plan (demo only — nothing to cancel in real life)."""
    status = credits.set_plan(x_client_id, "free")
    return CheckoutResponse(status=status, message="Switched back to the Free plan.")
