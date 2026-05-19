/**
 * Ambient animated background inspired by kokonutd's shape-landing-hero.
 * Rotated, blurred gradient pills that fade + float in on every page load.
 * Pointer-events disabled — purely decorative behind page content.
 */
type Shape = {
  className: string;
  style: React.CSSProperties;
  gradient: string;
  rotate: number;
  delay: number;
};

const SHAPES: Shape[] = [
  {
    className: "w-[28rem] h-28 left-[-6%] top-[12%]",
    gradient: "from-primary/30 to-transparent",
    style: {},
    rotate: -12,
    delay: 0,
  },
  {
    className: "w-[22rem] h-24 right-[-4%] top-[24%]",
    gradient: "from-accent/25 to-transparent",
    style: {},
    rotate: 14,
    delay: 120,
  },
  {
    className: "w-[18rem] h-20 left-[6%] bottom-[14%]",
    gradient: "from-sky/30 to-transparent",
    style: {},
    rotate: 8,
    delay: 240,
  },
  {
    className: "w-[14rem] h-16 right-[14%] bottom-[24%]",
    gradient: "from-primary/25 to-transparent",
    style: {},
    rotate: -22,
    delay: 360,
  },
  {
    className: "w-[10rem] h-12 left-[28%] top-[8%]",
    gradient: "from-accent/20 to-transparent",
    style: {},
    rotate: 28,
    delay: 480,
  },
];

export function ShapesBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {SHAPES.map((s, i) => (
        <div
          key={i}
          className={`shape-rise absolute ${s.className}`}
          style={{
            ...s.style,
            animationDelay: `${s.delay}ms`,
            ["--shape-rotate" as string]: `${s.rotate}deg`,
          }}
        >
          <div
            className={`shape-float w-full h-full rounded-full bg-gradient-to-r ${s.gradient} backdrop-blur-2xl border border-white/10`}
            style={{ animationDelay: `${s.delay + 200}ms` }}
          />
        </div>
      ))}
      {/* Soft vignette to fade edges */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,var(--color-background)_100%)]" />
    </div>
  );
}
