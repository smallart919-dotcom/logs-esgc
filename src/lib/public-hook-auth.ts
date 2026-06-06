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
  // Accept either a header-based bearer or `?apikey=` query for pg_cron-style calls.
  const url = new URL(request.url);
  const header = request.headers.get("authorization") ?? "";
  const apikeyHeader = request.headers.get("apikey") ?? "";
  const token =
    (header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "") ||
    apikeyHeader.trim() ||
    (url.searchParams.get("apikey") ?? "").trim();

  if (!token) return new Response("Unauthorized", { status: 401 });

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return null;

  // The Supabase publishable/anon key is an acceptable bearer for /api/public/hooks/*
  // — matches the canonical pg_cron + in-app trigger pattern.
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (publishable && token === publishable) return null;

  // Otherwise validate as a Supabase user JWT.
  const SUPABASE_URL = process.env.SUPABASE_URL;
  if (!SUPABASE_URL || !publishable) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

