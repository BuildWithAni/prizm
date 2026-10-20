/**
 * Interaction check: exercises states the static viewport matrix cannot see.
 *
 *  1. Landing hamburger menu at phone width — opens, stays inside the viewport.
 *  2. Full flow: /editor → Run → Visualize — the populated visualizer (ribbon,
 *     narration, variables, event log) at phone and laptop widths, asserting
 *     zero horizontal overflow and capturing screenshots.
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
  for (const [width, height] of [[360, 740], [1024, 768]]) {
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
      if (pageErrors.length) fail(`pageerrors@${width}`, pageErrors.join(" | "));
      await page.screenshot({ path: path.join(shotDir, `flow-visualize-${width}x${height}.png`) });
    } catch (err) {
      fail(`flow@${width}`, String(err).slice(0, 200));
    }
    await ctx.close();
  }

  await browser.close();
  for (const row of report) console.log(JSON.stringify(row));
  const failed = report.filter((r) => r.status === "FAIL").length;
  console.log(JSON.stringify({ summary: { total: report.length, failed } }));
  process.exit(failed ? 1 : 0);
})();
