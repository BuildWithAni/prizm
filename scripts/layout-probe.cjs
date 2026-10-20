/**
 * One-off layout probe: for a couple of viewports, find the exact source of
 * horizontal document overflow (works for pseudo-elements too, since it
 * toggles display) and capture element-level screenshots of the demo window.
 *
 *   node scripts/layout-probe.cjs [320x568,820x1180,912x1368]
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

const SIZES = (process.argv[2] || "320x568,820x1180,912x1368")
  .split(",")
  .map((s) => s.split("x").map(Number));

(async () => {
  const { chromium } = await loadPlaywright();
  const shotDir = path.join(os.tmpdir(), "prizm-responsive");
  fs.mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch();

  for (const [width, height] of SIZES) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(BASE_URL + "/", { waitUntil: "load", timeout: 90_000 });
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.8);
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1400);

    const info = await page.evaluate(() => {
      const vw = window.innerWidth;
      const doc = document.documentElement;
      const desc = (el) => {
        let sel = el.tagName.toLowerCase();
        if (el.id) sel += "#" + el.id;
        if (el.className && typeof el.className === "string")
          sel += "." + el.className.trim().split(/\s+/).slice(0, 3).join(".");
        return sel;
      };
      const clipped = (el) => {
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX) || /(auto|scroll|hidden|clip)/.test(s.overflow)) return true;
        }
        return false;
      };

      // Rightmost non-clipped elements regardless of threshold.
      const rightmost = [];
      for (const el of document.body.querySelectorAll("*")) {
        if (el.namespaceURI === "http://www.w3.org/2000/svg") continue;
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (clipped(el)) continue;
        if (r.right > vw - 4) {
          rightmost.push({
            sel: desc(el),
            right: Math.round(r.right * 100) / 100,
            left: Math.round(r.left * 100) / 100,
            w: Math.round(r.width),
            pos: s.position,
            transform: s.transform === "none" ? "" : s.transform.slice(0, 60),
          });
        }
      }
      rightmost.sort((a, b) => b.right - a.right);

      // Exact contributor: hide subtrees and watch scrollWidth fall.
      const base = doc.scrollWidth;
      const contributes = (el) => {
        const prev = el.style.display;
        el.style.display = "none";
        const w = doc.scrollWidth;
        el.style.display = prev;
        return w < base;
      };
      let source = null;
      if (base > vw) {
        let node = [...document.body.children].find(contributes);
        if (node) {
          const pathSels = [];
          for (;;) {
            pathSels.push(desc(node));
            const kids = [...node.children].find(contributes);
            if (!kids) break;
            node = kids;
          }
          const r = node.getBoundingClientRect();
          const s = getComputedStyle(node);
          const before = getComputedStyle(node, "::before");
          const after = getComputedStyle(node, "::after");
          source = {
            path: pathSels,
            rect: { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) },
            width: s.width,
            position: s.position,
            transform: s.transform.slice(0, 60),
            pseudoBefore: before.content === "none" ? "" : `${before.content} w=${before.width} pos=${before.position}`,
            pseudoAfter: after.content === "none" ? "" : `${after.content} w=${after.width} pos=${after.position}`,
          };
        } else {
          source = { note: "no top-level subtree hides fix it (body/html level or pseudo of a wrapper)" };
        }
      }

      return {
        vw,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        overflowX: Math.max(0, doc.scrollWidth - vw),
        rightmost: rightmost.slice(0, 8),
        source,
      };
    });

    console.log(JSON.stringify({ size: `${width}x${height}`, ...info }));

    // Element screenshot of the demo window at this size.
    try {
      const win = page.locator(".window").first();
      await win.scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      await win.screenshot({ path: path.join(shotDir, `window-${width}x${height}.png`) });
      console.log(JSON.stringify({ size: `${width}x${height}`, windowShot: path.join(shotDir, `window-${width}x${height}.png`) }));
    } catch (err) {
      console.log(JSON.stringify({ size: `${width}x${height}`, windowShotError: String(err).slice(0, 140) }));
    }

    await context.close();
  }

  await browser.close();
})();
