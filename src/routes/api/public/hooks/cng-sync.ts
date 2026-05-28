import { createFileRoute } from "@tanstack/react-router";
import { runCngSync } from "@/lib/cng-sync-run.server";

// POST /api/public/hooks/cng-sync
// Body (optional): { date?: "YYYY-MM-DD" }
//
// Logs into Click n' Glide using server-side stored credentials, scrapes the
// chosen day's dashboard, and persists the result.
//
// Called by pg_cron nightly and from the "Sync now" button in the UI.

export const Route = createFileRoute("/api/public/hooks/cng-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { date?: string } = {};
        try { body = (await request.json()) as { date?: string }; } catch {}

        const result = await runCngSync(body);
        if (result.error) {
          const status = result.error.includes("date must be") ? 400 : 502;
          return Response.json({ error: result.error }, { status });
        }

        return Response.json(result);
      },
    },
  },
});
