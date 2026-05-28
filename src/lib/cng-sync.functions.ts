import { createServerFn } from "@tanstack/react-start";

// Thin wrapper that triggers the public sync endpoint from the UI. We can't
// invoke a public TanStack route via `useServerFn` directly, so this server fn
// makes an internal HTTP call to /api/public/hooks/cng-sync. Running it server
// side keeps the click-and-glide cookies/credentials off the browser.

export const cngSyncNow = createServerFn({ method: "POST" })
  .inputValidator((d: { date?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const baseUrl =
      process.env.PUBLIC_BASE_URL ||
      process.env.VITE_BASE_URL ||
      "https://logs-esgc.lovable.app";
    const url = new URL("/api/public/hooks/cng-sync", baseUrl).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data ?? {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        typeof json.error === "string" ? json.error : `Sync failed (HTTP ${res.status})`,
      );
    }
    return json;
  });
