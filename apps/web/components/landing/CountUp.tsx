"use client";

/** Animated number that counts up the first time it scrolls into view. */

import { useEffect, useRef } from "react";
import { useInView } from "framer-motion";

function parse(value: string): { target: number; suffix: string; decimals: number } | null {
  const match = value.match(/^([\d.]+)(.*)$/);
  if (!match) return null;
  return {
    target: parseFloat(match[1]),
    suffix: match[2],
    decimals: match[1].includes(".") ? 1 : 0,
  };
}

export default function CountUp({ value, duration = 1500 }: { value: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const parsed = parse(value);

  useEffect(() => {
    if (!inView || !parsed) return;
    const { target, suffix, decimals } = parsed;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      if (ref.current) ref.current.textContent = (target * eased).toFixed(decimals) + suffix;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, parsed, duration]);

  if (!parsed) return <span>{value}</span>;
  return <span ref={ref}>0{parsed.suffix}</span>;
}
