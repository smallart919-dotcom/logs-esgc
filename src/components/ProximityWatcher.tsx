/**
 * Global proximity watcher. Mounted in the root layout so chime + push +
 * toast alerts fire on every page (Daily Logs, Weather, etc.), not only
 * the Map page. Disabled when the user is actually viewing /map — that
 * page runs its own higher-frequency detector with shared prefs.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getLiveTraffic } from "@/lib/live-traffic.functions";
import { firePush } from "@/lib/push.functions";
import { AIRFIELD_LATLON } from "@/lib/airfield";
import { loadProximityPrefs, type ProximityPrefs } from "@/lib/proximity-prefs";
import { playChime, primeChime } from "@/lib/chime";

const PREFS_STORAGE_KEY = "esgc.proximity.prefs.v1";

export function ProximityWatcher() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const firePushFn = useServerFn(firePush);
  const insideZoneRef = useRef<Map<string, number>>(new Map());
  const lastPushRef = useRef<Map<string, number>>(new Map());
  const prefsRef = useRef<ProximityPrefs>(loadProximityPrefs());
  const fleetRef = useRef<{ flarm: Set<string>; reg: Set<string> }>({ flarm: new Set(), reg: new Set() });
  const activeRef = useRef(true);

  // Disable on the map page (it runs its own detector).
  activeRef.current = !path.startsWith("/map") && path !== "/auth";

  // Prime the AudioContext on first user gesture.
  useEffect(() => { primeChime(); }, []);

  // Re-read prefs when they change in this tab or another tab.
  useEffect(() => {
    const refresh = () => { prefsRef.current = loadProximityPrefs(); };
    const onStorage = (e: StorageEvent) => { if (e.key === PREFS_STORAGE_KEY) refresh(); };
    window.addEventListener("storage", onStorage);
    const t = setInterval(refresh, 5000);
    return () => { window.removeEventListener("storage", onStorage); clearInterval(t); };
  }, []);

  // Load fleet for own-fleet exclusion.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from("fleet_gliders").select("flarm_id, registration");
      if (cancelled || !data) return;
      const flarm = new Set<string>();
      const reg = new Set<string>();
      for (const g of data) {
        if (g.flarm_id) flarm.add(String(g.flarm_id).toUpperCase());
        if (g.registration) reg.add(String(g.registration).toUpperCase().replace(/[^A-Z0-9]/g, ""));
      }
      fleetRef.current = { flarm, reg };
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Ask permission once if push/alerts are wanted.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default" && prefsRef.current.notifyEnabled) {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Polling loop.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      const prefs = prefsRef.current;
      const visible = typeof document !== "undefined" && document.visibilityState === "visible";
      const everyMs = activeRef.current && prefs.notifyEnabled ? (visible ? 15_000 : 60_000) : 30_000;

      if (activeRef.current && prefs.notifyEnabled) {
        try {
          const [alat, alon] = AIRFIELD_LATLON;
          const proxied = await getLiveTraffic({ data: { lat: alat, lon: alon, distNm: 40 } });

          type Plain = { id: string; lat: number; lon: number; altFt: number; reg: string; isOwn: boolean; isStale: boolean };
          const out: Plain[] = [];
          const nowSec = Date.now() / 1000;

          // OGN
          const ognList = (proxied?.ogn as { message?: Record<string, unknown>[] } | null)?.message;
          if (Array.isArray(ognList)) {
            for (const a of ognList) {
              const flarm = String(a.flarmID ?? "").toUpperCase();
              const reg = String(a.registration ?? a.displayName ?? "");
              const normReg = reg.toUpperCase().replace(/[^A-Z0-9]/g, "");
              const tsMs = parseFloat(String(a.timestamp ?? 0)) || 0;
              const ts = Math.round(tsMs / 1000);
              const altM = parseFloat(String(a.altitude ?? 0)) || 0;
              const lat = parseFloat(String(a.lat));
              const lon = parseFloat(String(a.lng));
              if (isNaN(lat) || isNaN(lon)) continue;
              out.push({
                id: normReg || flarm || `ogn-${lat.toFixed(3)}-${lon.toFixed(3)}`,
                lat, lon,
                altFt: Math.round(altM * 3.281),
                reg,
                isOwn: fleetRef.current.flarm.has(flarm) || fleetRef.current.reg.has(normReg),
                isStale: nowSec - ts > 300,
              });
            }
          }

          // ADS-B
          const adsbJson = proxied?.adsb as { ac?: unknown[]; aircraft?: unknown[]; now?: number } | null;
          const adsbList = adsbJson?.aircraft ?? adsbJson?.ac ?? [];
          const rawNow = adsbJson?.now ?? nowSec;
          const serverNow = rawNow > 10_000_000_000 ? rawNow / 1000 : rawNow;
          for (const raw of adsbList) {
            const a = raw as Record<string, unknown>;
            const altFt = parseFloat(String(a.alt_baro ?? a.altitude ?? a.alt ?? 0)) || 0;
            const reg = String(a.flight ?? a.r ?? a.registration ?? "").trim();
            const normReg = reg.toUpperCase().replace(/[^A-Z0-9]/g, "");
            const hex = String(a.hex ?? a.icao ?? "").toUpperCase().replace(/[^A-F0-9]/g, "");
            const seen = parseFloat(String(a.seen_pos ?? a.seen ?? 0)) || 0;
            const lat = parseFloat(String(a.lat));
            const lon = parseFloat(String(a.lon));
            if (isNaN(lat) || isNaN(lon)) continue;
            out.push({
              id: hex || normReg || `adsb-${lat.toFixed(3)}-${lon.toFixed(3)}`,
              lat, lon, altFt: Math.round(altFt), reg,
              isOwn: false,
              isStale: (serverNow - seen) < 0 ? false : seen > 300,
            });
          }

          const seenIds = new Set<string>();
          for (const a of out) {
            if (a.isStale || a.isOwn) continue;
            const toRad = (d: number) => (d * Math.PI) / 180;
            const dLat = toRad(a.lat - alat);
            const dLon = toRad(a.lon - alon);
            const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(alat)) * Math.cos(toRad(a.lat)) * Math.sin(dLon / 2) ** 2;
            const distNm = (2 * 6371 * Math.asin(Math.sqrt(h))) / 1.852;
            if (distNm <= prefs.proximityNm && a.altFt <= 2200) {
              seenIds.add(a.id);
              const prev = insideZoneRef.current.get(a.id);
              if (!prev || nowSec - prev > 300) {
                const label = a.reg || a.id;
                const msg = `${label} · ${a.altFt.toLocaleString()}ft · ${distNm.toFixed(1)}nm`;
                toast(`✈ Aircraft near Ringmer`, { description: msg });
                if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                  try { new Notification("Aircraft near Ringmer", { body: msg, tag: a.id }); } catch { /* noop */ }
                }
                if (prefs.audioChime) playChime(prefs.chimeVolume);
                const lastPush = lastPushRef.current.get(a.id) ?? 0;
                if (nowSec - lastPush > 600) {
                  lastPushRef.current.set(a.id, nowSec);
                  firePushFn({ data: { category: "proximity", title: "Aircraft near Ringmer", body: msg, tag: a.id, url: "/map" } }).catch(() => {});
                }
              }
              insideZoneRef.current.set(a.id, nowSec);
            }
          }
          for (const id of Array.from(insideZoneRef.current.keys())) {
            if (!seenIds.has(id) && nowSec - (insideZoneRef.current.get(id) ?? 0) > 600) {
              insideZoneRef.current.delete(id);
            }
          }
        } catch {
          /* swallow — try again next tick */
        }
      }

      if (cancelled) return;
      timer = setTimeout(tick, everyMs);
    };

    timer = setTimeout(tick, 3000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [firePushFn]);

  return null;
}
