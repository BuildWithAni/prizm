"use client";

/**
 * Shared scroll-reveal wrapper: fades/slides/tilts children in the first time
 * they enter the viewport. Used all over the landing page.
 */

import { motion } from "framer-motion";

export const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  /** 3D tilt-in from the given degrees (perspective comes from the parent). */
  rotateX?: number;
  scale?: number;
  /** How much of the element must be visible before it animates. */
  amount?: number;
}

export default function Reveal({
  children,
  className,
  delay = 0,
  y = 34,
  rotateX = 0,
  scale = 1,
  amount = 0.25,
}: RevealProps) {
  return (
    <motion.div
      className={className}
      style={{ transformPerspective: 900 }}
      initial={{ opacity: 0, y, rotateX, scale }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.75, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
