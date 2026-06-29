import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { todayUKDate } from "@/lib/uktime";

const normReg = (s: string | null | undefined) =>
  (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Thin live "sky strip" — one dot per CLUB FLEET glider currently in the air.
 * Hidden when no club aircraft are flying.
 */
export function SkyStrip() {
  const [count, setCount] = useState<number>(0);
  const fleetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    const loadFleet = async () => {
      const { data } = await supabase.from("fleet_gliders").select("registration");
      fleetRef.current = new Set((data ?? []).map((r) => normReg(r.registration)));
    };

    const fetchCount = async () => {
      const today = todayUKDate();
      const { data } = await supabase
        .from("flights")
        .select("glider_registration")
        .eq("flight_date", today)
        .not("takeoff_time", "is", null)
        .is("landing_time", null);
      if (!active) return;
      const fleet = fleetRef.current;
      const n = (data ?? []).filter((r) => fleet.has(normReg(r.glider_registration))).length;
      setCount(n);
    };

    (async () => {
      await loadFleet();
      await fetchCount();
    })();

    const interval = setInterval(fetchCount, 30_000);
    const ch = supabase
      .channel(`sky-strip-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "flights" }, fetchCount)
      .on("postgres_changes", { event: "*", schema: "public", table: "fleet_gliders" }, async () => {
        await loadFleet();
        await fetchCount();
      })
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
      title={`${count} club fleet airborne`}
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
