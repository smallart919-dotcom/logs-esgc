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

/**
 * Returns the UK clock's offset from UTC, in whole hours, for a given
 * UTC instant. Returns 1 during British Summer Time, 0 during GMT.
 * Used when querying glidernet's logbook, which takes a fixed-hour UTC
 * offset (its `z` parameter) rather than a timezone name and has no
 * DST awareness of its own.
 */
export function ukUtcOffsetHours(at: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  });
  const part = fmt.formatToParts(at).find((p) => p.type === "timeZoneName");
  const m = part?.value.match(/GMT([+-]\d+)?/);
  return m?.[1] ? parseInt(m[1], 10) : 0;
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

/** Format a yyyy-MM-dd flight date as UK DD-MM-YYYY for display. */
export function fmtUKDate(date: string | null | undefined): string {
  if (!date) return "—";
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  return `${m[3]}-${m[2]}-${m[1]}`;
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

function parseYmdHms(s: string): { Y: number; M: number; D: number; h: number; m: number; sec: number } | null {
  const withSec = s.length === 16 ? `${s}:00` : s;
  const [datePart, timePart] = withSec.split("T");
  if (!datePart || !timePart) return null;
  const [Y, M, D] = datePart.split("-").map(Number);
  const [h, m, sec = 0] = timePart.split(":").map(Number);
  if (![Y, M, D, h, m, sec].every(Number.isFinite)) return null;
  if (M < 1 || M > 12 || D < 1 || D > 31 || h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 59) return null;
  return { Y, M, D, h, m, sec };
}

function wallMatches(utcMs: number, wall: { Y: number; M: number; D: number; h: number; m: number; sec: number }) {
  const p = londonParts(new Date(utcMs));
  return +p.year === wall.Y && +p.month === wall.M && +p.day === wall.D && +p.hour === wall.h && +p.minute === wall.m && +p.second === wall.sec;
}

/** Convert a UK local datetime-local value back to a UTC ISO string. */
export function fromUKLocalInput(s: string | null | undefined): string | null {
  if (!s) return null;
  const wall = parseYmdHms(s);
  if (!wall) return null;
  const asIfUtc = Date.UTC(wall.Y, wall.M - 1, wall.D, wall.h, wall.m, wall.sec);
  const candidates = [asIfUtc - 60 * 60_000, asIfUtc, asIfUtc + 60 * 60_000];
  const match = candidates.find((ms) => wallMatches(ms, wall));
  return new Date(match ?? asIfUtc).toISOString();
}

export function todayUKDate(): string {
  const p = londonParts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
}

export function dateToUKShortLabel(date: string | null | undefined): string {
  if (!date) return "—";
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d).replace(/\//g, "-");
}
