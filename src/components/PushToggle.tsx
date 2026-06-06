import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/vapid";
import {
  subscribePush,
  unsubscribePush,
  firePush,
} from "@/lib/push.functions";

const SW_URL = "/push-sw.js";

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_URL);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  } catch (e) {
    console.warn("push-sw register failed", e);
    return null;
  }
}

export function PushToggle() {
  const subscribe = useServerFn(subscribePush);
  const unsubscribe = useServerFn(unsubscribePush);
  const fire = useServerFn(firePush);

  const [supported, setSupported] = useState<boolean>(false);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reg = await getRegistration();
      if (!reg) { setSupported(false); return; }
      setSupported(true);
      const sub = await reg.pushManager.getSubscription();
      if (!cancelled) setEnabled(!!sub && Notification.permission === "granted");
    })();
    return () => { cancelled = true; };
  }, []);

  const turnOn = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.error("Push permission denied");
        return;
      }
      const reg = await getRegistration();
      if (!reg) { toast.error("Push not supported on this browser"); return; }
      const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
      });
      const json = sub.toJSON();
      await subscribe({
        data: {
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
          userAgent: navigator.userAgent.slice(0, 500),
          notifyProximity: true,
          notifyOwnFleet: true,
        },
      });
      setEnabled(true);
      toast.success("Push notifications enabled");
    } catch (e) {
      console.error(e);
      toast.error("Could not enable push notifications");
    } finally {
      setBusy(false);
    }
  }, [subscribe]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribe({ data: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
      }
      setEnabled(false);
      toast("Push notifications disabled");
    } finally {
      setBusy(false);
    }
  }, [unsubscribe]);

  const sendTest = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fire({
        data: {
          category: "test",
          title: "ESGC Logs · test push",
          body: "If you can read this, push is working.",
          tag: "esgc-test",
          url: "/map",
        },
      });
      toast.success(`Test sent (${res.sent} delivered, ${res.failed} failed)`);
    } catch (e) {
      console.error(e);
      toast.error("Test push failed");
    } finally {
      setBusy(false);
    }
  }, [fire]);

  if (!supported) {
    return (
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 6 }}>
        Push notifications not supported here.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, padding: "6px 8px", borderRadius: 6, background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.25)" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: busy ? "wait" : "pointer", fontSize: 12 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => (e.target.checked ? turnOn() : turnOff())}
          style={{ accentColor: "#38bdf8", width: 15, height: 15 }}
        />
        <span>Push to this device</span>
      </label>
      {enabled && (
        <button
          type="button"
          onClick={sendTest}
          disabled={busy}
          style={{ background: "rgba(56,189,248,0.18)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.4)", borderRadius: 4, padding: "3px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer", alignSelf: "flex-start" }}
        >
          ▶ Send test push
        </button>
      )}
    </div>
  );
}
