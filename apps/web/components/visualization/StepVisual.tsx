"use client";

/**
 * StepVisual — High-impact animated visual theater for code execution.
 *
 * Every spec from buildStepVisual() becomes an animated graphic:
 * - Dynamic assignment pipeline with energy transfer beams
 * - Branch fork decision gates with glowing electrical paths
 * - Circular loop orbit tracks with rotating satellites & pip meters
 * - CRT cyberpunk terminal with animated print stream
 * - 3D call stack push/pop cards with flying return capsules
 */

import { motion, useReducedMotion } from "framer-motion";
import type { StepVisualSpec, VisualFrame, VisualToken } from "../../lib/step-story";

const KIND_LABEL: Record<StepVisualSpec["kind"], string> = {
  stack: "function call",
  return: "function return",
  expr: "assignment & computation",
  branch: "condition decision",
  loop: "loop iteration",
  print: "console output",
  error: "runtime exception",
  plain: "executing statement",
};

function Tokens({ tokens, reduce }: { tokens: VisualToken[]; reduce: boolean | null }) {
  return (
    <span className="sv-tokens">
      {tokens.map((t, i) =>
        t.t === "val" ? (
          <motion.span
            key={i}
            className={`sv-val sv-${t.vtype}`}
            title={t.name ? `${t.name} = ${t.s}` : t.s}
            initial={reduce ? false : { opacity: 0, y: 5, scale: 0.82 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.28, delay: 0.05 + i * 0.04 }}
          >
            {t.s}
          </motion.span>
        ) : (
          <span key={i} className="sv-code">
            {t.s}
          </span>
        ),
      )}
    </span>
  );
}

/** Stack drawn newest-on-top; active frame drops in with spring physics. */
function FrameStack({
  frames,
  activeIndex,
  popping,
  hiddenBelow,
}: {
  frames: VisualFrame[];
  activeIndex: number;
  popping?: boolean;
  hiddenBelow?: number;
}) {
  const visible = frames.slice(-4);
  const hidden = hiddenBelow ?? Math.max(0, frames.length - visible.length);
  const reversed = [...visible].reverse();

  return (
    <div className="sv-frames">
      {hidden > 0 && <div className="sv-frame-more">+{hidden} deeper frames below</div>}
      {reversed.map((f, i) => {
        const original = frames.length - 1 - i;
        const isActive = original === activeIndex;
        return (
          <motion.div
            key={`${f.name}-${original}`}
            className={
              "sv-frame" +
              (isActive ? (popping ? " active popping" : " active") : "")
            }
            initial={{ opacity: 0, y: -16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 450, damping: 25, delay: i * 0.06 }}
          >
            <span className="sv-frame-dot" aria-hidden="true" />
            <span className="sv-frame-name">{f.name === "<module>" ? "the program" : `${f.name}()`}</span>
            {f.line != null && <span className="sv-frame-line">line {f.line}</span>}
            {isActive && <span className="sv-frame-active-pill">{popping ? "popping" : "active"}</span>}
          </motion.div>
        );
      })}
    </div>
  );
}

/** Output produced by this step (tracers attach it to the recorded event). */
function PrintedChip({ text }: { text: string }) {
  return (
    <div className="sv-print-chip">
      <span className="sv-print-tag">stdout</span>
      <span className="sv-print-text">{text}</span>
    </div>
  );
}

