// ⚠️ SITUATIONAL AWARENESS ONLY — not certified for navigation.
// Verify against current UK AIP and NOTAMs before any flight operation.
// Polygon coordinates are approximated. For a production-quality overlay,
// replace this file with OpenAIP / OpenAIR data (see plan).

export type AirspaceClass = "ATZ" | "CTR" | "CTA" | "TMA" | "MATZ" | "DANGER";

export type AirspaceFeatureProperties = {
  name: string;
  ident?: string;          // e.g. "EGKA"
  class: AirspaceClass;
  lower: string;           // human-readable lower limit
  upper: string;           // human-readable upper limit
  colour: string;
  fill: number;
  frequency?: string;      // tower / approach freq, when known
  notes?: string;
  /** Lat/lon for a centred label marker (optional override). */
  labelAt?: [number, number];
};

const palette: Record<AirspaceClass, string> = {
  ATZ:    "#f97316", // orange
  CTR:    "#dc2626", // red
  CTA:    "#6366f1", // indigo
  TMA:    "#8b5cf6", // violet
  MATZ:   "#0ea5e9", // sky blue
  DANGER: "#ef4444", // red
};

const fillFor: Record<AirspaceClass, number> = {
  ATZ: 0.10, CTR: 0.10, CTA: 0.05, TMA: 0.05, MATZ: 0.08, DANGER: 0.15,
};

function feat(
  props: Omit<AirspaceFeatureProperties, "colour" | "fill"> & Partial<Pick<AirspaceFeatureProperties, "colour" | "fill">>,
  coordinates: [number, number][],
) {
  return {
    type: "Feature" as const,
    properties: {
      ...props,
      colour: props.colour ?? palette[props.class],
      fill: props.fill ?? fillFor[props.class],
    } satisfies AirspaceFeatureProperties,
    geometry: { type: "Polygon" as const, coordinates: [coordinates] },
  };
}

export const AIRSPACE_GEOJSON = {
  type: "FeatureCollection" as const,
  features: [
    feat(
      {
        name: "Shoreham ATZ",
        ident: "EGKA",
        class: "ATZ",
        lower: "SFC",
        upper: "2000 ft ALT",
        frequency: "125.405",
        notes: "Brighton City Airport. 2 NM radius.",
        labelAt: [50.8217, -0.2972],
      },
      [
        [-0.2972, 50.8706], [-0.2614, 50.8680], [-0.2329, 50.8577],
        [-0.2131, 50.8416], [-0.2059, 50.8217], [-0.2131, 50.8018],
        [-0.2329, 50.7857], [-0.2614, 50.7754], [-0.2972, 50.7728],
        [-0.3330, 50.7754], [-0.3615, 50.7857], [-0.3813, 50.8018],
        [-0.3885, 50.8217], [-0.3813, 50.8416], [-0.3615, 50.8577],
        [-0.3330, 50.8680], [-0.2972, 50.8706],
      ],
    ),
    feat(
      {
        name: "Gatwick CTR",
        ident: "EGKK",
        class: "CTR",
        lower: "SFC",
        upper: "2500 ft ALT",
        frequency: "124.225",
        notes: "Class D. Clearance required.",
        labelAt: [51.148, -0.190],
      },
      [
        [-0.2800, 51.1960], [-0.2200, 51.2080], [-0.1500, 51.2100],
        [-0.0800, 51.2000], [-0.0200, 51.1800], [0.0100, 51.1400],
        [-0.0100, 51.1000], [-0.0800, 51.0750], [-0.1600, 51.0700],
        [-0.2400, 51.0900], [-0.2900, 51.1200], [-0.2800, 51.1960],
      ],
    ),
    feat(
      {
        name: "Gatwick CTA",
        ident: "EGKK",
        class: "CTA",
        lower: "2500 ft ALT",
        upper: "FL065",
        frequency: "126.825",
        notes: "Class D control area.",
        labelAt: [51.16, 0.05],
      },
      [
        [-0.5000, 51.2500], [-0.3000, 51.2700], [-0.1000, 51.2800],
        [0.1000, 51.2500], [0.2500, 51.1800], [0.3000, 51.0500],
        [0.2000, 50.9800], [0.0000, 50.9400], [-0.2000, 50.9700],
        [-0.4000, 51.0500], [-0.5500, 51.1500], [-0.5000, 51.2500],
      ],
    ),
    feat(
      {
        name: "Lydd ATZ",
        ident: "EGMD",
        class: "ATZ",
        lower: "SFC",
        upper: "2000 ft ALT",
        frequency: "120.705",
        notes: "London Ashford Airport.",
        labelAt: [50.94, 0.945],
      },
      [
        [0.9392, 50.9849], [0.9750, 50.9790], [1.0020, 50.9590],
        [1.0100, 50.9330], [0.9960, 50.9090], [0.9640, 50.8940],
        [0.9270, 50.8910], [0.8990, 50.9040], [0.8800, 50.9290],
        [0.8840, 50.9570], [0.9040, 50.9790], [0.9392, 50.9849],
      ],
    ),
  ],
};

/** Returns true if (lat, lon) is inside any airspace polygon. Naive
 *  point-in-polygon (ray casting). Good enough for proximity warnings. */
export function airspaceAt(lat: number, lon: number): AirspaceFeatureProperties[] {
  const hits: AirspaceFeatureProperties[] = [];
  for (const f of AIRSPACE_GEOJSON.features) {
    const ring = f.geometry.coordinates[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersect = (yi > lat) !== (yj > lat) &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) hits.push(f.properties as AirspaceFeatureProperties);
  }
  return hits;
}
