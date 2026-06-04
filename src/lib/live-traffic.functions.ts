import { createServerFn } from "@tanstack/react-start";

/**
 * Server-side proxy for live traffic feeds (OGN + ADS-B Exchange).
 * Browsers cannot fetch these directly due to CORS, so we proxy here.
 */
export const getLiveTraffic = createServerFn({ method: "GET" }).handler(async () => {
  const OGN_URL =
    "https://live.glidernet.org/api/0/aircraft?a=0&b=51.4&c=50.4&d=1.8&e=-0.6";
  const ADSB_URL = "https://globe.adsbexchange.com/data/aircraft.json";

  const [ognRes, adsbRes] = await Promise.allSettled([
    fetch(OGN_URL, { headers: { Accept: "application/json" } }).then((r) =>
      r.ok ? r.json() : null,
    ),
    fetch(ADSB_URL, { headers: { Accept: "application/json" } }).then((r) =>
      r.ok ? r.json() : null,
    ),
  ]);

  return {
    ogn: ognRes.status === "fulfilled" ? ognRes.value : null,
    adsb: adsbRes.status === "fulfilled" ? adsbRes.value : null,
    fetchedAt: Date.now() / 1000,
  };
});
