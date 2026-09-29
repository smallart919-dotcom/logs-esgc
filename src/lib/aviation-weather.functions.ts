import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Server-side proxy: aviationweather.gov blocks direct browser requests.
export const getAviationWeather = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ kind: z.enum(["metar", "taf"]), ids: z.string().regex(/^[A-Z0-9]{4}(,[A-Z0-9]{4}){0,15}$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    const url = data.kind === "metar"
      ? `https://aviationweather.gov/api/data/metar?ids=${data.ids}&format=json&hours=2`
      : `https://aviationweather.gov/api/data/taf?ids=${data.ids}&format=json`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "ESGC-Logs/1.0" } });
      clearTimeout(t);
      if (!r.ok) return [] as Array<Record<string, string>>;
      const j = await r.json();
      return (Array.isArray(j) ? j : []).map((x: Record<string, unknown>) => ({
        icaoId: String(x.icaoId ?? ""),
        rawOb: String(x.rawOb ?? ""),
        reportTime: String(x.reportTime ?? ""),
        rawTAF: String(x.rawTAF ?? ""),
      }));
    } catch {
      return [] as Array<Record<string, string>>;
    }
  });
