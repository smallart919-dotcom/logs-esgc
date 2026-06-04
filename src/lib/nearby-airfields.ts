// Small static list of SE England airfields used to label trail start points
// with a likely departure airfield. Not authoritative — just nearest match.
export type NearbyAirfield = { icao?: string; name: string; lat: number; lon: number };

export const NEARBY_AIRFIELDS: NearbyAirfield[] = [
  { icao: "UKRIN", name: "Ringmer (ESGC)", lat: 50.9075, lon: 0.104722 },
  { icao: "EGKA", name: "Shoreham", lat: 50.8356, lon: -0.2972 },
  { icao: "EGKB", name: "Biggin Hill", lat: 51.3308, lon: 0.0325 },
  { icao: "EGKK", name: "Gatwick", lat: 51.1481, lon: -0.1903 },
  { icao: "EGKR", name: "Redhill", lat: 51.2136, lon: -0.1386 },
  { icao: "EGKH", name: "Lashenden/Headcorn", lat: 51.1567, lon: 0.6417 },
  { icao: "EGMD", name: "Lydd", lat: 50.9561, lon: 0.9392 },
  { icao: "EGMC", name: "Southend", lat: 51.5714, lon: 0.6956 },
  { icao: "EGTO", name: "Rochester", lat: 51.3517, lon: 0.5033 },
  { icao: "EGHR", name: "Goodwood", lat: 50.8594, lon: -0.7592 },
  { icao: "EGLK", name: "Blackbushe", lat: 51.3239, lon: -0.8475 },
  { name: "Parham (Southdown GC)", lat: 50.9333, lon: -0.4833 },
  { name: "Challock (Kent GC)", lat: 51.2225, lon: 0.8222 },
  { name: "Bicester", lat: 51.9133, lon: -1.1336 },
  { name: "Deanland", lat: 50.8728, lon: 0.1992 },
  { icao: "EGKE", name: "Penshurst", lat: 51.1797, lon: 0.1808 },
];

export function nearestAirfield(lat: number, lon: number, maxNm = 8): NearbyAirfield | null {
  const toRad = (d: number) => (d * Math.PI) / 180;
  let best: NearbyAirfield | null = null;
  let bestNm = Infinity;
  for (const a of NEARBY_AIRFIELDS) {
    const dLat = toRad(a.lat - lat);
    const dLon = toRad(a.lon - lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(a.lat)) * Math.sin(dLon / 2) ** 2;
    const nm = (2 * 6371 * Math.asin(Math.sqrt(h))) / 1.852;
    if (nm < bestNm) { bestNm = nm; best = a; }
  }
  return bestNm <= maxNm ? best : null;
}

export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return (2 * 6371 * Math.asin(Math.sqrt(h))) / 1.852;
}
