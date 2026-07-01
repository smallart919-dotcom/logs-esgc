import { useEffect, useMemo, useRef, useState } from "react";
import { useAviationWeather } from "@/lib/use-aviation-weather";


/**
 * Ringmer Soarcast-style weather briefing.
 * - METAR/TAF: metar-taf.com embed widget for GB-0614 (Ringmer Glider Field)
 * - RASP BlipSpot: 8 forecast graphs for trigraph RIN, day-pickable
 * - RASP Meteogram: full column atmospheric forecast, day-pickable
 *
 * Day buttons mirror the live Monday→Sunday RASP sequence. At UK midnight
 * into Sunday, Monday–Saturday roll forward; Sunday holds today's chart.
 */

const RIN_TRIGRAPH = "RIN";
const METAR_ID = "GB-0614";

type Day = { key: string; label: string; date: Date; rasp: string };

/** Build the Monday→Sunday day list used by the RASP buttons. */
function buildWeek(): Day[] {
  const now = new Date();
  // RASP day param is the English weekday name.
  const monday = new Date(now);
  const dow = (now.getDay() + 6) % 7; // 0 = Monday
  monday.setDate(now.getDate() - dow);
  monday.setHours(12, 0, 0, 0);
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return names.map((n, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      key: n.slice(0, 3) + d.getDate(),
      label: `${n.slice(0, 3)} ${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`,
      date: d,
      rasp: n,
    };
  });
}

const BLIP_PARAMS: { key: string; label: string; desc: string }[] = [
  { key: "blip_main", label: "Main Parameters", desc: "Thermal strength, height & cloudbase" },
  { key: "blip_temp", label: "Temperature", desc: "Surface & dew point temperature" },
  { key: "blip_wind", label: "Wind Speed", desc: "Surface & boundary layer winds" },
  { key: "blip_wind_dir", label: "Wind Direction", desc: "Wind direction through the day" },
  { key: "blip_cu", label: "Cu Potential", desc: "Cumulus cloudbase potential" },
  { key: "blip_sun", label: "Sun %", desc: "Solar radiation percentage" },
  { key: "blip_rain", label: "Rain", desc: "Precipitation forecast" },
  { key: "blip_stars", label: "Star Rating", desc: "Cross-country soaring rating" },
];

