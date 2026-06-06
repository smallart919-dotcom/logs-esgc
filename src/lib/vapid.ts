// VAPID public key — safe to ship to the browser (that is its purpose).
// Must match the VAPID_PUBLIC_KEY secret used by the server.
export const VAPID_PUBLIC_KEY =
  "BDaufXXLqVzqWBvah_gk2EzPdEpmMyRJUzPplbf5RlwukmuZ3_tdZnRExWJG6vmHlbOKZUS25DEWmC9JDKfUKq4";

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
