import { useEffect, useRef, useState } from "react";

/**
 * Animate a numeric value from its previous value to the target.
 * Returns a number you can format. Respects prefers-reduced-motion.
 */
export function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") { setValue(target); return; }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !Number.isFinite(target)) { setValue(target); fromRef.current = target; return; }

    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else { fromRef.current = to; rafRef.current = null; }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, durationMs]);

  return value;
}
