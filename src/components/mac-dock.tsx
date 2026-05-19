import { Link, useRouterState } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import type { ReactNode } from "react";

type DockItem = {
  to: string;
  label: string;
  icon: ReactNode;
};

/**
 * macOS-style dock with magnification on hover/touch.
 * Fixed to bottom of viewport; mirrors top-bar nav for fast access.
 */
export function MacDock({ items }: { items: DockItem[] }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [mouseX, setMouseX] = useState<number | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-50 transition-all duration-700 ease-out ${
        mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div
        ref={dockRef}
        onMouseMove={(e) => setMouseX(e.clientX)}
        onMouseLeave={() => setMouseX(null)}
        className="flex items-end gap-1.5 px-3 py-2 rounded-2xl border border-white/20 bg-background/60 backdrop-blur-xl shadow-[0_12px_40px_-12px_color-mix(in_oklab,var(--sky-deep)_50%,transparent)]"
      >
        {items.map((item) => (
          <DockButton
            key={item.to}
            item={item}
            active={path === item.to}
            mouseX={mouseX}
            dockRef={dockRef}
          />
        ))}
      </div>
    </div>
  );
}

function DockButton({
  item,
  active,
  mouseX,
  dockRef,
}: {
  item: DockItem;
  active: boolean;
  mouseX: number | null;
  dockRef: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  let scale = 1;
  if (mouseX !== null && ref.current && dockRef.current) {
    const rect = ref.current.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const dist = Math.abs(mouseX - center);
    const max = 110;
    const factor = Math.max(0, 1 - dist / max);
    scale = 1 + factor * 0.55;
  }

  return (
    <div className="relative flex flex-col items-center group">
      <span
        className={`pointer-events-none absolute -top-7 px-2 py-0.5 text-[10px] rounded-md bg-foreground text-background opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap`}
      >
        {item.label}
      </span>
      <Link
        ref={ref}
        to={item.to}
        aria-label={item.label}
        className={`grid place-items-center size-10 rounded-xl transition-colors ${
          active
            ? "bg-primary text-primary-foreground"
            : "bg-secondary/70 text-foreground hover:bg-secondary"
        }`}
        style={{
          transform: `scale(${scale}) translateY(${(scale - 1) * -10}px)`,
          transition:
            mouseX === null
              ? "transform 350ms cubic-bezier(0.22, 1, 0.36, 1), background-color 200ms"
              : "transform 90ms ease-out, background-color 200ms",
        }}
      >
        {item.icon}
      </Link>
      {active && (
        <span className="absolute -bottom-1.5 size-1 rounded-full bg-primary" />
      )}
    </div>
  );
}
