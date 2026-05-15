import { useEffect, useRef } from "react";

/**
 * Pixel murmuration — a tiny canvas that paints a flock of pixels
 * drifting in flowing, organic shapes (like starlings at dusk).
 * Designed to live inside the sticky header behind the glider.
 */
export function Murmuration({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Read theme color from CSS var, fall back to a sky blue
    const styles = getComputedStyle(document.documentElement);
    const themeColor = styles.getPropertyValue("--sky-deep").trim() || "oklch(0.35 0.14 250)";

    const COUNT = reduce ? 60 : 180;
    type P = { x: number; y: number; vx: number; vy: number };
    const particles: P[] = [];
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: rand(-width * 0.2, width * 1.2),
        y: rand(0, height),
        vx: rand(0.15, 0.55),
        vy: rand(-0.05, 0.05),
      });
    }

    let t = 0;
    let raf = 0;
    const tick = () => {
      t += 0.012;
      // soft trail fade
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.clearRect(0, 0, width, height);

      // Two flowing attractor curves shape the flock
      const cx1 = width * (0.35 + Math.sin(t * 0.7) * 0.12);
      const cy1 = height * (0.5 + Math.sin(t * 1.1) * 0.25);
      const cx2 = width * (0.75 + Math.cos(t * 0.5) * 0.15);
      const cy2 = height * (0.5 + Math.cos(t * 0.9) * 0.25);

      ctx.fillStyle = themeColor;
      for (const p of particles) {
        // flow-field-ish steering toward the two attractors + noise
        const a = Math.sin((p.x + t * 40) * 0.012) + Math.cos((p.y - t * 30) * 0.018);
        const dx1 = cx1 - p.x;
        const dy1 = cy1 - p.y;
        const dx2 = cx2 - p.x;
        const dy2 = cy2 - p.y;
        const d1 = Math.hypot(dx1, dy1) + 0.001;
        const d2 = Math.hypot(dx2, dy2) + 0.001;

        p.vx += (dx1 / d1) * 0.012 + (dx2 / d2) * 0.008 + Math.cos(a) * 0.04;
        p.vy += (dy1 / d1) * 0.012 + (dy2 / d2) * 0.008 + Math.sin(a) * 0.04;

        // baseline rightward drift (like a flock crossing the header)
        p.vx += 0.01;

        // damping / speed cap
        p.vx *= 0.94;
        p.vy *= 0.9;
        const sp = Math.hypot(p.vx, p.vy);
        const max = 1.2;
        if (sp > max) {
          p.vx = (p.vx / sp) * max;
          p.vy = (p.vy / sp) * max;
        }

        p.x += p.vx;
        p.y += p.vy;

        // wrap around horizontally, clamp vertically
        if (p.x > width + 8) p.x = -8;
        if (p.x < -10) p.x = width + 8;
        if (p.y < 0) p.y = 0;
        if (p.y > height) p.y = height;

        // pixel — crisp 1–2px squares with depth-based alpha
        const alpha = 0.35 + Math.min(1, sp / max) * 0.55;
        ctx.globalAlpha = alpha;
        const size = sp > 0.6 ? 2 : 1;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), size, size);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
