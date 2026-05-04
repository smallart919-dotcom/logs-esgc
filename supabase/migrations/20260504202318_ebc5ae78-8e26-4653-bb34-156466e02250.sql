
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.launch_type AS ENUM ('aerotow', 'winch');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles select own" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles insert own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE POLICY "roles select own" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Members (club members list)
CREATE TABLE public.club_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  membership_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read all" ON public.club_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "members insert auth" ON public.club_members FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "members update auth" ON public.club_members FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "members delete auth" ON public.club_members FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Fleet
CREATE TABLE public.fleet_gliders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration TEXT NOT NULL,
  callsign TEXT,
  flarm_id TEXT UNIQUE,
  glider_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fleet_gliders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fleet read all" ON public.fleet_gliders FOR SELECT TO authenticated USING (true);
CREATE POLICY "fleet insert auth" ON public.fleet_gliders FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "fleet update auth" ON public.fleet_gliders FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "fleet delete auth" ON public.fleet_gliders FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Flights
CREATE TABLE public.flights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  glider_id UUID REFERENCES public.fleet_gliders(id) ON DELETE SET NULL,
  glider_registration TEXT,
  flarm_id TEXT,
  takeoff_time TIMESTAMPTZ,
  landing_time TIMESTAMPTZ,
  p1_name TEXT,
  p1_membership TEXT,
  p2_name TEXT,
  p2_membership TEXT,
  launch_type launch_type,
  aerotow_height_ft INTEGER,
  manual BOOLEAN NOT NULL DEFAULT false,
  ogn_source JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
CREATE INDEX flights_date_idx ON public.flights(flight_date);
CREATE UNIQUE INDEX flights_ogn_unique ON public.flights(flarm_id, takeoff_time) WHERE flarm_id IS NOT NULL AND takeoff_time IS NOT NULL AND manual = false;

ALTER TABLE public.flights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flights read all" ON public.flights FOR SELECT TO authenticated USING (true);
CREATE POLICY "flights insert auth" ON public.flights FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "flights update auth" ON public.flights FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "flights delete auth" ON public.flights FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER flights_updated_at BEFORE UPDATE ON public.flights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name) VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
