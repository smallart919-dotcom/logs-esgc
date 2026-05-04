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

        let created = 0, updated = 0, skipped = 0;
        for (const f of payload.flights || []) {
          const dev = payload.devices?.[f.device];
          if (!dev?.address) { skipped++; continue; }
          const flarm = dev.address.toUpperCase();
          // Only auto-import flights for known fleet gliders
          const fleetMatch = fleetByFlarm.get(flarm);
          if (!fleetMatch) { skipped++; continue; }

          const takeoff = parseTimeOnDate(date, f.start);
          const landing = parseTimeOnDate(date, f.stop);
          if (!takeoff) { skipped++; continue; }

          // Upsert by (flarm_id, takeoff_time)
          const { data: existing } = await supabaseAdmin
            .from("flights").select("id, landing_time")
            .eq("flarm_id", flarm).eq("takeoff_time", takeoff).eq("manual", false)
            .maybeSingle();

          if (existing) {
            if (landing && !existing.landing_time) {
              await supabaseAdmin.from("flights").update({ landing_time: landing }).eq("id", existing.id);
              updated++;
            }
          } else {
            const { error: insErr } = await supabaseAdmin.from("flights").insert({
              flight_date: date,
              glider_id: fleetMatch.id,
              glider_registration: fleetMatch.registration,
              flarm_id: flarm,
              takeoff_time: takeoff,
              landing_time: landing,
              manual: false,
              ogn_source: { airfield: icao, raw: f, device: dev },
            });
            if (!insErr) created++;
          }
        }

        return Response.json({ ok: true, icao, date, created, updated, skipped, total: payload.flights?.length ?? 0 });
      },
    },
  },
});
