"use client";

import type { SerializedValue } from "../../lib/types";
import { formatValue } from "../../lib/format";

interface VariableInspectorProps {
  frameName: string | null;
  line: number | null;
  locals: Record<string, SerializedValue> | null;
  /** Previous step's locals for the same frame — used to flash changes. */
  prevLocals?: Record<string, SerializedValue> | null;
}

/** Shows the selected frame's variables as of the selected step. */
export default function VariableInspector({
  frameName,
  line,
  locals,
  prevLocals,
}: VariableInspectorProps) {
  const entries = locals ? Object.entries(locals) : [];

  const isChanged = (name: string, value: SerializedValue): boolean => {
    if (!prevLocals) return false;
    const before = prevLocals[name];
    if (before === undefined) return false;
    return JSON.stringify(before) !== JSON.stringify(value);
  };

  return (
    <section className="panel variable-inspector">
      <header className="panel-header">
        <span>Variables</span>
        {frameName && (
          <span className="panel-header-sub">
            {frameName}
            {line != null ? ` · line ${line}` : ""}
          </span>
        )}
      </header>
      <div className="panel-body">
        {entries.length === 0 ? (
          <p className="empty">No variables in scope at this step.</p>
        ) : (
          <table className="var-table">
            <tbody>
              {entries.map(([name, value]) => (
                <tr key={name} className={isChanged(name, value) ? "changed" : undefined}>
                  <td className="var-name">{name}</td>
                  <td className="var-value">{formatValue(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
