/**
 * Animated runway loader: a glider on a tow line being pulled along a runway
 * with dashed centre line. Used as a friendly inline loading indicator —
 * drop in wherever you'd put a spinner.
 */
export function RunwayLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <div className="relative w-72 h-16 overflow-hidden rounded-full liquid-glass">
        {/* Runway centre line */}
        <div
          aria-hidden
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] runway-stripes opacity-70"
        />
        {/* Tow-plane silhouette */}
        <svg
          viewBox="0 0 32 18"
          className="absolute top-1/2 -translate-y-1/2 size-7 text-primary runway-towplane"
          fill="currentColor"
          aria-hidden
        >
          <path d="M2 9 L 26 9 L 28 8 L 30 9 L 28 10 L 26 9 Z" />
          <path d="M10 5 L 22 5 L 24 9 L 22 13 L 10 13 L 8 9 Z" />
          <path d="M14 2 L 18 2 L 20 9 L 18 16 L 14 16 L 12 9 Z" />
        </svg>
        {/* Tow rope */}
        <div aria-hidden className="absolute top-1/2 -translate-y-1/2 h-px bg-foreground/40 runway-rope" />
        {/* Glider silhouette */}
        <svg
          viewBox="0 0 64 24"
          className="absolute top-1/2 -translate-y-1/2 w-12 h-5 text-accent runway-glider"
          fill="currentColor"
          aria-hidden
        >
          <path d="M2 12 Q 18 9 32 12 Q 46 9 62 12 L 62 12.6 Q 46 11 32 13 Q 18 11 2 12.6 Z" />
          <path d="M22 11.6 Q 32 10.8 50 12 L 50 12.6 Q 32 13.2 22 12.4 Z" />
          <ellipse cx="48" cy="11.6" rx="2.4" ry="1.1" />
          <path d="M22 9.6 L 24 9.6 L 24 14.6 L 22 14.6 Z" />
        </svg>
      </div>
      <div className="text-xs text-muted-foreground tracking-wide uppercase">{label}</div>
    </div>
  );
}
