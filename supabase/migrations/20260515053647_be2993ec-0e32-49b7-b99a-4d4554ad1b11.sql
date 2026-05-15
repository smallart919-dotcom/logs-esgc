-- Per-date clock offset (seconds added to UTC times when displayed)
CREATE TABLE public.clock_offsets (
  flight_date date PRIMARY KEY,
  offset_seconds integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.clock_offsets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clock_offsets read all" ON public.clock_offsets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "clock_offsets insert office" ON public.clock_offsets
  FOR INSERT TO authenticated WITH CHECK (is_office() OR auth.uid() IS NOT NULL);
CREATE POLICY "clock_offsets update office" ON public.clock_offsets
  FOR UPDATE TO authenticated USING (is_office() OR auth.uid() IS NOT NULL);
CREATE POLICY "clock_offsets delete office" ON public.clock_offsets
  FOR DELETE TO authenticated USING (is_office());

-- Permanent (always-on) clock offset, single row
CREATE TABLE public.clock_settings (
  id integer PRIMARY KEY DEFAULT 1,
  permanent_offset_seconds integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT clock_settings_singleton CHECK (id = 1)
);

INSERT INTO public.clock_settings (id, permanent_offset_seconds) VALUES (1, 0);

ALTER TABLE public.clock_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clock_settings read all" ON public.clock_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "clock_settings update office" ON public.clock_settings
  FOR UPDATE TO authenticated USING (is_office()) WITH CHECK (is_office());