import { useMemo, useState } from "react";
import { useAviationWeather, NEARBY_AIRFIELDS, type MetarRecord, type TafRecord } from "@/lib/use-aviation-weather";

type Tab = "metar" | "taf" | "windy" | "rasp";

/**
 * Reusable weather UI — tabs for METAR / TAF / Windy / RASP plus a
 * checkbox list of nearby aerodromes (Ringmer / Deanland area).
 *
 * `variant="drawer"` styles for a dark map overlay; `variant="page"` styles
 * for a standalone full-width route.
 */
export function WeatherView({ variant = "page" }: { variant?: "drawer" | "page" }) {
  const dark = variant === "drawer";
  const [tab, setTab] = useState<Tab>("metar");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(NEARBY_AIRFIELDS.filter((a) => a.near).map((a) => a.icao)),
  );
  const icaos = useMemo(() => Array.from(selected), [selected]);
  const { metar, taf } = useAviationWeather(icaos);

  const toggle = (icao: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(icao)) next.delete(icao); else next.add(icao);
      return next;
    });

  const dayKey = new Date().toISOString().slice(0, 10);
  const raspImg = `https://rasp.stratus.org.uk/UK2/FCST/wstar_bsratio.curr.1300lst.d2.png?d=${dayKey}`;
  const raspAlt = `https://rasp.stratus.org.uk/UK2/FCST/press1000.curr.1300lst.d2.png?d=${dayKey}`;
  const raspLink = "https://rasp.stratus.org.uk/";

  const windySrc =
    "https://embed.windy.com/embed2.html?lat=50.87&lon=0.10&detailLat=50.87&detailLon=0.10&width=650&height=450&zoom=8&level=surface&overlay=wind&product=ecmwf&menu=&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=kt&metricTemp=%C2%B0C&radarRange=-1";

  const tabs: { key: Tab; label: string }[] = [
    { key: "metar", label: "METAR" },
    { key: "taf", label: "TAF" },
    { key: "windy", label: "Windy" },
    { key: "rasp", label: "RASP" },
  ];

  const cardBg = dark ? "rgba(255,255,255,0.04)" : "hsl(var(--card))";
  const cardBorder = dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid hsl(var(--border))";
  const text = dark ? "#f1f5f9" : "hsl(var(--foreground))";
  const muted = dark ? "rgba(255,255,255,0.6)" : "hsl(var(--muted-foreground))";

  return (
    <div style={{ color: text, fontFamily: "system-ui,sans-serif" }}>
      {/* Airfield selector */}
      <div style={{ marginBottom: 14, padding: 12, background: cardBg, border: cardBorder, borderRadius: 10 }}>
        <div style={{ fontSize: 12, color: muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          Aerodromes (closest to Ringmer / Deanland)
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
          {NEARBY_AIRFIELDS.map((a) => (
            <label key={a.icao} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={selected.has(a.icao)}
                onChange={() => toggle(a.icao)}
                style={{ accentColor: "#38bdf8", width: 16, height: 16 }}
              />
              <span><b>{a.icao}</b> <span style={{ color: muted }}>· {a.name}</span></span>
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, color: muted, marginTop: 8, fontStyle: "italic" }}>
          Deanland (EGML) doesn't publish METAR/TAF — Shoreham &amp; Headcorn are the nearest reporting stations.
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 600,
              background: tab === t.key ? "#38bdf8" : (dark ? "rgba(255,255,255,0.06)" : "hsl(var(--muted))"),
              color: tab === t.key ? "#0b0f19" : text,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "metar" && <ReportList records={metar} accent="#38bdf8" empty="Fetching latest METAR…" muted={muted} cardBg={cardBg} cardBorder={cardBorder} />}
      {tab === "taf" && <ReportList records={taf as MetarRecord[]} accent="#a3e635" empty="Fetching latest TAF…" muted={muted} cardBg={cardBg} cardBorder={cardBorder} stripTaf />}

      {tab === "windy" && (
        <div>
          <div style={{ fontSize: 12, color: muted, marginBottom: 8 }}>Live wind &amp; weather · scroll / zoom to explore</div>
          <iframe
            title="Windy"
            src={windySrc}
            style={{ width: "100%", height: 500, border: "none", borderRadius: 10 }}
            loading="lazy"
          />
          <a href="https://www.windy.com/?50.87,0.10,8" target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "#38bdf8" }}>
            Open full Windy ↗
          </a>
        </div>
      )}

      {tab === "rasp" && (
        <div>
          <div style={{ fontSize: 12, color: muted, marginBottom: 8 }}>Today's soaring forecast · 13:00 local</div>
          <RaspImg label="Thermal strength × B/S ratio" src={raspImg} cardBg={cardBg} cardBorder={cardBorder} />
          <RaspImg label="Surface pressure" src={raspAlt} cardBg={cardBg} cardBorder={cardBorder} />
          <a href={raspLink} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#38bdf8" }}>
            Open full RASP UK ↗
          </a>
        </div>
      )}
    </div>
  );
}

function ReportList({
  records, accent, empty, muted, cardBg, cardBorder, stripTaf,
}: {
  records: (MetarRecord | TafRecord)[];
  accent: string;
  empty: string;
  muted: string;
  cardBg: string;
  cardBorder: string;
  stripTaf?: boolean;
}) {
  if (records.length === 0) {
    return <div style={{ fontSize: 14, color: muted, fontStyle: "italic", padding: 12 }}>{empty}</div>;
  }
  return (
    <div>
      {records.map((r) => {
        const raw = stripTaf
          ? r.raw.replace(/^TAF\s+(AMD\s+|COR\s+)?/, "").replace(`${r.id} `, "")
          : r.raw.replace(`${r.id} `, "");
        return (
          <div key={r.id} style={{ background: cardBg, border: cardBorder, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: accent, fontWeight: 700, marginBottom: 4 }}>{r.id}</div>
            <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{raw}</div>
          </div>
        );
      })}
    </div>
  );
}

function RaspImg({ label, src, cardBg, cardBorder }: { label: string; src: string; cardBg: string; cardBorder: string }) {
  return (
    <div style={{ marginBottom: 14, background: cardBg, border: cardBorder, borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <img
        src={src}
        alt={label}
        style={{ width: "100%", borderRadius: 6, display: "block" }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
      />
    </div>
  );
}
