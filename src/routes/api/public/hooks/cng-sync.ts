import { createFileRoute } from "@tanstack/react-router";
import { runCngSync } from "@/lib/cng-sync-run.server";
import { purgeOldLogExports } from "@/lib/storage-cleanup.server";
import { authorizePublicHook } from "@/lib/public-hook-auth";

// POST /api/public/hooks/cng-sync
// Body (optional): { date?: "YYYY-MM-DD" }
//
// Logs into Click n' Glide using server-side stored credentials, scrapes the
// chosen day's dashboard, and persists the result.
//
// Requires Authorization: Bearer <CRON_SECRET> (pg_cron) or a valid Supabase JWT.

export const Route = createFileRoute("/api/public/hooks/cng-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = await authorizePublicHook(request);
        if (unauth) return unauth;

        let body: { date?: string } = {};
        try { body = (await request.json()) as { date?: string }; } catch {}

        const result = await runCngSync(body);

        // Housekeeping: drop exported spreadsheets older than 35 days so the
        // private bucket doesn't grow without bound. Never fails the sync.
        let purged: { removed: number; error?: string } | undefined;
        try {
          purged = await purgeOldLogExports(35);
        } catch { /* non-fatal */ }
        if (purged && !result.error) {
          return Response.json({ ...result, exports_purged: purged.removed });
        }
        if (result.error) {
          const status = result.error.includes("date must be") ? 400 : 502;
          return Response.json({ error: result.error }, { status });
        }

        return Response.json(result);
      },
    },
  },
});
