import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Per-day clock offset (in seconds). Combines a permanent offset
 * (clock_settings.permanent_offset_seconds) with a per-date override
 * (clock_offsets.offset_seconds) — override wins if present.
 */
export function useDayOffset(date: string) {
  const [permanent, setPermanent] = useState(0);
  const [override, setOverride] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ data: s }, { data: o }] = await Promise.all([
      supabase.from("clock_settings").select("permanent_offset_seconds").eq("id", 1).maybeSingle(),
      supabase.from("clock_offsets").select("offset_seconds").eq("flight_date", date).maybeSingle(),
    ]);
    setPermanent(s?.permanent_offset_seconds ?? 0);
    setOverride(o ? o.offset_seconds : null);
    setLoading(false);
  }, [date]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime so the office settings page propagates instantly
  useEffect(() => {
    const ch = supabase
      .channel(`clock-offset-${date}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "clock_offsets" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "clock_settings" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [date, refresh]);

  const offsetSec = override ?? permanent;
  return { offsetSec, permanent, override, loading, refresh };
}

/** Compute a signed offset (seconds, range ±12h) from caravan HH:mm vs current UK wall time. */
export function computeOffsetFromCaravanHHMM(caravan: string): number | null {
  const m = caravan.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const ch = +m[1], cm = +m[2];
  if (ch > 23 || cm > 59) return null;

  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour12: false,
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  const nh = parts.hour === "24" ? 0 : +parts.hour;
  const nm = +parts.minute;
  const ns = +parts.second;

  const caravanSec = ch * 3600 + cm * 60;
  const realSec = nh * 3600 + nm * 60 + ns;
  let diff = caravanSec - realSec;
  // Normalise to ±12h so a small clock drift across midnight is treated as small.
  if (diff > 12 * 3600) diff -= 24 * 3600;
  if (diff < -12 * 3600) diff += 24 * 3600;
  return diff;
}

export function fmtOffset(sec: number): string {
  const sign = sec < 0 ? "−" : sec > 0 ? "+" : "";
  const a = Math.abs(sec);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  if (h) return `${sign}${h}h ${m}m`;
  if (m) return `${sign}${m}m ${s}s`;
  return `${sign}${s}s`;
}
