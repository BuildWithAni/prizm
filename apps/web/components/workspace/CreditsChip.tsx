"use client";

import Link from "next/link";
import { useCredits } from "./CreditsProvider";

/**
 * Compact plan + allowance indicator for the workspace topbars.
 *
 * Free accounts see the remaining visualizations for today and an Upgrade
 * link; Pro accounts see a filled PRO badge. Nothing else is metered, so the
 * chip only ever talks about visualization credits.
 */
export default function CreditsChip() {
  const { status, outOfCredits } = useCredits();
  if (!status) return null; // discovery pending or API unreachable — stay quiet

  if (status.plan === "pro") {
    return (
      <span className="credits-chip credits-chip-pro" title={`PRO plan · ${status.remaining} visualizations left today`}>
        <span className="credits-pro-badge">PRO</span>
        <span className="credits-count">{Math.max(status.remaining, 0)}/{status.limit}</span>
      </span>
    );
  }

  return (
    <span
      className={`credits-chip${outOfCredits ? " credits-chip-empty" : ""}`}
      title={`Free plan · ${status.remaining} of ${status.limit} visualizations left today · resets at midnight`}
    >
      <span className="credits-bolt" aria-hidden="true">⚡</span>
      <span className="credits-count">
        {Math.max(status.remaining, 0)}/{status.limit}
      </span>
      <Link href="/pricing" className="credits-upgrade" title="Get Pro for a much larger daily allowance">
        Upgrade
      </Link>
    </span>
  );
}
