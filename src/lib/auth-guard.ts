import { supabase } from "@/integrations/supabase/client";
import { redirect } from "@tanstack/react-router";

/**
 * Client-only auth gate. Skipped during SSR/prerender because the Supabase
 * browser client has no localStorage there — running it on the server would
 * always redirect to /auth, then the client would re-redirect to "/" once it
 * hydrated and saw the session, producing a visible page-to-page loop.
 *
 * Wraps the session lookup in try/catch so a transient network blip can't
 * crash the route loader — we'd rather let the page render and let the
 * realtime/data fetches surface the error than blank the whole route.
 */
export async function requireAuth() {
  if (typeof window === "undefined") return;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn("[requireAuth] session lookup failed:", error.message);
      return;
    }
    if (!data.session) throw redirect({ to: "/auth" });
  } catch (e: any) {
    // re-throw router redirects; swallow everything else
    if (e && typeof e === "object" && "to" in e) throw e;
    console.warn("[requireAuth] unexpected error, allowing route:", e?.message ?? e);
  }
}
