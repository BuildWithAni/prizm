"use client";

/**
 * Perspective "tron floor" under the hero: a CSS-3D grid plane that drifts on
 * its own and slides/fades as the hero scrolls away. Pass the hero's
 * scroll progress so it reacts immediately, not after a whole page.
 */

import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";

export default function PerspectiveGrid({ scroll }: { scroll?: MotionValue<number> }) {
  const internal = useScroll().scrollYProgress;
  const progress = scroll ?? internal;
  const y = useTransform(progress, [0, 0.6], [0, 170]);
  const opacity = useTransform(progress, [0, 0.45], [0.55, 0]);

  return (
    <motion.div className="grid-floor" style={{ y, opacity }} aria-hidden="true">
      <div className="grid-floor-plane" />
    </motion.div>
  );
}
