"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { AvatarGroup } from "./Avatar";
import PerspectiveGrid from "./PerspectiveGrid";
import { EASE } from "./Reveal";

const PrismScene = dynamic(() => import("./PrismScene"), {
  ssr: false,
  loading: () => <div className="prism-scene prism-loading" aria-hidden="true" />,
});

const LANGUAGES = [
  { name: "Python", hint: "live", active: true },
  { name: "JavaScript", hint: "live" },
  { name: "TypeScript", hint: "live" },
  { name: "Java", hint: "live" },
  { name: "Kotlin", hint: "live" },
  { name: "C", hint: "live" },
  { name: "C++", hint: "live" },
  { name: "Go", hint: "live" },
  { name: "Ruby", hint: "live" },
];

const HERO_MENU = ["Execution Flow", "Call Stack", "Variables", "Memory View", "Explain with AI"];

const CODE_LINES = [
  "def fibonacci(n):",
  "  if n <= 1:",
  "    return n",
  "  return fibonacci(n-1) + fibonacci(n-2)",
  "",
  "n = 5",
  "result = fibonacci(n)",
  "print(result)",
];

const TITLE_LINES = ["Don’t just", "read code."];

/** Mount-time rise-in used all over the hero. */
const rise = (delay: number) => ({
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, delay, ease: EASE },
});

export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });

  // Layered parallax: each element drifts at its own speed as you scroll.
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const copyFade = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const artY = useTransform(scrollYProgress, [0, 1], [0, -40]);
  const langY = useTransform(scrollYProgress, [0, 1], [0, -160]);
  const codeY = useTransform(scrollYProgress, [0, 1], [0, -250]);
  const menuY = useTransform(scrollYProgress, [0, 1], [0, -70]);

  return (
    <section className="hero" ref={heroRef}>
      <PerspectiveGrid scroll={scrollYProgress} />

      <motion.div className="hero-copy" style={{ y: copyY, opacity: copyFade }}>
        <motion.p className="eyebrow" {...rise(0.08)}>
          ◆ Visual Programming Environment —
        </motion.p>
        <h1 className="hero-title">
          {TITLE_LINES.map((line, index) => (
            <span className="line-mask" key={line}>
              <motion.span {...rise(0.16 + index * 0.09)} style={{ display: "inline-block" }}>
                {line}
              </motion.span>
            </span>
          ))}
          <span className="line-mask">
            <motion.span className="glow-text" {...rise(0.34)} style={{ display: "inline-block" }}>
              See it think.
            </motion.span>
          </span>
        </h1>
        <motion.p className="hero-sub" {...rise(0.42)}>
          PRIZM turns your code into interactive visualizations, making it easier to understand, learn
          and build — line by line, block by block, across your entire projects.
        </motion.p>
        <motion.div className="hero-actions" {...rise(0.5)}>
          <a href="/editor" className="btn btn-solid btn-lg">
            Start Coding Free <span className="btn-arrow">→</span>
          </a>
          <a href="#demo" className="btn btn-outline btn-lg">
            <span className="btn-play">▶</span> Watch Demo
          </a>
        </motion.div>
        <motion.div className="social-proof" {...rise(0.58)}>
          <AvatarGroup names={["Aarav M", "Neha S", "Rohit V", "Sneha I", "Karan P"]} />
          <div className="social-proof-text">
            <span>
              Loved by <strong>50,000+</strong> students &amp; educators
            </span>
            <span className="stars">★★★★★</span>
          </div>
        </motion.div>
      </motion.div>

      <motion.div className="hero-art" style={{ y: artY }}>
        {/* The real 3D prism: spins, follows the mouse, rotates with scroll. */}
        <PrismScene className="art-prism" scroll={scrollYProgress} />

        <motion.div style={{ y: langY }}>
          <motion.div className="lang-card" {...rise(0.62)}>
            {LANGUAGES.map((lang) => (
              <div key={lang.name} className={"lang-row" + (lang.active ? " active" : "")}>
                <span className="lang-badge">{lang.name.slice(0, 2)}</span>
                <span>{lang.name}</span>
                {lang.hint === "live" && <span className="lang-tag">● live</span>}
              </div>
            ))}
          </motion.div>
        </motion.div>

        <motion.div style={{ y: codeY }}>
          <motion.div className="code-chip-group" {...rise(0.72)}>
            <p className="art-label">
              Same code
              <br />
              a brighter way
              <br />
              to understand <span className="art-arrow">↷</span>
            </p>
            <div className="code-chip-card">
              <pre className="code-chip-pre">
                {CODE_LINES.map((line, index) => (
                  <div
                    key={index}
                    className={index === CODE_LINES.length - 1 ? "code-chip-hl" : undefined}
                  >
                    {line || " "}
                  </div>
                ))}
              </pre>
            </div>
          </motion.div>
        </motion.div>

        <motion.div style={{ y: codeY }}>
          <motion.a href="/editor" className="viz-cta" {...rise(0.82)}>
            <span className="viz-cta-play">▶</span>
            <span className="viz-cta-text">
              Visualize Execution <span className="btn-arrow">→</span>
            </span>
          </motion.a>
        </motion.div>

        <motion.div style={{ y: menuY }}>
          <motion.ul className="side-menu" {...rise(0.78)}>
            {HERO_MENU.map((item) => (
              <li key={item}>
                <span className="side-menu-dot" />
                {item}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        <motion.p className="art-label art-label-bottom" {...rise(0.9)}>
          From code
          <br />
          to clarity
        </motion.p>
      </motion.div>
    </section>
  );
}
