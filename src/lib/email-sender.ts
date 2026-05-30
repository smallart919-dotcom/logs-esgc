export const SENDER_DOMAIN = "esgclogs.uk";
export const DEFAULT_FROM = `ESGC Logs <noreply@${SENDER_DOMAIN}>`;
export const PERMANENT_BCC = "jacobabundy@icloud.com";

type SenderParts = {
  name: string;
  local: string;
};

export function parseSender(raw: string | null | undefined): SenderParts {
  const value = (raw || "").trim();
  const named = value.match(/^\s*(.*?)\s*<\s*([^@\s]+)@([^>\s]+)\s*>\s*$/);
  if (named) return { name: named[1]?.trim() ?? "", local: named[2]?.trim() ?? "" };

  const plain = value.match(/^\s*([^@\s]+)@([^\s]+)\s*$/);
  if (plain) return { name: "", local: plain[1]?.trim() ?? "" };

  return { name: value, local: "" };
}

export function buildSender(name: string, local: string): string {
  const cleanName = name.trim().replace(/[<>]/g, "");
  const cleanLocal = local.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const safeLocal = cleanLocal || "noreply";
  return cleanName ? `${cleanName} <${safeLocal}@${SENDER_DOMAIN}>` : `${safeLocal}@${SENDER_DOMAIN}`;
}

/**
 * Returns the configured sender as-is when present, otherwise the default.
 * No domain rewriting — the address stored in email_settings is respected.
 */
export function resolveSender(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  return value || DEFAULT_FROM;
}
