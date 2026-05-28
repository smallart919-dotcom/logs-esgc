import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { todayUKDate } from "@/lib/uktime";

/**
 * Live count of gliders currently in the air — flights where takeoff_time is
 * set, landing_time is null, and flight_date == today (UK). Subscribes to the
 * flights table so the count updates the instant a landing time is stamped
 * (manually or via OGN sync).
 */
export function AirborneBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const fetchCount = async () => {
      const today = todayUKDate();
      const { count: c, error } = await supabase
        .from("flights")
        .select("id", { head: true, count: "exact" })
        .eq("flight_date", today)
        .not("takeoff_time", "is", null)
        .is("landing_time", null);
      if (active && !error) setCount(c ?? 0);
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    const ch = supabase
      .channel(`airborne-badge-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "flights" },
        fetchCount,
      )
      .subscribe();
    return () => {
      active = false;
      clearInterval(interval);
      supabase.removeChannel(ch);
    };
  }, []);

  if (count === null) return null;
  const isEmpty = count === 0;
  return (
    <span
      className={`hidden xs:inline-flex sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold liquid-glass ${isEmpty ? "airborne-empty" : ""}`}
      title={
        isEmpty
          ? "No gliders currently airborne"
          : `${count} ${count === 1 ? "glider is" : "gliders are"} currently airborne`
      }
      aria-live="polite"
    >
      <span className="relative inline-flex size-2">
        <span
          className={`absolute inset-0 rounded-full ${isEmpty ? "bg-red-400/50 animate-pulse" : "bg-emerald-500 animate-ping opacity-70"}`}
        />
        <span
          className={`relative inline-flex size-2 rounded-full ${isEmpty ? "bg-red-400/80" : "bg-emerald-500"}`}
        />
      </span>
      <span className="tabular-nums">{count}</span>
      <span className="opacity-80">airborne</span>
    </span>
  );
}
