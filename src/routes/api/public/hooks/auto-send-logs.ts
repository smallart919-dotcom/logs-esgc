import { createFileRoute } from "@tanstack/react-router";
// Type-only import — the real exceljs module is loaded dynamically inside
// buildXlsx() so a future Node-only regression in the package can't crash
// module-init for the entire Cloudflare Worker bundle.
import type ExcelJSNs from "exceljs";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// --- UK time helpers (duplicated here so this route has no client deps) ---
const LONDON = "Europe/London";
function londonParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  if (parts.hour === "24") parts.hour = "00";
  return parts;
}
function fmtUKTime(iso: string | null | undefined, offsetSec = 0): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + offsetSec * 1000);
  const p = londonParts(d);
  return `${p.hour}:${p.minute}`;
}
function fmtUKDate(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : date;
}

// --- Build XLSX from query data ---
type Flight = any;
type Glider = any;

async function buildXlsx(opts: {
  date: string;
  flights: Flight[];
  gliders: Glider[];
  dutyInstructor: string;
  dutyPilot: string;
  offsetSec: number;
}): Promise<Uint8Array> {
  const { date, flights, gliders, dutyInstructor, dutyPilot, offsetSec } = opts;

  const fmtT = (iso: string | null) => fmtUKTime(iso, offsetSec);
  const dur = (a: string | null, b: string | null) => {
    if (!a || !b) return "";
    const m = Math.round((+new Date(b) - +new Date(a)) / 60000);
    const h = Math.floor(m / 60), mm = m % 60;
    return `${h}:${String(mm).padStart(2, "0")}`;
  };
  const pilotName = (kind: string | null, name: string | null) =>
    kind === "gfe" ? (name ? `GFE (${name})` : "GFE")
      : kind === "visitor" ? (name ? `Visitor (${name})` : "Visitor")
      : (name || "");

  const ExcelJS = ((await import("exceljs")) as unknown as { default: typeof ExcelJSNs }).default;
  const wb = new ExcelJS.Workbook();
  const RED = "FFC00000";
  const PINK = "FFFCE4E6";
  const thin: any = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };

  const fleetTypeByReg = new Map<string, string>(
    gliders.filter((g) => g.registration).map((g) => [g.registration.toUpperCase().trim(), g.glider_type || ""]),
  );
  const typeFor = (f: Flight) => {
    const r = (f.glider_registration || "").toUpperCase().trim();
    const fleetT = fleetTypeByReg.get(r);
    if (fleetT) return fleetT;
    const dev = (f.ogn_source as any)?.raw && (f.ogn_source as any)?.device;
    return (dev?.aircraft as string) || "";
  };

  const buildSheet = (name: string, rows: Flight[], launch: "aerotow" | "winch" | null) => {
    const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
    ws.columns = [
      { width: 4 }, { width: 8 }, { width: 7 },
      { width: 7 }, { width: 20 }, { width: 4 },
      { width: 7 }, { width: 20 }, { width: 4 },
      { width: 7 }, { width: 9 }, { width: 9 }, { width: 7 },
      { width: 28 }, { width: 5 },
    ];
    const setBox = (range: string, opts: { fill?: string; bold?: boolean; color?: string; size?: number; align?: "left" | "center" | "right"; value?: any }) => {
      ws.mergeCells(range);
      const cell = ws.getCell(range.split(":")[0]);
      if (opts.value !== undefined) cell.value = opts.value;
      cell.alignment = { vertical: "middle", horizontal: opts.align ?? "center", wrapText: true };
      cell.font = { bold: opts.bold, color: opts.color ? { argb: opts.color } : undefined, size: opts.size, name: "Calibri" };
      if (opts.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
      cell.border = thin;
    };

    ws.getRow(1).height = 28;
    ws.getRow(2).height = 22;
    setBox("A1:C2", { value: "ESGC", bold: true, color: "FF1F4E79", size: 16 });
    setBox("D1:F2", { value: "Flight Log", bold: true, color: RED, size: 18, fill: PINK });
    setBox("G1:I1", { value: "Launch Type ✓", bold: true, size: 10 });
    setBox("G2:H2", { value: "Aerotow", align: "left" });
    setBox("I2:I2", { value: launch === "aerotow" ? "✓" : "", bold: true });
    setBox("J1:L1", { value: "Sheet", bold: true });
    setBox("J2:K2", { value: "Winch", align: "left" });
    setBox("L2:L2", { value: launch === "winch" ? "✓" : "", bold: true });
    setBox("M1:M2", { value: "Of", bold: true });
    setBox("N1:O1", { value: "Day & Date", bold: true });
    setBox("N2:O2", { value: fmtUKDate(date) });

    ws.getRow(3).height = 40;
    setBox("A3:I3", { value: "LOG KEEPERS PLEASE MAKE ALL ENTRIES IN BLOCK CAPITALS AND LEGIBLE", bold: true, color: "FFFFFFFF", fill: RED, size: 10 });
    setBox("J3:O3", { value: "Enter comment against each flight eg trial lesson, voucher number, training flight etc. Enter tick in \"Ch\" against pilot who is to pay for the flight. Logged By: - please enter your initials in the \"LB\" Column", size: 8, align: "left" });

    ws.getRow(4).height = 22;
    setBox("A4:A4", { value: "Duty Instructor", bold: true, size: 9 });
    setBox("B4:E4", { value: dutyInstructor, align: "left", bold: true });
    setBox("F4:F4", { value: "Duty Pilot", bold: true, size: 9 });
    setBox("G4:O4", { value: dutyPilot, align: "left", bold: true });

    ws.getRow(5).height = 18;
    ws.getRow(6).height = 22;
    setBox("A5:A6", { value: "No", bold: true, fill: PINK });
    setBox("B5:B6", { value: "Reg", bold: true, fill: PINK });
    setBox("C5:C6", { value: "Type", bold: true, fill: PINK });
    setBox("D5:F5", { value: "P1", bold: true, fill: PINK });
    setBox("D6:D6", { value: "No", bold: true, fill: PINK });
    setBox("E6:E6", { value: "Name", bold: true, fill: PINK });
    setBox("F6:F6", { value: "Ch", bold: true, fill: PINK });
    setBox("G5:I5", { value: "P2", bold: true, fill: PINK });
    setBox("G6:G6", { value: "No", bold: true, fill: PINK });
    setBox("H6:H6", { value: "Name", bold: true, fill: PINK });
    setBox("I6:I6", { value: "Ch", bold: true, fill: PINK });
    setBox("J5:J6", { value: "Height", bold: true, fill: PINK });
    setBox("K5:K5", { value: "Take off", bold: true, fill: PINK });
    setBox("K6:K6", { value: "h:m", bold: true, fill: PINK, size: 9 });
    setBox("L5:L5", { value: "Landing", bold: true, fill: PINK });
    setBox("L6:L6", { value: "h:m", bold: true, fill: PINK, size: 9 });
    setBox("M5:M5", { value: "Time", bold: true, fill: PINK });
    setBox("M6:M6", { value: "h:m", bold: true, fill: PINK, size: 9 });
    setBox("N5:N6", { value: "Comments", bold: true, fill: PINK });
    setBox("O5:O6", { value: "LB", bold: true, fill: PINK });

    const startRow = 7;
    rows.forEach((f, i) => {
      const r = startRow + i;
      const row = ws.getRow(r);
      row.height = 20;
      const vals = [
        i + 1,
        f.glider_registration || "",
        typeFor(f),
        f.p1_kind === "member" ? (f.p1_membership || "") : "",
        pilotName(f.p1_kind, f.p1_name),
        f.p1_charge ? "✓" : "",
        f.p2_kind === "member" ? (f.p2_membership || "") : "",
        pilotName(f.p2_kind, f.p2_name),
        f.p2_charge ? "✓" : "",
        f.launch_type === "aerotow" ? (f.aerotow_height_ft ?? "") : "",
        fmtT(f.takeoff_time),
        fmtT(f.landing_time),
        dur(f.takeoff_time, f.landing_time),
        f.notes || "",
        f.logged_by || "",
      ];
      vals.forEach((v, c) => {
        const cell = row.getCell(c + 1);
        cell.value = v as any;
        cell.border = thin;
        cell.font = { name: "Calibri", size: 10 };
        cell.alignment = { vertical: "middle", horizontal: c === 4 || c === 7 || c === 13 ? "left" : "center", wrapText: true };
      });
    });

    const minRows = Math.max(20, rows.length);
    for (let i = rows.length; i < minRows; i++) {
      const r = startRow + i;
      const row = ws.getRow(r);
      row.height = 20;
      row.getCell(1).value = i + 1;
      for (let c = 1; c <= 15; c++) {
        row.getCell(c).border = thin;
        row.getCell(c).font = { name: "Calibri", size: 10 };
        row.getCell(c).alignment = { vertical: "middle", horizontal: "center" };
      }
    }

    ws.pageSetup = {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.2, footer: 0.2 },
    };
  };

  const reg = (f: Flight) => (f.glider_registration || "").toUpperCase().trim();
  const isExcluded = (f: Flight) => reg(f) === "G-ESGC" || reg(f) === "G-KIAU";
  const aerotow = flights.filter((f) => f.launch_type === "aerotow" && !isExcluded(f));
  const winch = flights.filter((f) => f.launch_type === "winch" && !isExcluded(f));
  const other = flights.filter((f) => f.launch_type !== "aerotow" && f.launch_type !== "winch" && !isExcluded(f));
  const kiau = flights.filter((f) => reg(f) === "G-KIAU");

  buildSheet("Aerotow", aerotow, "aerotow");
  buildSheet("Winch", winch, "winch");
  if (other.length) buildSheet("Other", other, null);
  if (kiau.length) buildSheet("G-KIAU", kiau, null);

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

