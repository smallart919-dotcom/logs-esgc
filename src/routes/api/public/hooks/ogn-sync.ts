import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fromUKLocalInput, todayUKDate, ukUtcOffsetHours } from "@/lib/uktime";
import { authorizePublicHook } from "@/lib/public-hook-auth";

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
  return todayUKDate();
}

function parseTimeOnDate(date: string, hms?: string): string | null {
  if (!hms) return null;
  // OGN HTML logbook (u=M) shows times in UK local wall-clock. Convert
  // that wall time to the correct UTC instant so subsequent UK formatting
  // round-trips to the same HH:mm the user saw on glidernet.
  return fromUKLocalInput(`${date}T${hms}`);
}

const normKey = (s: string | null | undefined) => (s || "").trim().toUpperCase();

function sameAircraft(row: { flarm_id?: string | null; glider_registration?: string | null }, flarm: string | null, regKey: string) {
  const sameFlarm = !!flarm && normKey(row.flarm_id) === flarm;
  const sameReg = !!regKey && normKey(row.glider_registration) === regKey;
  return sameFlarm || sameReg;
}

export const Route = createFileRoute("/api/public/hooks/ogn-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = await authorizePublicHook(request);
        if (unauth) return unauth;
        let body: { icao?: string; date?: string } = {};
        try { body = await request.json(); } catch {}
        // ICAO is permanently fixed to UKRIN (Ringmer). Any client-supplied
        // value or OGN_AIRFIELD_ICAO env var is ignored.
        const icao = "UKRIN";
        const date = body.date || todayUTC();

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
          const [yy, mm, dd] = date.split("-").map(Number);
          const noonOnDate = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0));
          const ukOffsetHours = ukUtcOffsetHours(noonOnDate);
          const ddmmyyyy = `${String(dd).padStart(2, "0")}${String(mm).padStart(2, "0")}${yy}`;
          const htmlUrl = `https://logbook.glidernet.org/index.php?a=${encodeURIComponent(htmlIcao)}&s=QFE&u=M&z=${ukOffsetHours}&p=&t=0&d=${ddmmyyyy}`;
          const hr = await fetch(htmlUrl);
          if (!hr.ok) throw new Error(`HTML ${hr.status}`);
          const html = await hr.text();
          payload = parseHtmlLogbook(html);
        } catch (e: any) {
          return Response.json({ error: `OGN HTML fetch failed: ${e.message}` }, { status: 502 });
        }

        if ((payload.flights?.length ?? 0) > 200) {
          return Response.json({ error: `OGN returned ${payload.flights.length} rows, so import was stopped to prevent duplicate or malformed flights.` }, { status: 422 });
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
        const seenInPayload = new Set<string>();

        for (const f of payload.flights || []) {
          const dev = payload.devices?.[f.device];
          const flarm = dev?.address ? dev.address.toUpperCase() : null;
          const takeoff = parseTimeOnDate(date, f.start) ?? (f.start_tsp ? new Date(f.start_tsp * 1000).toISOString() : null);
          const landing = parseTimeOnDate(date, f.stop) ?? (f.stop_tsp ? new Date(f.stop_tsp * 1000).toISOString() : null);

          // Sanity check: parsed times must fall on the requested UK calendar
          // date. If not, the z-offset or HTML parse went wrong — skip and
          // report rather than import a bad time.
          const isOnRequestedDate = (iso: string | null) => {
            if (!iso) return true;
            const ukDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));
            return ukDateStr === date;
          };
          if (!isOnRequestedDate(takeoff) || !isOnRequestedDate(landing)) {
            errors.push({
              flarm,
              registration: dev?.registration ?? null,
              message: `Parsed time fell outside ${date} (takeoff=${takeoff}, landing=${landing}) — likely a timezone offset issue, skipped.`,
            });
            skipped++;
            continue;
          }
          const fleetMatch =
            (flarm ? fleetByFlarm.get(flarm) : undefined) ??
            (dev?.registration ? fleetByReg.get(normReg(dev.registration)) : undefined);

          // Log every row including tugs (G-ESGC) and motor gliders (G-KIAU)
          // so they can be exported as separate sheets.


          // Tow plane present → assume aerotow
          const hasTow = (f.tow !== null && f.tow !== undefined) || (f.start_tow !== null && f.start_tow !== undefined);
          const launchType: "aerotow" | "winch" | null = hasTow ? "aerotow" : null;
          const towHeightFt = hasTow && f.tow_height ? Math.round(f.tow_height) : null;

          const matchedReg = fleetMatch?.registration ?? dev?.registration ?? null;
          const matchedId = fleetMatch?.id ?? null;
          const confidence: "high" | "low" = fleetMatch ? "high" : "low";
          const sourceMeta = {
            airfield: icao, raw: f, device: dev, synced_at,
            match: { flarm, registration: matchedReg, confidence },
          };

          if (!takeoff && !landing) {
            skipped++;
            matches.push({ status: "skipped", flarm, registration: matchedReg, callsign: dev?.cn ?? null, confidence, takeoff, landing, launch_type: launchType, tow_height_ft: towHeightFt, synced_at });
            continue;
          }

          // Dedupe within the same OGN response before the database is touched.
          const importKey = `${normKey(matchedReg)}|${takeoff ? `T:${takeoff}` : `L:${landing}`}`;
          if (seenInPayload.has(importKey)) {
            skipped++;
            continue;
          }
          seenInPayload.add(importKey);

          // Dedupe by flarm OR registration, comparing the incoming flight to
          // any existing row that overlaps in time. We match incoming TAKEOFF
          // against existing takeoff, and incoming LANDING against existing
          // landing — never cross-comparing, which previously caused duplicates
          // when OGN returned a landing-only row for a flight that already had
          // a completed (takeoff+landing) row in the DB (the matcher compared
          // incoming landing to existing takeoff and missed the match).
          const takeoffMs = takeoff ? +new Date(takeoff) : null;
          const landingMs = landing ? +new Date(landing) : null;
          const regKey = normKey(matchedReg);
          const HALF_DAY_MS = 12 * 60 * 60 * 1000;
          const within = (a: number | null, b: string | null | undefined) => {
            if (a === null || !b) return false;
            return Math.abs(+new Date(b) - a) <= TIME_WINDOW_MS;
          };
          let existing = dayFlights.find((row) => {
            if (!sameAircraft(row, flarm, regKey)) return false;
            // Both rows timeless → same.
            if (!row.takeoff_time && !row.landing_time && takeoffMs === null && landingMs === null) return true;
            // Match takeoff↔takeoff or landing↔landing within ±90s.
            if (within(takeoffMs, row.takeoff_time)) return true;
            if (within(landingMs, row.landing_time)) return true;
            return false;
          });
          // Fallback: incoming has landing-only -> match an in-air row
          // (existing takeoff present, landing missing) for same aircraft
          // where the existing takeoff is before incoming landing within
          // a reasonable flight duration.
          // SAFETY: only match if there's exactly one candidate — multiple
          // open in-air rows means we can't disambiguate, so create a new
          // row rather than risk pairing the wrong flight.
          if (!existing && landing && !takeoff) {
            const lMs = +new Date(landing);
            const candidates = dayFlights.filter((row) => {
              if (!sameAircraft(row, flarm, regKey)) return false;
              if (row.landing_time) return false;
              if (!row.takeoff_time) return false;
              const tMs = +new Date(row.takeoff_time);
              return tMs <= lMs && (lMs - tMs) <= HALF_DAY_MS;
            });
            if (candidates.length === 1) existing = candidates[0];
          }
          // Symmetric fallback: incoming has takeoff-only -> match a row
          // with landing only (rare but possible) for same aircraft.
          if (!existing && takeoff && !landing) {
            const tMs = +new Date(takeoff);
            const candidates = dayFlights.filter((row) => {
              if (!sameAircraft(row, flarm, regKey)) return false;
              if (row.takeoff_time) return false;
              if (!row.landing_time) return false;
              const lMs = +new Date(row.landing_time);
              return tMs <= lMs && (lMs - tMs) <= HALF_DAY_MS;
            });
            if (candidates.length === 1) existing = candidates[0];
          }

          // Skip if a tombstone matches (deleted previously). Same rule: only
          // match a timeless tombstone to a timeless incoming row.
          if (!existing) {
            const tombstoned = tombstones.find((t) => {
              if (!sameAircraft(t, flarm, regKey)) return false;
              if (!t.takeoff_time && !t.landing_time && takeoffMs === null && landingMs === null) return true;
              if (within(takeoffMs, t.takeoff_time)) return true;
              if (within(landingMs, t.landing_time)) return true;
              return false;
            });
            if (tombstoned) {
              skipped++;
              matches.push({ status: "skipped", flarm, registration: matchedReg, callsign: dev?.cn ?? null, confidence, takeoff, landing, launch_type: launchType, tow_height_ft: towHeightFt, synced_at });
              continue;
            }
          }

          if (existing) {
            // For manual entries we still backfill missing fields (e.g. landing
            // time once the glider lands) but never overwrite anything the user
            // already filled in. For OGN-sourced entries we also only fill gaps.
            const patch: any = { ogn_source: { ...(existing.ogn_source as object || {}), ...sourceMeta } };
            // Only fill MISSING fields — never overwrite values already on the row.
            // This preserves user edits to both manual and OGN-sourced flights so a
            // later sync can't clobber a corrected takeoff/landing time or launch.
            if (takeoff && !existing.takeoff_time) patch.takeoff_time = takeoff;
            if (landing && !existing.landing_time) patch.landing_time = landing;
            if (flarm && !existing.flarm_id) patch.flarm_id = flarm;
            if (matchedReg && !existing.glider_registration) patch.glider_registration = matchedReg;
            if (matchedId) patch.glider_id = matchedId;
            if (launchType && !existing.launch_type) patch.launch_type = launchType;
            if (towHeightFt && !existing.aerotow_height_ft) patch.aerotow_height_ft = towHeightFt;
            // If nothing actually changed besides ogn_source, skip
            if (Object.keys(patch).length === 1) {
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
            if (insErr) {
              if (insErr.code === "23505") {
                skipped++;
                matches.push({ status: "skipped", flarm, registration: matchedReg, callsign: dev?.cn ?? null, confidence, takeoff, landing, launch_type: launchType, tow_height_ft: towHeightFt, synced_at });
                continue;
              }
              errors.push({ flarm, registration: matchedReg, message: insErr.message });
              continue;
            }
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
