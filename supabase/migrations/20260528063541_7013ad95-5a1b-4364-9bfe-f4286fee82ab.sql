
ALTER TABLE public.daily_logs ADD COLUMN IF NOT EXISTS cng_synced_at timestamptz;
ALTER TABLE public.daily_logs ADD COLUMN IF NOT EXISTS cng_raw jsonb;

CREATE TABLE IF NOT EXISTS public.daily_gfes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_date date NOT NULL,
  position int NOT NULL,
  time_text text,
  passenger_name text,
  gfe_type text,
  ref text,
  raw_text text NOT NULL,
  source text NOT NULL DEFAULT 'cng',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flight_date, position)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_gfes TO authenticated;
GRANT ALL ON public.daily_gfes TO service_role;
ALTER TABLE public.daily_gfes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gfes read all" ON public.daily_gfes FOR SELECT TO authenticated USING (true);
CREATE POLICY "gfes insert auth" ON public.daily_gfes FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "gfes update auth" ON public.daily_gfes FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "gfes delete auth" ON public.daily_gfes FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE INDEX IF NOT EXISTS daily_gfes_date_idx ON public.daily_gfes (flight_date);

CREATE TABLE IF NOT EXISTS public.cng_settings (
  id int PRIMARY KEY DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CHECK (id = 1)
);
INSERT INTO public.cng_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.cng_settings TO authenticated;
GRANT ALL ON public.cng_settings TO service_role;
ALTER TABLE public.cng_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cng_settings read all" ON public.cng_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "cng_settings update office" ON public.cng_settings FOR UPDATE TO authenticated USING (is_office()) WITH CHECK (is_office());
