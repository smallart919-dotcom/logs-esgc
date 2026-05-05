import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// OGN Flightbook public API: https://flightbook.glidernet.org/api/logbook/{ICAO}/
// Returns devices[] (with address = FLARM ID) and flights[] for the day.
type OgnDevice = { address: string; registration?: string; cn?: string; aircraft?: string };
type OgnFlight = {
  start?: string; stop?: string; duration?: string;
  device: number;
  start_airfield?: number; stop_airfield?: number;
  start_tow?: number | null; tow_height?: number | null;
};
type OgnPayload = { airfield?: string; date?: string; devices: OgnDevice[]; flights: OgnFlight[] };

function todayUTC() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function parseTimeOnDate(date: string, hms?: string): string | null {
  if (!hms) return null;
  // OGN times are UTC HH:MM:SS
  return new Date(`${date}T${hms}Z`).toISOString();
}

export const Route = createFileRoute("/api/public/hooks/ogn-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { icao?: string; date?: string } = {};
        try { body = await request.json(); } catch {}
        const icao = (body.icao || process.env.OGN_AIRFIELD_ICAO || "").toUpperCase().trim();
        const date = body.date || todayUTC();

        if (!icao) {
          return Response.json({ error: "Missing airfield ICAO. Set it in Settings." }, { status: 400 });
        }

        // Fetch fleet to know which FLARM IDs belong to the club
        const { data: fleet, error: fleetErr } = await supabaseAdmin
          .from("fleet_gliders").select("id, registration, flarm_id");
        if (fleetErr) return Response.json({ error: fleetErr.message }, { status: 500 });
        const fleetByFlarm = new Map(
          (fleet ?? []).filter((g) => g.flarm_id).map((g) => [g.flarm_id!.toUpperCase(), g])
        );

        // Fetch OGN flightbook (today). For historical dates the JSON API returns
        // empty arrays — fall back to scraping the public HTML logbook.
        const url = `https://flightbook.glidernet.org/api/logbook/${encodeURIComponent(icao)}/`;
        let payload: OgnPayload;
        let source: "json" | "html" = "json";
        try {
          const r = await fetch(url, { headers: { Accept: "application/json" } });
          if (!r.ok) throw new Error(`OGN ${r.status}`);
          payload = (await r.json()) as OgnPayload;
        } catch (e: any) {
          return Response.json({ error: `OGN fetch failed: ${e.message}` }, { status: 502 });
        }

        if (!payload.flights || payload.flights.length === 0) {
          try {
            const [y, m, d] = date.split("-");
            const ddmmyyyy = `${d}${m}${y}`;
            const htmlUrl = `https://logbook.glidernet.org/index.php?a=${encodeURIComponent(icao)}&s=QFE&u=M&z=1&p=&t=0&td=15&d=${ddmmyyyy}`;
            const hr = await fetch(htmlUrl);
            if (!hr.ok) throw new Error(`HTML ${hr.status}`);
            const html = await hr.text();
            payload = parseHtmlLogbook(html);
            source = "html";
          } catch (e: any) {
            return Response.json({ error: `OGN historical fetch failed: ${e.message}` }, { status: 502 });
          }
        }

        const synced_at = new Date().toISOString();
        let created = 0, updated = 0, skipped = 0;
        const errors: Array<{ flarm: string | null; registration: string | null; message: string }> = [];
        const matches: Array<{
          status: "created" | "updated" | "unmatched" | "skipped";
          flarm: string | null;
          registration: string | null;
          callsign: string | null;
          confidence: "high" | "low";
          takeoff: string | null;
          landing: string | null;
          launch_type: "aerotow" | "winch" | null;
          tow_height_ft: number | null;
          synced_at: string;
        }> = [];

        // Pre-load all existing OGN flights for the day to enable stronger dedupe
        const { data: existingDay } = await supabaseAdmin
          .from("flights")
          .select("id, flarm_id, glider_registration, takeoff_time, landing_time, ogn_source, launch_type, aerotow_height_ft")
          .eq("flight_date", date).eq("manual", false);
        const dayFlights = existingDay ?? [];

        const TIME_WINDOW_MS = 90 * 1000; // ±90s window for fuzzy match

        for (const f of payload.flights || []) {
          const dev = payload.devices?.[f.device];
          const flarm = dev?.address ? dev.address.toUpperCase() : null;
          const takeoff = parseTimeOnDate(date, f.start);
          const landing = parseTimeOnDate(date, f.stop);
          const fleetMatch = flarm ? fleetByFlarm.get(flarm) : undefined;

          // Excluded registrations (tow planes / motor gliders) — never log
          const EXCLUDED_REGS = new Set(["G-ESGC", "G-KIAU"]);
          const regUpper = (dev?.registration || "").toUpperCase().trim();
          if (EXCLUDED_REGS.has(regUpper)) {
            skipped++;
            matches.push({ status: "skipped", flarm, registration: dev?.registration ?? null, callsign: dev?.cn ?? null, confidence: "low", takeoff, landing, launch_type: null, tow_height_ft: null, synced_at });
            continue;
          }
          // Only log known club gliders (in the fleet table). Anything else (visitors, tugs,
          // non-glider aircraft) is skipped so the daily log stays clean.
          if (!fleetMatch) {
            skipped++;
            matches.push({ status: "skipped", flarm, registration: dev?.registration ?? null, callsign: dev?.cn ?? null, confidence: "low", takeoff, landing, launch_type: null, tow_height_ft: null, synced_at });
            continue;
          }

          // Tow plane present → assume aerotow
          const hasTow = f.start_tow !== null && f.start_tow !== undefined;
          const launchType: "aerotow" | "winch" | null = hasTow ? "aerotow" : null;
          const towHeightFt = hasTow && f.tow_height ? Math.round(f.tow_height) : null;

          if (!takeoff) {
            skipped++;
            matches.push({ status: "skipped", flarm, registration: dev?.registration ?? null, callsign: dev?.cn ?? null, confidence: "low", takeoff, landing, launch_type: launchType, tow_height_ft: towHeightFt, synced_at });
            continue;
          }

          const matchedReg = fleetMatch?.registration ?? dev?.registration ?? null;
          const matchedId = fleetMatch?.id ?? null;
          const confidence: "high" | "low" = fleetMatch ? "high" : "low";
          const sourceMeta = {
            airfield: icao, raw: f, device: dev, synced_at,
            match: { flarm, registration: matchedReg, confidence },
          };

          // Stronger dedupe: match within ±90s on takeoff, by flarm OR registration (case-insensitive)
          const takeoffMs = +new Date(takeoff);
          const regKey = (matchedReg || "").trim().toUpperCase();
          const existing = dayFlights.find((row) => {
            if (!row.takeoff_time) return false;
            const dt = Math.abs(+new Date(row.takeoff_time) - takeoffMs);
            if (dt > TIME_WINDOW_MS) return false;
            const sameFlarm = flarm && row.flarm_id && row.flarm_id.toUpperCase() === flarm;
            const sameReg = regKey && row.glider_registration && row.glider_registration.trim().toUpperCase() === regKey;
            return sameFlarm || sameReg;
          });

          if (existing) {
            const patch: any = { ogn_source: { ...(existing.ogn_source as object || {}), ...sourceMeta } };
            if (landing && !existing.landing_time) patch.landing_time = landing;
            // Backfill flarm/registration if previously missing
            if (flarm && !existing.flarm_id) patch.flarm_id = flarm;
            if (matchedReg && !existing.glider_registration) patch.glider_registration = matchedReg;
            if (matchedId) patch.glider_id = matchedId;
            // Backfill launch info if missing
            if (launchType && !existing.launch_type) patch.launch_type = launchType;
            if (towHeightFt && !existing.aerotow_height_ft) patch.aerotow_height_ft = towHeightFt;
            const { error: upErr } = await supabaseAdmin.from("flights").update(patch).eq("id", existing.id);
            if (upErr) { errors.push({ flarm, registration: matchedReg, message: upErr.message }); continue; }
            // keep cached row in sync for subsequent iterations
            Object.assign(existing, patch);
            updated++;
            matches.push({ status: "updated", flarm, registration: matchedReg, callsign: dev?.cn ?? null, confidence, takeoff, landing, launch_type: launchType, tow_height_ft: towHeightFt, synced_at });
          } else {
            const insertRow: any = {
              flight_date: date,
              glider_id: matchedId,
              glider_registration: matchedReg,
              flarm_id: flarm,
              takeoff_time: takeoff,
              landing_time: landing,
              manual: false,
              launch_type: launchType,
              aerotow_height_ft: towHeightFt,
              ogn_source: sourceMeta,
            };
            const { data: inserted, error: insErr } = await supabaseAdmin.from("flights").insert(insertRow).select("id, flarm_id, glider_registration, takeoff_time, landing_time, ogn_source, launch_type, aerotow_height_ft").single();
            if (insErr) { errors.push({ flarm, registration: matchedReg, message: insErr.message }); continue; }
            if (inserted) dayFlights.push(inserted as any);
            created++;
            matches.push({ status: fleetMatch ? "created" : "unmatched", flarm, registration: matchedReg, callsign: dev?.cn ?? null, confidence, takeoff, landing, launch_type: launchType, tow_height_ft: towHeightFt, synced_at });
          }
        }

        return Response.json({ ok: true, icao, date, source, created, updated, skipped, total: payload.flights?.length ?? 0, synced_at, matches, errors });
      },
    },
  },
});

