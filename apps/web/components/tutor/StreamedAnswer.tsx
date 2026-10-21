"use client";

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";

import Markdown from "../../lib/markdown";

/**
 * Renders a tutor answer that grows line by line — the "writing" animation.
 *
 * The full text arrives from the streaming endpoint (or all at once from the
 * fallback); this component reveals it at a steady pace that always trails
 * the incoming text, so lines appear as if being typed. Each tick closes
 * ~5% of the remaining gap: short answers land line by line, long ones
 * finish in ~2 seconds. A "Show full answer" button skips ahead, and
 * reduced-motion users get the complete text immediately.
 */
export default function StreamedAnswer({
  text,
  streaming,
  onApplyCode,
  onGrow,
}: {
  text: string;
  /** The message is still receiving tokens from the server. */
  streaming: boolean;
  onApplyCode?: (code: string) => void;
  /** Called whenever more of the answer becomes visible (auto-scroll hook). */
  onGrow?: () => void;
}) {
  const reduce = useReducedMotion();
  const total = useMemo(
    () => text.replace(/\r\n/g, "\n").split("\n").length,
    [text],
  );
  const [revealed, setRevealed] = useState<number>(() =>
    reduce ? Number.POSITIVE_INFINITY : 0,
  );

  // Writing pace: reveal ~1/20th of the remaining lines every 50ms.
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      setRevealed((r) => {
        if (!Number.isFinite(r) || r >= total) return r;
        return r + Math.max(1, Math.ceil((total - r) / 20));
      });
    }, 50);
    return () => window.clearInterval(id);
  }, [reduce, total]);

  // Keep the transcript pinned while the answer grows.
  useEffect(() => {
    onGrow?.();
  }, [revealed, text, onGrow]);

  const finite = Number.isFinite(revealed);
  // "pending" alone is true for the brief empty-text mount before the first
  // tick — gate the visible writing state on real content so the skip button
  // never flashes for an empty answer.
  const revealing = finite && revealed < total && text.trim().length > 0;

  return (
    <div className={`tutor-answer${revealing ? " writing" : ""}`}>
      <Markdown
        text={text}
        revealLines={finite ? revealed : undefined}
        streaming={revealing || streaming}
        onApplyCode={onApplyCode}
      />
      {revealing && (
        <button
          type="button"
          className="tutor-skip"
          onClick={() => setRevealed(Number.POSITIVE_INFINITY)}
        >
          Show full answer ↓
        </button>
      )}
    </div>
  );
}
