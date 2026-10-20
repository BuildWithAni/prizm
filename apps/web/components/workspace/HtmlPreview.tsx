"use client";

/**
 * Live browser preview for HTML/CSS/JS — rendered entirely client-side.
 *
 * The iframe is sandboxed without `allow-same-origin`, so student scripts
 * run in an opaque origin: they can do anything a page can do, but cannot
 * touch the editor's DOM, storage or cookies.
 */
export default function HtmlPreview({
  source,
  reloadKey,
}: {
  source: string;
  /** Bumping this key remounts the iframe (a manual re-run). */
  reloadKey?: number;
}) {
  return (
    <section className="panel html-preview-panel">
      <header className="panel-header">
        <span>Live preview</span>
        <span className="panel-header-sub">rendered in your browser</span>
      </header>
      <iframe
        key={reloadKey ?? 0}
        title="HTML preview"
        className="html-preview-frame"
        sandbox="allow-scripts"
        srcDoc={source}
      />
    </section>
  );
}
