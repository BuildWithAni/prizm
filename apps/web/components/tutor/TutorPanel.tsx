"use client";

import { useEffect, useRef, useState } from "react";
import type { FrameState, TraceEvent } from "../../lib/types";
import { formatValue } from "../../lib/format";
import { askTutor, type TutorChatTurn, type TutorStepContext } from "../../lib/api";
import Markdown from "../../lib/markdown";

interface TutorPanelProps {
  currentEvent: TraceEvent | null;
  frameState: FrameState | null;
  source: string;
  language: string;
  onApplyCode: (code: string) => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  truncated?: boolean;
}

/** Prompts offered while a trace step is selected vs. before any run. */
const STEP_PROMPTS = [
  "Explain this line",
  "Why do these variables have these values?",
  "What happens next?",
];
const GENERAL_PROMPTS = [
  "Explain what this program does",
  "How does this loop work?",
  "Does this code have any bugs?",
  "Write a small example program that demonstrates recursion",
];

/**
 * Live AI chat grounded in the *selected execution step*. The payload is built
 * from the real trace (line, function frame, variable snapshots, output) —
 * never hardcoded — so the tutor explains the actual execution the student sees.
 */
export default function TutorPanel({
  currentEvent,
  frameState,
  source,
  language,
  onApplyCode,
}: TutorPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // keep the newest message in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, error]);

  const locals = frameState?.locals ?? currentEvent?.locals ?? {};
  const stepContext: TutorStepContext | null = currentEvent
    ? {
        line: currentEvent.line,
        function: frameState?.functionName ?? currentEvent.functionName,
        event_kind: currentEvent.event,
        locals: Object.fromEntries(
          Object.entries(locals).map(([k, v]) => [k, formatValue(v)]),
        ),
        stdout: currentEvent.output ? currentEvent.output : null,
      }
    : null;

  const hasStep = stepContext?.line != null;
  const prompts = hasStep ? STEP_PROMPTS : GENERAL_PROMPTS;

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    setError(null);
    setInput("");
    const history: TutorChatTurn[] = messages.slice(-10);
    const withUser: Message[] = [...messages, { role: "user", content: question }];
    setMessages(withUser);
    setBusy(true);
    try {
      const res = await askTutor({
        question,
        source,
        language,
        student_level: "beginner",
        context: stepContext,
        history,
      });
      setMessages([...withUser, { role: "assistant", content: res.answer, truncated: res.truncated || undefined }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tutor request failed.");
    } finally {
      setBusy(false);
    }
  };

  const stepLabel = hasStep
    ? `step L${stepContext!.line} · ${stepContext!.function ?? "<module>"}`
    : "no step selected";

  return (
    <section className="panel tutor-panel">
      <header className="panel-header">
        <span>AI Tutor</span>
        <span className="tutor-header-right">
          <span className={`tutor-step-chip${hasStep ? " on" : ""}`}>{stepLabel}</span>
          {messages.length > 0 && (
            <button
              type="button"
              className="tutor-clear"
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
            >
              clear
            </button>
          )}
        </span>
      </header>

      <div className="tutor-scroll" ref={scrollRef}>
        {messages.length === 0 && !busy && !error && (
          <div className="tutor-welcome">
            <p className="empty">
              Ask about the code — or the exact step you&apos;re looking at.
              Answers come from your <strong>real execution trace</strong>:
              highlighted line, function frame, and the variable values on
              screen right now.
            </p>
            <div className="tutor-chips">
              {prompts.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="tutor-chip"
                  onClick={() => void send(q)}
                  disabled={busy}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`tutor-msg ${m.role}`}>
            <div className="tutor-msg-role">{m.role === "user" ? "You" : "Tutor"}</div>
            {m.role === "assistant" ? (
              <>
                <Markdown text={m.content} onApplyCode={onApplyCode} />
                {m.truncated && (
                  <div className="md-truncated">
                    ⚠ Even after automatically continuing, this answer
                    ran past the length limit — any code above may be
                    incomplete. Ask for a shorter version to get a
                    complete file.
                  </div>
                )}
              </>
            ) : (
              <p className="tutor-user-text">{m.content}</p>
            )}
          </div>
        ))}

        {busy && (
          <div className="tutor-msg assistant">
            <div className="tutor-msg-role">Tutor</div>
            <div className="tutor-thinking" aria-label="thinking">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {error && (
          <div className="tutor-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="tutor-composer">
        <textarea
          rows={2}
          value={input}
          aria-label="Ask the AI tutor"
          placeholder="Ask the tutor… (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button
          type="button"
          className="btn btn-solid tutor-send"
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
        >
          {busy ? "…" : "Ask"}
        </button>
      </div>
    </section>
  );
}
