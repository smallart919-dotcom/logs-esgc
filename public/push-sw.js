/* ESGC Logs push service worker.
   Scope: site root. Receives push events and shows notifications.
   Does NOT cache the app shell — installability/offline is handled separately. */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: "ESGC Logs", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "ESGC Logs";
  const options = {
    body: payload.body || "",
    tag: payload.tag || "esgc-push",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: payload.url || "/map" },
    renotify: !!payload.renotify,
    requireInteraction: !!payload.requireInteraction,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/map";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          try { client.navigate(target); } catch (_) {}
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
