/**
 * Responsive audit: loads every page across a matrix of viewport sizes and
 * reports horizontal overflow, clipped content, and undersized tap targets.
 *
 *   node scripts/responsive-audit.cjs [--shots] [--pages=/editor] [--sizes=360x640]
 *
 * Findings print as JSON lines and a summary; screenshots (with --shots) land
 * in the temp dir printed at the start. Exit code 1 when anything is broken.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const BASE_URL = process.env.AUDIT_URL || "http://localhost:3000";

const PAGES = [
  { path: "/", name: "landing", fullPage: true },
  { path: "/editor", name: "editor" },
  { path: "/visualize", name: "visualize" },
  { path: "/pricing", name: "pricing" },
];

/** width x height across phones, tablets, laptops, desktops and ultrawides. */
const SIZES = [
  [320, 568], [360, 640], [390, 844], [414, 896], [480, 852],
  [600, 900], [768, 1024], [820, 1180], [912, 1368],
  [1024, 768], [1180, 820], [1280, 720], [1366, 768],
  [1440, 900], [1512, 982], [1728, 1117], [1920, 1080],
  [2560, 1080], [3440, 1440],
];

async function loadPlaywright() {
  const candidates = ["playwright"];
  // Fall back to the npx cache (playwright is available via npx but not a
  // local dependency of this repo).
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
  throw new Error("playwright not found (tried require paths: " + candidates.join(", ") + ")");
}

/** Runs inside the page: collects every layout defect currently on screen. */
function inspectInPage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const issues = [];
  const push = (kind, detail, el) => {
    if (issues.length >= 24) return;
    const rect = el.getBoundingClientRect();
    let sel = el.tagName.toLowerCase();
    if (el.id) sel += "#" + el.id;
    if (el.className && typeof el.className === "string") {
      sel += "." + el.className.trim().split(/\s+/).slice(0, 3).join(".");
    }
    issues.push({
      kind,
      sel,
      detail,
      rect: {
        l: Math.round(rect.left), r: Math.round(rect.right),
        t: Math.round(rect.top), b: Math.round(rect.bottom),
        w: Math.round(rect.width), h: Math.round(rect.height),
      },
    });
  };

  /** True when an ancestor (or self) clips horizontal overflow — then the
      element's bounds never reach the document's scrollable area. */
  const clippedHorizontally = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX) || /(auto|scroll|hidden|clip)/.test(s.overflow)) return true;
    }
    return false;
  };

  // 1. Page-level horizontal overflow (the classic "UI is sideways" bug).
  const doc = document.documentElement;
  const overflowX = Math.max(0, doc.scrollWidth - vw);

  // 2. Elements sticking out past either viewport edge AND able to affect the
  //    document's scrollable area (not clipped by any ancestor).
  const offenders = [];
  for (const el of document.body.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.right > vw + 2 || rect.left < -2) {
      if (!clippedHorizontally(el)) offenders.push(el);
    }
  }
  // Report outermost offenders only (parents of offenders, not children).
  const outermost = offenders.filter((el) => !offenders.some((o) => o !== el && o.contains(el)));
  for (const el of outermost.slice(0, 8)) push("offscreen", `past viewport edge (vw=${vw})`, el);

  // 3. Vertically clipped REAL content: only in-flow children count, so
  //    decorative absolutely-positioned art (glare, floor grids) is ignored.
  const clipped = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (el.namespaceURI === "http://www.w3.org/2000/svg" || el.closest("svg")) continue; // SVG roots clip by UA default
    let transformed = false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).transform !== "none") { transformed = true; break; }
    }
    if (transformed) continue; // rect geometry vs layout clientHeight is unreliable under transforms
    const style = getComputedStyle(el);
    if (style.overflowY !== "hidden" && style.overflow !== "hidden") continue;
    if (el.clientHeight < 40 || el.clientHeight === 0) continue;
    if (el.scrollTop > 0) continue; // a scrolled container legitimately shows less
    const elRect = el.getBoundingClientRect();
    let contentBottom = -Infinity;
    for (const child of el.children) {
      const cs = getComputedStyle(child);
      if (cs.position === "absolute" || cs.position === "fixed" || cs.display === "none") continue;
      const r = child.getBoundingClientRect();
      if (r.height > 0) contentBottom = Math.max(contentBottom, r.bottom);
    }
    if (Number.isFinite(contentBottom) && contentBottom > elRect.top + el.clientHeight + 6) clipped.push(el);
  }
  const outerClipped = clipped.filter((el) => !clipped.some((o) => o !== el && o.contains(el)));
  for (const el of outerClipped.slice(0, 8)) {
    push("clipped-y", "in-flow content cut at overflow:hidden boundary", el);
  }

  // 4. Tiny tap targets on touch-ish widths, aggregated by selector.
  const tiny = {};
  if (vw <= 820) {
    for (const el of document.body.querySelectorAll("button, a, .btn, .tab, .language-option")) {
      if (el.classList.contains("ribbon-tick") || el.classList.contains("journey-tl-marker")) continue; // dense strips: ::after hit area bridged over an already-clickable track
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue; // display:none has a 0x0 rect
        if (rect.width < 36 || rect.height < 26) {
        let sel = el.tagName.toLowerCase();
        if (el.className && typeof el.className === "string") {
          sel += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
        }
        tiny[sel] = (tiny[sel] || 0) + 1;
      }
    }
  }
  const tinyTargets = Object.values(tiny).reduce((a, b) => a + b, 0);
  const tinyBySelector = Object.entries(tiny)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([sel, count]) => `${sel} x${count}`);

  // 5. When the document overflows, list rightmost non-clipped elements so the
  //    culprit is identifiable even if it slipped past the thresholds above.
  let rightmost = [];
  if (overflowX > 1) {
    for (const el of document.body.querySelectorAll("*")) {
      if (el.namespaceURI === "http://www.w3.org/2000/svg") continue;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.position === "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (clippedHorizontally(el)) continue;
      if (r.right > vw - 4) {
        let sel = el.tagName.toLowerCase();
        if (el.id) sel += "#" + el.id;
        if (el.className && typeof el.className === "string")
          sel += "." + el.className.trim().split(/\s+/).slice(0, 3).join(".");
        rightmost.push(`${sel} r=${Math.round(r.right)}`);
      }
    }
    rightmost = [...new Set(rightmost)].sort().slice(0, 8);
  }

  return {
    overflowX,
    issues,
    tinyTargets,
    tinyBySelector,
    rightmost,
    title: document.title,
    scrollH: doc.scrollHeight,
  };
}

