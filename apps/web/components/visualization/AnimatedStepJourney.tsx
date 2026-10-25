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
function Particles({ color, count = 8 }: { color: string; count?: number }) {
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
            scale: [0, 1.2, 0.4],
            x: (Math.random() - 0.5) * 110,
            y: -30 - Math.random() * 50,
          }}
          transition={{
            duration: 0.8 + Math.random() * 0.4,
            delay: i * 0.05,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}

/** Interactive Live Memory Shelf embedded directly in the Animation Theater */
function LiveMemoryVault({
  locals,
  deltas,
  reduce,
}: {
  locals: Record<string, SerializedValue>;
  deltas: VarDelta[];
  reduce: boolean | null;
}) {
  const entries = Object.entries(locals);
  if (entries.length === 0) return null;

  const changedSet = new Set(deltas.map((d) => d.name));

  return (
    <div className="journey-memory-vault">
      <div className="vault-header">
        <span className="vault-title">⚡ Active Memory Shelf</span>
        <span className="vault-count">{entries.length} in scope</span>
      </div>
      <div className="vault-grid">
        {entries.map(([name, val]) => {
          const isChanged = changedSet.has(name);
          const delta = deltas.find((d) => d.name === name);
          const isNew = delta?.isNew ?? false;

          return (
            <motion.div
              key={name}
              className={`vault-cell ${isChanged ? (isNew ? "cell-new" : "cell-updated") : ""}`}
              initial={reduce ? false : { scale: 0.93, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.22 }}
            >
              <div className="vault-cell-top">
                <span className="vault-cell-name">{name}</span>
                <span className={`vault-type-badge sv-${val.type}`}>{val.type}</span>
                {isChanged && (
                  <motion.span
                    className="vault-change-indicator"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 20 }}
                  >
                    {isNew ? "+new" : "changed"}
                  </motion.span>
                )}
              </div>

              {val.type === "array" && Array.isArray(val.value) ? (
                <div className="vault-array-tape">
                  {val.value.slice(0, 5).map((item, idx) => (
                    <div key={idx} className="vault-slot">
                      <span className="vault-slot-idx">[{idx}]</span>
                      <span className="vault-slot-val">{formatValue(item)}</span>
                    </div>
                  ))}
                  {val.value.length > 5 && (
                    <span className="vault-slot-more">+{val.value.length - 5}</span>
                  )}
                </div>
              ) : (
                <div className="vault-cell-val">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={formatValue(val)}
                      className={`vault-val-display sv-${val.type}`}
                      initial={reduce ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18 }}
                    >
                      {formatValue(val)}
                    </motion.span>
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * AnimatedStepJourney: An Animation-First Visual Execution Experience.
 *
 *  1. CODE SPOTLIGHT — real line executing with syntax glow;
 *  2. ANIMATION THEATER — dynamic visual execution: assignment beams, decision gates,
 *     orbital loop runners, terminal displays, and 3D stack frames;
 *  3. LIVE MEMORY SHELF — glassmorphic memory cells and array tapes with live value morphing;
 *  4. CRISP HUD & COLLAPSIBLE INSIGHTS — clean 1-line action banner by default,
 *     with deep tutor explanations and AI insights accessible in a smooth toggle drawer.
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
  const [showInsights, setShowInsights] = useState(false);
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

  // Burst particles on call/return
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
            animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.85, 0.5] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
          <h3 className="journey-empty-title">Ready to Animate</h3>
          <p className="journey-empty-desc">
            Press <strong>▶ Visualize</strong> to watch an animated step-by-step playback of your program —
            with memory registers, flow beams, data structures and live execution.
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
          transition={{ duration: 0.22, ease: "easeOut" }}
          style={{ background: `linear-gradient(90deg, ${cfg.color} 0%, ${cfg.color}ee 100%)` }}
        />
      </div>

      {/* Control Header */}
      <header className="journey-header">
        <div
          className="journey-step-badge"
          style={{ color: cfg.color, borderColor: cfg.border, background: cfg.bg }}
        >
          <span className="journey-step-icon" aria-hidden="true">{cfg.icon}</span>
          <span className="journey-step-type">{cfg.label}</span>
        </div>

        {playing && (
          <div className="journey-live-indicator">
            <span className="journey-live-dot" />
            <span className="journey-live-text">ANIMATING</span>
          </div>
        )}

        <span className="journey-step-counter">
          {idx + 1} <span className="journey-step-of">of</span> {totalSteps}
        </span>

        {onTogglePlay && (
          <button
            className={`journey-play-btn ${playing ? "is-playing" : ""}`}
            onClick={onTogglePlay}
            title={playing ? "Pause animation (space)" : "Play animation (space)"}
          >
            {playing ? "⏸" : "▶"}
          </button>
        )}

        <button
          className="journey-prev-btn"
          onClick={() => onJump(Math.max(0, idx - 1))}
          disabled={idx <= 0}
          title="Previous step (←)"
        >
          ←
        </button>
        <button
          className="journey-next-btn"
          onClick={() => onJump(Math.min(totalSteps - 1, idx + 1))}
          disabled={idx >= totalSteps - 1}
          title="Next step (→)"
        >
          →
        </button>
      </header>

      {/* Main Animated Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`journey-${idx}`}
          className="journey-card journey-card-animated"
          style={{ background: `linear-gradient(${cfg.gradient})`, borderColor: cfg.border }}
          initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? {} : { opacity: 0, y: -12, scale: 0.98 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
        >
          {showParticles && <Particles color={cfg.particle} count={10} />}

          {/* 1. Code Spotlight Banner */}
          {story.codeLine && (
            <div className="journey-spotlight">
              <span className="journey-spot-no">L{story.codeLineNo}</span>
              <code className="journey-spot-code">{story.codeLine}</code>
              <span className="journey-spot-fn">{frameLabel(event.functionName)}</span>
            </div>
          )}

          {/* Fact Chips */}
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

          {/* 2. Centerpiece: The Animated Visual Theater */}
          {visual && (
            <div className="journey-theater-stage">
              <StepVisual spec={visual} />
            </div>
          )}

          {/* 3. Live Active Memory Shelf */}
          {event.locals && Object.keys(event.locals).length > 0 && (
            <LiveMemoryVault locals={event.locals} deltas={deltas} reduce={reduce} />
          )}

          {/* 4. Action Banner (1-line punchy caption) */}
          <div className="journey-action-caption">
            <span className="journey-caption-glyph" style={{ color: cfg.color }}>⚡</span>
            <span className="journey-caption-text">{story.what}</span>
          </div>

          {/* 5. Collapsible Deep Explanations & AI Insights */}
          <div className="journey-insights-drawer">
            <button
              type="button"
              className="journey-insights-toggle"
              onClick={() => setShowInsights((prev) => !prev)}
            >
              <span className="insights-toggle-icon">💡</span>
              <span className="insights-toggle-title">
                {showInsights ? "Hide Tutor Explanations" : "View Tutor Insights & Details"}
              </span>
              <span className="insights-toggle-chevron">{showInsights ? "▲" : "▼"}</span>
            </button>

            <AnimatePresence>
              {showInsights && (
                <motion.div
                  className="journey-insights-body"
                  initial={reduce ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  {story.why && (
                    <div className="journey-tip">
                      <span className="journey-seg-label">concept insight</span>
                      {story.why}
                    </div>
                  )}

                  {/* AI Tutor insight */}
                  <div className={`journey-ai ${ai.status}`}>
                    <div className="journey-ai-head">
                      <span className="journey-ai-spark" aria-hidden="true">✨</span>
                      <span className="journey-ai-title">AI Tutor Analysis</span>
                      {ai.status === "ready" && ai.model && (
                        <span className="journey-ai-model">{ai.model.split("/").pop()}</span>
                      )}
                      <button
                        type="button"
                        className="journey-ai-deeper"
                        onClick={deeper}
                        disabled={ai.status === "loading"}
                      >
                        {ai.status === "loading" ? "…" : "Ask Deeper ↓"}
                      </button>
                    </div>
                    {ai.status === "loading" ? (
                      <div className="journey-ai-shimmer" aria-label="thinking">
                        <span /><span /><span />
                      </div>
                    ) : ai.status === "ready" ? (
                      <p className="journey-ai-text">{ai.text}</p>
                    ) : ai.status === "failed" ? (
                      <p className="journey-ai-note">
                        {ai.error ?? "AI tutor unavailable."}{" "}
                        <button type="button" className="journey-ai-retry" onClick={retry}>
                          retry
                        </button>
                      </p>
                    ) : (
                      <p className="journey-ai-waiting">Pause playback on any step to summon AI insights.</p>
                    )}
                  </div>

                  {/* Next up */}
                  <div className="journey-nextrow">
                    <span className="journey-seg-label">next step</span>
                    <span className="journey-next-body">
                      {story.next ? `→ ${story.next}` : "✔ end of execution trace"}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Stack depth visualizer */}
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
