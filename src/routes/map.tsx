import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guard";

export const Route = createFileRoute("/map")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Live Map — ESGC Logs" },
      { name: "description", content: "Live aircraft positions around Ringmer — OGN + ADS-B." },
      { property: "og:title", content: "Live Map — ESGC Logs" },
      { property: "og:description", content: "Live traffic around Ringmer with weather and thermal overlays." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://esgclogs.uk/map" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://esgclogs.uk/map" }],
  }),
  ssr: false,
});
