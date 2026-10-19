"use client";

import dynamic from "next/dynamic";
import Reveal from "./Reveal";

const PrismScene = dynamic(() => import("./PrismScene"), {
  ssr: false,
  loading: () => (
    <div className="prism-scene prism-scene-compact cta-prism prism-loading" aria-hidden="true" />
  ),
});

export default function CtaSection() {
  return (
    <section className="section cta-band">
      <div className="cta-copy">
        <Reveal rotateX={10}>
          <h2 className="cta-title">
            Ready to See
            <br />
            Your Code Differently?
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="cta-sub">
            Join thousands of learners who are already building, understanding and growing with PRIZM.
          </p>
        </Reveal>
        <Reveal delay={0.22}>
          <div className="cta-actions">
            <a href="/editor" className="btn btn-solid btn-lg">
              Get Started Free <span className="btn-arrow">→</span>
            </a>
            <span className="cta-note">No credit card required</span>
          </div>
        </Reveal>
      </div>
      <div className="cta-art">
        {/* second live prism — same glass + spectrum, compacter framing */}
        <PrismScene className="cta-prism" compact />
        <Reveal delay={0.3}>
          <p className="cta-words">
            See
            <br />
            Learn
            <br />
            Build
            <br />
            Grow
          </p>
        </Reveal>
      </div>
    </section>
  );
}
