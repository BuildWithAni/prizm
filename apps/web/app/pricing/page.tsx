"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "../../components/landing/Logo";
import CreditsChip from "../../components/workspace/CreditsChip";
import { CreditsProvider, useCredits } from "../../components/workspace/CreditsProvider";
import { cancelPro, checkoutPro } from "../../lib/api";

/**
 * Plans & pricing — Free vs Pro.
 *
 * Visualizing a program costs 1 credit from a daily allowance; Pro raises
 * that allowance. The checkout is a simulation (this MVP has no payment
 * processor) and says so right on the form.
 */

const FREE_FEATURES = [
  { text: "20 visualizations per day", included: true },
  { text: "Run code in 13 languages", included: true },
  { text: "Live HTML preview", included: true },
  { text: "AI tutor", included: true },
  { text: "Full trace playback, call stack, variables", included: true },
];

const PRO_FEATURES = [
  { text: "500 visualizations per day", included: true },
  { text: "Everything in Free", included: true },
  { text: "Priority tracing on heavy programs", included: true },
  { text: "Pro badge in the workspace", included: true },
  { text: "Supports the project", included: true },
];

function PricingContent() {
  const credits = useCredits();
  const [showCheckout, setShowCheckout] = useState(false);
  const [phase, setPhase] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const isPro = credits.status?.plan === "pro";

  const buy = async () => {
    setPhase("submitting");
    setError(null);
    try {
      await checkoutPro();
      await credits.refresh();
      setPhase("done");
      setShowCheckout(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase("error");
    }
  };

  const downgrade = async () => {
    try {
      await cancelPro();
      await credits.refresh();
    } catch {
      /* keep the current state — the next refresh corrects it */
    }
  };

  return (
    <div className="pricing-page">
      <header className="topbar">
        <Link href="/" className="brand" title="Back to home">
          <Logo size={24} showWord />
        </Link>
        <span className="topbar-kicker">Pricing</span>
        <div className="topbar-right">
          <CreditsChip />
          <Link href="/editor" className="btn btn-ghost">
            ✎ Editor
          </Link>
        </div>
      </header>

      <main className="pricing-main">
        <h1 className="pricing-title">Visualize without limits</h1>
        <p className="pricing-sub">
          Stepping through a program costs <strong>1 credit</strong> from your daily allowance. Running code, the
          console and the AI tutor are free on every plan.
        </p>

        <div className="pricing-grid">
          <section className="plan-card">
            <header className="plan-head">
              <span className="plan-name">Free</span>
              <span className="plan-price">
                $0<span className="plan-period">/forever</span>
              </span>
            </header>
            <ul className="plan-features">
              {FREE_FEATURES.map((feature) => (
                <li key={feature.text} className="plan-feature">
                  <span className="plan-check" aria-hidden="true">
                    ✓
                  </span>
                  {feature.text}
                </li>
              ))}
            </ul>
            {!isPro && (
              <span className="plan-current" title="Your current plan">
                Current plan · {credits.status?.remaining ?? "—"} left today
              </span>
            )}
          </section>

          <section className={`plan-card plan-card-pro${isPro ? " plan-card-active" : ""}`}>
            <span className="plan-ribbon">MOST POWERFUL</span>
            <header className="plan-head">
              <span className="plan-name">
                Pro <span className="credits-pro-badge">PRO</span>
              </span>
              <span className="plan-price">
                $4.99<span className="plan-period">/month</span>
              </span>
            </header>
            <ul className="plan-features">
              {PRO_FEATURES.map((feature) => (
                <li key={feature.text} className="plan-feature">
                  <span className="plan-check" aria-hidden="true">
                    ✓
                  </span>
                  {feature.text}
                </li>
              ))}
            </ul>
            {isPro ? (
              <div className="plan-active-block">
                <span className="plan-current plan-current-pro">
                  You&apos;re on Pro · {credits.status?.remaining ?? "—"} left today
                </span>
                <button type="button" className="btn btn-ghost" onClick={downgrade} title="Demo: switch back to Free">
                  Switch to Free (demo)
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-solid plan-buy"
                onClick={() => setShowCheckout(true)}
                disabled={phase === "submitting"}
              >
                {phase === "submitting" ? "Activating…" : "⚡ Buy Pro"}
              </button>
            )}
          </section>
        </div>

        <p className="pricing-footnote">
          No sign-up needed — your plan follows this browser. Checkout is simulated in this demo build: nothing is
          charged and activation is instant.
        </p>
      </main>

      {showCheckout && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Checkout">
          <div className="modal">
            <header className="modal-head">
              <span>Checkout · Pro plan</span>
              <button type="button" className="btn btn-ghost" onClick={() => setShowCheckout(false)}>
                ✕
              </button>
            </header>
            <div className="modal-body">
              <label className="modal-field">
                <span>Name on card</span>
                <input className="modal-input" placeholder="Ada Lovelace" autoComplete="off" />
              </label>
              <label className="modal-field">
                <span>Card number</span>
                <input className="modal-input" placeholder="4242 4242 4242 4242" inputMode="numeric" autoComplete="off" />
              </label>
              <div className="modal-row">
                <label className="modal-field">
                  <span>Expiry</span>
                  <input className="modal-input" placeholder="12 / 29" autoComplete="off" />
                </label>
                <label className="modal-field">
                  <span>CVC</span>
                  <input className="modal-input" placeholder="123" inputMode="numeric" autoComplete="off" />
                </label>
              </div>
              <p className="modal-note">
                Demo checkout — no real payment is processed and the card fields are ignored. Your Pro allowance
                activates the moment you confirm.
              </p>
              {phase === "error" && <p className="modal-error">{error}</p>}
              <button type="button" className="btn btn-solid modal-confirm" onClick={buy} disabled={phase === "submitting"}>
                {phase === "submitting" ? "Activating Pro…" : "Confirm — $4.99/mo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="toast" role="status">
          ⚡ Pro activated — {credits.status?.limit ?? 500} visualizations a day.
        </div>
      )}
    </div>
  );
}

export default function PricingPage() {
  return (
    <CreditsProvider>
      <PricingContent />
    </CreditsProvider>
  );
}