export function WeatherView({ variant = "page" }: { variant?: "drawer" | "page" }) {
  const week = useMemo(buildWeek, []);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const [blipDay, setBlipDay] = useState<Day>(week[todayIdx]);
  const [metDay, setMetDay] = useState<Day>(week[todayIdx]);

  const dark = variant === "drawer";
  const text = dark ? "#f1f5f9" : "hsl(var(--foreground))";
  const muted = dark ? "rgba(255,255,255,0.6)" : "hsl(var(--muted-foreground))";
  const cardBg = dark ? "rgba(255,255,255,0.04)" : "hsl(var(--card))";
  const cardBorder = dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid hsl(var(--border))";

  return (
    <div style={{ color: text, fontFamily: "system-ui,sans-serif" }}>
      {/* Briefing intro */}
      <section style={{ marginBottom: 28, padding: 18, background: cardBg, border: cardBorder, borderRadius: 14 }}>
        <div style={{ display: "inline-block", padding: "4px 10px", background: "rgba(56,189,248,0.15)", color: "#38bdf8", borderRadius: 999, fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
          ☁ Ringmer gliding outlook · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 6px" }}>Live flying-day briefing</h2>
        <p style={{ color: muted, fontSize: 14, lineHeight: 1.5, marginBottom: 12, marginTop: 0 }}>
          Today's RASP, meteogram, METAR and aviation briefings are lined up below for a quick go / no-go scan before launch.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginTop: 10 }}>
          <MiniCard title="Suitability" body="Check today's live charts below" extra="The dashboard is aligned so each button date matches its live upstream chart." muted={muted} dark={dark} />
          <MiniCard title="Forecast flow" body="Sunday midnight rolls the week forward" extra="Monday–Saturday jump to the next forecast set at UK midnight into Sunday." muted={muted} dark={dark} />
        </div>
      </section>

      {/* METAR / TAF — official metar-taf.com embed (landscape widget for EGKA/Ringmer) */}
      <Section title="✈ METAR / TAF" subtitle={`Live weather for Ringmer Glider Field (${METAR_ID}) · Runway 06/24 (not 7/25)`} muted={muted}>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: 14, display: "flex", justifyContent: "center" }}>
          <MetarTafWidget dark={dark} />
        </div>
        <a href={`https://metar-taf.com/metar/${METAR_ID}?station_id=EGKA`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "#38bdf8" }}>
          Open full METAR / TAF ↗
        </a>
      </Section>

      {/* Nearby aerodromes — Deanland & Kitty Hawk (both use Shoreham EGKA as the nearest reporting station) */}
      <Section
        title="🛩 Nearby fields — Deanland & Kitty Hawk"
        subtitle="Neither field has its own METAR/TAF. Closest official observations are Shoreham (EGKA) and Headcorn (EGKH)."
        muted={muted}
      >
        <NearbyFieldsCard cardBg={cardBg} cardBorder={cardBorder} muted={muted} />
      </Section>



      {/* RASP BlipSpot */}
      <Section
        title={`☁ RASP BlipSpot — Ringmer (${RIN_TRIGRAPH})`}
        subtitle={<>Soaring forecast graphs from <a href={`https://rasp.stratus.org.uk/index.php/blipspot-maker?tp=${RIN_TRIGRAPH}`} target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>RASP Stratus</a></>}
        muted={muted}
      >
        <DayPicker week={week} selected={blipDay} onSelect={setBlipDay} dark={dark} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14, marginTop: 14 }}>
          {BLIP_PARAMS.map((p) => (
            <ChartCard
              key={p.key}
              label={p.label}
              desc={p.desc}
              src={`https://app.stratus.org.uk/blip/graph/${p.key}.php?day=${blipDay.rasp}&tp=${RIN_TRIGRAPH}`}
              cardBg={cardBg}
              cardBorder={cardBorder}
              muted={muted}
            />
          ))}
        </div>
      </Section>

      {/* RASP Meteogram */}
      <Section
        title={`📊 RASP Meteogram — Ringmer (${RIN_TRIGRAPH})`}
        subtitle={<>Full atmospheric profile from <a href={`https://rasp.stratus.org.uk/index.php/meteograms?tp=${RIN_TRIGRAPH}`} target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>RASP Meteograms</a></>}
        muted={muted}
      >
        <DayPicker week={week} selected={metDay} onSelect={setMetDay} dark={dark} />
        <ChartCard
          label={`Meteogram — ${metDay.label}`}
          desc="Full column atmospheric forecast for Ringmer"
          src={`https://app.stratus.org.uk/blip/graph/meteogram.php?day=${metDay.rasp}&tp=${RIN_TRIGRAPH}`}
          cardBg={cardBg}
          cardBorder={cardBorder}
          muted={muted}
          tall
        />
      </Section>
    </div>
  );
}

function Section({ title, subtitle, muted, children }: { title: string; subtitle: React.ReactNode; muted: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>{title}</h3>
      <p style={{ color: muted, fontSize: 13, margin: "0 0 12px" }}>{subtitle}</p>
      {children}
    </section>
  );
}

