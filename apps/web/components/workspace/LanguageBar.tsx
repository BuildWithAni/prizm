"use client";

import { LANGUAGE_CATALOG } from "../../lib/languages";

interface LanguageBarProps {
  language: string;
  onSelect: (language: string) => void;
  /** Language metadata from /api/languages (empty until it loads). */
  languages: { id: string; available: boolean; trace?: boolean; detail?: string | null }[];
}

/**
 * Full-width language selector strip. Availability is advisory: when the
 * language list hasn't loaded, Run stays enabled and the API reports
 * toolchain errors clearly.
 */
export default function LanguageBar({ language, onSelect, languages }: LanguageBarProps) {
  const selected = LANGUAGE_CATALOG.find((item) => item.id === language) ?? LANGUAGE_CATALOG[0];
  const info = languages.find((lang) => lang.id === language);

  return (
    <nav className="language-bar" aria-label="Choose a programming language">
      <div className="language-bar-label">
        <span className="language-bar-kicker">FILE · {selected.extension}</span>
        <span className="language-bar-current">{selected.name}</span>
      </div>
      <div className="language-list">
        {LANGUAGE_CATALOG.map((item) => {
          const itemInfo = languages.find((lang) => lang.id === item.id);
          const available = itemInfo?.available === true;
          const active = item.id === language;
          return (
            <button
              key={item.id}
              type="button"
              className={`language-option${active ? " active" : ""}${available ? "" : " unavailable"}`}
              onClick={() => onSelect(item.id)}
              aria-pressed={active}
              title={`${item.name} · ${item.extension}${itemInfo ? !available ? ` · ${itemInfo.detail ?? "runtime unavailable"}` : itemInfo.trace ? " · Visualize + Run" : " · Run" : " · API language list unavailable; try Run"}`}
            >
              <span className={`language-icon language-icon-${item.id}`} aria-hidden="true">
                <img src={`/languages/${item.icon}`} alt="" width="20" height="20" loading="lazy" />
              </span>
              <span className="language-option-name">{item.name}</span>
              {!available && <span className="language-setup-dot" aria-label="Runtime setup required" />}
            </button>
          );
        })}
      </div>
      <span className="language-bar-hint">
        {info?.trace ? "VISUALIZE + RUN" : info?.available ? "RUN" : "SETUP REQUIRED"}
      </span>
    </nav>
  );
}
