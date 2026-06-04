import { createServerFn } from "@tanstack/react-start";

/**
 * Server-side proxy for live traffic feeds.
 * - OGN gliders via GlideAndSeek's public REST proxy (live.glidernet.org's
 *   JSON endpoint is no longer publicly reachable / returns 404).
 * - Powered traffic via adsb.fi open data (ADS-B Exchange's public
 *   globe endpoint now returns 403 to unauthenticated requests).
 *
 * Both feeds are CORS-blocked from the browser, hence the server proxy.
 */
export const getLiveTraffic = createServerFn({ method: "GET" }).handler(async () => {
  // Bounding box covers East Sussex + soaring range.
  // GlideAndSeek: a=north, b=east, c=south, d=west
  const OGN_URL =
    "https://api.glideandseek.com/v2/aircraft?showOnlyGliders=false&a=51.4&b=1.8&c=50.4&d=-0.6";
  // adsb.fi: 50nm radius around Ringmer (50.907, 0.105)
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

  return {
    ogn: ognRes.status === "fulfilled" ? ognRes.value : null,
    adsb: adsbRes.status === "fulfilled" ? adsbRes.value : null,
    fetchedAt: Date.now() / 1000,
  };
});
