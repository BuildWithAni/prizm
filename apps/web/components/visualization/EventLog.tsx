"use client";

import { useEffect, useRef } from "react";
import type { TraceEvent } from "../../lib/types";

interface EventLogProps {
  events: TraceEvent[];
  step: number;
  onSelect: (step: number) => void;
}

const KIND_LABEL: Record<string, string> = {
  call: "call",
  line: "line",
  return: "return",
  exception: "error",
};

/** The raw execution timeline — click any step to jump to it. */
export default function EventLog({ events, step, onSelect }: EventLogProps) {
  const currentRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [step]);

  return (
    <section className="panel eventlog">
      <header className="panel-header">
        <span>Execution Timeline</span>
        <span className="panel-header-sub">{events.length} events</span>
      </header>
      <div className="panel-body">
        {events.length === 0 ? (
          <p className="empty">Run some code to record a trace.</p>
        ) : (
          events.map((event, index) => (
            <button
              key={event.step}
              ref={index === step ? currentRef : undefined}
              className={"event-row" + (index === step ? " current" : "")}
              onClick={() => onSelect(index)}
            >
              <span className="event-step">{event.step}</span>
              <span className={`event-kind kind-${event.event}`}>{KIND_LABEL[event.event]}</span>
              <span className="event-func">
                {event.functionName === "<module>" ? "(module)" : event.functionName}
                {event.exception ? ` — ${event.exception.type}` : ""}
              </span>
              <span className="event-line">{event.line != null ? `L${event.line}` : ""}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
