import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Coord = number | Coord[];


type AirspaceFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: Coord };
  properties: {
    id?: string;
    name: string;
    ident: string;
    class: string;
    upper: string;
    lower: string;
    frequency?: string;
    colour: string;
    fill: number;
    notes?: string;
  };
};

type Result = { features: AirspaceFeature[]; error: string | null; cached?: boolean };

const cache = new Map<string, { ts: number; data: AirspaceFeature[] }>();
const TTL_MS = 1000 * 60 * 30; // 30 min

const BboxSchema = z.object({
  south: z.number().min(-90).max(90),
  west: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
});

type OpenAipAirspace = {
  _id?: string;
  name?: string;
  icaoClass?: number;
  type?: number;
  country?: string;
  frequency?: { value?: string; name?: string }[];
  upperLimit?: { value?: number; unit?: number; referenceDatum?: number };
  lowerLimit?: { value?: number; unit?: number; referenceDatum?: number };
  geometry?: { type: string; coordinates: Coord };
};

// Map OpenAIP icaoClass enum (0=A,1=B,2=C,3=D,4=E,5=F,6=G) to label
const ICAO_CLASS_LABEL = ["A", "B", "C", "D", "E", "F", "G"];
// Type enum (subset): 0=Other, 1=Restricted, 2=Danger, 3=Prohibited, 4=CTR, 5=TMA,
// 6=RMZ, 7=TMZ, 8=ATZ, 12=MATZ, 14=FIR, 21=Gliding sector, 26=Overflight restriction
const TYPE_LABEL: Record<number, string> = {
  0: "OTHER", 1: "RESTRICTED", 2: "DANGER", 3: "PROHIBITED", 4: "CTR", 5: "TMA",
  6: "RMZ", 7: "TMZ", 8: "ATZ", 12: "MATZ", 14: "FIR", 21: "GLIDING", 26: "OVERFLIGHT",
};
// Unit: 1=FT, 6=FL ; ReferenceDatum: 0=GND, 1=MSL, 2=STD
function fmtLimit(l?: { value?: number; unit?: number; referenceDatum?: number }): string {
  if (!l || l.value === undefined) return "";
  if (l.referenceDatum === 0 && l.value === 0) return "GND";
  if (l.unit === 6) return `FL${l.value}`;
  const datum = l.referenceDatum === 0 ? "AGL" : l.referenceDatum === 2 ? "STD" : "AMSL";
  return `${l.value}ft ${datum}`;
}
function colourFor(typeLabel: string, cls: string): string {
  if (typeLabel === "PROHIBITED" || typeLabel === "RESTRICTED") return "#ef4444";
  if (typeLabel === "DANGER") return "#f59e0b";
  if (typeLabel === "CTR" || typeLabel === "TMA" || cls === "D" || cls === "C") return "#3b82f6";
  if (typeLabel === "ATZ" || typeLabel === "MATZ") return "#8b5cf6";
  if (typeLabel === "GLIDING") return "#22c55e";
  if (typeLabel === "TMZ" || typeLabel === "RMZ") return "#06b6d4";
  return "#94a3b8";
}

export const getAirspaceForBbox = createServerFn({ method: "POST" })
  .inputValidator((input) => BboxSchema.parse(input))
  .handler(async ({ data }): Promise<Result> => {
    const apiKey = process.env.OPENAIP_API_KEY;
    if (!apiKey) {
      return { features: [], error: "OPENAIP_API_KEY not configured" };
    }
    const r = (n: number) => Math.round(n * 10) / 10;
    const key = `${r(data.south)},${r(data.west)},${r(data.north)},${r(data.east)}`;
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && now - cached.ts < TTL_MS) {
      return { features: cached.data, error: null, cached: true };
    }

    const url = new URL("https://api.core.openaip.net/api/airspaces");
    url.searchParams.set("bbox", `${data.west},${data.south},${data.east},${data.north}`);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("page", "1");

    try {
      const res = await fetch(url.toString(), {
        headers: { "x-openaip-api-key": apiKey, Accept: "application/json" },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { features: [], error: `OpenAIP ${res.status}: ${text.slice(0, 200)}` };
      }
      const json = (await res.json()) as { items?: OpenAipAirspace[] };
      const items = json.items ?? [];

      const features: AirspaceFeature[] = [];
      for (const a of items) {
        if (!a.geometry || !a.geometry.coordinates) continue;
        const cls = ICAO_CLASS_LABEL[a.icaoClass ?? -1] ?? "";
        const typeLabel = TYPE_LABEL[a.type ?? 0] ?? "OTHER";
        const upper = fmtLimit(a.upperLimit);
        const lower = fmtLimit(a.lowerLimit);
        const freq = a.frequency?.[0]?.value;
        features.push({
          type: "Feature",
          geometry: { type: a.geometry.type, coordinates: a.geometry.coordinates },
          properties: {
            id: a._id,
            name: a.name ?? "Unknown",
            ident: typeLabel,
            class: cls || typeLabel,
            upper: upper || "—",
            lower: lower || "—",
            frequency: freq,
            colour: colourFor(typeLabel, cls),
            fill: typeLabel === "PROHIBITED" || typeLabel === "RESTRICTED" || typeLabel === "DANGER" ? 0.12 : 0.06,
            notes: a.country,
          },
        });
      }

      cache.set(key, { ts: now, data: features });
      return { features, error: null, cached: false };
    } catch (err) {
      return { features: [], error: err instanceof Error ? err.message : "Fetch failed" };
    }
  });

