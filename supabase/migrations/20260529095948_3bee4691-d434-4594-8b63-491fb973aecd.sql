
-- 1) Restrict daily_gfes reads (contains passenger phone numbers / PII)
DROP POLICY IF EXISTS "gfes read all" ON public.daily_gfes;
CREATE POLICY "gfes read office or caravan"
  ON public.daily_gfes FOR SELECT TO authenticated
  USING (is_office() OR is_caravan());

-- 2) Restrict email_settings reads to office only
DROP POLICY IF EXISTS "email_settings read all" ON public.email_settings;
CREATE POLICY "email_settings read office"
  ON public.email_settings FOR SELECT TO authenticated
  USING (is_office());

-- 3) Storage RLS for the private logs-exports bucket
-- Lock down all client-side bucket operations; signed URLs and server-side
-- admin writes (supabaseAdmin / service_role) continue to work because the
-- service role bypasses RLS.
DROP POLICY IF EXISTS "logs-exports office select" ON storage.objects;
DROP POLICY IF EXISTS "logs-exports office insert" ON storage.objects;
DROP POLICY IF EXISTS "logs-exports office update" ON storage.objects;
DROP POLICY IF EXISTS "logs-exports office delete" ON storage.objects;

CREATE POLICY "logs-exports office select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'logs-exports' AND is_office());
CREATE POLICY "logs-exports office insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logs-exports' AND is_office());
CREATE POLICY "logs-exports office update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'logs-exports' AND is_office())
  WITH CHECK (bucket_id = 'logs-exports' AND is_office());
CREATE POLICY "logs-exports office delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'logs-exports' AND is_office());

-- 4) Tighten EXECUTE on SECURITY DEFINER helpers — only authenticated users
-- (and service_role) need to call them; anon does not.
REVOKE EXECUTE ON FUNCTION public.is_office() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_caravan() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.caravan_offset_editing_allowed() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_office() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_caravan() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caravan_offset_editing_allowed() TO authenticated, service_role;
