import { createClient } from "@supabase/supabase-js";

/**
 * Auth gate for `/api/public/hooks/*` routes.
 *
 * Accepts either:
 *  - `Authorization: Bearer <CRON_SECRET>` (pg_cron / external schedulers)
 *  - `Authorization: Bearer <supabase JWT>` for a signed-in user
 *    (used by in-app "Sync now" buttons)
 *
 * Returns null when authorized, or a Response to short-circuit the handler.
 */
export async function authorizePublicHook(request: Request): Promise<Response | null> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) return new Response("Unauthorized", { status: 401 });

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return null;

  // Fall through to validating as a Supabase JWT.
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