(async () => {
  const args = process.argv.slice(2);
  const wantShots = args.includes("--shots");
  const pageFilter = args.find((a) => a.startsWith("--pages="));
  const sizeFilter = args.find((a) => a.startsWith("--sizes="));
  let pages = PAGES;
  let sizes = SIZES;
  if (pageFilter) {
    const wanted = pageFilter.split("=")[1].split(",");
    pages = pages.filter((p) => wanted.includes(p.path) || wanted.includes(p.name));
  }
  if (sizeFilter) {
    const wanted = new Set(sizeFilter.split("=")[1].split(","));
    sizes = sizes.filter(([w, h]) => wanted.has(`${w}x${h}`));
  }

  const { chromium } = await loadPlaywright();
  const shotDir = path.join(os.tmpdir(), "prizm-responsive");
  fs.mkdirSync(shotDir, { recursive: true });
  console.log(JSON.stringify({ type: "meta", baseUrl: BASE_URL, shotDir, pages: pages.length, sizes: sizes.length }));

  const browser = await chromium.launch();
  const failures = [];

  for (const pageDef of pages) {
    for (const [width, height] of sizes) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("pageerror", (err) => consoleErrors.push(String(err).slice(0, 200)));
      let result;
      try {
        await page.goto(BASE_URL + pageDef.path, { waitUntil: "load", timeout: 90_000 });
        // Walk the whole page first: triggers lazy reveal animations, image
        // loads and scroll-linked choreography, then return to the top.
        await page.evaluate(async () => {
          const step = Math.round(window.innerHeight * 0.8);
          for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 60));
          }
          window.scrollTo(0, 0);
        });
        // Let dev-server compile, fonts, monaco, canvases and fetches settle.
        await page.waitForTimeout(width <= 768 ? 1600 : 1200);
        result = await page.evaluate(inspectInPage);
      } catch (err) {
        result = { overflowX: -1, issues: [{ kind: "load", sel: String(err).slice(0, 160) }], tinyTargets: 0, tinyBySelector: [] };
      }

      const broken =
        result.overflowX > 1 ||
        result.issues.some((i) => i.kind !== "load") ||
        result.issues.some((i) => i.kind === "load");

      const row = {
        page: pageDef.path,
        size: `${width}x${height}`,
        overflowX: result.overflowX,
        tinyTargets: result.tinyTargets,
        tinyBySelector: result.tinyBySelector,
        rightmost: result.rightmost,
        scrollH: result.scrollH,
        issues: result.issues,
        pageErrors: consoleErrors.slice(0, 3),
      };
      if (broken || wantShots) {
        const shot = path.join(shotDir, `${pageDef.name}-${width}x${height}.png`);
        try {
          await page.screenshot({ path: shot, fullPage: Boolean(pageDef.fullPage) });
          row.shot = shot;
        } catch {}
      }
      console.log(JSON.stringify(row));
      if (broken) failures.push(`${pageDef.path} @ ${width}x${height}`);
      await context.close();
    }
  }

  await browser.close();
  console.log(JSON.stringify({ type: "summary", broken: failures.length, failures }));
  process.exit(failures.length ? 1 : 0);
})();
