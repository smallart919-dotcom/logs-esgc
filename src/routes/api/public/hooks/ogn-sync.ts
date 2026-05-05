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
        const matches: Array<{
          status: "created" | "updated" | "unmatched" | "skipped";
          flarm: string | null;
          registration: string | null;
          callsign: string | null;
          confidence: "high" | "low";
          takeoff: string | null;
          landing: string | null;
          synced_at: string;
        }> = [];

        for (const f of payload.flights || []) {
          const dev = payload.devices?.[f.device];
          const flarm = dev?.address ? dev.address.toUpperCase() : null;
          const takeoff = parseTimeOnDate(date, f.start);
          const landing = parseTimeOnDate(date, f.stop);
          const fleetMatch = flarm ? fleetByFlarm.get(flarm) : undefined;

          if (!flarm || !takeoff) {
            skipped++;
            matches.push({ status: "skipped", flarm, registration: dev?.registration ?? null, callsign: dev?.cn ?? null, confidence: "low", takeoff, landing, synced_at });
            continue;
          }

          if (!fleetMatch) {
            // Track unmatched FLARMs so the user can see what was seen
            matches.push({ status: "unmatched", flarm, registration: dev?.registration ?? null, callsign: dev?.cn ?? null, confidence: "low", takeoff, landing, synced_at });
            skipped++;
            continue;
          }

          const sourceMeta = { airfield: icao, raw: f, device: dev, synced_at, match: { flarm, registration: fleetMatch.registration, confidence: "high" as const } };

          const { data: existing } = await supabaseAdmin
            .from("flights").select("id, landing_time, ogn_source")
            .eq("flarm_id", flarm).eq("takeoff_time", takeoff).eq("manual", false)
            .maybeSingle();

          if (existing) {
            const patch: Record<string, unknown> = { ogn_source: { ...(existing.ogn_source as object || {}), ...sourceMeta } };
            if (landing && !existing.landing_time) patch.landing_time = landing;
            await supabaseAdmin.from("flights").update(patch).eq("id", existing.id);
            updated++;
            matches.push({ status: "updated", flarm, registration: fleetMatch.registration, callsign: dev?.cn ?? null, confidence: "high", takeoff, landing, synced_at });
          } else {
            const { error: insErr } = await supabaseAdmin.from("flights").insert({
              flight_date: date,
              glider_id: fleetMatch.id,
              glider_registration: fleetMatch.registration,
              flarm_id: flarm,
              takeoff_time: takeoff,
              landing_time: landing,
              manual: false,
              ogn_source: sourceMeta,
            });
            if (!insErr) {
              created++;
              matches.push({ status: "created", flarm, registration: fleetMatch.registration, callsign: dev?.cn ?? null, confidence: "high", takeoff, landing, synced_at });
            }
          }
        }

        return Response.json({ ok: true, icao, date, created, updated, skipped, total: payload.flights?.length ?? 0, synced_at, matches });
      },
    },
  },
});
