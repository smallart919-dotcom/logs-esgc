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
let _cache: { data: { ogn: unknown; adsb: unknown; fetchedAt: number }; at: number } | null = null;
const CACHE_TTL_MS = 1500;

export const getLiveTraffic = createServerFn({ method: "GET" }).handler(async () => {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.data;
  }

  const OGN_URL =
    "https://api.glideandseek.com/v2/aircraft?showOnlyGliders=false&a=51.4&b=1.8&c=50.4&d=-0.6";
  const ADSB_URL =
    "https://opendata.adsb.fi/api/v2/lat/50.907/lon/0.105/dist/50";

  const headers = {
    Accept: "application/json",
    "User-Agent": "ESGCLogs/1.0 (+https://esgclogs.uk)",
  };

  const [ognRes, adsbRes] = await Promise.allSettled([
    fetch(OGN_URL, { headers }).then((r) => (r.ok ? r.json() : null)),
    fetch(ADSB_URL, { headers }).then((r) => (r.ok ? r.json() : null)),
  ]);

  const result = {
    ogn: ognRes.status === "fulfilled" ? ognRes.value : null,
    adsb: adsbRes.status === "fulfilled" ? adsbRes.value : null,
    fetchedAt: Date.now() / 1000,
  };
  _cache = { data: result, at: Date.now() };
  return result;
});
