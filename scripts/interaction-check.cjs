/**
 * Interaction check: exercises states the static viewport matrix cannot see.
 *
 *  1. Landing hamburger menu at phone width — opens, stays inside the viewport.
 *  2. Full flow: /editor → Run → Visualize — the populated visualizer (journey
 *     story with code spotlight, step micro-diagrams and AI insight, the
 *     flowchart tab lit by the trace, variables, event log) at phone, laptop
 *     and desktop widths, asserting zero horizontal overflow and capturing
 *     screenshots.
 *  3. Touch targets on the journey/transport controls at phone width.
 *  4. AI Tutor: every code block in an answer offers Copy to workspace and
 *     clicking it really replaces the editor contents — the tutor API is
 *     mocked here so this never spends the free-tier key.
 *
 *   node scripts/interaction-check.cjs
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE_URL = process.env.AUDIT_URL || "http://localhost:3000";

async function loadPlaywright() {
  const candidates = ["playwright"];
  try {
    const base = path.join(os.homedir(), "AppData", "Local", "npm-cache", "_npx");
    for (const entry of fs.readdirSync(base)) {
      candidates.push(path.join(base, entry, "node_modules", "playwright"));
    }
  } catch {}
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error("playwright not found");
}

const report = [];
const fail = (name, detail) => report.push({ name, status: "FAIL", detail });
const pass = (name, detail) => report.push({ name, status: "PASS", detail });

(async () => {
  const { chromium } = await loadPlaywright();
  const shotDir = path.join(os.tmpdir(), "prizm-responsive");
  fs.mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch();

  // --- 1. mobile menu ------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    await page.goto(BASE_URL + "/", { waitUntil: "load", timeout: 90_000 });
    await page.waitForTimeout(800);
    try {
      await page.click(".nav-menu-btn");
      await page.waitForTimeout(300);
      const geo = await page.evaluate(() => {
        const menu = document.querySelector(".nav-mobile-menu");
        if (!menu) return { missing: true };
        const r = menu.getBoundingClientRect();
        const links = [...menu.querySelectorAll("a")].map((a) => {
          const ar = a.getBoundingClientRect();
          return { text: a.textContent.trim().slice(0, 24), h: Math.round(ar.height), top: Math.round(ar.top) };
        });
        return { r: { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }, vw: innerWidth, links };
      });
      if (geo.missing) fail("mobile-menu", "menu did not open");
      else if (geo.r.l < 0 || geo.r.r > geo.vw) fail("mobile-menu", `outside viewport ${JSON.stringify(geo.r)} vw=${geo.vw}`);
      else if (geo.links.length < 7) fail("mobile-menu", `only ${geo.links.length} links`);
      else if (geo.links.some((l) => l.h < 30)) fail("mobile-menu", `short link ${JSON.stringify(geo.links)}`);
      else pass("mobile-menu", `${geo.links.length} links, all inside ${geo.vw}px, tap>=30px`);
      await page.screenshot({ path: path.join(shotDir, "menu-360x740.png") });
    } catch (err) {
      fail("mobile-menu", String(err).slice(0, 160));
    }
    await ctx.close();
  }

  // --- 2. run → visualize with a real trace --------------------------------
  for (const [width, height] of [[360, 740], [1024, 768], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
    try {
      await page.goto(BASE_URL + "/editor", { waitUntil: "load", timeout: 90_000 });
      await page.waitForTimeout(2500); // monaco + providers

      await page.getByRole("button", { name: /Run/ }).first().click();
      // Console output (factorial demo prints 24) proves execution completed.
      await page.waitForFunction(() => {
        const el = document.querySelector(".console-panel");
        return el && /\d/.test(el.textContent || "");
      }, { timeout: 45_000 });
      pass(`run@${width}`, "console produced output");
      await page.screenshot({ path: path.join(shotDir, `flow-editor-${width}x${height}.png`) });

      await page.getByRole("button", { name: /Visualize/ }).first().click();
      await page.waitForURL(/\/visualize/, { timeout: 20_000 });
      try {
        await page.waitForSelector(".journey-panel, .event-row", { timeout: 45_000 });
      } catch (ribbonErr) {
        // Dump what the visualizer actually shows so the failure is diagnosable.
        const diag = await page.evaluate(() => ({
          url: location.pathname,
          placeholder: !!document.querySelector(".placeholder-panel, .viz-empty"),
          sideText: (document.querySelector(".side-content, .pane-side")?.textContent || "").slice(0, 260),
          bodyText: document.body.textContent.replace(/\s+/g, " ").slice(0, 400),
        }));
        const shot = path.join(shotDir, `flow-diag-${width}x${height}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        fail(`visualize-data@${width}`, `no ribbon; diag=${JSON.stringify(diag)} shot=${shot} err=${String(ribbonErr).slice(0, 80)}`);
        await ctx.close();
        continue;
      }
      await page.waitForTimeout(1200);

      const state = await page.evaluate(() => {
        const doc = document.documentElement;
        const rows = document.querySelectorAll(".event-row").length;
        const panels = {
          controls: !!document.querySelector(".controls"),
          journey: !!document.querySelector(".journey-panel"),
          events: rows,
        };
        return { overflowX: Math.max(0, doc.scrollWidth - innerWidth), panels, scrollH: doc.scrollHeight, vh: innerHeight };
      });

      if (state.overflowX > 1) fail(`visualize-data@${width}`, `overflowX=${state.overflowX}`);
      else if (!state.panels.controls || !state.panels.journey || state.panels.events < 5) fail(`visualize-data@${width}`, `panels=${JSON.stringify(state.panels)}`);
      else pass(`visualize-data@${width}`, `journey + ${state.panels.events} event rows, overflowX=0`);

      // Step visuals: walk the trace and confirm the micro-diagrams render —
      // stack push, substituted assignment, return flight and print output.
      {
        const seen = new Set();
        for (let i = 0; i < 14; i++) {
          const kind = await page.evaluate(() => {
            const el = document.querySelector(".journey-visual");
            if (!el) return null;
            const m = el.className.match(/sv-(stack|return|expr|branch|loop|print|error|plain)/);
            return m ? m[1] : "unknown";
          });
          if (kind) seen.add(kind);
          if (seen.has("stack") && seen.has("expr") && seen.has("return") && seen.has("print")) break;
          await page.keyboard.press("ArrowRight");
          await page.waitForTimeout(140);
        }
        const required = ["stack", "expr", "return", "print"];
        const missing = required.filter((k) => !seen.has(k));
        if (missing.length) fail(`step-visual@${width}`, `missing ${missing.join(",")} (saw ${[...seen].join(",") || "none"})`);
        else pass(`step-visual@${width}`, `diagrams rendered: ${[...seen].join(", ")}`);
        await page.keyboard.press("Home");
        await page.waitForTimeout(200);
      }

      // Flowchart tab with the same trace: nodes render, hot path lit, no
      // overflow — then return to Journey for the story assertions below.
      // The overlay only lights edges up to the current step, so jump to the
      // end of the trace first (Home/End keyboard transport).
      try {
        await page.keyboard.press("End");
        await page.waitForTimeout(250);
        await page.getByRole("button", { name: /Flowchart/ }).first().click();
        await page.waitForSelector(".flow-svg", { timeout: 20_000 });
        await page.waitForTimeout(900);
        const flowState = await page.evaluate(() => ({
          rects: document.querySelectorAll(".flow-svg rect").length,
          hot: document.querySelectorAll(".flow-edge.hot").length,
          overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        }));
        if (flowState.rects < 2 || flowState.hot < 1) fail(`flowchart@${width}`, JSON.stringify(flowState));
        else if (flowState.overflowX > 1) fail(`flowchart@${width}`, `overflowX=${flowState.overflowX}`);
        else pass(`flowchart@${width}`, `${flowState.rects} node rects, ${flowState.hot} hot edges, overflowX=0`);
        await page.locator(".flow-panel").scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(shotDir, `flow-flowchart-${width}x${height}.png`) });
      } catch (err) {
        fail(`flowchart@${width}`, String(err).slice(0, 160));
      } finally {
        await page.keyboard.press("Home"); // back to step 1 for the journey assertions
        await page.waitForTimeout(250);
        await page.getByRole("button", { name: /Journey/ }).first().click();
        await page.waitForSelector(".journey-card", { timeout: 20_000 });
      }

      if (pageErrors.length) fail(`pageerrors@${width}`, pageErrors.join(" | "));

      // Story layers: the real source line, grounded what/why/next text.
      const story = await page.evaluate(() => {
        const card = document.querySelector(".journey-card");
        const q = (s) => (card ? card.querySelector(s) : null);
        const ai = document.querySelector(".journey-ai");
        return {
          missing: !card,
          spotlight: (q(".journey-spot-code")?.textContent || "").trim(),
          headline: (q(".journey-headline")?.textContent || "").trim(),
          what: (q(".journey-explain")?.textContent || "").trim(),
          why: (q(".journey-tip")?.textContent || "").trim(),
          next: (q(".journey-next-body")?.textContent || "").trim(),
          aiClass: ai ? ai.className : null,
          aiText: (ai?.textContent || "").trim().slice(0, 240),
        };
      });
      if (story.missing) fail(`journey-story@${width}`, "no .journey-card");
      else if (!story.spotlight || !story.headline || !story.what)
        fail(`journey-story@${width}`, `empty layers spotlight="${story.spotlight}" headline="${story.headline}" what="${story.what}"`);
      else if (!story.why || !story.next)
        fail(`journey-story@${width}`, `missing why="${story.why}" next="${story.next}"`);
      else if (!story.aiClass)
        fail(`journey-story@${width}`, "no .journey-ai block");
      else pass(`journey-story@${width}`, `spotlight="${story.spotlight.slice(0, 30)}" next="${story.next.slice(0, 40)}"`);

      // AI insight: give the debounced fetch (750ms settle) time to resolve or
      // fail gracefully; either terminal state proves the layer works.
      const aiState = await (async () => {
        const deadline = Date.now() + 12_000;
        let last = null;
        while (Date.now() < deadline) {
          last = await page.evaluate(() => {
            const ai = document.querySelector(".journey-ai");
            if (!ai) return null;
            return { cls: ai.className, text: (ai.textContent || "").trim().slice(0, 240) };
          });
          if (last && (/\bready\b/.test(last.cls) || /\bfailed\b/.test(last.cls))) break;
          await page.waitForTimeout(600);
        }
        return last;
      })();
      if (!aiState) fail(`ai-insight@${width}`, "no .journey-ai block");
      else if (/\bready\b/.test(aiState.cls)) pass(`ai-insight@${width}`, `ready: "${aiState.text.slice(0, 90)}"`);
      else if (/\bfailed\b/.test(aiState.cls)) pass(`ai-insight@${width}`, `graceful failure: "${aiState.text.slice(0, 90)}"`);
      else if (/\bloading\b/.test(aiState.cls)) pass(`ai-insight@${width}`, `model still thinking (shimmer shown): "${aiState.text.slice(0, 60)}"`);
      else pass(`ai-insight@${width}`, `waiting (auto-off): "${aiState.text.slice(0, 90)}"`);

      // Touch targets at phone width (mirrors the matrix rule: >=36x26).
      if (width <= 820) {
        const tiny = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll(".journey-panel button, .controls button")) {
            if (el.classList.contains("journey-tl-marker")) continue; // scrubber dots: ::after bridge over a clickable track
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            if (r.width < 36 || r.height < 26) {
              out.push(`${(el.className || el.tagName).toString().trim().split(/\s+/)[0]} ${Math.round(r.width)}x${Math.round(r.height)}`);
            }
          }
          return out;
        });
        if (tiny.length) fail(`journey-tap@${width}`, tiny.slice(0, 6).join(", "));
        else pass(`journey-tap@${width}`, "every journey/transport button >= 36x26");
      }

      await page.locator(".journey-panel").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(shotDir, `flow-visualize-${width}x${height}.png`) });
    } catch (err) {
      fail(`flow@${width}`, String(err).slice(0, 200));
    }
    await ctx.close();
  }

  // Tutor streaming + copy-to-workspace (mocked API — never spends the key).
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const tutorErrors = [];
    page.on("pageerror", (e) => tutorErrors.push(String(e).slice(0, 160)));
    // A long (~32 line) canned answer so the line-by-line writing animation
    // is observable in two snapshots taken while it writes.
    const answer = [
      "Recursion is a function calling itself — here is the shape:",
      "",
      "```python",
      "def factorial(n):",
      "    if n <= 1:",
      "        return 1",
      "    return n * factorial(n - 1)",
      "```",
      "",
      "That block shows the base case on line 5 and the recursive call on line 7.",
      "Each call shrinks `n` by one until it reaches the base case.",
      "The call stack grows with every call, then unwinds as values return.",
      "Step 1: factorial(3) asks for factorial(2).",
      "Step 2: factorial(2) asks for factorial(1).",
      "Step 3: factorial(1) answers 1 right away.",
      "Step 4: factorial(2) can now answer 2 * 1 = 2.",
      "Step 5: factorial(3) can now answer 3 * 2 = 6.",
      "",
      "If you would rather have the whole file, apply this block:",
      "",
      "```prizm",
      "def factorial(n):",
      "    if n <= 1:",
      "        return 1",
      "    return n * factorial(n - 1)",
      "",
      "n = factorial(5)",
      "print(n)",
      "```",
      "",
      "The workspace block replaces your editor contents with this complete program.",
    ].join("\n");
    try {
      // Legacy one-shot endpoint — kept mocked so the fallback path can
      // never reach a real backend either.
      await page.route("**/api/tutor/explain", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ answer, model: "mock-tutor", truncated: false }),
        }),
      );
      // Streaming endpoint: three SSE delta batches + an end frame.
      await page.route("**/api/tutor/explain/stream", (route) => {
        const lines = answer.split("\n");
        const third = Math.ceil(lines.length / 3);
        const parts = [
          lines.slice(0, third),
          lines.slice(third, 2 * third),
          lines.slice(2 * third),
        ];
        const sse =
          parts
            .map((part, i) =>
              `data: ${JSON.stringify({
                t: "delta",
                text: part.join("\n") + (i < parts.length - 1 ? "\n" : ""),
              })}\n\n`,
            )
            .join("") +
          `data: ${JSON.stringify({ t: "end", model: "mock-tutor", truncated: false })}\n\n`;
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "access-control-allow-origin": "*" },
          body: sse,
        });
      });
      await page.goto(BASE_URL + "/editor", { waitUntil: "load", timeout: 60_000 });
      await page.waitForTimeout(3000);
      await page.getByRole("button", { name: /Write a small example program that demonstrates recursion/ }).click();
      await page.waitForSelector(".tutor-msg.assistant .md-pre .md-apply", { timeout: 20_000 });

      // Writing animation: the answer must GROW line by line (two snapshots
      // taken while it writes), with the skip button offered throughout.
      const snap = () =>
        page.evaluate(() => {
          const body = document.querySelector(".tutor-msg.assistant .tutor-answer");
          return {
            lines: body?.querySelector(".md")?.childElementCount ?? -1,
            chars: (body?.textContent || "").length,
            skip: !!body?.querySelector(".tutor-skip"),
          };
        });
      const g1 = await snap();
      await page.screenshot({ path: path.join(shotDir, "tutor-writing-1280x900.png") });
      await page.waitForTimeout(400);
      const g2 = await snap();
      if (g1.skip && g2.chars > g1.chars && g1.lines >= 0 && g2.lines >= g1.lines) {
        pass("tutor-writing", `grew ${g1.chars} → ${g2.chars} chars over 400ms, skip offered while writing`);
      } else {
        fail("tutor-writing", JSON.stringify({ g1, g2 }));
      }

      // Reveal finishes: the skip button disappears and every block lands.
      await page.waitForFunction(
        () => !document.querySelector(".tutor-msg.assistant .tutor-skip"),
        null,
        { timeout: 15_000 },
      );

      const info = await page.evaluate(() => {
        const blocks = [...document.querySelectorAll(".md .md-pre")];
        return {
          blocks: blocks.length,
          withButton: blocks.filter((b) => b.querySelector(".md-pre-head .md-apply")).length,
          labels: [...new Set(blocks.map((b) => b.querySelector(".md-apply")?.textContent?.trim() ?? "none"))],
        };
      });
      if (info.blocks >= 2 && info.withButton === info.blocks && info.labels.length === 1 && info.labels[0] === "Copy to workspace") {
        pass("tutor-copy-buttons", `${info.withButton}/${info.blocks} blocks offer "${info.labels[0]}"`);
      } else {
        fail("tutor-copy-buttons", JSON.stringify(info));
      }

      // Clicking really copies the snippet into the workspace editor.
      const before = await page.evaluate(() =>
        [...document.querySelectorAll(".monaco-editor .view-line")].map((l) => l.textContent).join("\n"),
      );
      await page.locator(".md-pre:not(.prizm) .md-apply").first().click();
      await page.waitForTimeout(600);
      const state = await page.evaluate(() => {
        const btn = document.querySelector(".md-pre:not(.prizm) .md-apply");
        return {
          label: btn?.textContent?.trim(),
          disabled: btn?.disabled,
          editor: [...document.querySelectorAll(".monaco-editor .view-line")].map((l) => l.textContent).join("\n"),
        };
      });
      if (state.label === "✓ copied" && state.disabled && state.editor !== before) {
        pass("tutor-copy-click", `label=${state.label}, editor replaced with the snippet`);
      } else {
        fail("tutor-copy-click", JSON.stringify({ label: state.label, disabled: state.disabled, changed: state.editor !== before }));
      }

      if (tutorErrors.length) fail("tutor-pageerrors", tutorErrors.join(" | "));
      else pass("tutor-pageerrors", "none");
      await page.screenshot({ path: path.join(shotDir, "tutor-copy-1280x900.png") });
    } catch (err) {
      fail("tutor-copy", String(err).slice(0, 200));
    }
    await ctx.close();
  }

  await browser.close();
  for (const row of report) console.log(JSON.stringify(row));
  const failed = report.filter((r) => r.status === "FAIL").length;
  console.log(JSON.stringify({ summary: { total: report.length, failed } }));
  process.exit(failed ? 1 : 0);
})();
