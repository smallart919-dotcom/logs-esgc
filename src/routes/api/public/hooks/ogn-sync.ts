import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fromUKLocalInput } from "@/lib/uktime";

// OGN Flightbook public API: https://flightbook.glidernet.org/api/logbook/{ICAO}/
// Returns devices[] (with address = FLARM ID) and flights[] for the day.
type OgnDevice = { address: string; registration?: string; cn?: string; aircraft?: string };
type OgnFlight = {
  start?: string; stop?: string; duration?: string;
  start_tsp?: number | null; stop_tsp?: number | null;
  device: number;
  start_airfield?: number; stop_airfield?: number;
  start_tow?: number | null; tow_height?: number | null;
  tow?: number | null;
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
        const normReg = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const fleetByReg = new Map(
          (fleet ?? []).filter((g) => g.registration).map((g) => [normReg(g.registration), g])
        );

        // Always use the public HTML logbook so the times exactly match
        // https://logbook.glidernet.org/index.php?a=UKRIN&s=QFE&u=M&z=1&p=&t=0&td=15&d=DDMMYYYY
        const htmlIcao = icao.startsWith("UK") ? icao : `UK${icao}`;
        let payload: OgnPayload;
        const source: "html" = "html";
        try {
          const [y, m, d] = date.split("-");
          const ddmmyyyy = `${d}${m}${y}`;
          const htmlUrl = `https://logbook.glidernet.org/index.php?a=${encodeURIComponent(htmlIcao)}&s=QFE&u=M&z=1&p=&t=0&td=15&d=${ddmmyyyy}`;
          const hr = await fetch(htmlUrl);
          if (!hr.ok) throw new Error(`HTML ${hr.status}`);
          const html = await hr.text();
          payload = parseHtmlLogbook(html);
        } catch (e: any) {
          return Response.json({ error: `OGN HTML fetch failed: ${e.message}` }, { status: 502 });
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

        // Pre-load ALL existing flights for the day (including manual) so we
        // never create OGN duplicates of an already-logged flight.
        const { data: existingDay } = await supabaseAdmin
          .from("flights")
          .select("id, flarm_id, glider_registration, takeoff_time, landing_time, ogn_source, launch_type, aerotow_height_ft, manual")
          .eq("flight_date", date);
        const dayFlights = existingDay ?? [];

        // Pre-load tombstones for the day so deleted flights don't get re-created.
        const { data: tombstoneRows } = await supabaseAdmin
          .from("flight_tombstones")
          .select("flarm_id, glider_registration, takeoff_time, landing_time")
          .eq("flight_date", date);
        const tombstones = tombstoneRows ?? [];

        const TIME_WINDOW_MS = 90 * 1000; // ±90s window for fuzzy match

        for (const f of payload.flights || []) {
          const dev = payload.devices?.[f.device];
          const flarm = dev?.address ? dev.address.toUpperCase() : null;
          const takeoff = f.start_tsp ? new Date(f.start_tsp * 1000).toISOString() : parseTimeOnDate(date, f.start);
          const landing = f.stop_tsp ? new Date(f.stop_tsp * 1000).toISOString() : parseTimeOnDate(date, f.stop);
          const fleetMatch =
            (flarm ? fleetByFlarm.get(flarm) : undefined) ??
            (dev?.registration ? fleetByReg.get(normReg(dev.registration)) : undefined);

          // Log every row including tugs (G-ESGC) and motor gliders (G-KIAU)
          // so they can be exported as separate sheets.


          // Tow plane present → assume aerotow
          const hasTow = (f.tow !== null && f.tow !== undefined) || (f.start_tow !== null && f.start_tow !== undefined);
          const launchType: "aerotow" | "winch" | null = hasTow ? "aerotow" : null;
          const towHeightFt = hasTow && f.tow_height ? Math.round(f.tow_height) : null;

          // Always log the row, even if takeoff or landing is missing.

          const matchedReg = fleetMatch?.registration ?? dev?.registration ?? null;
          const matchedId = fleetMatch?.id ?? null;
          const confidence: "high" | "low" = fleetMatch ? "high" : "low";
          const sourceMeta = {
            airfield: icao, raw: f, device: dev, synced_at,
            match: { flarm, registration: matchedReg, confidence },
          };

          // Dedupe within ±90s on takeoff (or landing if no takeoff), by flarm OR registration
          const refTime = takeoff ?? landing;
          const refMs = refTime ? +new Date(refTime) : null;
          const regKey = (matchedReg || "").trim().toUpperCase();
          const existing = refMs === null ? undefined : dayFlights.find((row) => {
            const rowRef = row.takeoff_time ?? row.landing_time;
            if (!rowRef) return false;
            const dt = Math.abs(+new Date(rowRef) - refMs);
            if (dt > TIME_WINDOW_MS) return false;
            const sameFlarm = flarm && row.flarm_id && row.flarm_id.toUpperCase() === flarm;
            const sameReg = regKey && row.glider_registration && row.glider_registration.trim().toUpperCase() === regKey;
            return sameFlarm || sameReg;
          });

          // Skip if a tombstone matches (deleted previously) — match by flarm OR registration within ±90s
          if (!existing && refMs !== null) {
            const tombstoned = tombstones.find((t) => {
              const tRef = t.takeoff_time ?? t.landing_time;
              if (!tRef) {
                const sameFlarm = flarm && t.flarm_id && t.flarm_id.toUpperCase() === flarm;
                const sameReg = regKey && t.glider_registration && t.glider_registration.trim().toUpperCase() === regKey;
                return sameFlarm || sameReg;
              }
              const dt = Math.abs(+new Date(tRef) - refMs);
              if (dt > TIME_WINDOW_MS) return false;
              const sameFlarm = flarm && t.flarm_id && t.flarm_id.toUpperCase() === flarm;
              const sameReg = regKey && t.glider_registration && t.glider_registration.trim().toUpperCase() === regKey;
              return sameFlarm || sameReg;
            });
            if (tombstoned) { skipped++; continue; }
          }

          if (existing) {
            // For manual entries we still backfill missing fields (e.g. landing
            // time once the glider lands) but never overwrite anything the user
            // already filled in. For OGN-sourced entries we also only fill gaps.
            const patch: any = { ogn_source: { ...(existing.ogn_source as object || {}), ...sourceMeta } };
            if (takeoff && !existing.takeoff_time) patch.takeoff_time = takeoff;
            if (landing && !existing.landing_time) patch.landing_time = landing;
            // Backfill flarm/registration if previously missing
            if (flarm && !existing.flarm_id) patch.flarm_id = flarm;
            if (matchedReg && !existing.glider_registration) patch.glider_registration = matchedReg;
            if (matchedId) patch.glider_id = matchedId;
            // Backfill launch info if missing
            if (launchType && !existing.launch_type) patch.launch_type = launchType;
            if (towHeightFt && !existing.aerotow_height_ft) patch.aerotow_height_ft = towHeightFt;
            // If nothing actually changed besides ogn_source for a manual row, skip
            if ((existing as any).manual && Object.keys(patch).length === 1) {
              skipped++;
              continue;
            }
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
            const { data: inserted, error: insErr } = await supabaseAdmin.from("flights").insert(insertRow).select("id, flarm_id, glider_registration, takeoff_time, landing_time, ogn_source, launch_type, aerotow_height_ft, manual").single();
            if (insErr) { errors.push({ flarm, registration: matchedReg, message: insErr.message }); continue; }
            if (inserted) dayFlights.push(inserted as any);
            created++;
            matches.push({ status: "created", flarm, registration: matchedReg, callsign: dev?.cn ?? null, confidence, takeoff, landing, launch_type: launchType, tow_height_ft: towHeightFt, synced_at });
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

  const ensureDevice = (registration: string, cn?: string, aircraft?: string): number => {
    const key = registration.toUpperCase();
    if (deviceIdx.has(key)) {
      const i = deviceIdx.get(key)!;
      if (aircraft && !devices[i].aircraft) devices[i].aircraft = aircraft;
      return i;
    }
    const i = devices.length;
    devices.push({ address: "", registration, cn, aircraft });
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

  // Match each TR individually, then collect its TD cells. The previous
  // pattern allowed TD content to span across TR boundaries which produced
  // garbage rows when shorter rows (header / totals) appeared.
  const rowRe = /<TR\b[^>]*>([\s\S]*?)<\/TR>/gi;
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
    const towType = cells[2];
    const gliderReg = cells[3];
    const cn = cells[4];
    const gliderType = cells[5];
    const takeoff = toHms(cells[6]);
    const landing = toHms(cells[7]);

    // Skip rows without any aircraft registration in either column.
    if (!gliderReg && !towReg) continue;
    // Use glider reg if present, otherwise the tug reg (so tug-only flights are captured).
    const reg = gliderReg || towReg;
    const aircraftType = (gliderReg ? gliderType : towType) || undefined;

    const deviceIndex = ensureDevice(reg, cn || undefined, aircraftType);

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
