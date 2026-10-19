"use client";

import { useState, type ReactNode } from "react";

/**
 * Dependency-free Markdown renderer for tutor answers: fenced code blocks,
 * headings, bullet/numbered lists, **bold**, `inline code`, hard breaks.
 * Anything else renders as plain text — safe by construction (no HTML passthrough).
 *
 * A fenced block tagged `prizm` is the workspace protocol: it holds the
 * COMPLETE new contents of the editor file, and — when properly closed —
 * gets an "Apply to workspace" button wired to the editor.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(text: string, key: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter((part) => part.length > 0)
    .map((part, i) => {
      const k = `${key}-${i}`;
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return <strong key={k}>{part.slice(2, -2)}</strong>;
      }
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return <code key={k}>{part.slice(1, -1)}</code>;
      }
      return <span key={k}>{part}</span>;
    });
}

function FenceBlock({
  lang,
  code,
  closed,
  onApplyCode,
}: {
  lang: string;
  code: string;
  closed: boolean;
  onApplyCode?: (code: string) => void;
}) {
  const [applied, setApplied] = useState(false);
  const isWorkspace = lang === "prizm";
  const canApply = isWorkspace && closed && typeof onApplyCode === "function";

  if (!isWorkspace) {
    return (
      <pre className="md-pre">
        {lang && <span className="md-lang">{lang}</span>}
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <pre className="md-pre prizm">
      <div className="md-pre-head">
        <span className="md-lang">workspace</span>
        {!closed && <span className="md-warn">incomplete</span>}
        {canApply && (
          <button
            type="button"
            className="md-apply"
            disabled={applied || !code.trim()}
            onClick={() => {
              onApplyCode?.(code);
              setApplied(true);
            }}
          >
            {applied ? "✓ applied" : "Apply to workspace"}
          </button>
        )}
      </div>
      <code>{code}</code>
    </pre>
  );
}

const isFence = (l: string) => /^```/.test(l);
const isHeading = (l: string) => /^#{1,6}\s/.test(l);
const isBullet = (l: string) => /^\s*[-*]\s+/.test(l);
const isNumbered = (l: string) => /^\s*\d+[.)]\s+/.test(l);
const isItemStart = (l: string) => isFence(l) || isHeading(l) || isBullet(l) || isNumbered(l);

export default function Markdown({
  text,
  onApplyCode,
}: {
  text: string;
  onApplyCode?: (code: string) => void;
}) {
  const nodes: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) body.push(lines[i++]);
      const closed = i < lines.length; // closing fence found (vs. truncated at EOF)
      i++; // consume closing fence (no-op at EOF)
      nodes.push(
        <FenceBlock
          key={`k${key++}`}
          lang={lang}
          code={body.join("\n")}
          closed={closed}
          onApplyCode={onApplyCode}
        />,
      );
      continue;
    }

    // headings (kept small for a side panel)
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const content = renderInline(heading[2], `h${key}`);
      nodes.push(
        heading[1].length <= 2 ? (
          <h4 key={`k${key++}`}>{content}</h4>
        ) : (
          <h5 key={`k${key++}`}>{content}</h5>
        ),
      );
      i++;
      continue;
    }

    // bullet list
    if (isBullet(line)) {
      const items: string[] = [];
      while (i < lines.length && isBullet(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      nodes.push(
        <ul key={`k${key++}`}>
          {items.map((t, n) => (
            <li key={n}>{renderInline(t, `ul${n}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // numbered list
    if (isNumbered(line)) {
      const items: string[] = [];
      while (i < lines.length && isNumbered(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      nodes.push(
        <ol key={`k${key++}`}>
          {items.map((t, n) => (
            <li key={n}>{renderInline(t, `ol${n}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // blank separator
    if (!line.trim()) {
      i++;
      continue;
    }

    // paragraph: consecutive plain lines
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isItemStart(lines[i])) para.push(lines[i++]);
    nodes.push(
      <p key={`k${key++}`}>
        {para.map((t, n) => (
          <span key={n}>
            {renderInline(t, `p${n}`)}
            {n < para.length - 1 && <br />}
          </span>
        ))}
      </p>,
    );
  }

  return <div className="md">{nodes}</div>;
}
