import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { todayUKDate } from "@/lib/uktime";
import { fetchCngDay } from "@/lib/cng-sync.server";

export type CngSyncResult = {
  ok?: boolean;
  date?: string;
  duty_instructor?: string | null;
  duty_pilot?: string | null;
  gfes_inserted?: number;
  fetched_at?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

export async function runCngSync(input: { date?: string } = {}): Promise<CngSyncResult> {
  const today = todayUKDate();
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today;

  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.abs(+new Date(date) - +new Date(today)) / dayMs;
  if (diff > 7) return { error: "date must be within 7 days of today" };

  const { data: settings } = await supabaseAdmin
    .from("cng_settings").select("enabled").eq("id", 1).maybeSingle();
  if (settings && settings.enabled === false) {
    return { skipped: true, reason: "CnG sync disabled in Settings" };
  }

  let snapshot;
  try {
    snapshot = await fetchCngDay(date);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from("cng_settings")
      .update({ last_sync_at: new Date().toISOString(), last_sync_error: message })
      .eq("id", 1);
    return { error: message };
  }

  const { data: existingLog } = await supabaseAdmin
    .from("daily_logs").select("duty_instructor, duty_pilot")
    .eq("flight_date", date).maybeSingle();

  const nextDI = existingLog?.duty_instructor && existingLog.duty_instructor.trim().length > 0
    ? existingLog.duty_instructor : snapshot.duty_instructor;
  const nextDP = existingLog?.duty_pilot && existingLog.duty_pilot.trim().length > 0
    ? existingLog.duty_pilot : snapshot.duty_pilot;

  const { error: logErr } = await supabaseAdmin.from("daily_logs").upsert(
    {
      flight_date: date,
      duty_instructor: nextDI,
      duty_pilot: nextDP,
      cng_synced_at: snapshot.fetched_at,
      cng_raw: JSON.parse(JSON.stringify(snapshot)),
    },
    { onConflict: "flight_date" },
  );
  if (logErr) return { error: `daily_logs upsert: ${logErr.message}` };

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
    if (gErr) return { error: `daily_gfes insert: ${gErr.message}` };
  }

  await supabaseAdmin.from("cng_settings")
    .update({ last_sync_at: snapshot.fetched_at, last_sync_error: null })
    .eq("id", 1);

  return {
    ok: true,
    date,
    duty_instructor: nextDI,
    duty_pilot: nextDP,
    gfes_inserted: allGfes.length,
    fetched_at: snapshot.fetched_at,
  };
}
