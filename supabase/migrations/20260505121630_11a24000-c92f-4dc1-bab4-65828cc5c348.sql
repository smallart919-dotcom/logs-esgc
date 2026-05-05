
CREATE OR REPLACE FUNCTION public.is_office()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE id = auth.uid() AND lower(email) = 'office@esgc.local'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_office() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_office() TO authenticated;

DROP POLICY IF EXISTS "fleet insert auth" ON public.fleet_gliders;
DROP POLICY IF EXISTS "fleet update auth" ON public.fleet_gliders;
DROP POLICY IF EXISTS "fleet delete auth" ON public.fleet_gliders;

CREATE POLICY "fleet insert office" ON public.fleet_gliders
  FOR INSERT TO authenticated WITH CHECK (public.is_office());
CREATE POLICY "fleet update office" ON public.fleet_gliders
  FOR UPDATE TO authenticated USING (public.is_office()) WITH CHECK (public.is_office());
CREATE POLICY "fleet delete office" ON public.fleet_gliders
  FOR DELETE TO authenticated USING (public.is_office());
