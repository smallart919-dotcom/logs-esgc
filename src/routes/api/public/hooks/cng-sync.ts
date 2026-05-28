import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { todayUKDate } from "@/lib/uktime";
import { fetchCngDay } from "@/lib/cng-sync.server";

// POST /api/public/hooks/cng-sync
// Body (optional): { date?: "YYYY-MM-DD" }
//
// Logs into Click n' Glide using server-side stored credentials, scrapes the
// chosen day's dashboard, and persists the result:
//   • Updates public.daily_logs duty_instructor / duty_pilot — ONLY when the
//     existing value is empty, so manual edits in the app are never clobbered.
//   • Replaces public.daily_gfes rows for that date (combined Introductory
//     Flights + TMG GFEs from CnG).
//   • Stamps cng_synced_at / cng_raw on daily_logs.
//   • Updates public.cng_settings last_sync_at / last_sync_error.
//
// Called by pg_cron nightly and from the "Sync now" button in the UI.

export const Route = createFileRoute("/api/public/hooks/cng-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { date?: string } = {};
        try { body = (await request.json()) as { date?: string }; } catch {}

        const today = todayUKDate();
        const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;

        // Safety: only allow ±7 days from today to keep this endpoint scoped.
        const dayMs = 24 * 60 * 60 * 1000;
        const diff = Math.abs(+new Date(date) - +new Date(today)) / dayMs;
        if (diff > 7) {
          return Response.json({ error: "date must be within 7 days of today" }, { status: 400 });
        }

        // Respect office-controlled enable toggle
        const { data: settings } = await supabaseAdmin
          .from("cng_settings")
          .select("enabled")
          .eq("id", 1)
          .maybeSingle();
        if (settings && settings.enabled === false) {
          return Response.json({ skipped: true, reason: "CnG sync disabled in Settings" });
        }

        let snapshot;
        try {
          snapshot = await fetchCngDay(date);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          await supabaseAdmin
            .from("cng_settings")
            .update({ last_sync_at: new Date().toISOString(), last_sync_error: message })
            .eq("id", 1);
          return Response.json({ error: message }, { status: 502 });
        }

        // 1) Upsert daily_logs (only fill blanks for duty fields)
        const { data: existingLog } = await supabaseAdmin
          .from("daily_logs")
          .select("duty_instructor, duty_pilot")
          .eq("flight_date", date)
          .maybeSingle();

        const nextDI =
          existingLog?.duty_instructor && existingLog.duty_instructor.trim().length > 0
            ? existingLog.duty_instructor
            : snapshot.duty_instructor;
        const nextDP =
          existingLog?.duty_pilot && existingLog.duty_pilot.trim().length > 0
            ? existingLog.duty_pilot
            : snapshot.duty_pilot;

        const { error: logErr } = await supabaseAdmin
          .from("daily_logs")
          .upsert(
            {
              flight_date: date,
              duty_instructor: nextDI,
              duty_pilot: nextDP,
              cng_synced_at: snapshot.fetched_at,
              cng_raw: snapshot as unknown as Record<string, unknown>,
            },
            { onConflict: "flight_date" },
          );
        if (logErr) {
          return Response.json({ error: `daily_logs upsert: ${logErr.message}` }, { status: 500 });
        }

        // 2) Replace daily_gfes for this date (combined: Introductory + TMG)
        const allGfes = [
          ...snapshot.gfes.map((g) => ({ ...g, source: "cng" })),
          ...snapshot.tmg_gfes.map((g) => ({ ...g, source: "cng-tmg" })),
        ];
        await supabaseAdmin.from("daily_gfes").delete().eq("flight_date", date);
        if (allGfes.length > 0) {
          const rows = allGfes.map((g, i) => ({
            flight_date: date,
            position: i + 1,
            time_text: g.time_text,
            passenger_name: g.passenger_name,
            gfe_type: g.gfe_type,
            ref: g.ref,
            raw_text: g.raw_text,
            source: g.source,
          }));
          const { error: gErr } = await supabaseAdmin.from("daily_gfes").insert(rows);
          if (gErr) {
            return Response.json({ error: `daily_gfes insert: ${gErr.message}` }, { status: 500 });
          }
        }

        // 3) Stamp success on settings
        await supabaseAdmin
          .from("cng_settings")
          .update({
            last_sync_at: snapshot.fetched_at,
            last_sync_error: null,
          })
          .eq("id", 1);

        return Response.json({
          ok: true,
          date,
          duty_instructor: nextDI,
          duty_pilot: nextDP,
          gfes_inserted: allGfes.length,
          fetched_at: snapshot.fetched_at,
        });
      },
    },
  },
});
