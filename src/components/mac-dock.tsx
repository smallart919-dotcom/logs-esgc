import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type DockItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
};

/**
 * Apple Liquid Glass dock — translucent, blurred, with a morphic
 * hover bubble that grows under the active icon.
 */
export function MacDock({ items }: { items: DockItem[] }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [hovered, setHovered] = React.useState<number | null>(null);

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center px-3 max-w-[calc(100vw-1rem)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <TooltipProvider delayDuration={120}>
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 24, delay: 0.1 }}
          className={cn(
            "liquid-glass relative flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 rounded-3xl",
            "overflow-x-auto max-w-full [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {/* Specular highlight on top edge */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-3 top-0 h-px rounded-full bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/30"
          />
          {items.map((item, i) => {
            const active = path === item.to;
            return (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>
                  <div
                    className="relative flex items-center justify-center shrink-0"
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <AnimatePresence>
                      {hovered === i && (
                        <motion.div
                          initial={{ scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1.35, opacity: 1 }}
                          exit={{ scale: 0.6, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 220, damping: 18 }}
                          className={cn(
                            "absolute inset-0 rounded-full -z-10",
                            "bg-gradient-to-tr from-primary/40 via-primary/15 to-transparent",
                            "backdrop-blur-2xl shadow-md dark:shadow-primary/20",
                          )}
                        />
                      )}
                    </AnimatePresence>
                    <Link
                      to={item.to}
                      aria-label={item.label}
                      className={cn(
                        "relative z-10 grid place-items-center size-10 rounded-full transition-all duration-200",
                        "hover:scale-110",
                        active
                          ? "bg-primary/90 text-primary-foreground shadow-[0_4px_14px_-4px_color-mix(in_oklab,var(--primary)_55%,transparent)]"
                          : "text-foreground/80 hover:text-foreground",
                      )}
                    >
                      {item.icon}
                    </Link>
                    {active && (
                      <motion.span
                        layoutId="dock-active-dot"
                        className="absolute -bottom-1 size-1 rounded-full bg-primary"
                      />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </motion.div>
      </TooltipProvider>
    </div>
  );
}
