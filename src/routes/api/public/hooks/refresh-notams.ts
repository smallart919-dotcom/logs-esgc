import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicHook } from "@/lib/public-hook-auth";

export const Route = createFileRoute("/api/public/hooks/refresh-notams")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authorizePublicHook(request);
        if (denied) return denied;
        const { refreshNotamsFromNATS } = await import("@/lib/notams-refresh.server");
        try {
          const result = await refreshNotamsFromNATS();
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
