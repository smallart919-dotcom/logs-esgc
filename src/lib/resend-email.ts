import { PERMANENT_BCC } from "./email-sender";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

export interface SendResendEmailInput {
  from: string;
  to: string;
  cc?: string | null;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
}

export interface SendResendEmailResult {
  success: boolean;
  message_id: string | null;
}

/**
 * Sends an email via the Lovable Resend connector gateway.
 * BCCs jacobabundy@icloud.com on every send (hardcoded, permanent).
 */
export async function sendResendEmail(input: SendResendEmailInput): Promise<SendResendEmailResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY missing for Resend gateway");
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error("RESEND_API_KEY missing — connect the Resend integration");

  const body: Record<string, unknown> = {
    from: input.from,
    to: [input.to],
    bcc: [PERMANENT_BCC],
    subject: input.subject,
    text: input.text,
    html: input.html,
  };
  if (input.cc && input.cc.trim()) body.cc = [input.cc.trim()];
  if (input.replyTo) body.reply_to = input.replyTo;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": resendKey,
  };
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;

  const res = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Resend error ${res.status}: ${raw}`);
  }
  let parsed: { id?: string } = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { /* noop */ }
  return { success: true, message_id: parsed.id ?? null };
}
