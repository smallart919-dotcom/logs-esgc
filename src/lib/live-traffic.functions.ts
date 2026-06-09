import { createServerFn } from "@tanstack/react-start";

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

export const getLiveTraffic = createServerFn({ method: "GET" }).handler(async () => {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.data;
  }

  const OGN_URL =
    "https://api.glideandseek.com/v2/aircraft?showOnlyGliders=false&a=51.4&b=1.8&c=50.4&d=-0.6";
  const ADSB_URLS = [
    "https://opendata.adsb.fi/api/v2/lat/50.907/lon/0.105/dist/50",
    "https://api.airplanes.live/v2/point/50.907/0.105/50",
    "https://api.adsb.lol/v2/point/50.907/0.105/50",
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
