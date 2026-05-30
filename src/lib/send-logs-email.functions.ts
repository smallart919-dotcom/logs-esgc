import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_FROM, resolveSender } from "@/lib/email-sender";
import { sendResendEmail } from "@/lib/resend-email";

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
    const from = resolveSender((settings as { from_email?: string } | null)?.from_email || DEFAULT_FROM);
    const subjectTpl = settings?.subject_template?.trim() || DEFAULT_SUBJECT;
    const bodyTpl = settings?.body_template ?? DEFAULT_BODY;

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

    try {
      const primary = await sendResendEmail({
        from,
        to,
        cc: cc && cc.toLowerCase() !== to.toLowerCase() ? cc : null,
        replyTo: REPLY_TO,
        subject,
        text,
        html,
        idempotencyKey: `${idemBase}-to`,
      });

      return {
        success: primary.success,
        messageId: primary.message_id,
        to,
        cc: cc && cc.toLowerCase() !== to.toLowerCase() ? cc : null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Send failed: ${msg}`);
    }
  });
