import { useEffect, useState } from "react";

export type MetarRecord = { id: string; raw: string; obs: string };
export type TafRecord = { id: string; raw: string };

/**
 * Fetches METAR (10 min) and TAF (30 min) from NOAA aviationweather.gov
 * for the given ICAO list. Re-fetches when the list changes.
 */
export function useAviationWeather(icaos: string[]) {
  const [metar, setMetar] = useState<MetarRecord[]>([]);
  const [taf, setTaf] = useState<TafRecord[]>([]);
  const key = icaos.join(",");

  useEffect(() => {
    if (!key) { setMetar([]); return; }
    let cancelled = false;
    const fetchMetar = async () => {
      try {
        const r = await fetch(`https://aviationweather.gov/api/data/metar?ids=${key}&format=json&hours=2`);
        if (!r.ok) return;
        const json = await r.json() as Array<{ icaoId: string; rawOb: string; reportTime: string }>;
        if (cancelled || !Array.isArray(json)) return;
        const latest = new Map<string, MetarRecord>();
        for (const m of json) {
          if (!latest.has(m.icaoId)) latest.set(m.icaoId, { id: m.icaoId, raw: m.rawOb, obs: m.reportTime });
        }
        setMetar(Array.from(latest.values()));
      } catch { /* noop */ }
    };
    fetchMetar();
    const id = setInterval(fetchMetar, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [key]);

  useEffect(() => {
    if (!key) { setTaf([]); return; }
    let cancelled = false;
    const fetchTaf = async () => {
      try {
        const r = await fetch(`https://aviationweather.gov/api/data/taf?ids=${key}&format=json`);
        if (!r.ok) return;
        const json = await r.json() as Array<{ icaoId: string; rawTAF: string }>;
        if (cancelled || !Array.isArray(json)) return;
        const latest = new Map<string, TafRecord>();
        for (const t of json) {
          if (t.rawTAF && !latest.has(t.icaoId)) latest.set(t.icaoId, { id: t.icaoId, raw: t.rawTAF });
        }
        setTaf(Array.from(latest.values()));
      } catch { /* noop */ }
    };
    fetchTaf();
    const id = setInterval(fetchTaf, 30 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [key]);

  return { metar, taf };
}

/**
 * Aerodromes within sensible range of Ringmer / Deanland (the gliding site).
 * `near` = within ~25nm; these light up by default.
 * Deanland itself (EGML) and Ringmer have no METAR/TAF — Shoreham (EGKA)
 * and Headcorn (EGKH) are the closest reporting stations.
 */
export const NEARBY_AIRFIELDS: { icao: string; name: string; near: boolean }[] = [
  { icao: "EGKA", name: "Shoreham (closest licensed)", near: true },
  { icao: "EGKH", name: "Headcorn / Lashenden", near: true },
  { icao: "EGKK", name: "Gatwick", near: true },
  { icao: "EGKB", name: "Biggin Hill", near: false },
  { icao: "EGMD", name: "Lydd", near: false },
  { icao: "EGMC", name: "Southend", near: false },
  { icao: "EGLL", name: "Heathrow", near: false },
];
