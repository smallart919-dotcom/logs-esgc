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

  // Always sync duty fields from CnG when CnG returned a value; keep the
  // existing value only when CnG has nothing (so we never blank out a manual
  // entry just because the CnG box was empty).
  const { data: existingLog } = await supabaseAdmin
    .from("daily_logs").select("duty_instructor, duty_pilot")
    .eq("flight_date", date).maybeSingle();

  const nextDI = snapshot.duty_instructor ?? existingLog?.duty_instructor ?? null;
  const nextDP = snapshot.duty_pilot ?? existingLog?.duty_pilot ?? null;

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

  // Preserve locally-set state (tick-off, cancellation, event-day assignment)
  // across syncs — the sync rebuilds the CnG rows, it must not wipe user edits.
  type Keep = {
    checked: boolean; checked_at: string | null;
    cancelled: boolean; cancelled_at: string | null; cancel_reason: string | null;
    assigned_glider_id: string | null; launch_time: string | null; weight_kg: number | null; member_name: string | null;
  };
  const keyOf = (r: { source?: string | null; ref?: string | null; passenger_name?: string | null; time_text?: string | null }) =>
    [r.source ?? "", (r.ref ?? "").trim().toLowerCase(), (r.passenger_name ?? "").trim().toLowerCase(), (r.time_text ?? "").trim()].join("|");

  const { data: existingGfes } = await supabaseAdmin
    .from("daily_gfes")
    .select("source, ref, passenger_name, time_text, checked, checked_at, cancelled, cancelled_at, cancel_reason, assigned_glider_id, launch_time, weight_kg, member_name")
    .eq("flight_date", date);

  const preserved = new Map<string, Keep>();
  for (const r of (existingGfes ?? []) as any[]) {
    preserved.set(keyOf(r), {
      checked: !!r.checked, checked_at: r.checked_at ?? null,
      cancelled: !!r.cancelled, cancelled_at: r.cancelled_at ?? null, cancel_reason: r.cancel_reason ?? null,
      assigned_glider_id: r.assigned_glider_id ?? null, launch_time: r.launch_time ?? null, weight_kg: r.weight_kg ?? null, member_name: r.member_name ?? null,
    });
  }

  // Only rebuild rows that came from Click n' Glide; manually added ones stay.
  await supabaseAdmin
    .from("daily_gfes")
    .delete()
    .eq("flight_date", date)
    .in("source", ["cng", "cng-tmg"]);
  if (allGfes.length > 0) {
    const rows = allGfes.map((g, i) => {
      const keep = preserved.get(keyOf(g));
      return {
        flight_date: date,
        position: i + 1,
        time_text: g.time_text,
        passenger_name: g.passenger_name,
        gfe_type: g.gfe_type,
        ref: g.ref,
        phone: g.phone,
        notes: g.notes,
        raw_text: g.raw_text,
        source: g.source,
        checked: keep?.checked ?? false,
        checked_at: keep?.checked_at ?? null,
        cancelled: keep?.cancelled ?? false,
        cancelled_at: keep?.cancelled_at ?? null,
        cancel_reason: keep?.cancel_reason ?? null,
        assigned_glider_id: keep?.assigned_glider_id ?? null,
        launch_time: keep?.launch_time ?? null,
        weight_kg: keep?.weight_kg ?? null,
        member_name: keep?.member_name ?? null,
      };
    });
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
