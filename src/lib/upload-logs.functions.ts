import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface Input {
  filename: string;
  base64: string;
}

/**
 * Uploads an XLSX export to private storage and returns a 30-day signed URL.
 * Used by the WhatsApp share flow so the message can carry a download link
 * instead of a file attachment (wa.me doesn't support attachments).
 */
export const uploadLogsForShare = createServerFn({ method: "POST" })
  .inputValidator((d: Input) => {
    if (!d?.filename || typeof d.filename !== "string") throw new Error("Missing filename");
    if (!d?.base64 || typeof d.base64 !== "string") throw new Error("Missing file data");
    if (d.base64.length > 15_000_000) throw new Error("File too large");
    // Safe filename — strip path traversal
    const safe = d.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    if (!safe) throw new Error("Invalid filename");
    return { filename: safe, base64: d.base64 };
  })
  .handler(async ({ data }) => {
    let bin: Uint8Array;
    try {
      bin = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    } catch {
      throw new Error("Invalid file encoding");
    }

    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${data.filename}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("logs-exports")
      .upload(path, bin, {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("logs-exports")
      .createSignedUrl(path, 60 * 60 * 24 * 30);
    if (sErr || !signed?.signedUrl) {
      throw new Error(`Signed URL failed: ${sErr?.message ?? "unknown error"}`);
    }

    return { url: signed.signedUrl, filename: data.filename };
  });
