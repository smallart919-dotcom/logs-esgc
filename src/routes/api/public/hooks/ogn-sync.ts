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

        // Fetch OGN flightbook
        const url = `https://flightbook.glidernet.org/api/logbook/${encodeURIComponent(icao)}/`;
        let payload: OgnPayload;
        try {
          const r = await fetch(url, { headers: { Accept: "application/json" } });
          if (!r.ok) throw new Error(`OGN ${r.status}`);
          payload = (await r.json()) as OgnPayload;
        } catch (e: any) {
          return Response.json({ error: `OGN fetch failed: ${e.message}` }, { status: 502 });
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

        return Response.json({ ok: true, icao, date, created, updated, skipped, total: payload.flights?.length ?? 0, synced_at, matches, errors });
      },
    },
  },
});
