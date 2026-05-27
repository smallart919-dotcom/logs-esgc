-- Flights: restrict mutations to service accounts
DROP POLICY IF EXISTS "flights insert auth" ON public.flights;
DROP POLICY IF EXISTS "flights update auth" ON public.flights;
DROP POLICY IF EXISTS "flights delete auth" ON public.flights;

CREATE POLICY "flights insert service" ON public.flights
  FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'email' IN ('office@esgc.local', 'caravan@esgc.local'));
CREATE POLICY "flights update service" ON public.flights
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'email' IN ('office@esgc.local', 'caravan@esgc.local'));
CREATE POLICY "flights delete service" ON public.flights
  FOR DELETE TO authenticated
  USING (auth.jwt() ->> 'email' IN ('office@esgc.local', 'caravan@esgc.local'));

-- Fleet gliders
DROP POLICY IF EXISTS "fleet insert auth" ON public.fleet_gliders;
DROP POLICY IF EXISTS "fleet update auth" ON public.fleet_gliders;
DROP POLICY IF EXISTS "fleet delete auth" ON public.fleet_gliders;

-- (fleet already has office-only policies from earlier; recreate idempotently)
DROP POLICY IF EXISTS "fleet insert service" ON public.fleet_gliders;
DROP POLICY IF EXISTS "fleet update service" ON public.fleet_gliders;
DROP POLICY IF EXISTS "fleet delete service" ON public.fleet_gliders;
CREATE POLICY "fleet insert service" ON public.fleet_gliders
  FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'email' IN ('office@esgc.local', 'caravan@esgc.local'));
CREATE POLICY "fleet update service" ON public.fleet_gliders
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'email' IN ('office@esgc.local', 'caravan@esgc.local'));
CREATE POLICY "fleet delete service" ON public.fleet_gliders
  FOR DELETE TO authenticated
  USING (auth.jwt() ->> 'email' IN ('office@esgc.local', 'caravan@esgc.local'));

-- Members
DROP POLICY IF EXISTS "members insert auth" ON public.club_members;
DROP POLICY IF EXISTS "members update auth" ON public.club_members;
DROP POLICY IF EXISTS "members delete auth" ON public.club_members;

CREATE POLICY "members insert service" ON public.club_members
  FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'email' IN ('office@esgc.local', 'caravan@esgc.local'));
CREATE POLICY "members update service" ON public.club_members
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'email' IN ('office@esgc.local', 'caravan@esgc.local'));
CREATE POLICY "members delete service" ON public.club_members
  FOR DELETE TO authenticated
  USING (auth.jwt() ->> 'email' IN ('office@esgc.local', 'caravan@esgc.local'));

-- email_settings already has policies, but ensure RLS is on
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

-- Revoke unnecessary execute
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated;

-- Missing columns on flights (most already exist; IF NOT EXISTS protects)
ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS p1_kind TEXT,
  ADD COLUMN IF NOT EXISTS p2_kind TEXT,
  ADD COLUMN IF NOT EXISTS logged_by TEXT,
  ADD COLUMN IF NOT EXISTS under_21 BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS p1_charge BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS p2_charge BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.flights ALTER COLUMN notes SET DEFAULT '';

-- club_members extras
ALTER TABLE public.club_members
  ADD COLUMN IF NOT EXISTS under_21 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS currency_aerotow_override DATE,
  ADD COLUMN IF NOT EXISTS currency_winch_override DATE;