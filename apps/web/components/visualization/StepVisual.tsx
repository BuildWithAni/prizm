"use client";

/**
 * StepVisual — the animated micro-diagram inside the Journey card.
 *
 * Every spec from buildStepVisual() becomes a small picture of the step:
 * stack push/pop with real argument chips, assignments with identifiers
 * substituted by live values, condition forks with the taken path lit,
 * loop iteration pips, prints, and exception unwinding. Colors follow the
 * step kind via --cfg-* custom properties set on the journey panel.
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { StepVisualSpec, VisualFrame, VisualToken } from "../../lib/step-story";

const KIND_LABEL: Record<StepVisualSpec["kind"], string> = {
  stack: "stack push",
  return: "returning",
  expr: "assignment",
  branch: "condition",
  loop: "loop pass",
  print: "output",
  error: "exception",
  plain: "statement",
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
            initial={reduce ? false : { opacity: 0, y: 5, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.28, delay: 0.08 + i * 0.045 }}
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

/** Stack drawn newest-on-top; the active frame slides in, a popping frame fades up. */
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
      {hidden > 0 && <div className="sv-frame-more">+{hidden} deeper</div>}
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
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, delay: i * 0.06, ease: "easeOut" }}
          >
            <span className="sv-frame-name">{f.name === "<module>" ? "the program" : `${f.name}()`}</span>
            {f.line != null && <span className="sv-frame-line">L{f.line}</span>}
          </motion.div>
        );
      })}
    </div>
  );
}

/** Output produced by this step (tracers attach it to the recorded event). */
function PrintedChip({ text }: { text: string }) {
  return (
    <div className="sv-print sv-print-inline">
      <span className="sv-print-glyph" aria-hidden="true">
        ▸
      </span>
      <span className="sv-print-text">{text}</span>
    </div>
  );
}

export default function StepVisual({ spec }: { spec: StepVisualSpec }) {
  const reduce = useReducedMotion();

  let body: React.ReactNode = null;

  if (spec.kind === "stack") {
    body = (
      <>
        {spec.printed && <PrintedChip text={spec.printed} />}
        {spec.args.length > 0 && (
          <div className="sv-args">
            {spec.args.map((arg) => (
              <span key={arg.name} className="sv-arg">
                <i>{arg.name}</i>
                <b className={`sv-val sv-${arg.vtype}`}>{arg.value}</b>
              </span>
            ))}
          </div>
        )}
        <FrameStack frames={spec.frames} activeIndex={spec.newFrameIndex} hiddenBelow={spec.hiddenBelow} />
      </>
    );
  } else if (spec.kind === "return") {
    body = (
      <>
        {spec.printed && <PrintedChip text={spec.printed} />}
        {spec.value && (
          <div className="sv-return-row">
            <motion.span
              className={`sv-value sv-${spec.vtype ?? "null"}`}
              initial={reduce ? false : { opacity: 0, y: 12, scale: 0.8 }}
              animate={{ opacity: 1, y: [0, -3, 0], scale: 1 }}
              transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
            >
              → {spec.value}
            </motion.span>
            {!spec.isModule && spec.caller && (
              <span className="sv-return-to">
                back to {spec.caller === "<module>" ? "the program" : `${spec.caller}()`}
                {spec.callerLine != null ? ` · L${spec.callerLine}` : ""}
              </span>
            )}
          </div>
        )}
        <FrameStack
          frames={spec.frames}
          activeIndex={spec.returningIndex}
          popping={!spec.isModule}
        />
        {spec.isModule && <div className="sv-unwind">the global frame ends — program finished</div>}
      </>
    );
  } else if (spec.kind === "expr") {
    body = (
      <>
        <div className="sv-expr-line">
          <span className="sv-target">{spec.target}</span>
          <span className="sv-op">{spec.op}</span>
          <Tokens tokens={spec.tokens} reduce={reduce} />
        </div>
        {spec.result && (
          <motion.div
            className="sv-result-row"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.5 }}
          >
            <span className="sv-arrow">=</span>
            <span className={`sv-value sv-${spec.vtype ?? "null"}`}>{spec.result}</span>
          </motion.div>
        )}
      </>
    );
  } else if (spec.kind === "branch") {
    body = (
      <>
        <div className="sv-fork-cond">
          <Tokens tokens={spec.tokens} reduce={reduce} />
        </div>
        <div className="sv-paths">
          <div className={`sv-path${spec.result === true ? " on" : spec.result === null ? " unknown" : ""}`}>
            <span className="sv-path-tag">{spec.isLoop ? "↺ loop back" : "✓ true"}</span>
            <span className="sv-path-note">
              {spec.isLoop ? "the body runs again" : "the body below it runs"}
            </span>
          </div>
          <div className={`sv-path${spec.result === false ? " on" : spec.result === null ? " unknown" : ""}`}>
            <span className="sv-path-tag">{spec.isLoop ? "↪ exit loop" : "✗ false"}</span>
            <span className="sv-path-note">
              {spec.isLoop ? "execution continues after the loop" : "the body is skipped this time"}
            </span>
          </div>
        </div>
      </>
    );
  } else if (spec.kind === "loop") {
    const pips = Math.min(spec.total ?? Math.max(spec.visited, 4), 12);
    body = (
      <>
        <div className="sv-loop-row">
          <span className="sv-target">{spec.target}</span>
          <span className="sv-op">=</span>
          {spec.value ? (
            <span className={`sv-value sv-${spec.vtype ?? "null"}`}>{spec.value}</span>
          ) : (
            <span className="sv-value sv-null">?</span>
          )}
          <Tokens tokens={spec.seq} reduce={reduce} />
        </div>
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
        <div className="sv-count">
          pass {spec.visited}
          {spec.total != null ? ` of ${spec.total}` : ""}
          {spec.total != null && spec.total > 12 ? " (first 12 shown)" : ""}
        </div>
      </>
    );
  } else if (spec.kind === "print") {
    body = (
      <div className="sv-print">
        <span className="sv-print-glyph" aria-hidden="true">
          ▸
        </span>
        {spec.text ? (
          <span className="sv-print-text">{spec.text}</span>
        ) : (
          <span className="sv-print-pending">
            <Tokens tokens={spec.tokens ?? []} reduce={reduce} />
            <i> writes to the console</i>
          </span>
        )}
      </div>
    );
  } else if (spec.kind === "error") {
    body = (
      <>
        {spec.printed && <PrintedChip text={spec.printed} />}
        <div className="sv-error-pill">
          <span aria-hidden="true">⚠</span>
          <span>
            {spec.type}
            {spec.message ? `: ${spec.message}` : ""}
          </span>
        </div>
        <FrameStack frames={spec.frames} activeIndex={-1} />
        <div className="sv-unwind">↑ unwinding the stack — no handler catches it</div>
      </>
    );
  } else {
    body = <Tokens tokens={spec.tokens} reduce={reduce} />;
  }

  return (
    <div
      className={`journey-visual journey-seg sv-${spec.kind}`}
      style={{ animationDelay: "0.09s" }}
    >
      <div className="sv-kind">{KIND_LABEL[spec.kind]}</div>
      {body}
    </div>
  );
}
