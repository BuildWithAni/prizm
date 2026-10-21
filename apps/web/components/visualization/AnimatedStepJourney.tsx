"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { SerializedValue, TraceEvent } from "../../lib/types";
import { formatValue } from "../../lib/format";
import { buildStepStory, buildStepVisual, frameDeltas, frameLabel, type VarDelta } from "../../lib/step-story";
import { useStepInsight } from "../../hooks/useStepInsight";
import StepVisual from "./StepVisual";

interface AnimatedStepJourneyProps {
  events: TraceEvent[];
  step: number;
  onJump: (index: number) => void;
  /** Code source for the spotlight + story */
  code?: string;
  language?: string;
  playing?: boolean;
  onTogglePlay?: () => void;
}

const EVENT_CONFIG: Record<
  string,
  {
    color: string;
    bg: string;
    border: string;
    icon: string;
    label: string;
    gradient: string;
    particle: string;
  }
> = {
  call: {
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.08)",
    border: "rgba(167,139,250,0.35)",
    icon: "⬇",
    label: "Function Called",
    gradient: "135deg, rgba(167,139,250,0.15) 0%, rgba(167,139,250,0.02) 100%",
    particle: "rgba(167,139,250,0.7)",
  },
  line: {
    color: "#38bdf8",
    bg: "rgba(56,189,248,0.08)",
    border: "rgba(56,189,248,0.30)",
    icon: "▶",
    label: "Line Executing",
    gradient: "135deg, rgba(56,189,248,0.12) 0%, rgba(56,189,248,0.02) 100%",
    particle: "rgba(56,189,248,0.7)",
  },
  return: {
    color: "#34d399",
    bg: "rgba(52,211,153,0.08)",
    border: "rgba(52,211,153,0.30)",
    icon: "↩",
    label: "Returning",
    gradient: "135deg, rgba(52,211,153,0.12) 0%, rgba(52,211,153,0.02) 100%",
    particle: "rgba(52,211,153,0.7)",
  },
  exception: {
    color: "#f87171",
    bg: "rgba(248,113,113,0.08)",
    border: "rgba(248,113,113,0.30)",
    icon: "✕",
    label: "Exception!",
    gradient: "135deg, rgba(248,113,113,0.14) 0%, rgba(248,113,113,0.02) 100%",
    particle: "rgba(248,113,113,0.7)",
  },
};