export default function StepVisual({ spec }: { spec: StepVisualSpec }) {
  const reduce = useReducedMotion();

  let body: React.ReactNode = null;

  if (spec.kind === "stack") {
    body = (
      <div className="sv-theater-stack">
        {spec.printed && <PrintedChip text={spec.printed} />}
        {spec.args.length > 0 && (
          <div className="sv-args-panel">
            <span className="sv-args-title">Parameters Bound:</span>
            <div className="sv-args-list">
              {spec.args.map((arg, idx) => (
                <motion.div
                  key={arg.name}
                  className="sv-arg-card"
                  initial={reduce ? false : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + idx * 0.06 }}
                >
                  <span className="sv-arg-name">{arg.name}</span>
                  <span className="sv-arg-arrow">←</span>
                  <span className={`sv-val sv-${arg.vtype}`}>{arg.value}</span>
                </motion.div>
              ))}
            </div>
          </div>
        )}
        <FrameStack frames={spec.frames} activeIndex={spec.newFrameIndex} hiddenBelow={spec.hiddenBelow} />
      </div>
    );
  } else if (spec.kind === "return") {
    body = (
      <div className="sv-theater-return">
        {spec.printed && <PrintedChip text={spec.printed} />}
        {spec.value && (
          <motion.div
            className="sv-return-capsule"
            initial={reduce ? false : { opacity: 0, y: 18, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 20, delay: 0.1 }}
          >
            <div className="sv-capsule-badge">Returning Value</div>
            <div className="sv-capsule-value-row">
              <span className="sv-capsule-arrow">↩</span>
              <span className={`sv-value sv-${spec.vtype ?? "null"}`}>{spec.value}</span>
              {!spec.isModule && spec.caller && (
                <span className="sv-return-destination">
                  → to {spec.caller === "<module>" ? "main" : `${spec.caller}()`}
                  {spec.callerLine != null ? ` (line ${spec.callerLine})` : ""}
                </span>
              )}
            </div>
          </motion.div>
        )}
        <FrameStack
          frames={spec.frames}
          activeIndex={spec.returningIndex}
          popping={!spec.isModule}
        />
        {spec.isModule && <div className="sv-unwind">✔ Global scope completed — program finished execution</div>}
      </div>
    );
  } else if (spec.kind === "expr") {
    body = (
      <div className="sv-theater-expr">
        {/* Source expression with substituted live values */}
        <div className="sv-expr-top">
          <span className="sv-expr-label">Expression:</span>
          <Tokens tokens={spec.tokens} reduce={reduce} />
        </div>

        {/* Animated assignment transfer beam */}
        <div className="sv-assign-flow">
          {/* Target variable register */}
          <motion.div
            className="sv-target-vault"
            initial={reduce ? false : { scale: 0.95 }}
            animate={{ scale: [0.95, 1.05, 1] }}
            transition={{ duration: 0.35, delay: 0.3 }}
          >
            <span className="sv-vault-tag">VARIABLE</span>
            <span className="sv-vault-name">{spec.target}</span>
          </motion.div>

          {/* Transfer beam */}
          <div className="sv-beam-track" aria-hidden="true">
            <svg className="sv-beam-svg" viewBox="0 0 120 28" fill="none">
              <line x1="110" y1="14" x2="10" y2="14" stroke="rgba(56, 189, 248, 0.25)" strokeWidth="3" strokeDasharray="4 4" />
              {!reduce && (
                <motion.circle
                  r="5"
                  fill="#38bdf8"
                  animate={{ cx: [110, 10], opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
                  cy="14"
                />
              )}
            </svg>
            <span className="sv-beam-glyph">⟵</span>
          </div>

          {/* Evaluated Result */}
          <motion.div
            className="sv-result-vault"
            initial={reduce ? false : { scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 450, damping: 22, delay: 0.15 }}
          >
            <span className="sv-result-tag">COMPUTED RESULT</span>
            <span className={`sv-value sv-${spec.vtype ?? "null"}`}>
              {spec.result ?? "?"}
            </span>
          </motion.div>
        </div>
      </div>
    );
  } else if (spec.kind === "branch") {
    const isTrue = spec.result === true;
    const isFalse = spec.result === false;

    body = (
      <div className="sv-theater-branch">
        {/* Evaluated condition pill */}
        <div className="sv-branch-formula">
          <span className="sv-branch-label">Condition:</span>
          <Tokens tokens={spec.tokens} reduce={reduce} />
          <motion.span
            className={`sv-branch-outcome ${isTrue ? "outcome-true" : isFalse ? "outcome-false" : "outcome-unknown"}`}
            initial={reduce ? false : { scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 20, delay: 0.2 }}
          >
            → {isTrue ? "TRUE ✓" : isFalse ? "FALSE ✗" : "EVALUATING"}
          </motion.span>
        </div>

        {/* Animated 2-way fork */}
        <div className="sv-fork-grid">
          {/* True Path */}
          <motion.div
            className={`sv-fork-path path-true ${isTrue ? "is-taken" : isFalse ? "is-skipped" : ""}`}
            animate={isTrue ? { scale: [0.98, 1.02, 1] } : {}}
            transition={{ duration: 0.35 }}
          >
            <div className="sv-fork-head">
              <span className="sv-fork-icon">{isTrue ? "✓" : "○"}</span>
              <span className="sv-fork-title">{spec.isLoop ? "Continue Loop" : "Take If-Branch"}</span>
              {isTrue && <span className="sv-taken-pill">PATH TAKEN</span>}
            </div>
            <p className="sv-fork-desc">
              {spec.isLoop ? "Condition passed: body runs again" : "Condition passed: execution enters this block"}
            </p>
          </motion.div>

          {/* False Path */}
          <motion.div
            className={`sv-fork-path path-false ${isFalse ? "is-taken" : isTrue ? "is-skipped" : ""}`}
            animate={isFalse ? { scale: [0.98, 1.02, 1] } : {}}
            transition={{ duration: 0.35 }}
          >
            <div className="sv-fork-head">
              <span className="sv-fork-icon">{isFalse ? "✓" : "○"}</span>
              <span className="sv-fork-title">{spec.isLoop ? "Exit Loop" : "Skip Branch"}</span>
              {isFalse && <span className="sv-taken-pill">PATH TAKEN</span>}
            </div>
            <p className="sv-fork-desc">
              {spec.isLoop ? "Condition is false: loops ends, continues after" : "Condition failed: block is bypassed"}
            </p>
          </motion.div>
        </div>
      </div>
    );
  } else if (spec.kind === "loop") {
    const pips = Math.min(spec.total ?? Math.max(spec.visited, 4), 12);

    body = (
      <div className="sv-theater-loop">
        {/* Orbital loop progress visual */}
        <div className="sv-loop-orbit-container">
          <div className="sv-orbit-graphic" aria-hidden="true">
            <svg viewBox="0 0 90 90" className="sv-orbit-svg">
              <circle cx="45" cy="45" r="36" className="sv-orbit-base" />
              <circle
                cx="45"
                cy="45"
                r="36"
                className="sv-orbit-dash"
                strokeDasharray="226"
                strokeDashoffset={spec.total ? 226 - (226 * Math.min(spec.visited, spec.total)) / spec.total : 150}
              />
              {!reduce && (
                <circle cx="45" cy="9" r="4.5" className="sv-orbit-satellite">
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 45 45"
                    to="360 45 45"
                    dur="3s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
            </svg>
            <div className="sv-orbit-center">
              <span className="sv-orbit-num">{spec.visited}</span>
              <span className="sv-orbit-lbl">pass</span>
            </div>
          </div>

          <div className="sv-loop-details">
            <div className="sv-loop-assign">
              <span className="sv-loop-tag">ACTIVE ITEM</span>
              <div className="sv-loop-val-row">
                <span className="sv-loop-target">{spec.target}</span>
                <span className="sv-loop-eq">=</span>
                <span className={`sv-value sv-${spec.vtype ?? "null"}`}>{spec.value ?? "?"}</span>
              </div>
            </div>

            {/* Pips */}
            <div className="sv-pips-row">
              <div className="sv-pips">
                {Array.from({ length: pips }, (_, i) => (
                  <span
                    key={i}
                    className={
                      "sv-pip" +
                      (i + 1 < spec.visited ? " done" : "") +
                      (i + 1 === spec.visited ? " now" : "")
                    }
                  />
                ))}
              </div>
              <span className="sv-pips-caption">
                iteration {spec.visited}
                {spec.total ? ` of ${spec.total}` : ""}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  } else if (spec.kind === "print") {
    body = (
      <div className="sv-theater-print">
        <div className="sv-terminal-bar">
          <span className="sv-term-dot red" />
          <span className="sv-term-dot yellow" />
          <span className="sv-term-dot green" />
          <span className="sv-term-title">terminal stdout</span>
        </div>
        <div className="sv-terminal-body">
          <span className="sv-term-prompt">▸</span>
          {spec.text ? (
            <motion.span
              className="sv-term-printed"
              initial={reduce ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
            >
              {spec.text}
            </motion.span>
          ) : (
            <span className="sv-term-pending">
              <Tokens tokens={spec.tokens ?? []} reduce={reduce} />
            </span>
          )}
          <span className="sv-term-cursor" aria-hidden="true" />
        </div>
      </div>
    );
  } else if (spec.kind === "error") {
    body = (
      <div className="sv-theater-error">
        {spec.printed && <PrintedChip text={spec.printed} />}
        <motion.div
          className="sv-error-banner"
          initial={reduce ? false : { scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 450, damping: 18 }}
        >
          <span className="sv-error-icon" aria-hidden="true">⚠</span>
          <div className="sv-error-text">
            <strong>{spec.type}</strong>
            {spec.message && <span>: {spec.message}</span>}
          </div>
        </motion.div>
        <FrameStack frames={spec.frames} activeIndex={-1} />
        <div className="sv-unwind">↑ Unwinding stack — exception bubbles to top</div>
      </div>
    );
  } else {
    body = (
      <div className="sv-theater-plain">
        <Tokens tokens={spec.tokens} reduce={reduce} />
      </div>
    );
  }

  return (
    <div className={`journey-visual sv-kind-${spec.kind}`}>
      <div className="sv-kind-header">
        <span className="sv-kind-badge">{KIND_LABEL[spec.kind]}</span>
      </div>
      {body}
    </div>
  );
}
