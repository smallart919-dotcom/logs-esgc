/**
 * Compute a flight duration from its takeoff and landing timestamps. The
 * displayed/exported duration must always be derived from these two
 * stored times — never from a free-text field — so manual data-entry
 * mistakes can't desync the duration from the actual airtime.
 */
export function durationMinutes(takeoff: string | null | undefined, landing: string | null | undefined): number | null {
  if (!takeoff || !landing) return null;
  const t = +new Date(takeoff);
  const l = +new Date(landing);
  if (!Number.isFinite(t) || !Number.isFinite(l)) return null;
  const m = Math.round((l - t) / 60000);
  return m >= 0 ? m : null;
}

/** Format as `H:MM` (e.g. `1:23`). Returns `—` when unknown, `?` when landing < takeoff. */
export function fmtDurationHMM(takeoff: string | null | undefined, landing: string | null | undefined): string {
  if (!takeoff) return "—";
  if (!landing) return "in air";
  const m = durationMinutes(takeoff, landing);
  if (m === null) return "?";
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** Format as `Xh YYm`. */
export function fmtDurationHHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
