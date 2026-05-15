// UK time helpers — gliding club uses local Europe/London time on logs,
// while OGN and the database store UTC. These helpers convert between the two
// safely across BST/GMT.

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
  // Intl can return "24" for hour at midnight in some engines; normalise.
  if (parts.hour === "24") parts.hour = "00";
  return parts;
}

/** Format a UTC ISO string as UK local HH:mm (handles BST). Optional offsetSec is added to the instant before formatting (used to match an out-of-sync clubhouse clock). */
export function fmtUKTime(iso: string | null | undefined, offsetSec = 0): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + offsetSec * 1000);
  const p = londonParts(d);
  return `${p.hour}:${p.minute}`;
}

/** Add offsetSec to an ISO and return the new ISO (or null). */
export function shiftIso(iso: string | null | undefined, offsetSec = 0): string | null {
  if (!iso) return null;
  if (!offsetSec) return iso;
  return new Date(new Date(iso).getTime() + offsetSec * 1000).toISOString();
}

/** Format a UTC ISO string as UK local HH:mm:ss. */
export function fmtUKTimeSec(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = londonParts(new Date(iso));
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** Convert a UTC ISO to a value suitable for <input type="datetime-local"> in UK time. */
export function toUKLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = londonParts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Convert a UK local datetime-local value back to a UTC ISO string. */
export function fromUKLocalInput(s: string | null | undefined): string | null {
  if (!s) return null;
  const withSec = s.length === 16 ? `${s}:00` : s;
  const [datePart, timePart] = withSec.split("T");
  if (!datePart || !timePart) return null;
  const [Y, M, D] = datePart.split("-").map(Number);
  const [h, m, sec] = timePart.split(":").map(Number);
  // Treat the entered wall time as UTC, then subtract the London offset at
  // that wall-clock moment to get the true UTC instant.
  const asIfUtc = Date.UTC(Y, M - 1, D, h, m, sec || 0);
  // Offset in minutes London is ahead of UTC at this wall time.
  const p = londonParts(new Date(asIfUtc));
  const wallUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = (wallUtc - asIfUtc) / 60_000;
  return new Date(asIfUtc - offsetMin * 60_000).toISOString();
}