// Parse the public HTML logbook (logbook.glidernet.org) into the same shape as the JSON API.
// Columns: # | TowPlane reg | TowPlane type | Glider reg | CN | Glider type | Take Off | Landing | Time | Plane Landing | Plane Time | TowMaxAlt | Remarks
function parseHtmlLogbook(html: string): OgnPayload {
  const devices: OgnDevice[] = [];
  const flights: OgnFlight[] = [];
  const deviceIdx = new Map<string, number>(); // registration -> index

  const ensureDevice = (registration: string, cn?: string): number => {
    const key = registration.toUpperCase();
    if (deviceIdx.has(key)) return deviceIdx.get(key)!;
    const i = devices.length;
    devices.push({ address: "", registration, cn });
    deviceIdx.set(key, i);
    return i;
  };

  const toHms = (s: string): string | undefined => {
    // glidernet logbook formats: "10h32", "10h32:45", "10:32:45"
    let m = s.match(/(\d{1,2})h(\d{2})(?::(\d{2}))?/);
    if (!m) m = s.match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return undefined;
    const hh = m[1].padStart(2, "0");
    const mm = m[2];
    const ss = (m[3] ?? "00").padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  };
  const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").trim();

  // Match flight rows; skip the totals/header rows by requiring 13 cells.
  const rowRe = /<TR>((?:\s*<TD[^>]*>[\s\S]*?<\/TD>\s*){13})<\/TR>/gi;
  const cellRe = /<TD[^>]*>([\s\S]*?)<\/TD>/gi;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const rowHtml = m[1];
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rowHtml))) cells.push(stripTags(cm[1]));
    if (cells.length !== 13) continue;
    const idx = cells[0];
    if (!/^\d+$/.test(idx)) continue;

    const towReg = cells[1];
    const gliderReg = cells[3];
    const cn = cells[4];
    const takeoff = toHms(cells[6]);
    const landing = toHms(cells[7]);

    // Only record glider flights — skip rows without a glider registration
    // (tug-only / non-glider entries do not belong in the club log).
    if (!gliderReg) continue;
    const regUpper = gliderReg.toUpperCase().trim();
    // Also exclude the tug and motor glider explicitly even if they appear in the glider column.
    if (regUpper === "G-ESGC" || regUpper === "G-KIAU") continue;

    const deviceIndex = ensureDevice(gliderReg, cn || undefined);

    flights.push({
      start: takeoff,
      stop: landing,
      device: deviceIndex,
      start_tow: towReg ? 0 : null,
      tow_height: null,
    });
  }

  return { devices, flights };
}
