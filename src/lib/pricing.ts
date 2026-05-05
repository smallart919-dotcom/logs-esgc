// ESGC 2026 pricing — derived from official price list.
// All prices in GBP.

export type FlightLike = {
  glider_registration: string | null;
  takeoff_time: string | null;
  landing_time: string | null;
  launch_type: "aerotow" | "winch" | null;
  aerotow_height_ft: number | null;
};

export const PRICES = {
  winch: { standard: 12.5, u21: 6.25 },
  soaringPerMin: { standard: 0.56, u21: 0.28 },
  motorGliderPerHour: 110,
  launchFailureBelow1000: 14,
};

export function aerotowFee(heightFt: number | null | undefined): number {
  if (!heightFt || heightFt <= 0) return 0;
  if (heightFt < 1000) return PRICES.launchFailureBelow1000;
  if (heightFt <= 1000) return 27;
  if (heightFt <= 1500) return 33;
  if (heightFt <= 2000) return 39;
  if (heightFt <= 2500) return 44;
  if (heightFt <= 3000) return 50;
  const over = heightFt - 3000;
  const blocks = Math.ceil(over / 500);
  return 50 + blocks * 6.25;
}

export type Charge = {
  launch: number;
  soaring: number;
  motorGlider: number;
  total: number;
  notes: string[];
};

export function computeFlightCharge(f: FlightLike, u21: boolean): Charge {
  const reg = (f.glider_registration || "").toUpperCase().trim();
  const notes: string[] = [];
  let launch = 0;
  let soaring = 0;
  let motorGlider = 0;

  // Tug — not charged to pilots
  if (reg === "G-ESGC") {
    return { launch: 0, soaring: 0, motorGlider: 0, total: 0, notes: ["Tug — no charge"] };
  }

  // Motor glider — per-hour rate, no separate launch/soaring
  if (reg === "G-KIAU") {
    if (f.takeoff_time && f.landing_time) {
      const mins = (+new Date(f.landing_time) - +new Date(f.takeoff_time)) / 60000;
      motorGlider = +(PRICES.motorGliderPerHour * (mins / 60)).toFixed(2);
      notes.push(`Motor glider ${Math.round(mins)} min`);
    } else {
      notes.push("Motor glider — missing time");
    }
    const total = +(launch + soaring + motorGlider).toFixed(2);
    return { launch, soaring, motorGlider, total, notes };
  }

  // Launch
  if (f.launch_type === "aerotow") {
    launch = aerotowFee(f.aerotow_height_ft);
    notes.push(`Aerotow ${f.aerotow_height_ft ?? "?"}ft`);
  } else if (f.launch_type === "winch") {
    launch = u21 ? PRICES.winch.u21 : PRICES.winch.standard;
    notes.push(`Winch${u21 ? " U21" : ""}`);
  }

  // Soaring (duration)
  if (f.takeoff_time && f.landing_time) {
    const mins = Math.max(0, Math.round((+new Date(f.landing_time) - +new Date(f.takeoff_time)) / 60000));
    const rate = u21 ? PRICES.soaringPerMin.u21 : PRICES.soaringPerMin.standard;
    soaring = +(mins * rate).toFixed(2);
    notes.push(`${mins} min @ £${rate.toFixed(2)}`);
  }

  const total = +(launch + soaring + motorGlider).toFixed(2);
  return { launch, soaring, motorGlider, total, notes };
}

export const fmtGBP = (n: number) => `£${n.toFixed(2)}`;
