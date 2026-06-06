// Best-effort daily NATS NOTAM refresh.
// Strategy: fetch the NATS daily pre-flight briefing summary page (text content),
// extract NOTAM-shaped records with lat/lon/radius, and upsert into `notams`.
// If the source format changes, we log the error and leave existing records intact.
// Records older than 48h with no upsert are pruned.
import { createClient } from "@supabase/supabase-js";

const NATS_SOURCES = [
  // Daily plain-text briefing endpoints (publicly accessible). Order matters —
  // first that returns text is used. These URLs may move; failures are logged.
  "https://nats-uk.ead-it.com/cms-nats/export/sites/default/en/Publications/Pre-flight-Briefing/Daily/today.txt",
  "https://www.nats-uk.ead-it.com/cms-nats/opencms/en/Publications/Pre-flight-Briefing/Daily/today.txt",
];

type ParsedNotam = {
  ref: string;
  centre_lat: number;
  centre_lon: number;
  radius_nm: number | null;
  lower_ft: number | null;
  upper_ft: number | null;
  valid_from: string | null;
  valid_to: string | null;
  description: string;
  raw: string;
  kind: string;
};

/** Parse NOTAM coordinate string "510530N 0001212W" -> [lat, lon] decimal degrees. */
function parseLatLon(s: string): [number, number] | null {
  const m = s.match(/(\d{2})(\d{2})(\d{2})([NS])\s*(\d{3})(\d{2})(\d{2})([EW])/);
  if (!m) return null;
  let lat = parseInt(m[1], 10) + parseInt(m[2], 10) / 60 + parseInt(m[3], 10) / 3600;
  if (m[4] === "S") lat = -lat;
  let lon = parseInt(m[5], 10) + parseInt(m[6], 10) / 60 + parseInt(m[7], 10) / 3600;
  if (m[8] === "W") lon = -lon;
  return [lat, lon];
}

function classify(raw: string): string {
  const u = raw.toUpperCase();
  if (u.includes("DANGER AREA") || /\bEG D\d/.test(u)) return "danger";
  if (u.includes("TEMPORARY RESERVED") || u.includes(" TRA ")) return "tra";
  if (u.includes("RESTRICTED AREA") || /\bEG R\d/.test(u)) return "restricted";
  return "notam";
}

function parseNotams(text: string): ParsedNotam[] {
  const out: ParsedNotam[] = [];
  // NOTAMs typically begin with a line containing the ref like "A1234/26" and
  // end at a blank line or next ref. We split on ref boundaries.
  const blocks = text.split(/\n(?=[A-Z]\d{3,5}\/\d{2,4}\b)/);
  for (const block of blocks) {
    const refMatch = block.match(/^([A-Z]\d{3,5}\/\d{2,4})\b/);
    if (!refMatch) continue;
    const ref = refMatch[1];
    const coord = parseLatLon(block);
    if (!coord) continue;
    // Radius extraction: "RADIUS 5NM" or "5NM RADIUS" or trailing "001" (nm) after coords
    let radius_nm: number | null = null;
    const rMatch = block.match(/(\d{1,3})\s?NM/i) || block.match(/RADIUS\s*(\d{1,3})/i);
    if (rMatch) radius_nm = Math.min(50, parseInt(rMatch[1], 10));
    if (radius_nm === null) {
      // tail-of-coordinate format e.g. "510530N 0001212W005" = 5nm
      const tail = block.match(/[NS]\s*\d{7}[EW](\d{3})\b/);
      if (tail) radius_nm = parseInt(tail[1], 10) || null;
    }
    let lower_ft: number | null = null;
    let upper_ft: number | null = null;
    const lower = block.match(/LOWER:?\s*(SFC|GND|\d{1,5})\s*(FT|M|FL)?/i);
    const upper = block.match(/UPPER:?\s*(UNL|\d{1,5})\s*(FT|M|FL)?/i);
    if (lower) lower_ft = lower[1].toUpperCase() === "SFC" || lower[1].toUpperCase() === "GND" ? 0 : parseInt(lower[1], 10);
    if (upper) upper_ft = upper[1].toUpperCase() === "UNL" ? 99999 : parseInt(upper[1], 10) * (upper[2]?.toUpperCase() === "FL" ? 100 : 1);
    // Validity B) YYMMDDHHMM C) YYMMDDHHMM
    const parseValid = (tag: "B" | "C") => {
      const m = block.match(new RegExp(`\\b${tag}\\)\\s*(\\d{10})`));
      if (!m) return null;
      const s = m[1];
      const yyyy = 2000 + parseInt(s.slice(0, 2), 10);
      const mm = parseInt(s.slice(2, 4), 10) - 1;
      const dd = parseInt(s.slice(4, 6), 10);
      const hh = parseInt(s.slice(6, 8), 10);
      const mi = parseInt(s.slice(8, 10), 10);
      return new Date(Date.UTC(yyyy, mm, dd, hh, mi)).toISOString();
    };
    const description = (block.match(/E\)([\s\S]{0,400}?)(?:\n[A-Z]\)|$)/)?.[1] || block.slice(0, 240)).trim();
    out.push({
      ref,
      centre_lat: coord[0],
      centre_lon: coord[1],
      radius_nm,
      lower_ft,
      upper_ft,
      valid_from: parseValid("B"),
      valid_to: parseValid("C"),
      description,
      raw: block.slice(0, 2000),
      kind: classify(block),
    });
  }
  return out;
}

export async function refreshNotamsFromNATS(): Promise<{ fetched: number; upserted: number; source: string | null; error?: string }> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let text: string | null = null;
  let usedSource: string | null = null;
  for (const url of NATS_SOURCES) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "ESGCLogs/1.0" } });
      if (r.ok) {
        const t = await r.text();
        if (t && t.length > 100) {
          text = t;
          usedSource = url;
          break;
        }
      }
    } catch (e) {
      console.warn("NOTAM source failed:", url, e);
    }
  }
  if (!text) {
    return { fetched: 0, upserted: 0, source: null, error: "No NATS source reachable" };
  }

  const parsed = parseNotams(text);
  if (parsed.length === 0) {
    return { fetched: 0, upserted: 0, source: usedSource, error: "Parsed zero records" };
  }

  // Restrict to UK bounding box (sanity).
  const inUK = parsed.filter(
    (n) =>
      n.centre_lat >= 49 &&
      n.centre_lat <= 61 &&
      n.centre_lon >= -9 &&
      n.centre_lon <= 3,
  );

  const rows = inUK.map((n) => ({
    notam_ref: n.ref,
    kind: n.kind,
    centre_lat: n.centre_lat,
    centre_lon: n.centre_lon,
    radius_nm: n.radius_nm,
    polygon: null,
    lower_ft: n.lower_ft,
    upper_ft: n.upper_ft,
    valid_from: n.valid_from,
    valid_to: n.valid_to,
    description: n.description.slice(0, 1000),
    raw: n.raw,
    source: "nats",
  }));

  const { error } = await supabase
    .from("notams")
    .upsert(rows, { onConflict: "notam_ref" });
  if (error) {
    return { fetched: parsed.length, upserted: 0, source: usedSource, error: error.message };
  }

  // Prune NOTAMs whose valid_to has passed by more than 24h.
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await supabase.from("notams").delete().lt("valid_to", cutoff).eq("source", "nats");

  return { fetched: parsed.length, upserted: rows.length, source: usedSource };
}
