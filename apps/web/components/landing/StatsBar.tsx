"use client";

import CountUp from "./CountUp";
import Reveal from "./Reveal";

const STATS = [
  { num: "50K+", label: "Active Learners" },
  { num: "1M+", label: "Code Executions" },
  { num: "4.9/5", label: "User Satisfaction", stars: true },
  { num: "20+", label: "Colleges & Educators" },
];

export default function StatsBar() {
  return (
    <section className="section stats-wrap">
      <Reveal>
        <p className="eyebrow">◆ Trusted by a growing community —</p>
      </Reveal>
      <div className="stats-bar">
        {STATS.map((stat, index) => (
          <Reveal key={stat.label} delay={index * 0.12} scale={0.9} className="stat">
            <p className="stat-num">
              <CountUp value={stat.num} />
            </p>
            <p className="stat-label">{stat.label}</p>
            {stat.stars && <p className="stars">★★★★★</p>}
          </Reveal>
        ))}
      </div>
    </section>
  );
}
