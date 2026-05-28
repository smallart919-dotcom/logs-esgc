import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { todayUKDate } from "@/lib/uktime";

/**
 * Thin live "sky strip" rendered next to the airborne badge in the header.
 * One dot per glider currently in the air, each drifting horizontally at a
 * slightly different pace to feel alive. Hidden when nothing is flying.
 */
export function SkyStrip() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let active = true;
    const fetchCount = async () => {
      const today = todayUKDate();
      const { count: c } = await supabase
        .from("flights")
        .select("id", { head: true, count: "exact" })
        .eq("flight_date", today)
        .not("takeoff_time", "is", null)
        .is("landing_time", null);
      if (active) setCount(c ?? 0);
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    const ch = supabase
      .channel(`sky-strip-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "flights" }, fetchCount)
      .subscribe();
    return () => {
      active = false;
      clearInterval(interval);
      supabase.removeChannel(ch);
    };
  }, []);

  if (count <= 0) return null;
  const dots = Array.from({ length: Math.min(count, 12) });
  return (
    <span
      aria-hidden
      className="hidden sm:inline-block relative h-3 w-24 overflow-hidden rounded-full liquid-glass ml-1"
      title={`${count} airborne`}
    >
      {dots.map((_, i) => (
        <span
          key={i}
          className="sky-dot absolute top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-emerald-500"
          style={{
            left: `${(i / dots.length) * 100}%`,
            animationDelay: `${-i * 1.6}s`,
            animationDuration: `${10 + (i % 4) * 2}s`,
          }}
        />
      ))}
    </span>
  );
}
