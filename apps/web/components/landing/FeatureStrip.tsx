"use client";

import Reveal from "./Reveal";

const ITEMS = [
  {
    title: "Visual Execution",
    desc: "See how your code runs",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="9" />
        <polygon points="10,8.5 16,12 10,15.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: "AI Explanations",
    desc: "Get instant, simple insights",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="6" cy="7" r="2.4" />
        <circle cx="18" cy="7" r="2.4" />
        <circle cx="12" cy="17.5" r="2.4" />
        <line x1="7.8" y1="8.6" x2="10.4" y2="15.6" />
        <line x1="16.2" y1="8.6" x2="13.6" y2="15.6" />
        <line x1="8.4" y1="7" x2="15.6" y2="7" />
      </svg>
    ),
  },
  {
    title: "Project Understanding",
    desc: "Visualize entire codebases",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <polygon points="3,9 12,4.5 21,9 12,13.5" />
        <polyline points="5.5,11 5.5,16.5 12,19.8 18.5,16.5 18.5,11" />
      </svg>
    ),
  },
  {
    title: "Learn by Doing",
    desc: "Interactive, hands-on learning",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="4.5" width="16" height="15" rx="2.2" />
        <polygon points="10.5,9 15.5,12 10.5,15" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

/** Endless marquee of feature chips (three copies → seamless -33.33% loop). */
export default function FeatureStrip() {
  const loop = [...ITEMS, ...ITEMS, ...ITEMS];
  return (
    <section className="feature-strip">
      <Reveal className="marquee" amount={0.4}>
        <div className="marquee-track">
          {loop.map((item, index) => (
            <div key={index} className="strip-item">
              <span className="strip-icon">{item.icon}</span>
              <div>
                <p className="strip-title">{item.title}</p>
                <p className="strip-desc">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
