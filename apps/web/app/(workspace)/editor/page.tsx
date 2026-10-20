"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "../../../components/landing/Logo";
import CodeEditor from "../../../components/editor/CodeEditor";
import ConsolePanel from "../../../components/visualization/ConsolePanel";
import TutorPanel from "../../../components/tutor/TutorPanel";
import LanguageBar from "../../../components/workspace/LanguageBar";
import HtmlPreview from "../../../components/workspace/HtmlPreview";
import CreditsChip from "../../../components/workspace/CreditsChip";
import { useCredits } from "../../../components/workspace/CreditsProvider";
import { useWorkspace } from "../../../components/workspace/WorkspaceProvider";
import { KNOWN_TRACE_LANGUAGES, PREVIEW_LANGUAGES } from "../../../lib/languages";

/**
 * The writing desk: pick a language, write code, run it, and talk to the AI
 * Tutor about it. Every visualization lives on /visualize — this page stays
 * focused on the source and the conversation about it.
 */
export default function EditorPage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const { code, setCode, language, changeLanguage, traceStdin, addTraceStdin, clearTraceStdin, tracedFor, execution, runner } =
    workspace;

  const languageInfo = runner.languages.find((lang) => lang.id === language);
  const traceCapable = languageInfo ? languageInfo.trace : KNOWN_TRACE_LANGUAGES.includes(language);
  // Language discovery is advisory: a temporarily failed /api/languages request
  // must not disable Run. The session endpoint returns a clear toolchain error.
  const languageUnavailable = languageInfo ? !languageInfo.available : false;
  /** HTML runs as a live sandboxed preview — nothing executes on the server. */
  const isPreview = PREVIEW_LANGUAGES.includes(language);
  /** Bumped by Run to re-render the preview iframe. */
  const [previewRun, setPreviewRun] = useState(0);
  /** The recorded trace describes the code exactly as it is right now. */
  const traceFresh = tracedFor?.code === code && tracedFor?.language === language;
  const credits = useCredits();

  const runProgram = useCallback(() => {
    if (isPreview) {
      setPreviewRun((count) => count + 1);
      return;
    }
    runner.run(language, code);
  }, [runner, language, code, isPreview]);

  /** Jump to the visualizer; it records a fresh trace when the buffer changed. */
  const openVisualizer = useCallback(() => {
    router.push("/visualize");
  }, [router]);

  return (
    <div className="workspace">
      <header className="topbar">
        <Link href="/" className="brand" title="Back to home">
          <Logo size={24} showWord />
        </Link>
        <span className="topbar-kicker">Editor</span>

        <div className="topbar-right">
          {execution.requestError && (
            <span className="badge badge-error" title={execution.requestError}>
              API unreachable
            </span>
          )}
          {execution.result && (
            <span
              className={`badge badge-${execution.result.status}`}
              title={
                traceFresh
                  ? "A trace is ready — open the visualizer"
                  : "Trace recorded from an earlier version of the code; the visualizer will record a fresh one"
              }
            >
              {traceFresh ? `${execution.total} steps` : "trace outdated"}
            </span>
          )}
          <CreditsChip />
          <button
            className="btn btn-outline"
            onClick={openVisualizer}
            disabled={!traceCapable || languageUnavailable}
            title={
              traceCapable
                ? "Open the visualizer and step through this program"
                : "Step-through tracing is unavailable for this language here — use Run instead"
            }
          >
            ◎ Visualize
          </button>
          <button
            className="btn btn-solid"
            onClick={runProgram}
            disabled={runner.busy || languageUnavailable}
            title={
              isPreview
                ? "Re-render the live browser preview from the current code"
                : "Execute the program and stream its output"
            }
          >
            {runner.busy ? "Starting…" : runner.running ? "● Running" : isPreview ? "▶ Run (Preview)" : "▶ Run"}
          </button>
        </div>
      </header>

      <LanguageBar language={language} onSelect={changeLanguage} languages={runner.languages} />

      <div className="workspace-body">
        <section className="pane pane-editor">
          <div className="editor-wrap">
            {/* The highlight follows the step selected in the visualizer, but
                only while the buffer still matches the traced source — after
                an edit the old line numbers would point at the wrong code. */}
            <CodeEditor
              value={code}
              onChange={setCode}
              activeLine={tracedFor?.code === code ? (execution.currentEvent?.line ?? null) : null}
              language={language}
            />
          </div>

          {traceCapable && credits.outOfCredits && (
            <div className="error-card credits-empty-banner">
              <strong>Out of visualizer credits for today</strong>
              <span>
                You&apos;ve used all {credits.status?.limit ?? ""} visualizations on the Free plan — they reset at
                midnight. Pro gives you a much larger daily allowance; running code, the console and the tutor stay
                free on every plan.
              </span>
              <Link href="/pricing" className="btn btn-solid credits-empty-cta">
                ⚡ Get Pro
              </Link>
            </div>
          )}

          {isPreview ? (
            <HtmlPreview source={code} reloadKey={previewRun} />
          ) : (
            <ConsolePanel
              session={runner.session}
              busy={runner.busy}
              traceOutput={execution.visibleOutput}
              source={runner.session ? "run" : "trace"}
              error={runner.error}
              onSend={(line) => runner.sendInput(line)}
              onStop={() => runner.stop()}
              traceInputEnabled={!runner.session && traceCapable}
              stdinValue={traceStdin}
              onSupplyTraceInput={addTraceStdin}
              onClearTraceInput={clearTraceStdin}
            />
          )}
        </section>

        <aside className="pane pane-side">
          <div className="tutor-host">
            <TutorPanel
              currentEvent={execution.currentEvent}
              frameState={execution.activeFrameState}
              source={code}
              language={language}
              onApplyCode={setCode}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
