// Server-only helper for sending web-push notifications.
// Do not import this from client-reachable modules at module scope —
// always `await import(...)` inside server-fn handlers.
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@esgclogs.uk";
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

function adminClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  renotify?: boolean;
  requireInteraction?: boolean;
};

/** Send to every subscriber that has opted into the given category. */
export async function sendToAllSubscribers(
  category: "proximity" | "own_fleet" | "test",
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  configure();
  const supabase = adminClient();
  let query = supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth");
  if (category === "proximity") query = query.eq("notify_proximity", true);
  else if (category === "own_fleet") query = query.eq("notify_own_fleet", true);
  const { data, error } = await query;
  if (error) throw error;
  const subs = data ?? [];

  let sent = 0;
  let failed = 0;
  const toDelete: string[] = [];
  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (err: unknown) {
        failed++;
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) toDelete.push(s.id);
      }
    }),
  );

  if (toDelete.length) {
    await supabase.from("push_subscriptions").delete().in("id", toDelete);
  }
  return { sent, failed };
}
