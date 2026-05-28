export const SENDER_DOMAIN = "notify.spaghettigalleries.uk";
export const DEFAULT_FROM = `Jacob Abundy <caravan@${SENDER_DOMAIN}>`;

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
  const safeLocal = cleanLocal || "caravan";
  return cleanName ? `${cleanName} <${safeLocal}@${SENDER_DOMAIN}>` : `${safeLocal}@${SENDER_DOMAIN}`;
}

export function normalizeSender(raw: string | null | undefined): string {
  const parsed = parseSender(raw || DEFAULT_FROM);
  return buildSender(parsed.name || "Jacob Abundy", parsed.local || "caravan");
}