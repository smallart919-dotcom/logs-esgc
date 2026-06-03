// Single source of truth for the home airfield.
// East Sussex Gliding Club — Kitson Field, The Broyle, Ringmer, Lewes BN8 5AP.
// Coordinates verified against SeeYou / standard UK aviation sources.
export const AIRFIELD = {
  id: "UKRIN",
  icao: "UKRIN",
  name: "East Sussex Gliding Club",
  shortName: "ESGC · Ringmer",
  address: "Kitson Field, The Broyle, Ringmer, Lewes BN8 5AP",
  // Kitson Field — verified: 50°54'27"N 0°6'17"E.
  lat: 50.9075,
  lon: 0.104722,
  elevationFt: 89, // 27 m MSL
  surface: "Grass",
  notes: "Gliding airfield · Grass strip · 27m MSL",
} as const;

export const AIRFIELD_LATLON: [number, number] = [AIRFIELD.lat, AIRFIELD.lon];

/** Great-circle distance in nautical miles. */
export function distanceNmFromAirfield(lat: number, lon: number): number {
  const R = 6371; // km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - AIRFIELD.lat);
  const dLon = toRad(lon - AIRFIELD.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(AIRFIELD.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
  const km = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  return km * 0.539957;
}
