import { useEffect, useRef, useState } from "react";

/**
 * Returns [ref, inView] — inView flips true the first time the element
 * enters the viewport and stays true after. Used to defer count-up
 * animations on stats cards so the numbers tick up as the user scrolls.
 */
export function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || typeof IntersectionObserver === "undefined") {
      if (!seen) setSeen(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setSeen(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}
