import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guard";

export const Route = createFileRoute("/map")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Live Map — ESGC Logs" },
      { name: "description", content: "Live aircraft positions around Ringmer — OGN + ADS-B." },
    ],
  }),
  ssr: false,
});
