"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Avatar from "./Avatar";
import Reveal, { EASE } from "./Reveal";

const QUOTES = [
  {
    quote: "“PRIZM made recursion finally click for me. The visualizations are just next level.”",
    name: "Aarav Mehta",
    role: "B.Tech CSE Student",
  },
  {
    quote: "“I use PRIZM in my class to explain data structures. It saves hours and makes concepts fun.”",
    name: "Dr. Neha Sharma",
    role: "Assistant Professor",
  },
  {
    quote: "“The project visualizer is insane. I can understand a new codebase in minutes now.”",
    name: "Rohit Verma",
    role: "Software Developer",
  },
  {
    quote: "“Stepping through my own bugs taught me more than weeks of tutorials ever did.”",
    name: "Sneha Iyer",
    role: "Self-taught Developer",
  },
];

const VISIBLE = 3;

export default function Testimonials() {
  const [start, setStart] = useState(0);
  const [direction, setDirection] = useState(1);

  const move = (delta: number) => {
    setDirection(delta);
    setStart((current) => (current + delta + QUOTES.length) % QUOTES.length);
  };

  const visible = Array.from(
    { length: VISIBLE },
    (_, index) => QUOTES[(start + index) % QUOTES.length],
  );

  return (
    <section className="section testi-wrap" id="testimonials">
      <div className="testi-head">
        <div>
          <Reveal>
            <p className="eyebrow">◆ What people say —</p>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="section-title">
              Loved by Learners
              <br />
              and Educators
            </h2>
          </Reveal>
        </div>
        <Reveal delay={0.16}>
          <div className="testi-arrows">
            <button type="button" className="testi-arrow" onClick={() => move(-1)} aria-label="Previous">
              ←
            </button>
            <button type="button" className="testi-arrow" onClick={() => move(1)} aria-label="Next">
              →
            </button>
          </div>
        </Reveal>
      </div>

      <div className="testi-grid">
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((item) => (
            <motion.article
              key={item.name}
              layout
              className="testi-card"
              initial={{ opacity: 0, x: direction * 70, scale: 0.94 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: direction * -70, scale: 0.94 }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              <p className="stars">★★★★★</p>
              <p className="testi-quote">{item.quote}</p>
              <div className="testi-person">
                <Avatar name={item.name} size={40} />
                <div>
                  <p className="testi-name">{item.name}</p>
                  <p className="testi-role">{item.role}</p>
                </div>
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
