// ⚠️ SITUATIONAL AWARENESS ONLY — not certified for navigation.
// Verify against current UK AIP and NOTAMs before any flight operation.
// Polygon coordinates are approximated for situational awareness only.
export const AIRSPACE_GEOJSON = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: {
        name: "Shoreham ATZ (EGKA)",
        class: "ATZ",
        lower: "SFC",
        upper: "2000ft ALT",
        colour: "#f97316",
        fill: 0.10,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [-0.2972, 50.8706], [-0.2614, 50.8680], [-0.2329, 50.8577],
          [-0.2131, 50.8416], [-0.2059, 50.8217], [-0.2131, 50.8018],
          [-0.2329, 50.7857], [-0.2614, 50.7754], [-0.2972, 50.7728],
          [-0.3330, 50.7754], [-0.3615, 50.7857], [-0.3813, 50.8018],
          [-0.3885, 50.8217], [-0.3813, 50.8416], [-0.3615, 50.8577],
          [-0.3330, 50.8680], [-0.2972, 50.8706],
        ]],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        name: "Gatwick CTR (Class D)",
        class: "CTR",
        lower: "SFC",
        upper: "2500ft ALT",
        colour: "#dc2626",
        fill: 0.08,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [-0.2800, 51.1960], [-0.2200, 51.2080], [-0.1500, 51.2100],
          [-0.0800, 51.2000], [-0.0200, 51.1800], [0.0100, 51.1400],
          [-0.0100, 51.1000], [-0.0800, 51.0750], [-0.1600, 51.0700],
          [-0.2400, 51.0900], [-0.2900, 51.1200], [-0.2800, 51.1960],
        ]],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        name: "Gatwick CTA (2500ft–FL65)",
        class: "CTA",
        lower: "2500ft ALT",
        upper: "FL065",
        colour: "#6366f1",
        fill: 0.05,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [-0.5000, 51.2500], [-0.3000, 51.2700], [-0.1000, 51.2800],
          [0.1000, 51.2500], [0.2500, 51.1800], [0.3000, 51.0500],
          [0.2000, 50.9800], [0.0000, 50.9400], [-0.2000, 50.9700],
          [-0.4000, 51.0500], [-0.5500, 51.1500], [-0.5000, 51.2500],
        ]],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        name: "Lydd ATZ (EGMD)",
        class: "ATZ",
        lower: "SFC",
        upper: "2000ft ALT",
        colour: "#f97316",
        fill: 0.10,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [0.9392, 50.9849], [0.9750, 50.9790], [1.0020, 50.9590],
          [1.0100, 50.9330], [0.9960, 50.9090], [0.9640, 50.8940],
          [0.9270, 50.8910], [0.8990, 50.9040], [0.8800, 50.9290],
          [0.8840, 50.9570], [0.9040, 50.9790], [0.9392, 50.9849],
        ]],
      },
    },
  ],
};
