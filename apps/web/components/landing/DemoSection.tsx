"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import Reveal from "./Reveal";

const CODE = [
  { n: 1, text: "def factorial(n):" },
  { n: 2, text: "    if n <= 1:" },
  { n: 3, text: "        return 1" },
  { n: 4, text: "    return n * factorial(n-1)" },
  { n: 5, text: "" },
  { n: 6, text: "num = 4" },
  { n: 7, text: "result = factorial(num)" },
  { n: 8, text: "print(result)", active: true },
  { n: 9, text: "" },
];

/** Static mockup of the PRIZM workspace for the landing page demo section. */
function DemoWindow() {
  return (
    <div className="window">
      <div className="window-bar">
        <span className="window-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="window-tab">▣ main.py ×</span>
        <span className="window-bar-right">
          <span className="window-select">▷ Python ▾</span>
          <span className="window-run">▶ Run</span>
        </span>
      </div>

      <div className="window-body">
        <div className="window-code">
          {CODE.map((line) => (
            <div key={line.n} className={"mock-code-row" + (line.active ? " active" : "")}>
              <span className="mock-line-no">{line.n}</span>
              <span className="mock-line-text">{line.text || " "}</span>
            </div>
          ))}
        </div>

        <div className="window-viz">
          <div className="viz-tabs">
            <span className="viz-tab active">Visualization</span>
            <span className="viz-tab">Output</span>
            <span className="viz-tab">AI Explanation</span>
          </div>
          <div className="viz-canvas">
            <svg viewBox="0 0 420 250" className="viz-svg" aria-hidden="true">
              <defs>
                <filter id="ds-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* connectors */}
              <g stroke="#3B4A7A" strokeWidth="1.6" fill="none">
                <line x1="286" y1="48" x2="222" y2="86" />
                <line x1="206" y1="114" x2="142" y2="152" />
                <line x1="126" y1="180" x2="70" y2="214" />
                <line x1="336" y1="34" x2="360" y2="34" />
                <line x1="256" y1="100" x2="280" y2="100" />
                <line x1="176" y1="166" x2="200" y2="166" />
              </g>

              {/* call nodes */}
              <g fontFamily="inherit">
                <g filter="url(#ds-glow)">
                  <rect x="242" y="20" width="88" height="28" rx="14" fill="#26305C" stroke="#6478C9" />
                  <text x="286" y="39" textAnchor="middle" fill="#EAF0FF" fontSize="14">
                    factorial(4)
                  </text>
                </g>
                <rect x="158" y="86" width="88" height="28" rx="14" fill="#26305C" stroke="#6478C9" />
                <text x="202" y="105" textAnchor="middle" fill="#EAF0FF" fontSize="14">
                  factorial(3)
                </text>
                <rect x="78" y="152" width="88" height="28" rx="14" fill="#26305C" stroke="#6478C9" />
                <text x="122" y="171" textAnchor="middle" fill="#EAF0FF" fontSize="14">
                  factorial(2)
                </text>
                <rect x="14" y="214" width="88" height="28" rx="14" fill="#26305C" stroke="#6478C9" />
                <text x="58" y="233" textAnchor="middle" fill="#EAF0FF" fontSize="14">
                  factorial(1)
                </text>

                {/* result bubbles */}
                <g>
                  <rect x="360" y="20" width="52" height="28" rx="14" fill="#F5F5F5" />
                  <text x="386" y="39" textAnchor="middle" fill="#0A0A0A" fontSize="13" fontWeight="700">
                    4 × 6
                  </text>
                </g>
                <g>
                  <rect x="280" y="86" width="52" height="28" rx="14" fill="#F5F5F5" />
                  <text x="306" y="105" textAnchor="middle" fill="#0A0A0A" fontSize="13" fontWeight="700">
                    3 × 2
                  </text>
                </g>
                <g>
                  <rect x="200" y="152" width="52" height="28" rx="14" fill="#F5F5F5" />
                  <text x="226" y="171" textAnchor="middle" fill="#0A0A0A" fontSize="13" fontWeight="700">
                    2 × 1
                  </text>
                </g>
              </g>
            </svg>
          </div>
        </div>
      </div>

      <div className="window-controls">
        <span className="ctrl-btn">⏸</span>
        <span className="ctrl-btn ctrl-play">▶</span>
        <span className="ctrl-track">
          <span className="ctrl-fill" />
          <span className="ctrl-knob" />
        </span>
        <span className="ctrl-step">Step 4 / 12</span>
      </div>
    </div>
  );
}

export default function DemoSection() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });

  // The workspace mockup swings in 3D as you scroll past it.
  const rotateY = useTransform(scrollYProgress, [0, 1], [18, -12]);
  const rotateX = useTransform(scrollYProgress, [0, 1], [7, -5]);
  const y = useTransform(scrollYProgress, [0, 1], [90, -90]);

  return (
    <section className="section demo-section" id="demo" ref={ref}>
      <div className="demo-copy">
        <Reveal>
          <p className="eyebrow">◆ Interactive Demo —</p>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="section-title">
            Turn Code into
            <br />
            Understanding
          </h2>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="section-lead">
            Write code on the left. Watch it execute on the right. See variables change, follow the
            flow, and get AI explanations for every step.
          </p>
        </Reveal>
        <Reveal delay={0.24}>
          <div className="hero-actions">
            <a href="/editor" className="btn btn-solid btn-lg">
              Try it Yourself <span className="btn-arrow">→</span>
            </a>
            <a href="#why" className="btn btn-outline btn-lg">
              See All Features
            </a>
          </div>
        </Reveal>
      </div>
      <motion.div
        className="demo-window-wrap"
        style={{ rotateY, rotateX, y, transformPerspective: 1300 }}
      >
        <DemoWindow />
      </motion.div>
    </section>
  );
}
