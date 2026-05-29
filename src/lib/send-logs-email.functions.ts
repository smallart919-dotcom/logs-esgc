import { createServerFn } from "@tanstack/react-start";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_FROM, SENDER_DOMAIN, normalizeSender } from "@/lib/email-sender";



interface Input {
  filename: string;
  base64: string;
  dateLabel: string;
}

const REPLY_TO = "jacobabundy@icloud.com";

const DEFAULT_SUBJECT = "Logs {date}";
const DEFAULT_BODY =
  "Please find today's logs attached via the link below:\n\n{link}\n\nFrom Caravan, have a good evening.";

function fillTokens(tpl: string, tokens: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => tokens[k] ?? `{${k}}`);
}

export const sendLogsEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => {
    if (!d?.filename || !d?.base64 || !d?.dateLabel) throw new Error("Missing fields");
    if (d.base64.length > 15_000_000) throw new Error("File too large");
    return d;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    // Load office-configured settings (enabled, to_email, from_email, templates)
    const { data: settings } = await supabaseAdmin
      .from("email_settings")
      .select("enabled, to_email, cc_email, from_email, subject_template, body_template")
      .eq("id", 1)
      .maybeSingle();

    if (settings && settings.enabled === false) {
      throw new Error("Sending to office is disabled in Settings");
    }

    const to = settings?.to_email?.trim() || "office@sussexgliding.co.uk";
    const cc = (settings as { cc_email?: string } | null)?.cc_email?.trim() || "";
    const from = normalizeSender((settings as { from_email?: string } | null)?.from_email || DEFAULT_FROM);
    const subjectTpl = settings?.subject_template?.trim() || DEFAULT_SUBJECT;
    const bodyTpl = settings?.body_template ?? DEFAULT_BODY;

    // Decode base64 to bytes and upload to private storage
    const bin = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${data.filename}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("logs-exports")
      .upload(path, bin, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("logs-exports")
      .createSignedUrl(path, 60 * 60 * 24 * 30);
    if (sErr || !signed) throw new Error(`Signed URL failed: ${sErr?.message}`);

    const link = signed.signedUrl;
    const nowUK = new Date().toLocaleTimeString("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
    });

    const tokens: Record<string, string> = {
      date: data.dateLabel,
      filename: data.filename,
      document: data.filename,
      link,
      time: nowUK,
    };

    const subject = fillTokens(subjectTpl, tokens);
    const text = fillTokens(bodyTpl, tokens);

    // Build HTML: escape template first (preserves {tokens}), then fill with HTML values.
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const linkAnchor = `<a href="${esc(link)}">${esc(data.filename)}</a>`;
    const htmlTokens: Record<string, string> = {
      date: esc(data.dateLabel),
      filename: esc(data.filename),
      document: linkAnchor,
      link: linkAnchor,
      time: esc(nowUK),
    };
    const htmlBody = fillTokens(esc(bodyTpl), htmlTokens).replace(/\n/g, "<br/>");
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#111">${htmlBody}</div>`;

    const idemBase = `logs-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}`;

    // Deterministic unsubscribe token per recipient (required by Lovable Email API
    // for transactional purpose). This is operational mail to the club office; no
    // real opt-out flow is needed, but the API mandates the field.
    const tokenFor = async (addr: string) => {
      const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`caravan-logs:${addr.toLowerCase()}`),
      );
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    };

    const send = async (recipient: string, suffix: string) =>
      sendLovableEmail(
        {
          to: recipient,
          from,
          sender_domain: SENDER_DOMAIN,
          reply_to: REPLY_TO,
          subject,
          text,
          html,
          purpose: "transactional",
          unsubscribe_token: await tokenFor(recipient),
          idempotency_key: `${idemBase}-${suffix}`,
        },
        { apiKey },
      );

    const tasks: Promise<Awaited<ReturnType<typeof send>>>[] = [send(to, "to")];
    if (cc && cc.toLowerCase() !== to.toLowerCase()) tasks.push(send(cc, "cc"));
    const results = await Promise.allSettled(tasks);
    const primary = results[0];
    const copy = results[1];

    if (primary.status === "rejected") {
      const msg = primary.reason instanceof Error ? primary.reason.message : String(primary.reason);
      throw new Error(`Send failed: ${msg}`);
    }
    if (copy && copy.status === "rejected") {
      console.warn(`CC to ${cc} failed:`, copy.reason);
    }

    return {
      success: primary.value.success,
      messageId: primary.value.message_id,
      to,
      cc: copy && copy.status === "fulfilled" ? cc : null,
    };
  });

