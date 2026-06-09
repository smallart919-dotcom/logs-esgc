import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server-side proxy for live traffic feeds.
 * - OGN gliders via GlideAndSeek's public REST proxy.
 * - Powered traffic via adsb.fi open data.
 *
 * Both feeds are CORS-blocked from the browser, hence the server proxy.
 * A short in-memory cache avoids hammering upstream when multiple clients
 * poll concurrently and keeps response shape stable between rapid polls.
 */
let _cache: { data: { ogn: unknown; adsb: unknown; fetchedAt: number; errors: string[] }; at: number } | null = null;
const CACHE_TTL_MS = 1500;
const TrafficInput = z.object({
  lat: z.number().min(49).max(59).optional(),
  lon: z.number().min(-8).max(4).optional(),
  distNm: z.number().min(20).max(250).optional(),
}).optional();

async function fetchJson(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function firstWorkingJson(urls: string[], headers: Record<string, string>) {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const data = await fetchJson(url, headers);
      const list = Array.isArray(data?.aircraft) ? data.aircraft : Array.isArray(data?.ac) ? data.ac : null;
      if (!list || list.length > 0) return { data, errors };
      errors.push(`${url}: empty`);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { data: null, errors };
}

export const getLiveTraffic = createServerFn({ method: "GET" })
  .inputValidator((input) => TrafficInput.parse(input))
  .handler(async ({ data }) => {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.data;
  }

  const lat = data?.lat ?? 50.907;
  const lon = data?.lon ?? 0.105;
  const distNm = data?.distNm ?? 70;
  const latDelta = distNm / 60;
  const lonDelta = distNm / (60 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const north = Math.min(59, lat + latDelta);
  const south = Math.max(49, lat - latDelta);
  const east = Math.min(4, lon + lonDelta);
  const west = Math.max(-8, lon - lonDelta);

  const OGN_URL = `https://api.glideandseek.com/v2/aircraft?showOnlyGliders=false&a=${north.toFixed(3)}&b=${east.toFixed(3)}&c=${south.toFixed(3)}&d=${west.toFixed(3)}`;
  const ADSB_URLS = [
    `https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(3)}/lon/${lon.toFixed(3)}/dist/${Math.round(distNm)}`,
    `https://api.airplanes.live/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${Math.round(distNm)}`,
    `https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${Math.round(distNm)}`,
  ];

  const headers = {
    Accept: "application/json",
    "User-Agent": "ESGCLogs/1.0 (+https://esgclogs.uk)",
  };

  const [ognRes, adsbRes] = await Promise.allSettled([
    fetchJson(OGN_URL, headers),
    firstWorkingJson(ADSB_URLS, headers),
  ]);

  const adsb = adsbRes.status === "fulfilled" ? adsbRes.value.data : null;
  const errors = adsbRes.status === "fulfilled" ? adsbRes.value.errors : [String(adsbRes.reason)];

  const result = {
    ogn: ognRes.status === "fulfilled" ? ognRes.value : null,
    adsb,
    fetchedAt: Date.now() / 1000,
    errors,
  };
  _cache = { data: result, at: Date.now() };
  return result;
});
