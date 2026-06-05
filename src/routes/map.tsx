import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MapContainer, Marker, Popup, TileLayer, Tooltip, ZoomControl, GeoJSON, Circle, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { AIRSPACE_GEOJSON, type AirspaceFeatureProperties } from "@/lib/airspace-ukrin";
import { AIRFIELD, AIRFIELD_LATLON } from "@/lib/airfield";
import { getAirspaceForBbox } from "@/lib/openaip.functions";
import { getLiveTraffic } from "@/lib/live-traffic.functions";
import { nearestAirfield, distanceNm } from "@/lib/nearby-airfields";

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

// OGN bounding box — East Sussex + full soaring range (proxied server-side
// in src/lib/live-traffic.functions.ts to avoid CORS).

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

type TrailPoint = { lat: number; lon: number; altFt: number; ts: number; course: number; speedKph: number };

function MapPage() {
  const [aircraft, setAircraft] = useState<LiveAircraft[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tileKey, setTileKey] = useState<TileKey>("dark");
  const [showAirspace, setShowAirspace] = useState(true);
  const [ownFleetOnly, setOwnFleetOnly] = useState(false);
  const [hideStale, setHideStale] = useState(true);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [proximityNm, setProximityNm] = useState(1);
  const [isOffice, setIsOffice] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [audioChime, setAudioChime] = useState(false);
  const [replayOffsetSec, setReplayOffsetSec] = useState(0); // 0 = LIVE; negative = seconds back
  const [trailsTick, setTrailsTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [photoCache, setPhotoCache] = useState<Map<string, { url: string; photographer?: string; link?: string } | null>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [metar, setMetar] = useState<{ id: string; raw: string; obs: string }[]>([]);
  const [fleetGliders, setFleetGliders] = useState<{ flarm_id: string | null; registration: string }[]>([]);
  const insideZoneRef = useRef<Map<string, number>>(new Map());
  const inboundRef = useRef<Map<string, number>>(new Map());
  // Per-aircraft trail history (full session, capped to last 2 hours)
  const trailsRef = useRef<Map<string, TrailPoint[]>>(new Map());
  const failCountRef = useRef(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setIsOffice((data.user?.email || "").toLowerCase() === "office@esgc.local");
    });
  }, []);

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

    // Single proxied call — both feeds blocked by CORS in the browser.
    const proxied = await getLiveTraffic().catch(() => null);

    const parseOgn = (): LiveAircraft[] => {
      // GlideAndSeek shape: { success, message: [{ lat, lng, altitude(m),
      //   speed(kph), track, vario(m/s), registration, flarmID, displayName,
      //   timestamp(ms), type, model }] }
      const json = proxied?.ogn as { message?: Record<string, unknown>[] } | null;
      const list = json?.message;
      if (!Array.isArray(list)) return [];
      return list.map((a) => {
        const flarm = String(a.flarmID ?? "").toUpperCase();
        const reg = String(a.registration ?? a.displayName ?? "");
        const normReg = reg.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const tsMs = parseFloat(String(a.timestamp ?? 0)) || 0;
        const ts = Math.round(tsMs / 1000);
        const altM = parseFloat(String(a.altitude ?? 0)) || 0;
        const lat = parseFloat(String(a.lat));
        const lon = parseFloat(String(a.lng));
        // OGN/GlideAndSeek type codes: 1 glider · 2 towplane · 3 helicopter
        // 4 parachute · 5 dropplane · 6 hangglider · 7 paraglider · 8 powered
        // 9 jet · 11 balloon · 12 airship · 13 UAV · 14 static (ground stn)
        const kind = Number(a.type);
        let mapped: AircraftType = "glider";
        if (kind === 3) mapped = "helicopter";
        else if (kind === 2 || kind === 5 || kind === 8 || kind === 9 || kind === 13) mapped = "powered";
        else if (kind === 1 || kind === 6 || kind === 7) mapped = "glider";
        else if (kind === 11 || kind === 12) mapped = "unknown";
        return {
          id: normReg || flarm || `ogn-${lat.toFixed(3)}-${lon.toFixed(3)}`,
          lat,
          lon,
          altM,
          altFt: Math.round(altM * 3.281),
          speedKph: parseFloat(String(a.speed ?? 0)) || 0,
          course: parseFloat(String(a.track ?? 0)) || 0,
          climbMs: parseFloat(String(a.vario ?? 0)) || 0,
          reg,
          type: mapped,
          category: String(a.model ?? ""),
          source: "ogn" as const,
          isOwnFleet: flarmSet.has(flarm) || regSet.has(normReg),
          isStale: nowSec - ts > 70,
          ts,
          _kind: kind,
        } as LiveAircraft & { _kind: number };
      }).filter((a) => !isNaN(a.lat) && !isNaN(a.lon) && a._kind !== 14);
    };
    const fetchOgn = async () => parseOgn();

    const fetchAdsb = async (): Promise<LiveAircraft[]> => {
      const json = proxied?.adsb as { ac?: unknown[]; aircraft?: unknown[]; now?: number } | null;
      if (!json) return [];
      const list = json.aircraft ?? json.ac ?? [];
      const serverNow = json.now ?? nowSec;
      const mapped: (LiveAircraft | null)[] = list.map((raw) => {
        const a = raw as Record<string, unknown>;
        const cat = String(a.category ?? a.t ?? "");
        const altFt = parseFloat(String(a.alt_baro ?? a.altitude ?? a.alt ?? 0)) || 0;
        const reg = String(a.flight ?? a.r ?? a.registration ?? "").trim();
        const normReg = reg.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const hex = String(a.hex ?? a.icao ?? "").toUpperCase().replace(/[^A-F0-9]/g, "");
        const seen = parseFloat(String(a.seen_pos ?? a.seen ?? 0)) || 0;
        const lat = parseFloat(String(a.lat));
        const lon = parseFloat(String(a.lon));
        if (isNaN(lat) || isNaN(lon)) return null;
        if (lat < 50.4 || lat > 51.4 || lon < -0.6 || lon > 1.8) return null;
        // ADS-B category codes: A1-A5 powered, A7 rotorcraft, B1 glider
        const catU = cat.toUpperCase();
        let type: AircraftType = "powered";
        if (/^B1/.test(catU) || /GLIDER/.test(catU)) type = "glider";
        else if (/^A7/.test(catU) || /HELI|ROTOR/.test(catU)) type = "helicopter";
        return {
          id: hex || normReg || `adsb-${lat.toFixed(3)}-${lon.toFixed(3)}`,
          lat,
          lon,
          altM: Math.round(altFt * 0.3048),
          altFt: Math.round(altFt),
          speedKph: Math.round((parseFloat(String(a.gs ?? a.spd ?? 0)) || 0) * 1.852),
          course: parseFloat(String(a.track ?? a.hdg ?? 0)) || 0,
          climbMs: (parseFloat(String(a.baro_rate ?? a.vsi ?? 0)) || 0) * 0.00508,
          reg,
          type,
          category: cat,
          squawk: a.squawk ? String(a.squawk) : undefined,
          source: "adsb",
          isOwnFleet: false,
          isStale: seen > 70,
          ts: serverNow - seen,
        };
      });
      return mapped.filter((a): a is LiveAircraft => a !== null);
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

    // Don't flap on transient empty responses — keep last data and only
    // surface "No data" after several consecutive empty fetches.
    const failed = !proxied || (merged.length === 0);
    if (failed) {
      failCountRef.current += 1;
      if (failCountRef.current >= 8) setFetchError("No data");
      return;
    }
    failCountRef.current = 0;
    setLastUpdate(new Date());
    setFetchError(null);
    setAircraft((prev) => {
      if (prev.length > 10 && merged.length < prev.length * 0.3) return prev;
      const prevMap = new Map(prev.map((a) => [a.id, a]));
      const next = merged.map((incoming) => {
        const existing = prevMap.get(incoming.id);
        if (!existing) return incoming;
        const latSame = Math.abs(incoming.lat - existing.lat) < 0.00008;
        const lonSame = Math.abs(incoming.lon - existing.lon) < 0.00008;
        const altSame = Math.abs(incoming.altFt - existing.altFt) < 10;
        const crseSame = Math.abs(incoming.course - existing.course) < 2;
        const staleSame = incoming.isStale === existing.isStale;
        const typeSame = incoming.type === existing.type;
        if (latSame && lonSame && altSame && crseSame && staleSame && typeSame) return existing;
        return incoming;
      });
      const cutoffTs = Date.now() / 1000 - 180;
      return next.filter((a) => a.ts > cutoffTs);
    });

    // Append trail points (full session — capped to last 2 hours)
    const cutoff = nowSec - 7200;
    for (const a of merged) {
      if (a.isStale) continue;
      const arr = trailsRef.current.get(a.id) ?? [];
      const last = arr[arr.length - 1];
      // Only append if position has actually moved or 5s elapsed
      if (!last || last.ts !== a.ts) {
        arr.push({ lat: a.lat, lon: a.lon, altFt: a.altFt, ts: a.ts, course: a.course, speedKph: a.speedKph });
      }
      // Trim by age
      while (arr.length && arr[0].ts < cutoff) arr.shift();
      trailsRef.current.set(a.id, arr);
    }
    // GC ids not seen for >30 min
    for (const id of Array.from(trailsRef.current.keys())) {
      const arr = trailsRef.current.get(id)!;
      if (!arr.length || nowSec - arr[arr.length - 1].ts > 1800) trailsRef.current.delete(id);
    }
    setTrailsTick((t) => t + 1);
  }, [flarmSet, regSet]);

  // Live updates: 500ms when visible, 15s in background
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (cancelled) return;
      const visible = typeof document !== "undefined" && document.visibilityState === "visible";
      fetchLive().finally(() => {
        if (cancelled) return;
        timer = setTimeout(tick, visible ? 1500 : 20_000);
      });
    };
    tick();
    const onVis = () => { if (document.visibilityState === "visible" && timer) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [fetchLive]);

  // Ask for browser notification permission once
  useEffect(() => {
    if (notifyEnabled && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [notifyEnabled]);

  // Proximity detection — fire notification when aircraft enters zone around Ringmer
  useEffect(() => {
    if (!notifyEnabled) return;
    const [alat, alon] = AIRFIELD_LATLON;
    const nowSec = Date.now() / 1000;
    const seen = new Set<string>();
    for (const a of aircraft) {
      if (a.isStale) continue;
      // Haversine distance in nm
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(a.lat - alat);
      const dLon = toRad(a.lon - alon);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(alat)) * Math.cos(toRad(a.lat)) * Math.sin(dLon / 2) ** 2;
      const distNm = (2 * 6371 * Math.asin(Math.sqrt(h))) / 1.852;
      if (distNm <= proximityNm && a.altFt <= 2200) {
        seen.add(a.id);
        const prev = insideZoneRef.current.get(a.id);
        // Debounce re-entry — only re-alert after 5 min outside
        if (!prev || nowSec - prev > 300) {
          const label = a.reg || a.id;
          const msg = `${label} · ${a.altFt.toLocaleString()}ft · ${distNm.toFixed(1)}nm`;
          toast(`✈ Aircraft near Ringmer`, { description: msg });
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try { new Notification("Aircraft near Ringmer", { body: msg, tag: a.id }); } catch { /* noop */ }
          }
          if (audioChime) playChime(audioCtxRef);
        }
        insideZoneRef.current.set(a.id, nowSec);
      }
    }
    // Expire entries no longer present
    for (const id of Array.from(insideZoneRef.current.keys())) {
      if (!seen.has(id) && nowSec - (insideZoneRef.current.get(id) ?? 0) > 600) {
        insideZoneRef.current.delete(id);
      }
    }
  }, [aircraft, notifyEnabled, proximityNm, audioChime]);

  // Inbound detection — aircraft tracking towards Ringmer at <15nm
  useEffect(() => {
    if (!notifyEnabled) return;
    const [alat, alon] = AIRFIELD_LATLON;
    const nowSec = Date.now() / 1000;
    for (const a of aircraft) {
      if (a.isStale || a.speedKph < 40 || a.altFt > 2200) continue;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(a.lat - alat);
      const dLon = toRad(a.lon - alon);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(alat)) * Math.cos(toRad(a.lat)) * Math.sin(dLon / 2) ** 2;
      const distNm = (2 * 6371 * Math.asin(Math.sqrt(h))) / 1.852;
      if (distNm > 15 || distNm < 2) continue;
      // Bearing FROM aircraft TO airfield
      const y = Math.sin(toRad(alon - a.lon)) * Math.cos(toRad(alat));
      const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(alat)) -
        Math.sin(toRad(a.lat)) * Math.cos(toRad(alat)) * Math.cos(toRad(alon - a.lon));
      const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      const diff = Math.abs(((a.course - bearing + 540) % 360) - 180);
      if (diff < 30) {
        const prev = inboundRef.current.get(a.id);
        if (!prev || nowSec - prev > 600) {
          toast(`🎯 Inbound to Ringmer`, { description: `${a.reg || a.id} · ${distNm.toFixed(1)}nm · ${a.altFt.toLocaleString()}ft` });
          inboundRef.current.set(a.id, nowSec);
        }
      }
    }
  }, [aircraft, notifyEnabled]);

  // Photo fetch — planespotters.net public API (CORS-enabled) for ADS-B hex IDs
  useEffect(() => {
    let cancelled = false;
    const toFetch = aircraft
      .filter((a) => a.source === "adsb" && !a.isStale && /^[A-F0-9]{6}$/.test(a.id) && !photoCache.has(a.id))
      .slice(0, 8);
    if (toFetch.length === 0) return;
    (async () => {
      const updates: Array<[string, { url: string; photographer?: string; link?: string } | null]> = [];
      for (const a of toFetch) {
        try {
          const r = await fetch(`https://api.planespotters.net/pub/photos/hex/${a.id}`);
          if (!r.ok) { updates.push([a.id, null]); continue; }
          const j = await r.json() as { photos?: Array<{ thumbnail_large?: { src: string }; photographer?: string; link?: string }> };
          const p = j.photos?.[0];
          if (p?.thumbnail_large?.src) {
            updates.push([a.id, { url: p.thumbnail_large.src, photographer: p.photographer, link: p.link }]);
          } else {
            updates.push([a.id, null]);
          }
        } catch { updates.push([a.id, null]); }
      }
      if (cancelled || updates.length === 0) return;
      setPhotoCache((prev) => {
        const next = new Map(prev);
        for (const [k, v] of updates) next.set(k, v);
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [aircraft, photoCache]);

  // METAR — refresh every 10 min (NOAA aviationweather.gov, CORS-enabled)
  useEffect(() => {
    let cancelled = false;
    const fetchMetar = async () => {
      try {
        const r = await fetch("https://aviationweather.gov/api/data/metar?ids=EGKB,EGKA,EGMD&format=json&hours=2");
        if (!r.ok) return;
        const json = await r.json() as Array<{ icaoId: string; rawOb: string; reportTime: string }>;
        if (cancelled || !Array.isArray(json)) return;
        // Latest per ICAO
        const latest = new Map<string, { id: string; raw: string; obs: string }>();
        for (const m of json) {
          if (!latest.has(m.icaoId)) latest.set(m.icaoId, { id: m.icaoId, raw: m.rawOb, obs: m.reportTime });
        }
        setMetar(Array.from(latest.values()));
      } catch { /* noop */ }
    };
    fetchMetar();
    const id = setInterval(fetchMetar, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Smooth interpolation tick — between data fetches we extrapolate positions
  // from each aircraft's last known speed/course so markers glide instead of
  // jumping (FR24-style). Runs at ~10fps when visible.
  const [interpTick, setInterpTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last >= 100) { last = t; setInterpTick((n) => n + 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Replay: when offset != 0, derive display positions from trail history.
  // Live: extrapolate from last fix using speed + course.
  const isReplay = replayOffsetSec < 0;
  const replayTargetTs = Date.now() / 1000 + replayOffsetSec;
  const displayAircraft = useMemo<LiveAircraft[]>(() => {
    void trailsTick; void interpTick;
    if (isReplay) {
      const out: LiveAircraft[] = [];
      for (const a of aircraft) {
        const arr = trailsRef.current.get(a.id);
        if (!arr || !arr.length) continue;
        let pick: TrailPoint | null = null;
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i].ts <= replayTargetTs) { pick = arr[i]; break; }
        }
        if (!pick) continue;
        out.push({ ...a, lat: pick.lat, lon: pick.lon, altFt: pick.altFt, course: pick.course, speedKph: pick.speedKph, ts: pick.ts, isStale: false });
      }
      return out;
    }
    // Live: extrapolate forward from the last known fix.
    const nowSec = Date.now() / 1000;
    return aircraft.map((a) => {
      if (a.isStale || a.speedKph < 5) return a;
      const elapsed = Math.min(Math.max(0, nowSec - a.ts), 8); // cap 8s
      if (elapsed < 0.05) return a;
      const distM = (a.speedKph * 1000 / 3600) * elapsed;
      const rad = (a.course * Math.PI) / 180;
      const dLat = (distM * Math.cos(rad)) / 111320;
      const dLon = (distM * Math.sin(rad)) / (111320 * Math.cos((a.lat * Math.PI) / 180));
      return { ...a, lat: a.lat + dLat, lon: a.lon + dLon };
    });
  }, [aircraft, isReplay, replayTargetTs, trailsTick, interpTick]);

  const visible = (ownFleetOnly ? displayAircraft.filter((a) => a.isOwnFleet) : displayAircraft)
    .filter((a) => !hideStale || !a.isStale);

  // Keep marker DOM stable: heading changes are applied directly to the
  // existing SVG wrapper instead of rebuilding Leaflet divIcons.
  useEffect(() => {
    const courses = new Map(visible.map((a) => [a.id, normalizeCourse(a.course)]));
    document.querySelectorAll<HTMLElement>("[data-aircraft-rotor]").forEach((el) => {
      const id = el.dataset.aircraftId;
      const course = id ? courses.get(id) : undefined;
      if (course === undefined) return;
      el.style.transform = `rotate(${course}deg)`;
    });
  }, [visible]);

  // Build trail polylines for visible aircraft
  const trailPolylines = useMemo(() => {
    if (!showTrails) return [];
    void trailsTick;
    const cutoff = isReplay ? replayTargetTs : Infinity;
    return visible.map((a) => {
      const arr = trailsRef.current.get(a.id);
      if (!arr || arr.length < 2) return null;
      const pts = arr.filter((p) => p.ts <= cutoff).map((p) => [p.lat, p.lon] as [number, number]);
      if (pts.length < 2) return null;
      const colour = a.isOwnFleet ? "#38bdf8"
        : a.type === "glider" ? "#a3e635"
        : a.type === "helicopter" ? "#fb923c"
        : "#f8fafc";
      const isSelected = selectedId === a.id;
      return { id: a.id, pts, colour, isOwn: a.isOwnFleet, isSelected };
    }).filter((x): x is { id: string; pts: [number, number][]; colour: string; isOwn: boolean; isSelected: boolean } => x !== null);
  }, [visible, showTrails, trailsTick, isReplay, replayTargetTs, selectedId]);

  // Icon cache — only rebuild when the actual silhouette/label state changes.
  // Altitude and heading are deliberately excluded to prevent Leaflet from
  // replacing marker DOM during live updates.
  const iconCacheRef = useRef<Map<string, { sig: string; icon: L.DivIcon }>>(new Map());
  const getIcon = useCallback((a: LiveAircraft): L.DivIcon => {
    const sig = `${a.type}|${a.reg || a.id}|${a.isOwnFleet ? 1 : 0}|${a.isStale ? 1 : 0}`;
    const hit = iconCacheRef.current.get(a.id);
    if (hit && hit.sig === sig) return hit.icon;
    const icon = aircraftIcon(a);
    iconCacheRef.current.set(a.id, { sig, icon });
    return icon;
  }, []);

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

        {showAirspace && <LiveAirspace />}

        {showAirspace && <AirspaceLabels />}

        {notifyEnabled && (
          <Circle
            center={AIRFIELD_LATLON}
            radius={proximityNm * 1852}
            pathOptions={{ color: "#38bdf8", weight: 1.5, opacity: 0.6, fillColor: "#38bdf8", fillOpacity: 0.04, dashArray: "4 6" }}
          />
        )}

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

        {/* Trails — from where each aircraft was first seen.
            Selected aircraft trail is rendered thicker + brighter (FR24-style). */}
        {trailPolylines.flatMap((t) => [
          <Polyline
            key={`trail-${t.id}`}
            positions={t.pts}
            pathOptions={{
              color: t.colour,
              weight: t.isSelected ? 4 : t.isOwn ? 3 : 2,
              opacity: t.isSelected ? 0.95 : 0.55,
              lineCap: "round",
              lineJoin: "round",
            }}
          />,
          <Marker
            key={`start-${t.id}`}
            position={t.pts[0]}
            interactive={false}
            icon={L.divIcon({
              className: "",
              html: `<div style="width:${t.isSelected ? 12 : 10}px;height:${t.isSelected ? 12 : 10}px;border-radius:50%;background:${t.colour};border:2px solid #0b0f19;box-shadow:0 0 ${t.isSelected ? 10 : 6}px ${t.colour}${t.isSelected ? "" : "aa"}"></div>`,
              iconSize: [t.isSelected ? 12 : 10, t.isSelected ? 12 : 10],
              iconAnchor: [t.isSelected ? 6 : 5, t.isSelected ? 6 : 5],
            })}
          />,
        ])}


        {visible.map((a) => {
          const trail = trailsRef.current.get(a.id);
          const start = trail && trail.length ? trail[0] : null;
          // Only call it a "departure" if first trail point is low (likely
          // on-airfield/just-after-takeoff) AND within 2.5nm of a known field.
          // Otherwise we just saw the aircraft mid-flight — show "first seen".
          const dep = start && start.altFt <= 1500 ? nearestAirfield(start.lat, start.lon, 2.5) : null;
          const firstSeenAirfield = !dep && start ? nearestAirfield(start.lat, start.lon, 8) : null;
          const photo = photoCache.get(a.id) ?? null;
          return (
          <Marker
            key={a.id}
            position={[a.lat, a.lon]}
            icon={getIcon(a)}
            zIndexOffset={a.isOwnFleet ? 1000 : a.type === "glider" ? 500 : 0}
            eventHandlers={{
              click: () => setSelectedId(a.id),
              popupclose: () => setSelectedId((cur) => (cur === a.id ? null : cur)),
            }}
          >
            <Popup>
              <div style={{ fontFamily: "system-ui,sans-serif", fontSize: "13px", minWidth: "220px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                  {a.reg || a.id || "Unknown"}
                  {a.isOwnFleet && <span style={{ color: "#38bdf8", fontSize: "11px" }}>⚡ ESGC</span>}
                  {selectedId === a.id && <span style={{ color: "#4ade80", fontSize: "10px", marginLeft: "auto" }}>● TRACKING</span>}
                </div>
                {photo && (
                  <a href={photo.link} target="_blank" rel="noreferrer noopener" style={{ display: "block", marginBottom: "6px" }}>
                    <img src={photo.url} alt={a.reg || a.id} style={{ width: "100%", height: "auto", borderRadius: "6px", display: "block" }} />
                    {photo.photographer && (
                      <div style={{ fontSize: "9px", color: "#9ca3af", textAlign: "right", marginTop: "2px" }}>© {photo.photographer} · planespotters.net</div>
                    )}
                  </a>
                )}
                <div style={{ color: "#6b7280", lineHeight: 1.7, fontSize: "12px" }}>
                  <div>Alt: <b>{a.altFt.toLocaleString()}ft</b> ({a.altM}m)</div>
                  <div>Speed: <b>{a.speedKph} km/h</b> · {Math.round(a.speedKph / 1.852)} kts</div>
                  <div>{a.climbMs >= 0 ? "↑" : "↓"} <b>{Math.abs(a.climbMs).toFixed(1)} m/s</b> · Course: {Math.round(a.course)}°</div>
                  {a.category && <div>Type: {a.category}</div>}
                  {a.squawk && <div>Squawk: {a.squawk}</div>}
                  {dep ? (
                    <div style={{ marginTop: "2px" }}>
                      Departed: <b style={{ color: "#38bdf8" }}>{dep.icao ? `${dep.icao} ` : ""}{dep.name}</b>
                    </div>
                  ) : firstSeenAirfield ? (
                    <div style={{ marginTop: "2px", color: "#9ca3af" }}>
                      First seen near: {firstSeenAirfield.icao ? `${firstSeenAirfield.icao} ` : ""}{firstSeenAirfield.name} @ {start!.altFt.toLocaleString()}ft
                    </div>
                  ) : start ? (
                    <div style={{ marginTop: "2px", color: "#9ca3af" }}>
                      First seen: {start.lat.toFixed(2)}°,{start.lon.toFixed(2)}° @ {start.altFt.toLocaleString()}ft
                    </div>
                  ) : null}
                  <div style={{ marginTop: "4px", color: "#9ca3af" }}>
                    Source: {a.source === "ogn" ? "OGN/FLARM" : "ADS-B"}<br />
                    {a.isStale ? "⚠ Position may be stale" : `Updated ${Math.max(0, Math.round(Date.now() / 1000 - a.ts))}s ago`}
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
          );
        })}
        <FollowSelected selectedId={selectedId} aircraft={visible} />

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
            ["Show trails", showTrails, setShowTrails],
            ["Own fleet only", ownFleetOnly, setOwnFleetOnly],
            ["Hide stale (>60s)", hideStale, setHideStale],
            [`Alert on entry (${proximityNm}nm)`, notifyEnabled, setNotifyEnabled],
            ["Audio chime on proximity", audioChime, (v: boolean) => { setAudioChime(v); if (v) playChime(audioCtxRef); }],
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
          {notifyEnabled && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>Radius</span>
              {isOffice ? (
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={proximityNm}
                  onChange={(e) => setProximityNm(parseInt(e.target.value, 10))}
                  style={{ flex: 1, accentColor: "#38bdf8" }}
                />
              ) : (
                <span style={{ flex: 1, fontSize: "10px", color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
                  office only
                </span>
              )}
              <span style={{ fontSize: "11px", width: "32px", textAlign: "right" }}>{proximityNm}nm</span>
            </div>
          )}
        </div>

        {/* Replay scrubber */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", marginBottom: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
              {isReplay ? `⏪ Replay −${Math.abs(Math.round(replayOffsetSec / 60))}m ${Math.abs(replayOffsetSec) % 60}s` : "▶ LIVE"}
            </span>
            {isReplay && (
              <button
                onClick={() => setReplayOffsetSec(0)}
                style={{ background: "#38bdf8", color: "#0b0f19", border: "none", borderRadius: "4px", padding: "2px 7px", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}
              >
                LIVE
              </button>
            )}
          </div>
          <input
            type="range"
            min={-7200}
            max={0}
            step={5}
            value={replayOffsetSec}
            onChange={(e) => setReplayOffsetSec(parseInt(e.target.value, 10))}
            style={{ width: "100%", accentColor: "#38bdf8" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "rgba(255,255,255,0.35)" }}>
            <span>−2h</span><span>now</span>
          </div>
        </div>

        {metar.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)", fontWeight: 600, marginBottom: "4px" }}>METAR</div>
            {metar.map((m) => (
              <div key={m.id} style={{ fontSize: "10px", color: "rgba(255,255,255,0.65)", fontFamily: "ui-monospace,monospace", marginBottom: "3px", lineHeight: 1.35 }}>
                <span style={{ color: "#38bdf8", fontWeight: 700 }}>{m.id}</span> {m.raw.replace(`${m.id} `, "")}
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "8px", fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
          {fetchError
            ? <span style={{ color: "#f87171" }}>⚠ {fetchError}</span>
            : <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#4ade80", marginRight: 6, boxShadow: "0 0 6px #4ade80", animation: "pulse 1.5s ease-in-out infinite" }} />LIVE · {lastUpdate ? lastUpdate.toLocaleTimeString("en-GB") : "connecting…"}</span>}
          <div style={{ marginTop: "3px" }}>OGN + ADS-B · 0.5s refresh</div>
        </div>
      </div>
    </div>
  );
}



/** Pans the map to keep the selected aircraft centred as its position updates. */
function FollowSelected({ selectedId, aircraft }: { selectedId: string | null; aircraft: LiveAircraft[] }) {
  const map = useMap();
  const target = selectedId ? aircraft.find((a) => a.id === selectedId) : null;
  const lat = target?.lat;
  const lon = target?.lon;
  useEffect(() => {
    if (lat == null || lon == null) return;
    map.panTo([lat, lon], { animate: true, duration: 0.4 });
  }, [lat, lon, map]);
  return null;
}

/** Short two-tone chime via WebAudio. Lazily creates a shared AudioContext. */
function playChime(ctxRef: React.MutableRefObject<AudioContext | null>) {
  try {
    if (typeof window === "undefined") return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctxRef.current) ctxRef.current = new AC();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const beep = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.25, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    };
    beep(880, 0, 0.18);
    beep(1320, 0.18, 0.22);
  } catch { /* noop */ }
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

function normalizeCourse(course: number): number {
  return ((Math.round(course) % 360) + 360) % 360;
}

function aircraftIcon(a: LiveAircraft): L.DivIcon {
  const isOwn = a.isOwnFleet;
  const stale = a.isStale;
  const opacity = stale ? 0.45 : 1;

  const colour = isOwn ? "#38bdf8"
    : a.type === "glider" ? "#a3e635"
    : a.type === "helicopter" ? "#fb923c"
    : stale ? "#6b7280"
    : "#f8fafc";

  const stroke = "#0b0f19";

  // Top-down silhouettes (north-up; rotated by heading), FR24-style.
  // Glider: extremely long slender wings (15m+ span), pencil fuselage, T-tail.
  const gliderShape = `
    <ellipse cx="24" cy="24" rx="1.6" ry="17" fill="${colour}" stroke="${stroke}" stroke-width="0.7" opacity="${opacity}"/>
    <path d="M24 22.5 L46.5 24 L46.5 25.4 L24 25.4 L1.5 25.4 L1.5 24 Z"
      fill="${colour}" stroke="${stroke}" stroke-width="0.7" stroke-linejoin="round" opacity="${opacity}"/>
    <path d="M19 39.5 L24 38.4 L29 39.5 L29 40.7 L24 39.9 L19 40.7 Z"
      fill="${colour}" stroke="${stroke}" stroke-width="0.6" opacity="${opacity}"/>
    <rect x="23.2" y="38.4" width="1.6" height="2" fill="${stroke}" opacity="${opacity * 0.7}"/>
  `;
  // Powered: classic airliner top-down — swept wings, tail, engines.
  const poweredShape = `
    <path d="M24 3 C26 3 27 5 27.4 9 L28 20 L44 26 L44 29 L28 26.5 L28 34 L33 38 L33 40 L24 38 L15 40 L15 38 L20 34 L20 26.5 L4 29 L4 26 L20 20 L20.6 9 C21 5 22 3 24 3 Z"
      fill="${colour}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round" opacity="${opacity}"/>
    <ellipse cx="14" cy="24" rx="1.6" ry="2.4" fill="${stroke}" opacity="${opacity * 0.85}"/>
    <ellipse cx="34" cy="24" rx="1.6" ry="2.4" fill="${stroke}" opacity="${opacity * 0.85}"/>
  `;
  // Helicopter: fuselage + spinning rotor disc.
  const heliShape = `
    <ellipse cx="24" cy="24" rx="6" ry="11" fill="${colour}" stroke="${stroke}" stroke-width="1.2" opacity="${opacity}"/>
    <circle cx="24" cy="24" r="20" fill="none" stroke="${colour}" stroke-width="1.2" opacity="${opacity * 0.35}"/>
    <line x1="6" y1="14" x2="42" y2="34" stroke="${colour}" stroke-width="1.6" opacity="${opacity * 0.55}"/>
    <line x1="6" y1="34" x2="42" y2="14" stroke="${colour}" stroke-width="1.6" opacity="${opacity * 0.55}"/>
    <rect x="22.5" y="36" width="3" height="6" rx="1" fill="${colour}" stroke="${stroke}" stroke-width="1" opacity="${opacity}"/>
    <rect x="18" y="41" width="12" height="2" rx="1" fill="${colour}" stroke="${stroke}" stroke-width="1" opacity="${opacity * 0.9}"/>
  `;

  const shape = a.type === "glider" ? gliderShape
    : a.type === "helicopter" ? heliShape
    : poweredShape;

  const label = (a.reg || a.id || "").toString().toUpperCase().slice(0, 8);
  const ringHtml = isOwn
    ? `<div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid #38bdf8;box-shadow:0 0 14px #38bdf8aa;animation:ping 2s ease-out infinite"></div>`
    : "";

  return L.divIcon({
    className: "aircraft-icon",
    html: `
      <div style="position:relative;width:48px;height:48px;display:flex;align-items:center;justify-content:center">
        ${ringHtml}
        <div data-aircraft-rotor data-aircraft-id="${a.id}" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform:rotate(${normalizeCourse(a.course)}deg);transform-origin:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.65));will-change:transform">
          <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${shape}</svg>
        </div>
        <div style="position:absolute;top:46px;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(10,14,22,.85);border:1px solid ${colour};border-radius:6px;padding:1px 5px;font:600 10px/1.2 system-ui,sans-serif;color:${colour};box-shadow:0 2px 6px rgba(0,0,0,.5);pointer-events:none;text-align:center">
          ${label || "—"}
        </div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
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

/** Fetch live airspace from OpenAIP for the current viewport (debounced).
 *  Falls back to hand-drawn AIRSPACE_GEOJSON if OpenAIP returns no features / errors. */
function LiveAirspace() {
  const map = useMap();
  const [features, setFeatures] = useState<GeoJSON.Feature[] | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const b = map.getBounds();
        const res = await getAirspaceForBbox({
          data: {
            south: b.getSouth(),
            west: b.getWest(),
            north: b.getNorth(),
            east: b.getEast(),
          },
        }).catch(() => null);
        if (cancelled) return;
        if (!res || res.error || res.features.length === 0) {
          setFeatures(null);
          setUsedFallback(true);
        } else {
          setFeatures(res.features as unknown as GeoJSON.Feature[]);
          setUsedFallback(false);
        }
      }, 400);
    };

    refresh();
    map.on("moveend", refresh);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      map.off("moveend", refresh);
    };
  }, [map]);

  const data: GeoJSON.FeatureCollection = usedFallback || !features
    ? (AIRSPACE_GEOJSON as unknown as GeoJSON.FeatureCollection)
    : { type: "FeatureCollection", features };

  return (
    <GeoJSON
      key={usedFallback ? "fallback" : `live-${features?.length ?? 0}`}
      data={data}
      style={(feature) => {
        const p = feature?.properties as Partial<AirspaceFeatureProperties> | undefined;
        const cls = p?.class;
        const isCtrl = cls === "CTR" || cls === "CTA" || cls === "TMA" || cls === ("D" as typeof cls) || cls === ("C" as typeof cls);
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
  );
}


