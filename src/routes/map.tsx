import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, Tooltip, ZoomControl, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { AIRSPACE_GEOJSON, type AirspaceFeatureProperties } from "@/lib/airspace-ukrin";
import { AIRFIELD, AIRFIELD_LATLON } from "@/lib/airfield";

export const Route = createFileRoute("/map")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Live Map — ESGC Logs" },
      { name: "description", content: "Live aircraft positions around Ringmer — OGN + ADS-B." },
    ],
  }),
  component: MapPage,
});

// OGN bounding box — East Sussex + full soaring range
// Format: a=0 (separator), b=N max, c=S min, d=E max, e=W min
const OGN_URL = "https://live.glidernet.org/api/0/aircraft?a=0&b=51.4&c=50.4&d=1.8&e=-0.6";

type TileKey = "dark" | "light" | "satellite";
const TILES: Record<TileKey, { label: string; url: string; attribution: string }> = {
  dark: {
    label: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  },
  light: {
    label: "Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
};

type AircraftType = "glider" | "powered" | "helicopter" | "unknown";
type LiveAircraft = {
  id: string;
  lat: number;
  lon: number;
  altM: number;
  altFt: number;
  speedKph: number;
  course: number;
  climbMs: number;
  reg: string;
  type: AircraftType;
  category: string;
  source: "ogn" | "adsb";
  isOwnFleet: boolean;
  isStale: boolean;
  ts: number;
  squawk?: string;
};

function MapPage() {
  const [aircraft, setAircraft] = useState<LiveAircraft[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tileKey, setTileKey] = useState<TileKey>("dark");
  const [showAirspace, setShowAirspace] = useState(true);
  const [ownFleetOnly, setOwnFleetOnly] = useState(false);
  const [hideStale, setHideStale] = useState(true);
  const [fleetGliders, setFleetGliders] = useState<{ flarm_id: string | null; registration: string }[]>([]);

  // Load fleet for "own fleet" highlighting
  useEffect(() => {
    supabase.from("fleet_gliders").select("flarm_id,registration").then(({ data }) => {
      setFleetGliders(data ?? []);
    });
  }, []);

  const { flarmSet, regSet } = useMemo(() => {
    const flarmSet = new Set<string>();
    const regSet = new Set<string>();
    for (const g of fleetGliders) {
      if (g.flarm_id) flarmSet.add(g.flarm_id.toUpperCase());
      if (g.registration) regSet.add(g.registration.toUpperCase().replace(/[^A-Z0-9]/g, ""));
    }
    return { flarmSet, regSet };
  }, [fleetGliders]);

  const fetchLive = useCallback(async () => {
    const nowSec = Date.now() / 1000;

    const fetchOgn = async (): Promise<LiveAircraft[]> => {
      try {
        const res = await fetch(OGN_URL);
        if (!res.ok) return [];
        const json: { aircraft?: unknown[][] } = await res.json();
        return (json.aircraft ?? []).map((a) => {
          const flarm = String(a[0] ?? "").toUpperCase();
          const reg = String(a[8] ?? "");
          const normReg = reg.toUpperCase().replace(/[^A-Z0-9]/g, "");
          const ts = parseInt(String(a[9])) || 0;
          const altM = parseFloat(String(a[3])) || 0;
          return {
            id: flarm || `ogn-${a[1]}-${a[2]}`,
            lat: parseFloat(String(a[1])),
            lon: parseFloat(String(a[2])),
            altM,
            altFt: Math.round(altM * 3.281),
            speedKph: parseFloat(String(a[4])) || 0,
            course: parseFloat(String(a[5])) || 0,
            climbMs: parseFloat(String(a[6])) || 0,
            reg,
            type: "glider" as AircraftType,
            category: "",
            source: "ogn" as const,
            isOwnFleet: flarmSet.has(flarm) || regSet.has(normReg),
            isStale: nowSec - ts > 60,
            ts,
          };
        }).filter((a) => !isNaN(a.lat) && !isNaN(a.lon));
      } catch {
        return [];
      }
    };

    const fetchAdsb = async (): Promise<LiveAircraft[]> => {
      try {
        // Public ADS-B Exchange endpoint — no key required, rate limited.
        const res = await fetch("https://globe.adsbexchange.com/data/aircraft.json", {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return [];
        const json: { ac?: unknown[]; now?: number } = await res.json();
        const list = json.ac ?? [];
        const serverNow = json.now ?? Date.now() / 1000;
        const mapped: (LiveAircraft | null)[] = list.map((raw) => {
          const a = raw as Record<string, unknown>;
          const cat = String(a.category ?? a.t ?? "");
          const altFt = parseFloat(String(a.alt_baro ?? a.altitude ?? a.alt ?? 0)) || 0;
          const seen = parseFloat(String(a.seen_pos ?? a.seen ?? 0)) || 0;
          const lat = parseFloat(String(a.lat));
          const lon = parseFloat(String(a.lon));
          if (isNaN(lat) || isNaN(lon)) return null;
          // Clip to our region
          if (lat < 50.4 || lat > 51.4 || lon < -0.6 || lon > 1.8) return null;
          let type: AircraftType = "powered";
          if (/^A[67]|glider/i.test(cat)) type = "glider";
          else if (/^A[34]|heli/i.test(cat)) type = "helicopter";
          const ac: LiveAircraft = {
            id: String(a.hex ?? a.icao ?? `${lat}-${lon}`).toUpperCase(),
            lat,
            lon,
            altM: Math.round(altFt * 0.3048),
            altFt: Math.round(altFt),
            speedKph: Math.round((parseFloat(String(a.gs ?? a.spd ?? 0)) || 0) * 1.852),
            course: parseFloat(String(a.track ?? a.hdg ?? 0)) || 0,
            climbMs: (parseFloat(String(a.baro_rate ?? a.vsi ?? 0)) || 0) * 0.00508,
            reg: String(a.flight ?? a.r ?? a.registration ?? "").trim(),
            type,
            category: cat,
            squawk: a.squawk ? String(a.squawk) : undefined,
            source: "adsb",
            isOwnFleet: false,
            isStale: seen > 60,
            ts: serverNow - seen,
          };
          return ac;
        });
        return mapped.filter((a): a is LiveAircraft => a !== null);

      } catch {
        return [];
      }
    };

    const [ognR, adsbR] = await Promise.allSettled([fetchOgn(), fetchAdsb()]);
    const ogn = ognR.status === "fulfilled" ? ognR.value : [];
    const adsb = adsbR.status === "fulfilled" ? adsbR.value : [];

    // Dedupe: prefer OGN for gliders by reg
    const ognRegs = new Set(ogn.map((a) => a.reg.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean));
    const merged = [
      ...ogn,
      ...adsb.filter((a) => {
        const normReg = a.reg.toUpperCase().replace(/[^A-Z0-9]/g, "");
        return !normReg || !ognRegs.has(normReg);
      }),
    ];

    setAircraft(merged);
    setLastUpdate(new Date());
    setFetchError(merged.length === 0 && ogn.length === 0 && adsb.length === 0 ? "No data" : null);
  }, [flarmSet, regSet]);

  // Initial + poll every 10s when visible, 30s when hidden
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (cancelled) return;
      const visible = typeof document !== "undefined" && document.visibilityState === "visible";
      fetchLive().finally(() => {
        if (cancelled) return;
        timer = setTimeout(tick, visible ? 10_000 : 30_000);
      });
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [fetchLive]);

  const visible = (ownFleetOnly ? aircraft.filter((a) => a.isOwnFleet) : aircraft)
    .filter((a) => !hideStale || !a.isStale);

  const countLive = (pred: (a: LiveAircraft) => boolean) =>
    aircraft.filter((a) => !a.isStale && pred(a)).length;

  return (
    <div style={{ position: "relative", height: "calc(100vh - 11rem)", minHeight: "500px" }}>
      <MapContainer
        center={AIRFIELD_LATLON}
        zoom={11}
        style={{ height: "100%", width: "100%", borderRadius: "12px", overflow: "hidden" }}
        zoomControl={false}
      >
        <ZoomControl position="bottomleft" />
        <TileLayer
          key={tileKey}
          url={TILES[tileKey].url}
          attribution={TILES[tileKey].attribution}
          maxZoom={19}
        />

        {showAirspace && (
          <GeoJSON
            key="airspace"
            data={AIRSPACE_GEOJSON}
            style={(feature) => {
              const p = feature?.properties as Partial<AirspaceFeatureProperties> | undefined;
              const cls = p?.class;
              const isCtrl = cls === "CTR" || cls === "CTA" || cls === "TMA";
              return {
                color: p?.colour ?? "#888",
                weight: cls === "CTR" ? 2.5 : 2,
                opacity: 0.9,
                fillColor: p?.colour ?? "#888",
                fillOpacity: p?.fill ?? 0.07,
                dashArray: isCtrl ? undefined : "6 4",
                lineJoin: "round",
              };
            }}
            onEachFeature={(feature, layer) => {
              const p = feature.properties as AirspaceFeatureProperties;
              layer.bindTooltip(
                `<strong>${p.name}</strong> <span style="opacity:.7">${p.ident ?? ""}</span><br/>` +
                `<span style="color:${p.colour};font-weight:600">${p.class}</span> · ${p.lower} – ${p.upper}` +
                (p.frequency ? `<br/><span style="opacity:.8">📻 ${p.frequency}</span>` : "") +
                (p.notes ? `<br/><span style="opacity:.6;font-size:11px">${p.notes}</span>` : ""),
                { sticky: true, className: "leaflet-tooltip-airspace", direction: "top" },
              );
            }}
          />
        )}

        {showAirspace && <AirspaceLabels />}

        <Marker position={AIRFIELD_LATLON} icon={airfieldIcon}>
          <Tooltip permanent direction="right" offset={[14, 0]} className="leaflet-tooltip-airfield">
            <b>ESGC · {AIRFIELD.icao}</b><br />
            <span style={{ fontSize: "10px" }}>Ringmer Gliding · {AIRFIELD.surface}</span>
          </Tooltip>
          <Popup>
            <div style={{ fontFamily: "system-ui,sans-serif", fontSize: "13px" }}>
              <b style={{ fontSize: "15px" }}>{AIRFIELD.name}</b><br />
              <div style={{ color: "#6b7280", lineHeight: 1.7, marginTop: "4px", fontSize: "12px" }}>
                ICAO: {AIRFIELD.icao}<br />
                {AIRFIELD.address}<br />
                Elev: {AIRFIELD.elevationFt}ft AMSL<br />
                <span style={{ color: "#9ca3af" }}>{AIRFIELD.notes}</span>
              </div>
            </div>
          </Popup>
        </Marker>


        {visible.map((a) => (
          <Marker
            key={a.id}
            position={[a.lat, a.lon]}
            icon={aircraftIcon(a)}
            zIndexOffset={a.isOwnFleet ? 1000 : a.type === "glider" ? 500 : 0}
          >
            <Popup>
              <div style={{ fontFamily: "system-ui,sans-serif", fontSize: "13px", minWidth: "190px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                  {a.reg || a.id || "Unknown"}
                  {a.isOwnFleet && <span style={{ color: "#38bdf8", fontSize: "11px" }}>⚡ ESGC</span>}
                </div>
                <div style={{ color: "#6b7280", lineHeight: 1.7, fontSize: "12px" }}>
                  <div>Alt: <b>{a.altFt.toLocaleString()}ft</b> ({a.altM}m)</div>
                  <div>Speed: <b>{a.speedKph} km/h</b> · {Math.round(a.speedKph / 1.852)} kts</div>
                  <div>{a.climbMs >= 0 ? "↑" : "↓"} <b>{Math.abs(a.climbMs).toFixed(1)} m/s</b> · Course: {Math.round(a.course)}°</div>
                  {a.category && <div>Type: {a.category}</div>}
                  {a.squawk && <div>Squawk: {a.squawk}</div>}
                  <div style={{ marginTop: "4px", color: "#9ca3af" }}>
                    Source: {a.source === "ogn" ? "OGN/FLARM" : "ADS-B"}<br />
                    {a.isStale ? "⚠ Position may be stale" : `Updated ${Math.max(0, Math.round(Date.now() / 1000 - a.ts))}s ago`}
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Control panel */}
      <div className="absolute top-4 right-4 z-[1000]" style={{ background: "rgba(0,0,0,0.80)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "12px", padding: "14px 16px", minWidth: "230px", color: "#f1f5f9", fontFamily: "system-ui,sans-serif", fontSize: "13px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <div style={{ marginBottom: "10px", lineHeight: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#38bdf8", display: "inline-block" }} />
            ESGC fleet: <b>{countLive((a) => a.isOwnFleet)}</b>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "rgba(255,255,255,0.7)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#a3e635", display: "inline-block" }} />
            Gliders: <b>{countLive((a) => a.type === "glider")}</b>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "rgba(255,255,255,0.7)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f1f5f9", display: "inline-block" }} />
            Powered: <b>{countLive((a) => a.type === "powered")}</b>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "rgba(255,255,255,0.7)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fb923c", display: "inline-block" }} />
            Helicopters: <b>{countLive((a) => a.type === "helicopter")}</b>
          </div>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", marginBottom: "10px" }}>
          <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
            {(["dark", "light", "satellite"] as TileKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setTileKey(k)}
                style={{
                  flex: 1, padding: "4px 0", borderRadius: "6px", border: "none",
                  fontSize: "11px", fontWeight: 600, cursor: "pointer",
                  background: tileKey === k ? "#f1f5f9" : "rgba(255,255,255,0.1)",
                  color: tileKey === k ? "#111" : "#f1f5f9",
                }}
              >
                {TILES[k].label}
              </button>
            ))}
          </div>

          {([
            ["Airspace overlay", showAirspace, setShowAirspace],
            ["Own fleet only", ownFleetOnly, setOwnFleetOnly],
            ["Hide stale (>60s)", hideStale, setHideStale],
          ] as [string, boolean, (v: boolean) => void][]).map(([label, state, setter]) => (
            <label key={label} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "5px" }}>
              <input
                type="checkbox"
                checked={state}
                onChange={(e) => setter(e.target.checked)}
                style={{ accentColor: "#38bdf8", width: 15, height: 15 }}
              />
              {label}
            </label>
          ))}
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "8px", fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
          {fetchError
            ? <span style={{ color: "#f87171" }}>⚠ {fetchError}</span>
            : lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString("en-GB")}` : "Connecting…"}
          <div style={{ marginTop: "3px" }}>OGN + ADS-B Exchange</div>
        </div>
      </div>
    </div>
  );
}

const airfieldIcon = L.divIcon({
  className: "",
  html: `<div style="display:flex;flex-direction:column;align-items:center">
    <div style="width:8px;height:26px;background:#4ade80;border:1.5px solid #166534;
      border-radius:2px;transform:rotate(-20deg);
      box-shadow:0 0 0 4px rgba(74,222,128,0.2),0 0 0 8px rgba(74,222,128,0.06)">
    </div>
  </div>`,
  iconSize: [24, 32],
  iconAnchor: [12, 16],
});

function aircraftIcon(a: LiveAircraft): L.DivIcon {
  const isOwn = a.isOwnFleet;
  const stale = a.isStale;
  const opacity = stale ? 0.4 : 1;

  const colour = isOwn ? "#38bdf8"
    : a.type === "glider" ? "#a3e635"
    : a.type === "helicopter" ? "#fb923c"
    : stale ? "#4b5563"
    : "#f1f5f9";

  const stroke = isOwn ? "#0284c7"
    : a.type === "glider" ? "#4d7c0f"
    : a.type === "helicopter" ? "#9a3412"
    : "#374151";

  const gliderShape = `
    <rect x="15" y="4" width="2" height="24" rx="1" fill="${colour}" opacity="${opacity}"/>
    <ellipse cx="16" cy="14" rx="14" ry="2.2" fill="${colour}" opacity="${opacity}"/>
    <ellipse cx="16" cy="25" rx="5" ry="1.3" fill="${colour}" opacity="${opacity * 0.75}"/>
    ${isOwn ? `<circle cx="16" cy="16" r="14" fill="none" stroke="${colour}" stroke-width="1.5" opacity="0.35"/>` : ""}
  `;

  const poweredShape = `
    <path d="M15 3 L17 3 L18 14 L22 12 L22 14 L18 16 L18 26 L16 28 L14 26 L14 16 L10 14 L10 12 L14 14 Z"
      fill="${colour}" stroke="${stroke}" stroke-width="0.8" opacity="${opacity}"/>
  `;

  const heliShape = `
    <circle cx="16" cy="13" r="5" fill="${colour}" opacity="${opacity}"/>
    <rect x="4" y="12" width="24" height="2" rx="1" fill="${colour}" opacity="${opacity * 0.8}"/>
    <rect x="14" y="18" width="4" height="8" rx="1" fill="${colour}" opacity="${opacity}"/>
    <rect x="10" y="25" width="10" height="1.5" rx="0.5" fill="${colour}" opacity="${opacity * 0.7}"/>
  `;

  const shape = a.type === "glider" ? gliderShape
    : a.type === "helicopter" ? heliShape
    : poweredShape;

  return L.divIcon({
    className: "",
    html: `<div style="transform:rotate(${a.course}deg);width:32px;height:32px">
      <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        ${shape}
      </svg>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

/** Permanent airspace name labels rendered at appropriate zoom levels.
 *  Decluttered: only shown at zoom >= 10. */
function AirspaceLabels() {
  const map = useMap();
  const [zoom, setZoom] = useState<number>(map.getZoom());
  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => { map.off("zoomend", onZoom); };
  }, [map]);
  if (zoom < 10) return null;
  return (
    <>
      {AIRSPACE_GEOJSON.features.map((f) => {
        const p = f.properties as AirspaceFeatureProperties;
        const pos = p.labelAt;
        if (!pos) return null;
        return (
          <Marker
            key={p.name}
            position={pos}
            interactive={false}
            icon={L.divIcon({
              className: "",
              html: `<div class="airspace-label" style="--asp:${p.colour}">
                <div class="airspace-label-name">${p.name}</div>
                <div class="airspace-label-meta">${p.class} · ${p.lower}–${p.upper}</div>
              </div>`,
              iconSize: [120, 30],
              iconAnchor: [60, 15],
            })}
          />
        );
      })}
    </>
  );
}

