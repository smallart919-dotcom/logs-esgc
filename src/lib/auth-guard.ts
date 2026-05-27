import { supabase } from "@/integrations/supabase/client";
import { redirect } from "@tanstack/react-router";

/**
 * Client-only auth gate. Skipped during SSR/prerender because the Supabase
 * browser client has no localStorage there — running it on the server would
 * always redirect to /auth, then the client would re-redirect to "/" once it
 * hydrated and saw the session, producing a visible page-to-page loop.
 */
export async function requireAuth() {
  if (typeof window === "undefined") return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw redirect({ to: "/auth" });
}
