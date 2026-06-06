import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MapContainer, Marker, Popup, TileLayer, Tooltip, ZoomControl, GeoJSON, Circle, Polyline, Polygon, useMap } from "react-leaflet";
import { useServerFn } from "@tanstack/react-start";
import jsPDF from "jspdf";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { AIRSPACE_GEOJSON, type AirspaceFeatureProperties } from "@/lib/airspace-ukrin";
import { AIRFIELD, AIRFIELD_LATLON } from "@/lib/airfield";
import { getAirspaceForBbox } from "@/lib/openaip.functions";
import { getLiveTraffic } from "@/lib/live-traffic.functions";
import { nearestAirfield, distanceNm } from "@/lib/nearby-airfields";
import { listActiveNotams, refreshNotamsNow, type NotamRecord } from "@/lib/notams.functions";
import { firePush } from "@/lib/push.functions";
import { PushToggle } from "@/components/PushToggle";

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
  const [showNotams, setShowNotams] = useState(true);
  const [notams, setNotams] = useState<NotamRecord[]>([]);
  const lastPushRef = useRef<Map<string, number>>(new Map());
  const firePushFn = useServerFn(firePush);
  const fetchNotamsFn = useServerFn(listActiveNotams);
  const [proximityNm, setProximityNm] = useState(1);
  const [isOffice, setIsOffice] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [audioChime, setAudioChime] = useState(true);
  const [chimeVolume, setChimeVolume] = useState(0.9);
  const [replayOffsetSec, setReplayOffsetSec] = useState(0); // 0 = LIVE; negative = seconds back
  const [trailsTick, setTrailsTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [photoCache, setPhotoCache] = useState<Map<string, { url: string; photographer?: string; link?: string } | null>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [metar, setMetar] = useState<{ id: string; raw: string; obs: string }[]>([]);
  const [fleetGliders, setFleetGliders] = useState<{ flarm_id: string | null; registration: string }[]>([]);
  const insideZoneRef = useRef<Map<string, number>>(new Map());
  const [panelOpen, setPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  // Per-aircraft trail history (full session, kept permanently like FR24)
  const trailsRef = useRef<Map<string, TrailPoint[]>>(new Map());
  // Last-known meta per id so we can keep drawing trails after the aircraft
  // drops off the live feed (FR24-style persistence).
  const trailMetaRef = useRef<Map<string, { type: AircraftType; isOwnFleet: boolean; reg: string }>>(new Map());
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

  // Load NOTAMs (active set) — refresh every 30 min
  useEffect(() => {
    let cancelled = false;
    const load = () => fetchNotamsFn().then((r) => { if (!cancelled) setNotams(r.notams); }).catch(() => {});
    load();
    const t = setInterval(load, 30 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [fetchNotamsFn]);

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

    // Append trail points — kept permanently for the session (FR24-style).
    for (const a of merged) {
      if (a.isStale) continue;
      const arr = trailsRef.current.get(a.id) ?? [];
      const last = arr[arr.length - 1];
      if (!last || last.ts !== a.ts) {
        arr.push({ lat: a.lat, lon: a.lon, altFt: a.altFt, ts: a.ts, course: a.course, speedKph: a.speedKph });
      }
      trailsRef.current.set(a.id, arr);
      trailMetaRef.current.set(a.id, { type: a.type, isOwnFleet: a.isOwnFleet, reg: a.reg });
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
      if (a.isOwnFleet) continue; // never alert on our own fleet
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
          if (audioChime) playChime(audioCtxRef, chimeVolume);
          // Broadcast to push subscribers (debounced per aircraft, max once / 10 min)
          const lastPush = lastPushRef.current.get(a.id) ?? 0;
          if (nowSec - lastPush > 600) {
            lastPushRef.current.set(a.id, nowSec);
            firePushFn({ data: { category: "proximity", title: "Aircraft near Ringmer", body: msg, tag: a.id, url: "/map" } }).catch(() => {});
          }
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
  }, [aircraft, notifyEnabled, proximityNm, audioChime, chimeVolume, firePushFn]);

  // Inbound alerts removed per user request.

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

  // Build trail polylines — segment-coloured by altitude so the whole flight
  // gradient is visible at a glance (low=green, mid=amber, high=yellow).
  const trailPolylines = useMemo(() => {
    if (!showTrails) return [] as {
      id: string;
      pts: [[number, number], [number, number]];
      colour: string;
      weight: number;
      opacity: number;
      isStart: boolean;
      startPt: [number, number] | null;
      startColour: string;
    }[];
    void trailsTick;
    const cutoff = isReplay ? replayTargetTs : Infinity;
    const visibleIds = new Set(visible.map((a) => a.id));
    const segs: {
      id: string;
      pts: [[number, number], [number, number]];
      colour: string;
      weight: number;
      opacity: number;
      isStart: boolean;
      startPt: [number, number] | null;
      startColour: string;
    }[] = [];
    for (const [id, arr] of trailsRef.current.entries()) {
      if (!arr || arr.length < 2) continue;
      const meta = trailMetaRef.current.get(id);
      if (!meta) continue;
      if (ownFleetOnly && !meta.isOwnFleet && !visibleIds.has(id)) continue;
      const filtered = arr.filter((p) => p.ts <= cutoff);
      if (filtered.length < 2) continue;

      const first = filtered[0];
      const dep = first.altFt <= 1500 ? nearestAirfield(first.lat, first.lon, 2.5) : null;
      const allPts: { lat: number; lon: number; altFt: number }[] = dep
        ? [{ lat: dep.lat, lon: dep.lon, altFt: 0 }, ...filtered]
        : filtered;

      const isSelected = selectedId === id;
      const weight = isSelected ? 4 : meta.isOwnFleet ? 3 : 2;
      const opacity = isSelected ? 0.95 : meta.isOwnFleet ? 0.78 : 0.62;
      const useAlt = meta.type === "glider" || meta.isOwnFleet;
      const flat = meta.type === "helicopter" ? "#fb923c" : "#f8fafc";
      const startColour = useAlt ? altColour(allPts[0].altFt) : flat;

      for (let i = 0; i < allPts.length - 1; i++) {
        const avg = (allPts[i].altFt + allPts[i + 1].altFt) / 2;
        segs.push({
          id: `${id}-${i}`,
          pts: [[allPts[i].lat, allPts[i].lon], [allPts[i + 1].lat, allPts[i + 1].lon]],
          colour: useAlt ? altColour(avg) : flat,
          weight,
          opacity,
          isStart: i === 0,
          startPt: i === 0 ? [allPts[0].lat, allPts[0].lon] : null,
          startColour,
        });
      }
    }
    return segs;
  }, [visible, showTrails, trailsTick, isReplay, replayTargetTs, selectedId, ownFleetOnly]);

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

        <NightTerminator />

        {showNotams && notams.map((n) => {
          const colour = n.kind === "danger" ? "#ef4444" : n.kind === "tra" ? "#f97316" : n.kind === "restricted" ? "#a855f7" : "#facc15";
          const radius = (n.radius_nm ?? 2) * 1852;
          return (
            <Circle
              key={n.id}
              center={[n.centre_lat, n.centre_lon]}
              radius={radius}
              pathOptions={{ color: colour, weight: 1.5, fillColor: colour, fillOpacity: 0.12, dashArray: "4 4" }}
            >
              <Tooltip direction="top" sticky>
                <div style={{ maxWidth: 280, fontSize: 11 }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>
                    {n.kind.toUpperCase()} · {n.notam_ref}
                  </div>
                  <div style={{ marginBottom: 2 }}>
                    {n.lower_ft != null ? `${n.lower_ft}ft` : "SFC"} – {n.upper_ft != null ? `${n.upper_ft}ft` : "UNL"}
                  </div>
                  <div style={{ opacity: 0.8 }}>{n.description}</div>
                </div>
              </Tooltip>
            </Circle>
          );
        })}



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
        {/* Altitude-coloured trail segments + start-point dots */}
        {trailPolylines.map((seg) => (
          <Polyline
            key={`seg-${seg.id}`}
            positions={seg.pts}
            pathOptions={{
              color: seg.colour,
              weight: seg.weight,
              opacity: seg.opacity,
              lineCap: "round",
              lineJoin: "round",
              className: "trail-glow",
            }}
          />
        ))}
        {trailPolylines.filter((s) => s.isStart && s.startPt).map((seg) => (
          <Marker
            key={`start-${seg.id}`}
            position={seg.startPt as [number, number]}
            interactive={false}
            icon={L.divIcon({
              className: "",
              html: `<div style="width:${seg.weight >= 4 ? 12 : 10}px;height:${seg.weight >= 4 ? 12 : 10}px;border-radius:50%;background:${seg.startColour};border:2px solid #0b0f19;box-shadow:0 0 ${seg.weight >= 4 ? 10 : 6}px ${seg.startColour}aa"></div>`,
              iconSize: [seg.weight >= 4 ? 12 : 10, seg.weight >= 4 ? 12 : 10],
              iconAnchor: [seg.weight >= 4 ? 6 : 5, seg.weight >= 4 ? 6 : 5],
            })}
          />
        ))}


        {visible.map((a) => (
          <Marker
            key={a.id}
            position={[a.lat, a.lon]}
            icon={getIcon(a)}
            zIndexOffset={a.isOwnFleet ? 1000 : a.type === "glider" ? 500 : 0}
            eventHandlers={{
              click: () => setSelectedId(a.id),
            }}
          />
        ))}


        <FollowSelected selectedId={selectedId} aircraft={visible} />

      </MapContainer>

      {/* Aircraft detail side panel (FR24-style) */}
      <AircraftPanel
        sel={selectedId ? visible.find((a) => a.id === selectedId) ?? null : null}
        trail={selectedId ? trailsRef.current.get(selectedId) ?? null : null}
        photo={selectedId ? photoCache.get(selectedId) ?? null : null}
        onClose={() => setSelectedId(null)}
      />

      {/* ESGC fleet dock — bottom-centre, fleet at a glance */}
      <FleetDock
        aircraft={displayAircraft}
        fleetRegs={fleetGliders}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id)}
      />

      




      {/* Control panel — collapsible toggle for mobile */}
      <button
        onClick={() => setPanelOpen((v) => !v)}
        aria-label={panelOpen ? "Hide controls" : "Show controls"}
        className="absolute top-3 right-3 z-[1001] sm:hidden"
        style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", padding: "8px 12px", color: "#f1f5f9", fontFamily: "system-ui,sans-serif", fontSize: "13px", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}
      >
        {panelOpen ? "✕" : "☰"} {!panelOpen && `${countLive(() => true)} live`}
      </button>

      <div
        className={`absolute z-[1000] ${panelOpen ? "block" : "hidden"} sm:block top-3 right-3 sm:top-4 sm:right-4`}
        style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "12px", padding: "14px 16px", color: "#f1f5f9", fontFamily: "system-ui,sans-serif", fontSize: "13px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", width: "min(260px, calc(100vw - 24px))", maxHeight: "calc(100vh - 14rem)", overflowY: "auto", marginTop: panelOpen ? "44px" : 0 }}
      >
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
            ["Airspace overlay", showAirspace, setShowAirspace, true],
            [`NOTAMs / TRA (${notams.length})`, showNotams, setShowNotams, true],
            ["Show trails", showTrails, setShowTrails, true],
            ["Own fleet only", ownFleetOnly, setOwnFleetOnly, true],
            ["Hide stale (>60s)", hideStale, setHideStale, true],
            [`Alert on entry (${proximityNm}nm)`, notifyEnabled, setNotifyEnabled, true],
            ["Audio chime on proximity", audioChime, (v: boolean) => { setAudioChime(v); if (v) playChime(audioCtxRef, chimeVolume); }, true],
          ] as [string, boolean, (v: boolean) => void, boolean][]).map(([label, state, setter, enabled]) => {
            const lockedForCaravan = !isOffice && label.startsWith("Audio");
            return (
              <label key={label} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: enabled && !lockedForCaravan ? "pointer" : "not-allowed", marginBottom: "5px", opacity: enabled ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  checked={state}
                  disabled={!enabled || lockedForCaravan}
                  onChange={(e) => setter(e.target.checked)}
                  style={{ accentColor: "#38bdf8", width: 15, height: 15 }}
                />
                <span>
                  {label}
                  {lockedForCaravan && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: "rgba(255,255,255,0.45)", fontStyle: "italic" }}>· office adjustable</span>
                  )}
                </span>
              </label>
            );
          })}
          {isOffice && (
            <div style={{ marginTop: "6px", marginBottom: "4px" }}>
              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span style={{ fontSize: "10px", transition: "transform 0.2s", transform: settingsOpen ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span> Settings
              </button>
              {settingsOpen && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", paddingLeft: "2px" }}>
                  <button
                    type="button"
                    onClick={() => playChime(audioCtxRef, chimeVolume)}
                    style={{ background: "rgba(56,189,248,0.15)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.4)", borderRadius: "4px", padding: "3px 8px", fontSize: "10px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                    title="Preview chime"
                  >
                    ▶ Preview
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={chimeVolume}
                    onChange={(e) => setChimeVolume(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: "#38bdf8" }}
                    aria-label="Chime volume"
                  />
                  <span style={{ fontSize: "11px", width: "32px", textAlign: "right" }}>{Math.round(chimeVolume * 100)}%</span>
                </div>
              )}
            </div>
          )}
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
          {showTrails && (
            <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px dashed rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Trail altitude</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "rgba(255,255,255,0.7)" }}>
                <span>0ft</span>
                <div style={{ flex: 1, height: "8px", borderRadius: "4px", background: "linear-gradient(to right, rgb(74,222,128), rgb(250,204,21), rgb(239,68,68))" }} />
                <span>6000ft</span>
              </div>
            </div>
          )}
          <PushToggle />
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
          <div style={{ marginTop: "3px" }}>OGN + ADS-B · 1.5s refresh</div>
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

type AircraftPhoto = { url: string; photographer?: string; link?: string } | null;

function formatDMS(lat: number, lon: number): string {
  const toDMS = (v: number, pos: string, neg: string) => {
    const d = Math.abs(v);
    const deg = Math.floor(d);
    const minF = (d - deg) * 60;
    const min = Math.floor(minF);
    const sec = ((minF - min) * 60).toFixed(1);
    return `${deg}°${String(min).padStart(2, "0")}'${sec.padStart(4, "0")}"${v >= 0 ? pos : neg}`;
  };
  return `${toDMS(lat, "N", "S")} ${toDMS(lon, "E", "W")}`;
}

function AircraftPanel({
  sel,
  trail,
  photo,
  onClose,
}: {
  sel: LiveAircraft | null;
  trail: TrailPoint[] | null;
  photo: AircraftPhoto;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!sel) return null;

  const start = trail && trail.length ? trail[0] : null;
  const dep = start && start.altFt <= 1500 ? nearestAirfield(start.lat, start.lon, 2.5) : null;
  const firstSeen = !dep && start ? nearestAirfield(start.lat, start.lon, 8) : null;
  const nowUtc = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  const knots = Math.round(sel.speedKph / 1.852);
  const fpm = Math.round(sel.climbMs * 196.85);

  const reportText =
    `AIRPROX / SAFETY REPORT — DRAFT\n` +
    `Time (UTC): ${nowUtc}\n` +
    `Registration: ${sel.reg || "Unknown"}\n` +
    `Mode-S / ID: ${sel.id}\n` +
    `Type: ${sel.category || sel.type}\n` +
    `Source: ${sel.source === "ogn" ? "OGN/FLARM" : "ADS-B"}\n` +
    `Position: ${sel.lat.toFixed(5)}, ${sel.lon.toFixed(5)}\n` +
    `         (${formatDMS(sel.lat, sel.lon)})\n` +
    `Altitude: ${sel.altFt.toLocaleString()} ft (${sel.altM} m)\n` +
    `Track: ${Math.round(sel.course)}°  Speed: ${knots} kt\n` +
    `Vertical: ${fpm >= 0 ? "+" : ""}${fpm} fpm\n` +
    (sel.squawk ? `Squawk: ${sel.squawk}\n` : "") +
    (dep ? `Departed: ${dep.icao ?? ""} ${dep.name}\n` : firstSeen ? `First seen near: ${firstSeen.icao ?? ""} ${firstSeen.name} @ ${start!.altFt}ft\n` : "") +
    `Observer: ESGC Logs (Ringmer)\n` +
    `Refs: https://www.airproxboard.org.uk/Report-an-Airprox/  ·  https://members.gliding.co.uk/safety/report-an-incident/`;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("Copy failed");
    }
  };

  const Stat = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) => (
    <div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{value}{sub && <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 400, marginLeft: 4, fontSize: 11 }}>{sub}</span>}</div>
    </div>
  );

  // Bearing + distance from observer (Ringmer / ESGC ~ 50.886, 0.090)
  const OBS_LAT = 50.886, OBS_LON = 0.090;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(sel.lat - OBS_LAT);
  const dLon = toRad(sel.lon - OBS_LON);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(OBS_LAT)) * Math.cos(toRad(sel.lat)) * Math.sin(dLon / 2) ** 2;
  const distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distNm = distKm * 0.539957;
  const y = Math.sin(dLon) * Math.cos(toRad(sel.lat));
  const x = Math.cos(toRad(OBS_LAT)) * Math.sin(toRad(sel.lat)) - Math.sin(toRad(OBS_LAT)) * Math.cos(toRad(sel.lat)) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const cardinal = ["N","NE","E","SE","S","SW","W","NW"][Math.round(bearing / 45) % 8];
  const accent = altColour(sel.altFt);

  return (
    <div
      className="absolute z-[1002] left-0 right-0 bottom-0 sm:right-auto sm:bottom-auto sm:top-4 sm:left-4"
      style={{
        background: "linear-gradient(180deg, rgba(14,18,28,0.96) 0%, rgba(10,12,18,0.96) 100%)",
        backdropFilter: "blur(18px) saturate(140%)",
        WebkitBackdropFilter: "blur(18px) saturate(140%)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 16,
        color: "#f1f5f9",
        fontFamily: "system-ui,-apple-system,sans-serif",
        fontSize: 13,
        boxShadow: `0 24px 60px -12px rgba(0,0,0,0.75), 0 0 0 1px ${accent}22, 0 -2px 20px -8px ${accent}55 inset`,
        width: "min(340px, 100vw)",
        maxHeight: "76vh",
        overflowY: "auto",
        margin: "0 auto",
        animation: "panelSlideIn 0.28s cubic-bezier(0.22,1,0.36,1)",
        overflow: "hidden",
      }}
    >
      {/* Altitude-coloured accent strip */}
      <div style={{
        height: 3,
        background: `linear-gradient(90deg, ${accent}, ${accent}88, ${accent})`,
        backgroundSize: "200% 100%",
        animation: "accentSheen 6s linear infinite",
      }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "sticky", top: 0, background: "rgba(10,12,18,0.94)", backdropFilter: "blur(16px)", zIndex: 2 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: 0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sel.reg || sel.id || "Unknown"}
            {sel.isOwnFleet && <span style={{ color: "#38bdf8", fontSize: 10, marginLeft: 6, fontWeight: 700, background: "rgba(56,189,248,0.12)", padding: "2px 6px", borderRadius: 4, letterSpacing: 0.5 }}>ESGC</span>}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: sel.isStale ? "#f59e0b" : "#4ade80", animation: sel.isStale ? "none" : "livePulse 1.6s ease-out infinite" }} />
            <span>{sel.isStale ? "STALE" : "LIVE"}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{sel.source === "ogn" ? "OGN/FLARM" : "ADS-B"}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{Math.max(0, Math.round(Date.now() / 1000 - sel.ts))}s</span>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,0.06)", border: "none", color: "#f1f5f9", borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontSize: 14 }}>✕</button>
      </div>


      <div style={{ padding: "12px 14px" }}>
        {photo ? (
          <a href={photo.link} target="_blank" rel="noreferrer noopener" style={{ display: "block", marginBottom: 12 }}>
            <img src={photo.url} alt={sel.reg || sel.id} style={{ width: "100%", height: "auto", borderRadius: 10, display: "block", border: "1px solid rgba(255,255,255,0.06)" }} />
            {photo.photographer && (
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textAlign: "right", marginTop: 3 }}>© {photo.photographer} · planespotters.net</div>
            )}
          </a>
        ) : (
          <div
            className="skeleton-shimmer"
            style={{ marginBottom: 12, height: 110, borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "rgba(255,255,255,0.35)" }}
          >
            {sel.source === "adsb" ? "Looking up photo…" : "No photo available"}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px", marginBottom: 12 }}>
          <Stat label="Altitude" value={<span style={{ color: accent }}>{sel.altFt.toLocaleString()} ft</span>} sub={`${sel.altM}m`} />
          <Stat label="Speed" value={`${knots} kt`} sub={`${sel.speedKph}km/h`} />
          <Stat label="Vertical" value={<span style={{ color: fpm > 50 ? "#4ade80" : fpm < -50 ? "#f87171" : "#cbd5e1" }}>{fpm >= 0 ? "↑" : "↓"} {Math.abs(fpm)} fpm</span>} />
          <Stat label="Course" value={`${Math.round(sel.course)}°`} />
          <Stat label="From ESGC" value={`${distNm.toFixed(1)} nm`} sub={cardinal} />
          {sel.squawk ? <Stat label="Squawk" value={sel.squawk} /> : sel.category ? <Stat label="Type" value={sel.category} /> : null}
        </div>

        {/* Sparkline altitude (last ~10 min) + compass rose */}
        <div style={{ display: "flex", gap: 12, alignItems: "stretch", marginBottom: 12, padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Altitude · last 10 min</div>
            <AltSparkline trail={trail} accent={accent} />
          </div>
          <div style={{ width: 64, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Track</div>
            <CompassRose course={sel.course} />
          </div>
        </div>



        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.4 }}>Position · UTC {nowUtc}</div>
            <button onClick={() => copy(`${sel.lat.toFixed(5)}, ${sel.lon.toFixed(5)}`, "pos")} style={{ background: "rgba(56,189,248,0.12)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.3)", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
              {copied === "pos" ? "✓" : "Copy"}
            </button>
          </div>
          <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: "rgba(255,255,255,0.85)" }}>{sel.lat.toFixed(5)}, {sel.lon.toFixed(5)}</div>
          <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{formatDMS(sel.lat, sel.lon)}</div>
        </div>

        {dep ? (
          <div style={{ marginBottom: 10, fontSize: 12 }}>Departed: <b style={{ color: "#38bdf8" }}>{dep.icao ? `${dep.icao} ` : ""}{dep.name}</b></div>
        ) : firstSeen ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "rgba(255,255,255,0.7)" }}>First seen near: {firstSeen.icao ? `${firstSeen.icao} ` : ""}{firstSeen.name} @ {start!.altFt.toLocaleString()}ft</div>
        ) : null}

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Report incident</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button onClick={() => copy(reportText, "rep")} style={{ flex: 1, background: copied === "rep" ? "rgba(74,222,128,0.18)" : "rgba(255,255,255,0.08)", color: copied === "rep" ? "#4ade80" : "#f1f5f9", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              {copied === "rep" ? "✓ Copied" : "📋 Copy text"}
            </button>
            <button onClick={() => downloadAirproxPDF(sel, reportText, photo)} style={{ flex: 1, background: "rgba(168,85,247,0.14)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.35)", borderRadius: 8, padding: "8px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              📄 PDF report
            </button>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <a href="https://www.airproxboard.org.uk/Report-an-Airprox/" target="_blank" rel="noreferrer noopener" style={{ flex: 1, textAlign: "center", background: "rgba(251,146,60,0.12)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 8, padding: "8px 10px", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
              Airprox Board ↗
            </a>
            <a href="https://members.gliding.co.uk/safety/report-an-incident/" target="_blank" rel="noreferrer noopener" style={{ flex: 1, textAlign: "center", background: "rgba(56,189,248,0.12)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.3)", borderRadius: 8, padding: "8px 10px", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
              BGA Safety ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ─────────────────────────  Sparkline (altitude history) ───────────────────────── */
function AltSparkline({ trail, accent }: { trail: TrailPoint[] | null; accent: string }) {
  const pts = useMemo(() => {
    if (!trail || trail.length < 2) return null;
    const cutoff = Date.now() / 1000 - 10 * 60;
    const slice = trail.filter((p) => p.ts >= cutoff);
    if (slice.length < 2) return null;
    const t0 = slice[0].ts;
    const tN = slice[slice.length - 1].ts;
    const tSpan = Math.max(1, tN - t0);
    const alts = slice.map((p) => p.altFt);
    const lo = Math.min(...alts);
    const hi = Math.max(...alts);
    const span = Math.max(50, hi - lo);
    const W = 180, H = 44, pad = 3;
    const poly = slice
      .map((p) => {
        const x = pad + ((p.ts - t0) / tSpan) * (W - 2 * pad);
        const y = H - pad - ((p.altFt - lo) / span) * (H - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const area = `${pad},${H - pad} ${poly} ${W - pad},${H - pad}`;
    return { poly, area, lo, hi, W, H };
  }, [trail]);
  if (!pts) return <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", padding: "8px 0" }}>Collecting data…</div>;
  return (
    <div>
      <svg viewBox={`0 0 ${pts.W} ${pts.H}`} style={{ width: "100%", height: 44, display: "block" }}>
        <polygon points={pts.area} fill={accent} opacity={0.18} />
        <polyline points={pts.poly} fill="none" stroke={accent} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
        <span>{pts.lo.toLocaleString()}ft</span>
        <span>{pts.hi.toLocaleString()}ft</span>
      </div>
    </div>
  );
}

/* ─────────────────────────  Compass rose ───────────────────────── */
function CompassRose({ course }: { course: number }) {
  return (
    <svg viewBox="0 0 60 60" style={{ width: 56, height: 56 }}>
      <circle cx="30" cy="30" r="26" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      {["N", "E", "S", "W"].map((dir, i) => {
        const angle = (i * 90 - 90) * (Math.PI / 180);
        const x = 30 + Math.cos(angle) * 22;
        const y = 30 + Math.sin(angle) * 22 + 3;
        return <text key={dir} x={x} y={y} textAnchor="middle" fontSize="8" fill={dir === "N" ? "#f87171" : "rgba(255,255,255,0.55)"} fontWeight={700}>{dir}</text>;
      })}
      <g transform={`rotate(${course} 30 30)`}>
        <polygon points="30,8 34,32 30,28 26,32" fill="#38bdf8" />
        <polygon points="30,52 34,30 30,32 26,30" fill="rgba(255,255,255,0.35)" />
      </g>
      <circle cx="30" cy="30" r="2" fill="#f1f5f9" />
    </svg>
  );
}

/* ─────────────────────────  Airprox PDF download ───────────────────────── */
async function downloadAirproxPDF(sel: LiveAircraft, reportText: string, photo: AircraftPhoto) {
  try {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 48;
    let y = margin;

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 595, 80, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("AIRPROX / SAFETY REPORT", margin, 40);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Draft — review before submission · ESGC Logs (Ringmer)", margin, 58);

    y = 110;
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`${sel.reg || sel.id || "Unknown aircraft"}`, margin, y);
    y += 22;

    if (photo?.url) {
      try {
        const blob = await (await fetch(photo.url)).blob();
        const dataUrl: string = await new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.readAsDataURL(blob);
        });
        doc.addImage(dataUrl, "JPEG", margin, y, 200, 130);
        y += 145;
      } catch { /* skip image on failure */ }
    }

    doc.setFont("courier", "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(reportText, 595 - 2 * margin);
    doc.text(lines, margin, y);

    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Generated ${new Date().toISOString()} · esgclogs.uk`, margin, 820);

    const fname = `airprox-${sel.reg || sel.id || "report"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.pdf`;
    doc.save(fname);
    toast.success("PDF downloaded");
  } catch (e) {
    console.error(e);
    toast.error("PDF generation failed");
  }
}

/* ─────────────────────────  Day/Night Terminator overlay ───────────────────────── */
function NightTerminator() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5 * 60_000);
    return () => clearInterval(id);
  }, []);
  const { polygon, isNight } = useMemo(() => {
    const date = new Date();
    const dayOfYear = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
    const declRad = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10)) * Math.PI / 180;
    const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const sunLon = -((utcH - 12) * 15);
    const pts: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      const h = (lon - sunLon) * Math.PI / 180;
      const lat = Math.atan(-Math.cos(h) / Math.tan(declRad)) * 180 / Math.PI;
      pts.push([lat, lon]);
    }
    // Night is on the side opposite the sun's declination hemisphere
    const nightNorth = declRad < 0;
    const poly: [number, number][] = nightNorth
      ? [[85, -180], ...pts.map(([la, lo]) => [la, lo] as [number, number]), [85, 180]]
      : [[-85, -180], ...pts.map(([la, lo]) => [la, lo] as [number, number]), [-85, 180]];
    return { polygon: poly, isNight: nightNorth };
  }, []);
  void isNight;
  return (
    <Polygon
      positions={polygon}
      pathOptions={{
        color: "transparent",
        fillColor: "#0b1020",
        fillOpacity: 0.28,
        interactive: false,
      }}
    />
  );
}




/**
 * Silky proximity chime — descending C major triad (G5 → E5 → C5) with
 * a sine+triangle blend, slow vibrato, low-pass warmth and a single
 * delay-echo for a reverb-style tail. Pleasant enough for all-day use.
 */
function playChime(ctxRef: React.MutableRefObject<AudioContext | null>, volume = 0.9) {
  try {
    if (typeof window === "undefined") return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctxRef.current) ctxRef.current = new AC();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const vol = Math.max(0, Math.min(1, volume));

    const master = ctx.createGain();
    master.gain.value = vol;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2000;
    lp.Q.value = 0.5;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;

    master.connect(lp);
    lp.connect(comp);
    comp.connect(ctx.destination);

    // Single delay-line echo fed into the low-pass for a reverb-ish tail.
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.22;
    const echoGain = ctx.createGain();
    echoGain.gain.value = 0.12;
    delay.connect(echoGain);
    echoGain.connect(lp);

    const tone = (freq: number, start: number, dur: number, peak: number) => {
      const osc1 = ctx.createOscillator();
      osc1.type = "sine";
      osc1.frequency.value = freq;

      const osc2 = ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.value = freq * 2;

      // Slow vibrato — ±3 Hz at ~5 Hz
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 5.2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 3;
      lfo.connect(lfoGain);
      lfoGain.connect(osc1.frequency);
      lfoGain.connect(osc2.frequency);

      const g = ctx.createGain();
      const h = ctx.createGain();
      h.gain.value = 0.07;

      g.gain.setValueAtTime(0.0001, now + start);
      g.gain.exponentialRampToValueAtTime(peak, now + start + 0.12);
      g.gain.setValueAtTime(peak, now + start + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);

      osc1.connect(g);
      osc2.connect(h);
      h.connect(g);
      g.connect(master);
      g.connect(delay);

      const startT = now + start;
      const stopT = now + start + dur + 0.15;
      lfo.start(startT); lfo.stop(stopT);
      osc1.start(startT); osc1.stop(stopT);
      osc2.start(startT); osc2.stop(stopT);
    };

    // Descending C major triad — G5, E5, C5, slightly overlapped for legato.
    tone(783.99, 0.00, 1.20, 0.16);
    tone(659.25, 0.28, 1.30, 0.15);
    tone(523.25, 0.56, 1.60, 0.13);
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

/** Altitude → colour ramp (green→amber→yellow, 0 to 6000ft). */
function altColour(altFt: number): string {
  const t = Math.max(0, Math.min(1, altFt / 6000));
  if (t < 0.5) {
    const s = t / 0.5;
    return `rgb(${Math.round(74 + 176 * s)},${Math.round(222 - 18 * s)},${Math.round(128 - 107 * s)})`;
  }
  const s = (t - 0.5) / 0.5;
  return `rgb(${Math.round(250 - 11 * s)},${Math.round(204 - 136 * s)},${Math.round(21 + 47 * s)})`;
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



/* ─────────────────────────  ESGC Fleet Dock ───────────────────────── */
function FleetDock({
  aircraft,
  fleetRegs,
  selectedId,
  onSelect,
}: {
  aircraft: LiveAircraft[];
  fleetRegs: { flarm_id: string | null; registration: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const byReg = useMemo(() => {
    const map = new Map<string, LiveAircraft>();
    for (const a of aircraft) {
      const key = (a.reg || a.id).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (key && !map.has(key)) map.set(key, a);
    }
    return map;
  }, [aircraft]);

  if (!fleetRegs.length) return null;

  return (
    <div
      className="absolute z-[1000] left-1/2 -translate-x-1/2 bottom-3 sm:bottom-4"
      style={{
        background: "rgba(10,12,18,0.88)",
        backdropFilter: "blur(14px) saturate(140%)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        padding: "6px 8px",
        boxShadow: "0 14px 40px -8px rgba(0,0,0,0.6)",
        display: "flex",
        gap: 4,
        maxWidth: "calc(100vw - 16px)",
        overflowX: "auto",
      }}
    >
      {fleetRegs.map((g) => {
        const key = g.registration.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const live = byReg.get(key);
        const isAirborne = !!live && !live.isStale;
        const isSelected = !!live && selectedId === live.id;
        return (
          <button
            key={g.registration}
            onClick={() => live && onSelect(live.id)}
            disabled={!live}
            title={isAirborne ? `${g.registration} · ${live!.altFt.toLocaleString()}ft · ${Math.round(live!.speedKph / 1.852)}kt` : `${g.registration} · on ground`}
            style={{
              minWidth: 64,
              padding: "6px 8px",
              borderRadius: 9,
              border: isSelected ? "1px solid #38bdf8" : "1px solid rgba(255,255,255,0.08)",
              background: isSelected ? "rgba(56,189,248,0.18)" : isAirborne ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.03)",
              color: "#f1f5f9",
              fontFamily: "system-ui,-apple-system,sans-serif",
              cursor: live ? "pointer" : "default",
              opacity: live ? 1 : 0.45,
              transition: "all 0.15s ease",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: isAirborne ? "#4ade80" : "rgba(255,255,255,0.25)",
                  boxShadow: isAirborne ? "0 0 6px #4ade80" : "none",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>{g.registration}</span>
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
              {isAirborne ? `${live!.altFt.toLocaleString()}ft` : "on ground"}
            </div>
          </button>
        );
      })}
    </div>
  );
}
