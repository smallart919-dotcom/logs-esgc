import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type QaCheck = {
  id: string;
  group: "Auth" | "Autosave" | "OGN" | "Midnight email" | "CnG" | "Config" | "Schema";
  name: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
  ms: number;
};

export type QaReport = {
  ran_at: string;
  duration_ms: number;
  pass: number;
  fail: number;
  warn: number;
  skip: number;
  checks: QaCheck[];
};

async function timed<T extends { status: QaCheck["status"]; detail: string }>(
  id: string,
  group: QaCheck["group"],
  name: string,
  fn: () => Promise<T>,
): Promise<QaCheck> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { id, group, name, status: r.status, detail: r.detail, ms: Date.now() - t0 };
  } catch (e: unknown) {
    return {
      id, group, name, status: "fail",
      detail: `Threw: ${e instanceof Error ? e.message : String(e)}`,
      ms: Date.now() - t0,
    };
  }
}

export const runQaChecks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { live?: boolean } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    // Office-only gate
    const email = (context.claims?.email as string | undefined)?.toLowerCase() ?? "";
    if (email !== "office@esgc.local") {
      throw new Error("Forbidden: office account only");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { authorizePublicHook } = await import("@/lib/public-hook-auth");
    const { todayUKDate } = await import("@/lib/uktime");

    const live = data?.live === true;
    const t0 = Date.now();
    const checks: QaCheck[] = [];

    // ----- Auth gate -----
    checks.push(await timed("auth.no-bearer", "Auth", "Public hooks reject missing bearer", async () => {
      const req = new Request("https://example.invalid/api/public/hooks/ogn-sync", { method: "POST" });
      const r = await authorizePublicHook(req);
      if (r && r.status === 401) return { status: "pass" as const, detail: "401 Unauthorized as expected" };
      return { status: "fail" as const, detail: `Expected 401, got ${r ? r.status : "null (accepted)"}` };
    }));

    checks.push(await timed("auth.publishable-bearer", "Auth", "Public hooks accept publishable key", async () => {
      const key = process.env.SUPABASE_PUBLISHABLE_KEY;
      if (!key) return { status: "fail" as const, detail: "SUPABASE_PUBLISHABLE_KEY env missing" };
      const req = new Request("https://example.invalid/api/public/hooks/ogn-sync", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
      });
      const r = await authorizePublicHook(req);
      if (r === null) return { status: "pass" as const, detail: "Accepted publishable key" };
      return { status: "fail" as const, detail: `Rejected with ${r.status}` };
    }));

    checks.push(await timed("auth.cron-secret", "Auth", "Public hooks accept CRON_SECRET", async () => {
      const secret = process.env.CRON_SECRET;
      if (!secret) return { status: "warn" as const, detail: "CRON_SECRET not configured (pg_cron jobs will fail)" };
      const req = new Request("https://example.invalid/api/public/hooks/cng-sync", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
      const r = await authorizePublicHook(req);
      if (r === null) return { status: "pass" as const, detail: "CRON_SECRET accepted" };
      return { status: "fail" as const, detail: `Rejected with ${r.status}` };
    }));

    checks.push(await timed("auth.bad-bearer", "Auth", "Public hooks reject garbage bearer", async () => {
      const req = new Request("https://example.invalid/api/public/hooks/cng-sync", {
        method: "POST",
        headers: { authorization: "Bearer not-a-real-token-xxxxxxxxxxxxxxxxx" },
      });
      const r = await authorizePublicHook(req);
      if (r && r.status === 401) return { status: "pass" as const, detail: "Rejected garbage token" };
      return { status: "fail" as const, detail: `Expected 401, got ${r ? r.status : "null (accepted)"}` };
    }));

    // ----- Config -----
    checks.push(await timed("config.resend", "Config", "RESEND_API_KEY present", async () => {
      return process.env.RESEND_API_KEY
        ? { status: "pass" as const, detail: "Configured" }
        : { status: "fail" as const, detail: "RESEND_API_KEY missing — midnight email will fail" };
    }));

    checks.push(await timed("config.cng-creds", "Config", "CnG credentials present", async () => {
      const ok = !!(process.env.CNG_EMAIL && process.env.CNG_PASSWORD);
      return ok
        ? { status: "pass" as const, detail: "CNG_EMAIL + CNG_PASSWORD set" }
        : { status: "fail" as const, detail: "CnG sync will fail — missing CNG_EMAIL or CNG_PASSWORD" };
    }));

    checks.push(await timed("config.vapid", "Config", "VAPID keys present", async () => {
      const ok = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
      return ok
        ? { status: "pass" as const, detail: "Push notifications configured" }
        : { status: "warn" as const, detail: "Push will be unavailable" };
    }));

    // ----- Schema sanity -----
    const tables = ["flights", "daily_logs", "daily_gfes", "fleet_gliders", "email_settings", "cng_settings", "auto_send_log", "flight_tombstones", "clock_settings"] as const;
    for (const t of tables) {
      checks.push(await timed(`schema.${t}`, "Schema", `Table ${t} reachable`, async () => {
        const { error } = await supabaseAdmin.from(t).select("*", { head: true, count: "exact" }).limit(1);
        return error
          ? { status: "fail" as const, detail: error.message }
          : { status: "pass" as const, detail: "OK" };
      }));
    }

    // ----- Midnight email dedup -----
    checks.push(await timed("midnight.dedup", "Midnight email", "auto_send_log unique constraint on flight_date", async () => {
      const sentinel = "1900-01-01";
      // Clean up any leftover sentinel first
      await supabaseAdmin.from("auto_send_log").delete().eq("flight_date", sentinel);
      const { error: e1 } = await supabaseAdmin.from("auto_send_log").insert({
        flight_date: sentinel,
        sent_at: new Date().toISOString(),
        flights_count: 0,
        note: "qa:dedup-test",
      });
      if (e1) return { status: "fail" as const, detail: `First insert failed: ${e1.message}` };
      const { error: e2 } = await supabaseAdmin.from("auto_send_log").insert({
        flight_date: sentinel,
        sent_at: new Date().toISOString(),
        flights_count: 0,
        note: "qa:dedup-test-2",
      });
      // Cleanup regardless
      await supabaseAdmin.from("auto_send_log").delete().eq("flight_date", sentinel);
      if (!e2) return { status: "fail" as const, detail: "Second insert succeeded — dedup is BROKEN" };
      const code = (e2 as { code?: string }).code;
      if (code === "23505") return { status: "pass" as const, detail: "Second insert rejected with 23505 (unique_violation)" };
      return { status: "warn" as const, detail: `Second insert rejected but with code ${code}: ${e2.message}` };
    }));

    checks.push(await timed("midnight.email-settings", "Midnight email", "email_settings row valid", async () => {
      const { data, error } = await supabaseAdmin
        .from("email_settings")
        .select("enabled, to_email, from_email, subject_template, body_template")
        .eq("id", 1).maybeSingle();
      if (error) return { status: "fail" as const, detail: error.message };
      if (!data) return { status: "warn" as const, detail: "No email_settings row — defaults will be used" };
      if (!data.to_email?.trim()) return { status: "warn" as const, detail: "to_email blank — default office@sussexgliding.co.uk will be used" };
      const flag = data.enabled === false ? " (DISABLED — midnight email will skip)" : "";
      return { status: "pass" as const, detail: `to=${data.to_email}${flag}` };
    }));

    checks.push(await timed("midnight.recent-runs", "Midnight email", "Recent auto-send activity", async () => {
      const { data, error } = await supabaseAdmin
        .from("auto_send_log")
        .select("flight_date, note, sent_at, recipient")
        .order("sent_at", { ascending: false })
        .limit(5);
      if (error) return { status: "fail" as const, detail: error.message };
      if (!data || data.length === 0) return { status: "warn" as const, detail: "No auto-send history yet" };
      // Check for any same-day duplicates (would indicate a regression)
      const dates = data.map((r) => r.flight_date);
      const dup = dates.find((d, i) => dates.indexOf(d) !== i);
      if (dup) return { status: "fail" as const, detail: `Duplicate auto_send_log rows for ${dup} — dedup regression` };
      const last = data[0];
      return { status: "pass" as const, detail: `Last: ${last.flight_date} → ${last.recipient ?? "—"} (${last.note ?? "ok"})` };
    }));

    // ----- OGN -----
    checks.push(await timed("ogn.fleet-flarms", "OGN", "Fleet has FLARM IDs configured", async () => {
      const { data, error } = await supabaseAdmin.from("fleet_gliders").select("registration, flarm_id");
      if (error) return { status: "fail" as const, detail: error.message };
      const total = data?.length ?? 0;
      const withFlarm = (data ?? []).filter((g) => g.flarm_id?.trim()).length;
      if (total === 0) return { status: "warn" as const, detail: "No fleet gliders configured" };
      if (withFlarm === 0) return { status: "warn" as const, detail: `${total} gliders, 0 with FLARM IDs — OGN matching will be reg-only` };
      return { status: "pass" as const, detail: `${withFlarm}/${total} gliders have FLARM IDs` };
    }));

    checks.push(await timed("ogn.no-open-stale", "OGN", "No long-open in-air rows (>24h)", async () => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabaseAdmin
        .from("flights")
        .select("id, glider_registration, takeoff_time")
        .is("landing_time", null)
        .not("takeoff_time", "is", null)
        .lt("takeoff_time", cutoff)
        .limit(10);
      if (error) return { status: "fail" as const, detail: error.message };
      if (!data || data.length === 0) return { status: "pass" as const, detail: "No stale open rows" };
      const sample = data.slice(0, 3).map((f) => `${f.glider_registration} @ ${f.takeoff_time}`).join(", ");
      return { status: "warn" as const, detail: `${data.length} open row(s) >24h old (likely missed landing): ${sample}` };
    }));

    if (live) {
      checks.push(await timed("ogn.live-fetch", "OGN", "Live OGN logbook reachable", async () => {
        const today = todayUKDate();
        const [y, m, d] = today.split("-");
        const url = `https://logbook.glidernet.org/index.php?a=UKRIN&s=QFE&u=M&z=1&p=&t=0&td=15&d=${d}${m}${y}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return { status: "fail" as const, detail: `HTTP ${r.status}` };
        const text = await r.text();
        if (!text.includes("<TR") && !text.includes("<tr")) {
          return { status: "warn" as const, detail: "Reachable but no rows — site may be empty today" };
        }
        return { status: "pass" as const, detail: `Reachable (${(text.length / 1024).toFixed(1)}KB)` };
      }));
    } else {
      checks.push({ id: "ogn.live-fetch", group: "OGN", name: "Live OGN logbook reachable", status: "skip", detail: "Enable Live mode to fetch glidernet.org", ms: 0 });
    }

    // ----- CnG -----
    checks.push(await timed("cng.settings", "CnG", "cng_settings row valid", async () => {
      const { data, error } = await supabaseAdmin.from("cng_settings")
        .select("enabled, last_sync_at, last_sync_error").eq("id", 1).maybeSingle();
      if (error) return { status: "fail" as const, detail: error.message };
      if (!data) return { status: "warn" as const, detail: "No cng_settings row" };
      const enabled = data.enabled !== false;
      const parts: string[] = [enabled ? "enabled" : "DISABLED"];
      if (data.last_sync_at) {
        const ageMin = Math.round((Date.now() - +new Date(data.last_sync_at)) / 60000);
        parts.push(`last sync ${ageMin}m ago`);
        if (ageMin > 24 * 60) parts.push("(>24h)");
      } else {
        parts.push("never synced");
      }
      if (data.last_sync_error) {
        return { status: "warn" as const, detail: `${parts.join(", ")} · last error: ${data.last_sync_error}` };
      }
      return { status: "pass" as const, detail: parts.join(", ") };
    }));

    if (live) {
      checks.push(await timed("cng.live-sync", "CnG", "Live CnG sync (today)", async () => {
        const { runCngSync } = await import("@/lib/cng-sync-run.server");
        const today = todayUKDate();
        const res = await runCngSync({ date: today });
        if (res.error) return { status: "fail" as const, detail: res.error };
        if (res.skipped) return { status: "warn" as const, detail: res.reason ?? "skipped" };
        return { status: "pass" as const, detail: `OK — ${res.gfes_inserted ?? 0} GFEs for ${res.date}` };
      }));
    } else {
      checks.push({ id: "cng.live-sync", group: "CnG", name: "Live CnG sync (today)", status: "skip", detail: "Enable Live mode to hit Click n' Glide", ms: 0 });
    }

    // ----- Autosave / data shape -----
    checks.push(await timed("autosave.flights-shape", "Autosave", "flights table accepts partial updates", async () => {
      // Find any flight row from today/recent and verify update of a no-op field
      const { data, error } = await supabaseAdmin
        .from("flights").select("id, notes").order("flight_date", { ascending: false }).limit(1);
      if (error) return { status: "fail" as const, detail: error.message };
      if (!data || data.length === 0) return { status: "skip" as const, detail: "No flights to probe yet" };
      const row = data[0];
      const probe = `${row.notes ?? ""}`; // no-op write
      const { error: upErr } = await supabaseAdmin.from("flights").update({ notes: probe }).eq("id", row.id);
      if (upErr) return { status: "fail" as const, detail: `Update failed: ${upErr.message}` };
      return { status: "pass" as const, detail: "Partial update OK (autosave path healthy)" };
    }));

    const duration_ms = Date.now() - t0;
    const tally = { pass: 0, fail: 0, warn: 0, skip: 0 };
    for (const c of checks) tally[c.status]++;

    const report: QaReport = {
      ran_at: new Date().toISOString(),
      duration_ms,
      ...tally,
      checks,
    };
    return report;
  });