function short(value: SerializedValue, limit = 36): string {
  const text = formatValue(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Floating particle animation on call/return */
function Particles({ color, count = 6 }: { color: string; count?: number }) {
  const particles = Array.from({ length: count }, (_, i) => i);
  return (
    <div className="journey-particles" aria-hidden="true">
      {particles.map((i) => (
        <motion.div
          key={i}
          className="journey-particle"
          style={{ background: color }}
          initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
          animate={{
            opacity: [0, 1, 0],
            scale: [0, 1, 0.5],
            x: (Math.random() - 0.5) * 80,
            y: -40 - Math.random() * 40,
          }}
          transition={{
            duration: 0.8 + Math.random() * 0.4,
            delay: i * 0.06,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}

/** A single variable delta card with animated value morph */
function VarDeltaCard({ delta, index }: { delta: VarDelta; index: number }) {
  const reduce = useReducedMotion();
  const afterDisplay = short(delta.after);
  const beforeDisplay = delta.before ? short(delta.before) : null;

  return (
    <motion.div
      className={`journey-var-card ${delta.isNew ? "is-new" : delta.isRemoved ? "is-removed" : "is-changed"}`}
      initial={reduce ? false : { opacity: 0, x: -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.3, delay: 0.1 + index * 0.07, ease: "easeOut" }}
    >
      <div className="journey-var-name">{delta.name}</div>
      <div className="journey-var-value-row">
        {delta.isNew ? (
          <>
            <motion.span
              className="journey-var-new-badge"
              initial={reduce ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 18, delay: 0.2 + index * 0.07 }}
            >
              new
            </motion.span>
            <motion.code
              className="journey-var-val journey-var-val-after"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 + index * 0.07 }}
            >
              {afterDisplay}
            </motion.code>
          </>
        ) : delta.isRemoved ? (
          <>
            <span className="journey-var-removed-badge">removed</span>
            <code className="journey-var-val journey-var-val-before">{beforeDisplay}</code>
          </>
        ) : (
          <>
            {beforeDisplay && (
              <motion.code
                className="journey-var-val journey-var-val-before"
                initial={reduce ? false : { opacity: 1 }}
                animate={{ opacity: 0.5 }}
                transition={{ duration: 0.2, delay: 0.15 }}
              >
                {beforeDisplay}
              </motion.code>
            )}
            <span className="journey-var-arrow">→</span>
            <AnimatePresence mode="wait">
              <motion.code
                key={afterDisplay}
                className="journey-var-val journey-var-val-after"
                initial={reduce ? false : { opacity: 0, y: 8, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.92 }}
                transition={{ duration: 0.22, ease: "easeOut", delay: 0.1 + index * 0.05 }}
              >
                {afterDisplay}
              </motion.code>
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.div>
  );
}

/**
 * The Journey panel: one step, told properly.
 *
 *  1. CODE SPOTLIGHT — the real source line this step executes;
 *  2. STORY — what happened (real values), why it matters, what happens next;
 *  3. AI INSIGHT — the tutor model's take on this exact step, cached per step,
 *     fetched only when playback is paused (see useStepInsight);
 *  4. variable deltas, stack depth, timeline scrubber — with motion that
 *     follows the trace (frame push/pop colors, value morphs, pulses).
 */
export default function AnimatedStepJourney({
  events,
  step,
  onJump,
  code,
  language = "python",
  playing = false,
  onTogglePlay,
}: AnimatedStepJourneyProps) {
  const reduce = useReducedMotion();
  const [showParticles, setShowParticles] = useState(false);
  const prevStepRef = useRef(step);
  const totalSteps = events.length;
  const idx = Math.min(Math.max(step, 0), Math.max(totalSteps - 1, 0));

  const event = totalSteps > 0 ? events[idx] : null;
  const cfg = event ? (EVENT_CONFIG[event.event] ?? EVENT_CONFIG.line) : null;

  const story = useMemo(() => (event ? buildStepStory(events, idx, code ?? "") : null), [events, idx, code, event]);
  const visual = useMemo(() => (event ? buildStepVisual(events, idx, code ?? "") : null), [events, idx, code, event]);
  const deltas = useMemo(() => frameDeltas(events, idx), [events, idx]);
  const { state: ai, deeper, retry } = useStepInsight({
    events,
    step,
    code: code ?? "",
    language,
    playing,
    enabled: event !== null,
  });

  // Compute call depth for stack depth visualization
  const callDepth = useMemo(() => {
    let depth = 0;
    let maxDepth = 0;
    for (let i = 0; i < totalSteps && i <= idx; i++) {
      if (events[i].event === "call") depth++;
      if (events[i].event === "return") depth = Math.max(0, depth - 1);
      maxDepth = Math.max(maxDepth, depth);
    }
    return { current: depth, max: maxDepth };
  }, [events, idx, totalSteps]);

  // Burst particles when stepping into/out of a function
  useEffect(() => {
    if (step !== prevStepRef.current && event && (event.event === "call" || event.event === "return")) {
      setShowParticles(true);
      const timer = setTimeout(() => setShowParticles(false), 900);
      prevStepRef.current = step;
      return () => clearTimeout(timer);
    }
    prevStepRef.current = step;
  }, [step, event]);

  const progress = totalSteps > 1 ? (idx / (totalSteps - 1)) * 100 : 0;

  if (!event || !cfg || !story) {
    return (
      <section className="panel journey-panel journey-empty">
        <div className="journey-empty-content">
          <motion.div
            className="journey-empty-orb"
            animate={{ scale: [1, 1.06, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
          <h3 className="journey-empty-title">Ready to Visualize</h3>
          <p className="journey-empty-desc">
            Press <strong>▶ Visualize</strong> and watch every single step of your program come alive — with
            the real code line, grounded explanations, AI insights, variable changes and animated flow.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="panel journey-panel"
      style={{ "--cfg-color": cfg.color, "--cfg-bg": cfg.bg, "--cfg-border": cfg.border } as CSSProperties}
    >
      {/* Progress bar */}
      <div className="journey-progress-bar">
        <motion.div
          className="journey-progress-fill"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          style={{ background: `linear-gradient(90deg, ${cfg.color} 0%, ${cfg.color}aa 100%)` }}
        />
      </div>

      {/* Step counter header */}
      <header className="journey-header">
        <div
          className="journey-step-badge"
          style={{ color: cfg.color, borderColor: cfg.border, background: cfg.bg }}
        >
          <span className="journey-step-icon" aria-hidden="true">{cfg.icon}</span>
          <span className="journey-step-type">{cfg.label}</span>
        </div>
        <span className="journey-step-counter">
          {idx + 1} <span className="journey-step-of">of</span> {totalSteps}
        </span>
        {onTogglePlay && (
          <button
            className="journey-play-btn"
            onClick={onTogglePlay}
            title={playing ? "Pause playback (space)" : "Play the trace (space)"}
          >
            {playing ? "⏸" : "▶"}
          </button>
        )}
        <button
          className="journey-prev-btn"
          onClick={() => onJump(Math.max(0, idx - 1))}
          disabled={idx <= 0}
          title="Previous step"
        >
          ←
        </button>
        <button
          className="journey-next-btn"
          onClick={() => onJump(Math.min(totalSteps - 1, idx + 1))}
          disabled={idx >= totalSteps - 1}
          title="Next step"
        >
          →
        </button>
      </header>

      {/* Main animated card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`journey-${idx}`}
          className="journey-card"
          style={{ background: `linear-gradient(${cfg.gradient})`, borderColor: cfg.border }}
          initial={reduce ? false : { opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? {} : { opacity: 0, y: -16, scale: 0.97 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          {showParticles && <Particles color={cfg.particle} count={8} />}

          {/* 1. The real code line this step executes */}
          {story.codeLine && (
            <div className="journey-spotlight">
              <span className="journey-spot-no">{story.codeLineNo}</span>
              <code className="journey-spot-code">{story.codeLine}</code>
            </div>
          )}

          {/* Headline — built from real values */}
          <motion.h2
            className="journey-headline"
            style={{ color: cfg.color }}
            initial={reduce ? false : { opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, delay: 0.04 }}
          >
            {story.headline}
          </motion.h2>

          {/* Location context */}
          <motion.div
            className="journey-location"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.08 }}
          >
            <span className="journey-loc-fn">{frameLabel(event.functionName)}</span>
            {event.line != null && (
              <>
                <span className="journey-loc-sep">·</span>
                <span className="journey-loc-line">line {event.line}</span>
              </>
            )}
            {callDepth.current > 1 && (
              <>
                <span className="journey-loc-sep">·</span>
                <span className="journey-loc-depth">depth {callDepth.current}</span>
              </>
            )}
          </motion.div>

          {/* Fact chips — iteration, printed output, recursion */}
          {story.chips.length > 0 && (
            <div className="journey-chips">
              {story.chips.map((chip) => (
                <span
                  key={chip.label}
                  className={`journey-chip tone-${chip.tone ?? "fn"}`}
                  title={chip.title}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          )}

          {/* The visual: an animated micro-diagram of this exact step */}
          {visual && <StepVisual spec={visual} />}

          {/* 2. WHAT HAPPENED */}
          <p className="journey-explain journey-seg" style={{ animationDelay: "0.05s" }}>
            {story.what}
          </p>

          {/* WHY IT MATTERS */}
          {story.why && (
            <div className="journey-tip journey-seg" style={{ animationDelay: "0.13s" }}>
              <span className="journey-seg-label">why it matters</span>
              {story.why}
            </div>
          )}

          {/* 3. AI INSIGHT — the tutor model on this exact step */}
          <div
            className={`journey-ai journey-seg ${ai.status}${ai.autoOff ? " auto-off" : ""}`}
            style={{ animationDelay: "0.2s" }}
          >
            <div className="journey-ai-head">
              <span className="journey-ai-spark" aria-hidden="true">✨</span>
              <span className="journey-ai-title">AI insight</span>
              {ai.status === "ready" && ai.model && (
                <span className="journey-ai-model">{ai.model.split("/").pop()}</span>
              )}
              <button
                type="button"
                className="journey-ai-deeper"
                onClick={deeper}
                disabled={ai.status === "loading"}
                title="Ask the AI tutor for a deeper explanation of this step"
              >
                {ai.status === "loading" ? "…" : "Deeper ↓"}
              </button>
            </div>
            {ai.status === "loading" ? (
              <div className="journey-ai-shimmer" aria-label="thinking">
                <span />
                <span />
                <span />
              </div>
            ) : ai.status === "ready" ? (
              <p className="journey-ai-text">{ai.text}</p>
            ) : ai.status === "failed" ? (
              <p className="journey-ai-note">
                {ai.error ?? "The AI tutor is unavailable right now."}{" "}
                <button type="button" className="journey-ai-retry" onClick={retry}>
                  retry
                </button>
              </p>
            ) : (
              <p className="journey-ai-waiting">
                {ai.autoOff
                  ? "Automatic insights are paused — press Deeper to ask the AI."
                  : "Pause on any step to summon an AI explanation."}
              </p>
            )}
          </div>

          {/* 4. WHAT HAPPENS NEXT */}
          <div className="journey-nextrow journey-seg" style={{ animationDelay: "0.26s" }}>
            <span className="journey-seg-label">next</span>
            <span className="journey-next-body">
              {story.next ? `→ ${story.next}` : "✔ end of trace — the program finished"}
            </span>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Variable changes section */}
      <AnimatePresence>
        {deltas.length > 0 && (
          <motion.div
            className="journey-vars"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="journey-vars-header">
              <span className="journey-vars-title">Variable Changes</span>
              <span className="journey-vars-count">{deltas.length} changed</span>
            </div>
            <div className="journey-vars-grid">
              {deltas.slice(0, 6).map((delta, i) => (
                <VarDeltaCard key={delta.name} delta={delta} index={i} />
              ))}
              {deltas.length > 6 && (
                <div className="journey-vars-more">+{deltas.length - 6} more changes</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stack depth viz */}
      {callDepth.max > 1 && (
        <div className="journey-stack-viz">
          <span className="journey-stack-label">Stack depth</span>
          <div className="journey-stack-bars">
            {Array.from({ length: Math.min(callDepth.max, 8) }, (_, i) => (
              <motion.div
                key={i}
                className={`journey-stack-bar ${i < callDepth.current ? "active" : ""}`}
                animate={{
                  opacity: i < callDepth.current ? 1 : 0.15,
                  scaleY: i < callDepth.current ? 1 : 0.4,
                }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                style={{
                  background: i < callDepth.current ? cfg.color : undefined,
                }}
              />
            ))}
          </div>
          <span className="journey-stack-num">{callDepth.current}</span>
        </div>
      )}

      {/* Mini timeline scrubber */}
      <div className="journey-timeline">
        <button
          className="journey-tl-btn"
          onClick={() => onJump(0)}
          title="Jump to start"
          disabled={idx === 0}
        >
          ⏮
        </button>
        <div
          className="journey-tl-track"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            onJump(Math.round(ratio * (totalSteps - 1)));
          }}
        >
          <div className="journey-tl-fill" style={{ width: `${progress}%`, background: cfg.color }} />
          <motion.div
            className={`journey-tl-thumb${playing ? " is-playing" : ""}`}
            style={{ left: `${progress}%`, background: cfg.color }}
            layout
            transition={{ duration: 0.2 }}
          />
          {/* Event type markers */}
          {events.map((ev, i) => {
            if (ev.event === "line") return null;
            const pct = totalSteps > 1 ? (i / (totalSteps - 1)) * 100 : 0;
            const markerCfg = EVENT_CONFIG[ev.event] ?? EVENT_CONFIG.line;
            return (
              <button
                key={i}
                className="journey-tl-marker"
                style={{ left: `${pct}%`, background: markerCfg.color }}
                onClick={(e) => {
                  e.stopPropagation();
                  onJump(i);
                }}
                title={`Step ${i + 1}: ${ev.event} in ${ev.functionName}`}
              />
            );
          })}
        </div>
        <button
          className="journey-tl-btn"
          onClick={() => onJump(totalSteps - 1)}
          title="Jump to end"
          disabled={idx >= totalSteps - 1}
        >
          ⏭
        </button>
      </div>
    </section>
  );
}