// --- Resolve effective clock offset for a date (per-date override else permanent) ---
async function getOffsetSec(flightDate: string): Promise<number> {
  const { data: over } = await supabaseAdmin
    .from("clock_offsets").select("offset_seconds").eq("flight_date", flightDate).maybeSingle();
  if (over) return over.offset_seconds || 0;
  const { data: perm } = await supabaseAdmin
    .from("clock_settings").select("permanent_offset_seconds").eq("id", 1).maybeSingle();
  return perm?.permanent_offset_seconds || 0;
}

// --- Email config (mirrors send-logs-email.functions.ts) ---
const SENDER_DOMAIN = "notify.spaghettigalleries.uk";
const FROM = `Jacob Abundy <caravan@${SENDER_DOMAIN}>`;
const REPLY_TO = "jacobabundy@icloud.com";
const DEFAULT_SUBJECT = "Logs {date}";
const DEFAULT_BODY = "Please find today's logs attached via the link below:\n\n{link}\n\nFrom Caravan, have a good evening.";
const CC = "accounts@sussexgliding.co.uk";

function fillTokens(tpl: string, tokens: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => tokens[k] ?? `{${k}}`);
}

async function tokenFor(addr: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`caravan-logs:${addr.toLowerCase()}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendOne(opts: { recipient: string; from: string; subject: string; text: string; html: string; idemKey: string; apiKey: string }) {
  return sendLovableEmail({
    to: opts.recipient,
    from: opts.from,
    sender_domain: SENDER_DOMAIN,
    reply_to: REPLY_TO,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    purpose: "transactional",
    unsubscribe_token: await tokenFor(opts.recipient),
    idempotency_key: opts.idemKey,
  }, { apiKey: opts.apiKey });
}

// --- Core: run auto-send for a target UK date ---
async function runForDate(flightDate: string, reason: string): Promise<{ status: string; detail?: any }> {
  // Dedupe via auto_send_log (INSERT first; conflict = already sent)
  const { error: insErr } = await supabaseAdmin
    .from("auto_send_log").insert({ flight_date: flightDate, sent_at: new Date().toISOString(), flights_count: 0, note: `pending:${reason}` });
  if (insErr) {
    // 23505 unique_violation = already sent
    if ((insErr as any).code === "23505") return { status: "already_sent" };
    throw new Error(`Reserve failed: ${insErr.message}`);
  }

  try {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const { data: flights, error: fErr } = await supabaseAdmin
      .from("flights").select("*").eq("flight_date", flightDate).order("takeoff_time", { ascending: true });
    if (fErr) throw new Error(`Flights query: ${fErr.message}`);

    if (!flights || flights.length === 0) {
      await supabaseAdmin.from("auto_send_log").update({ note: "skipped:no_flights", flights_count: 0 }).eq("flight_date", flightDate);
      return { status: "no_flights" };
    }

    const { data: gliders } = await supabaseAdmin.from("fleet_gliders").select("id, registration, glider_type, flarm_id, callsign");
    const { data: daily } = await supabaseAdmin.from("daily_logs").select("duty_instructor, duty_pilot").eq("flight_date", flightDate).maybeSingle();
    const offsetSec = await getOffsetSec(flightDate);

    const bin = await buildXlsx({
      date: flightDate,
      flights: flights as any[],
      gliders: (gliders as any[]) || [],
      dutyInstructor: daily?.duty_instructor ?? "",
      dutyPilot: daily?.duty_pilot ?? "",
      offsetSec,
    });

    const filename = `flight-log-${flightDate}.xlsx`;
    const path = `${flightDate}/${crypto.randomUUID()}-${filename}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("logs-exports").upload(path, bin, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });
    if (upErr) throw new Error(`Upload: ${upErr.message}`);

    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("logs-exports").createSignedUrl(path, 60 * 60 * 24 * 30);
    if (sErr || !signed?.signedUrl) throw new Error(`Sign: ${sErr?.message}`);
    const link = signed.signedUrl;

    // Email settings
    const { data: settings } = await supabaseAdmin
      .from("email_settings")
      .select("enabled, to_email, subject_template, body_template")
      .eq("id", 1).maybeSingle();
    if (settings && settings.enabled === false) {
      await supabaseAdmin.from("auto_send_log").update({ note: "skipped:email_disabled", flights_count: flights.length }).eq("flight_date", flightDate);
      return { status: "email_disabled" };
    }
    const to = settings?.to_email?.trim() || "office@sussexgliding.co.uk";
    const subjectTpl = settings?.subject_template?.trim() || DEFAULT_SUBJECT;
    const bodyTpl = settings?.body_template ?? DEFAULT_BODY;

    const dateLabel = fmtUKDate(flightDate);
    const nowUK = new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
    const tokens = { date: dateLabel, filename, document: filename, link, time: nowUK };
    const subject = fillTokens(subjectTpl, tokens);
    const text = fillTokens(bodyTpl, tokens);

    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const linkAnchor = `<a href="${esc(link)}">${esc(filename)}</a>`;
    const htmlTokens = { date: esc(dateLabel), filename: esc(filename), document: linkAnchor, link: linkAnchor, time: esc(nowUK) };
    const htmlBody = fillTokens(esc(bodyTpl), htmlTokens).replace(/\n/g, "<br/>");
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#111"><p style="margin:0 0 12px;color:#666;font-size:12px">Auto-sent at midnight by Caravan.</p>${htmlBody}</div>`;

    const idemBase = `auto-logs-${flightDate}`;
    const [primary, copy] = await Promise.allSettled([
      sendOne({ recipient: to, subject, text, html, idemKey: `${idemBase}-to`, apiKey }),
      sendOne({ recipient: CC, subject, text, html, idemKey: `${idemBase}-cc`, apiKey }),
    ]);

    if (primary.status === "rejected") {
      const msg = primary.reason instanceof Error ? primary.reason.message : String(primary.reason);
      throw new Error(`Send: ${msg}`);
    }

    await supabaseAdmin.from("auto_send_log").update({
      note: `sent:${reason}${copy.status === "rejected" ? " (cc_failed)" : ""}`,
      flights_count: flights.length,
      message_id: primary.value.message_id ?? null,
      recipient: to,
      sent_at: new Date().toISOString(),
    }).eq("flight_date", flightDate);

    return { status: "sent", detail: { to, messageId: primary.value.message_id, flights: flights.length } };
  } catch (err: any) {
    // Roll back the reservation so we'll retry on the next cron tick.
    await supabaseAdmin.from("auto_send_log").delete().eq("flight_date", flightDate);
    throw err;
  }
}

// --- Route ---
export const Route = createFileRoute("/api/public/hooks/auto-send-logs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({} as any));
          const force = body?.force === true;
          const explicitDate: string | undefined = typeof body?.date === "string" ? body.date : undefined;

          const nowUK = londonParts(new Date());
          const ukHour = parseInt(nowUK.hour, 10);

          // Target date = the UK day that just ended. At 00:xx UK -> yesterday.
          // Compute "yesterday in UK" by subtracting 1h from now then taking UK date.
          const yesterdayUK = londonParts(new Date(Date.now() - 60 * 60 * 1000));
          const targetDate = explicitDate || `${yesterdayUK.year}-${yesterdayUK.month}-${yesterdayUK.day}`;

          // Gate: only run during the midnight UK hour (00:00–00:59 UK) unless forced.
          if (!force && ukHour !== 0) {
            return Response.json({ status: "not_midnight", uk_hour: ukHour, target_date: targetDate });
          }

          const result = await runForDate(targetDate, force ? "forced" : "midnight");
          return Response.json({ target_date: targetDate, ...result });
        } catch (err: any) {
          console.error("[auto-send-logs] failed:", err);
          return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
