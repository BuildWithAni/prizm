"use client";

import CardArt, { type CardArtVariant } from "./CardArt";
import Reveal from "./Reveal";
import TiltCard from "./TiltCard";

const CARDS: { variant: CardArtVariant; title: string; desc: string }[] = [
  {
    variant: "pyramid",
    title: "Execution Visualizer",
    desc: "Step through your code and see variables, memory, call stack and control flow in real time.",
  },
  {
    variant: "wave",
    title: "AI Tutor",
    desc: "Get clear explanations, hints and suggestions contextually, for the exact line or concept you're stuck on.",
  },
  {
    variant: "cubes",
    title: "Project Explorer",
    desc: "Understand entire codebases with interactive maps, file dependencies and data flow visualizations.",
  },
  {
    variant: "book",
    title: "Built for Learning",
    desc: "Structured lessons, guided exercises and quizzes to help you retain what you learn.",
  },
];

export default function WhySection() {
  return (
    <section className="section" id="why">
      <div className="why-head">
        <div>
          <Reveal>
            <p className="eyebrow">◆ Why PRIZM —</p>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="section-title">
              A Smarter Way
              <br />
              to Learn and Build
            </h2>
          </Reveal>
        </div>
        <Reveal delay={0.16}>
          <p className="section-lead why-lead">
            PRIZM combines a powerful online editor, AI assistance and real-time visualizations to
            help you truly understand what your code does — not just what it outputs.
          </p>
        </Reveal>
      </div>

      <div className="why-grid">
        {CARDS.map((card, index) => (
          <Reveal
            key={card.title}
            delay={index * 0.1}
            rotateX={12}
            scale={0.94}
            className="why-reveal"
          >
            {/* pointer-driven 3D tilt + glare sweep on hover */}
            <TiltCard className="why-card" max={7}>
              <div className="why-art">
                <CardArt variant={card.variant} />
              </div>
              <h3 className="why-card-title">{card.title}</h3>
              <p className="why-card-desc">{card.desc}</p>
              <a href="/editor" className="learn-more">
                Learn more <span className="btn-arrow">→</span>
              </a>
            </TiltCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
