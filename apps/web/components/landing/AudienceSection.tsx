"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import Reveal from "./Reveal";

const AUDIENCES = [
  {
    title: "Students",
    desc: "Build a strong foundation and understand concepts visually.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <polygon points="2.5,9.5 12,5 21.5,9.5 12,14" />
        <path d="M6 11.5v4.5c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.5" />
      </svg>
    ),
  },
  {
    title: "Educators",
    desc: "Create interactive lessons and track student progress.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="9" cy="8.5" r="3" />
        <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
        <circle cx="17" cy="9.5" r="2.4" />
        <path d="M16 14.5c2.5 0 4.5 1.8 4.5 4.5" />
      </svg>
    ),
  },
  {
    title: "Self-Learners",
    desc: "Learn at your own pace with AI-guided practice.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <polyline points="8.5,7.5 4,12 8.5,16.5" />
        <polyline points="15.5,7.5 20,12 15.5,16.5" />
        <line x1="13.2" y1="5.5" x2="10.8" y2="18.5" />
      </svg>
    ),
  },
  {
    title: "Developers",
    desc: "Explore and understand unfamiliar codebases quickly.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <circle cx="6" cy="6.7" r="0.9" fill="currentColor" />
        <circle cx="8.8" cy="6.7" r="0.9" fill="currentColor" />
      </svg>
    ),
  },
];

/** Audience section: risograph-style poster + "From First Program to Real Projects". */
export default function AudienceSection() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });

  // Poster swings in 3D and drifts at its own parallax speed.
  const posterY = useTransform(scrollYProgress, [0, 1], [80, -80]);
  const posterRotateY = useTransform(scrollYProgress, [0, 1], [15, -11]);

  return (
    <section className="section audience-section" id="learners" ref={ref}>
      <Reveal rotateX={8}>
        <motion.div
          style={{ y: posterY, rotateY: posterRotateY, transformPerspective: 1200 }}
          className="poster-wrap"
        >
          <div className="poster">
            <div className="poster-left">
              <span>For</span>
              <span>Students</span>
              <span>Educators</span>
              <span>Builders</span>
            </div>
            <div className="poster-main">
              <svg viewBox="0 0 200 240" className="poster-triangle" aria-hidden="true">
                <polygon points="100,28 172,196 40,170" fill="#0A0A0A" />
                <polygon points="100,28 128,132 40,170" fill="#121212" opacity="0.6" />
              </svg>
              <svg className="poster-grain" aria-hidden="true">
                <filter id="poster-noise">
                  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" />
                  <feColorMatrix type="saturate" values="0" />
                </filter>
                <rect width="100%" height="100%" filter="url(#poster-noise)" opacity="0.4" />
              </svg>
              <span className="poster-caption">Visual code · learner</span>
            </div>
            <div className="poster-strip">
              <span className="poster-strip-text">The future of hands-on learners</span>
            </div>
          </div>
        </motion.div>
      </Reveal>

      <div className="audience-copy">
        <Reveal>
          <p className="eyebrow">◆ Made for every learner —</p>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="section-title">
            From First Program
            <br />
            to Real Projects
          </h2>
        </Reveal>
        <div className="audience-grid">
          {AUDIENCES.map((item, index) => (
            <Reveal key={item.title} delay={0.16 + index * 0.09} y={26}>
              <div className="audience-item">
                <span className="aud-icon">{item.icon}</span>
                <div>
                  <p className="aud-title">{item.title}</p>
                  <p className="aud-desc">{item.desc}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
