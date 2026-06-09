import { useEffect, useMemo, useRef, useState } from "react";

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

      {/* METAR / TAF */}
      <Section title="✈ METAR / TAF" subtitle={`Live weather for Ringmer Glider Field (${METAR_ID}) · Runway 06/24 (not 7/25)`} muted={muted}>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: 12, display: "flex", justifyContent: "center" }}>
          <iframe
            title="METAR Ringmer"
            src={`https://metar-taf.com/embed-widget/${METAR_ID}?bg=transparent`}
            style={{ width: "100%", maxWidth: 460, height: 460, border: "none", borderRadius: 8 }}
            loading="lazy"
          />
        </div>
        <a href={`https://metar-taf.com/metar/${METAR_ID}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "#38bdf8" }}>
          Open full METAR / TAF ↗
        </a>
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
