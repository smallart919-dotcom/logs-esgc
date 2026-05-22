import { createServerFn } from "@tanstack/react-start";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface Input {
  filename: string;
  base64: string;
  dateLabel: string;
}

const SENDER_DOMAIN = "notify.spaghettigalleries.uk";
const FROM = `Jacob Abundy <caravan@${SENDER_DOMAIN}>`;
const TO = "office@sussexgliding.co.uk";
const REPLY_TO = "jacobabundy@icloud.com";

export const sendLogsEmail = createServerFn({ method: "POST" })
  .inputValidator((d: Input) => {
    if (!d?.filename || !d?.base64 || !d?.dateLabel) throw new Error("Missing fields");
    if (d.base64.length > 15_000_000) throw new Error("File too large");
    return d;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

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

    // 30-day signed download URL
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("logs-exports")
      .createSignedUrl(path, 60 * 60 * 24 * 30);
    if (sErr || !signed) throw new Error(`Signed URL failed: ${sErr?.message}`);

    const subject = `Logs ${data.dateLabel}`;
    const link = signed.signedUrl;
    const text = `Please find today's logs attached via the link below:\n\n${link}\n\nFrom Caravan, have a good evening.`;
    const html = `<p>Please find today's logs attached via the link below:</p>
<p><a href="${link}">${data.filename}</a></p>
<p>From Caravan, have a good evening.</p>`;

    const res = await sendLovableEmail(
      {
        to: TO,
        from: FROM,
        sender_domain: SENDER_DOMAIN,
        reply_to: REPLY_TO,
        subject,
        text,
        html,
      },
      { apiKey },
    );

    return { success: res.success, messageId: res.message_id };
  });
