import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { todayUKDate } from "@/lib/uktime";

const normReg = (s: string | null | undefined) =>
  (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Live count of CLUB FLEET gliders currently in the air. A flight counts when
 * takeoff_time is set, landing_time is null, flight_date is today (UK), AND
 * the glider_registration matches an entry in fleet_gliders. Updates live via
 * realtime subscriptions on both flights and fleet_gliders.
 */
export function AirborneBadge() {
  const [count, setCount] = useState<number | null>(null);
  const fleetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    const loadFleet = async () => {
      const { data } = await supabase.from("fleet_gliders").select("registration");
      fleetRef.current = new Set((data ?? []).map((r) => normReg(r.registration)));
    };

    const fetchCount = async () => {
      const today = todayUKDate();
      const { data, error } = await supabase
        .from("flights")
        .select("glider_registration")
        .eq("flight_date", today)
        .not("takeoff_time", "is", null)
        .is("landing_time", null);
      if (!active || error) return;
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
      .channel(`airborne-badge-${Math.random().toString(36).slice(2)}`)
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

  if (count === null) return null;
  const isEmpty = count === 0;
  return (
    <span
      className={`hidden xs:inline-flex sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold liquid-glass ${isEmpty ? "airborne-empty" : ""}`}
      title={
        isEmpty
          ? "No club fleet gliders currently airborne"
          : `${count} club ${count === 1 ? "glider is" : "gliders are"} currently airborne`
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