function MiniCard({ title, body, extra, muted, dark }: { title: string; body: string; extra: string; muted: string; dark: boolean }) {
  return (
    <div style={{ padding: 14, borderRadius: 10, background: dark ? "rgba(255,255,255,0.03)" : "hsl(var(--muted))", border: dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid hsl(var(--border))" }}>
      <div style={{ fontSize: 11, color: muted, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{body}</div>
      <div style={{ fontSize: 12, color: muted, lineHeight: 1.45 }}>{extra}</div>
    </div>
  );
}

function DayPicker({ week, selected, onSelect, dark }: { week: Day[]; selected: Day; onSelect: (d: Day) => void; dark: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {week.map((d) => {
        const active = d.key === selected.key;
        return (
          <button
            key={d.key}
            onClick={() => onSelect(d)}
            style={{
              padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 600,
              background: active ? "#38bdf8" : (dark ? "rgba(255,255,255,0.06)" : "hsl(var(--muted))"),
              color: active ? "#0b0f19" : (dark ? "#f1f5f9" : "hsl(var(--foreground))"),
            }}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

function ChartCard({ label, desc, src, cardBg, cardBorder, muted, tall }: { label: string; desc: string; src: string; cardBg: string; cardBorder: string; muted: string; tall?: boolean }) {
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: muted, marginBottom: 8 }}>{desc}</div>
      <img
        src={src}
        alt={label}
        style={{ width: "100%", borderRadius: 6, display: "block", minHeight: tall ? 360 : 180, background: "rgba(0,0,0,0.2)" }}
        loading="lazy"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
      />
    </div>
  );
}

/**
 * Official metar-taf.com landscape embed with an iframe fallback so the
 * widget still renders if the third-party script is blocked (adblock,
 * CSP, offline). We mount both and let whichever loads first fill the box.
 */
function MetarTafWidget({ dark }: { dark: boolean }) {
  const targetId = useRef(`metartaf-${Math.random().toString(36).slice(2, 10)}`).current;
  const [scriptOk, setScriptOk] = useState(false);
  useEffect(() => {
    const s = document.createElement("script");
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.src = `https://metar-taf.com/embed-js/${METAR_ID}?bg_color=${dark ? "000000" : "ffffff"}&station_id=EGKA&layout=landscape&qnh=inHg&rh=rh&target=${targetId}`;
    s.onload = () => setScriptOk(true);
    s.onerror = () => setScriptOk(false);
    document.body.appendChild(s);
    // If the script hasn't populated the anchor in 2.5s, show the iframe fallback.
    const t = setTimeout(() => {
      const el = document.getElementById(targetId);
      if (el && el.childElementCount === 0) setScriptOk(false);
    }, 2500);
    return () => { s.remove(); clearTimeout(t); };
  }, [dark, targetId]);
  return (
    <div style={{ width: 350, maxWidth: "100%" }}>
      <a
        href={`https://metar-taf.com/metar/${METAR_ID}?station_id=EGKA`}
        id={targetId}
        style={{ fontSize: 14, fontWeight: 500, color: dark ? "#fff" : "#000", width: "100%", minHeight: scriptOk ? 278 : 0, display: "block" }}
      >
        METAR Ringmer Glider Field
      </a>
      {!scriptOk && (
        <iframe
          title="METAR Ringmer fallback"
          src={`https://metar-taf.com/embed/${METAR_ID}?bg_color=${dark ? "000000" : "ffffff"}&station_id=EGKA&layout=landscape&qnh=inHg&rh=rh`}
          style={{ width: "100%", height: 278, border: 0, borderRadius: 8, background: dark ? "#000" : "#fff" }}
          loading="lazy"
        />
      )}
    </div>
  );
}

/**
 * Deanland (EGML) and Kitty Hawk (Ashford) have no official METAR/TAF.
 * We show the nearest reporting stations — Shoreham EGKA (25 nm west of
 * Deanland / 40 nm from Kitty Hawk) and Headcorn EGKH (closer to Kitty
 * Hawk) — plus a plain-language card per field with runway + elevation.
 */
function NearbyFieldsCard({ cardBg, cardBorder, muted }: { cardBg: string; cardBorder: string; muted: string }) {
  const { metar, taf } = useAviationWeather(["EGKA", "EGKH"]);
  const byId = (id: string) => ({
    metar: metar.find((m) => m.id === id)?.raw ?? "Fetching…",
    taf: taf.find((t) => t.id === id)?.raw ?? "Fetching…",
  });
  const egka = byId("EGKA");
  const egkh = byId("EGKH");

  const fields = [
    {
      name: "Deanland (EGML)",
      blurb: "Grass strip, elevation ~52 ft. Runway 06/24. Sits ~2 nm ENE of Ringmer — expect broadly similar surface wind and cloudbase. PPR only.",
      station: "Shoreham (EGKA)",
      metar: egka.metar,
      taf: egka.taf,
    },
    {
      name: "Kitty Hawk (Ashford)",
      blurb: "Farm strip near Ashford, Kent. Grass, elevation ~200 ft. Uncontrolled — use Headcorn observations as the closest proxy for wind and visibility.",
      station: "Headcorn (EGKH)",
      metar: egkh.metar,
      taf: egkh.taf,
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 }}>
      {fields.map((f) => (
        <div key={f.name} style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{f.name}</div>
          <div style={{ fontSize: 12, color: muted, marginBottom: 10, lineHeight: 1.5 }}>{f.blurb}</div>
          <div style={{ fontSize: 11, color: muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
            Nearest METAR · {f.station}
          </div>
          <pre style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 12, background: "rgba(0,0,0,0.25)", color: "#e2e8f0", padding: 8, borderRadius: 6, whiteSpace: "pre-wrap", margin: "0 0 8px" }}>{f.metar}</pre>
          <div style={{ fontSize: 11, color: muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
            TAF · {f.station}
          </div>
          <pre style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 12, background: "rgba(0,0,0,0.25)", color: "#e2e8f0", padding: 8, borderRadius: 6, whiteSpace: "pre-wrap", margin: 0 }}>{f.taf}</pre>
        </div>
      ))}
    </div>
  );
}

