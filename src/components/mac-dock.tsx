"use client";

import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

type DockItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
};

export function MacDock({ items }: { items: DockItem[] }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [hovered, setHovered] = React.useState<number | null>(null);
  const [mouseX, setMouseX] = React.useState<number | null>(null);
  const dockRef = React.useRef<HTMLDivElement>(null);

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        ref={dockRef}
        onMouseMove={(e) => setMouseX(e.clientX)}
        onMouseLeave={() => setMouseX(null)}
        className={cn(
          "flex items-end gap-4 px-5 py-3 rounded-3xl",
          "bg-background/25 backdrop-blur-2xl",
          "border border-white/20 dark:border-white/10",
          "shadow-[0_8px_40px_-8px_rgba(0,0,0,0.35)]",
          "relative",
        )}
      >
        {items.map((item, i) => {
          const ref = React.useRef<HTMLAnchorElement>(null);

          // macOS‑style magnification
          let scale = 1;
          if (mouseX !== null && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            const center = rect.left + rect.width / 2;
            const dist = Math.abs(mouseX - center);
            const max = 120;
            const factor = Math.max(0, 1 - dist / max);
            scale = 1 + factor * 0.55;
          }

          const active = path === item.to;

          return (
            <div
              key={item.to}
              className="relative flex flex-col items-center"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Tooltip */}
              <span
                className={cn(
                  "absolute -top-7 px-2 py-0.5 text-[10px] rounded-md",
                  "bg-foreground text-background whitespace-nowrap",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                )}
              >
                {item.label}
              </span>

              {/* Morphic bubble */}
              <AnimatePresence>
                {hovered === i && (
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1.4, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 200, damping: 20 }}
                    className={cn(
                      "absolute inset-0 rounded-full -z-10",
                      "bg-gradient-to-tr from-primary/40 via-primary/20 to-transparent",
                      "backdrop-blur-3xl shadow-lg",
                    )}
                  />
                )}
              </AnimatePresence>

              {/* Icon */}
              <Link
                ref={ref}
                to={item.to}
                aria-label={item.label}
                className={cn(
                  "grid place-items-center size-12 rounded-2xl transition-colors",
                  active ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-foreground hover:bg-secondary",
                )}
                style={{
                  transform: `scale(${scale}) translateY(${(scale - 1) * -12}px)`,
                  transition:
                    mouseX === null ? "transform 350ms cubic-bezier(0.22, 1, 0.36, 1)" : "transform 90ms ease-out",
                }}
              >
                {item.icon}
              </Link>

              {/* Active indicator */}
              {active && <span className="absolute -bottom-2 size-1.5 rounded-full bg-primary" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
