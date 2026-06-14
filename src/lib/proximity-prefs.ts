const KEY = "esgc.proximity.prefs.v1";

export type ProximityPrefs = {
  notifyEnabled: boolean;
  proximityNm: number;
  audioChime: boolean;
  chimeVolume: number;
};

export const DEFAULT_PROX_PREFS: ProximityPrefs = {
  notifyEnabled: true,
  proximityNm: 1,
  audioChime: true,
  chimeVolume: 0.9,
};

export function loadProximityPrefs(): ProximityPrefs {
  if (typeof window === "undefined") return DEFAULT_PROX_PREFS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PROX_PREFS;
    const j = JSON.parse(raw) as Partial<ProximityPrefs>;
    return {
      notifyEnabled: typeof j.notifyEnabled === "boolean" ? j.notifyEnabled : DEFAULT_PROX_PREFS.notifyEnabled,
      proximityNm: typeof j.proximityNm === "number" ? j.proximityNm : DEFAULT_PROX_PREFS.proximityNm,
      audioChime: typeof j.audioChime === "boolean" ? j.audioChime : DEFAULT_PROX_PREFS.audioChime,
      chimeVolume: typeof j.chimeVolume === "number" ? j.chimeVolume : DEFAULT_PROX_PREFS.chimeVolume,
    };
  } catch {
    return DEFAULT_PROX_PREFS;
  }
}

export function saveProximityPrefs(p: ProximityPrefs) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
