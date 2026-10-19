"use client";

interface ExecutionControlsProps {
  step: number; // 0-based index into events
  total: number;
  playing: boolean;
  busy: boolean;
  onFirst: () => void;
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onLast: () => void;
  onScrub: (step: number) => void;
}

/** Timeline + transport controls. Every panel follows the step selected here. */
export default function ExecutionControls({
  step,
  total,
  playing,
  busy,
  onFirst,
  onPrev,
  onTogglePlay,
  onNext,
  onLast,
  onScrub,
}: ExecutionControlsProps) {
  const hasTrace = total > 0;
  const atStart = step <= 0;
  const atEnd = step >= total - 1;

  return (
    <div className="controls panel">
      <button className="icon-btn" title="First step" onClick={onFirst} disabled={!hasTrace || atStart}>
        ⏮
      </button>
      <button className="icon-btn" title="Previous step" onClick={onPrev} disabled={!hasTrace || atStart}>
        ◀
      </button>
      <button
        className="icon-btn icon-btn-play"
        title={playing ? "Pause" : "Play"}
        onClick={onTogglePlay}
        disabled={!hasTrace || atEnd || busy}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button className="icon-btn" title="Next step" onClick={onNext} disabled={!hasTrace || atEnd}>
        ▶
      </button>
      <button className="icon-btn" title="Last step" onClick={onLast} disabled={!hasTrace || atEnd}>
        ⏭
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(total - 1, 0)}
        value={step}
        onChange={(e) => onScrub(Number(e.target.value))}
        disabled={!hasTrace}
        aria-label="Execution step"
      />

      <span className="step-label">
        {hasTrace ? `Step ${step + 1} / ${total}` : "No trace yet"}
      </span>
    </div>
  );
}
