CREATE TABLE public.event_gliders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_date date NOT NULL,
  name text NOT NULL DEFAULT 'Glider 1',
  pilot_name text,
  position integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_gliders TO authenticated;
GRANT ALL ON public.event_gliders TO service_role;

ALTER TABLE public.event_gliders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_gliders read all" ON public.event_gliders FOR SELECT TO authenticated USING (true);
CREATE POLICY "event_gliders insert auth" ON public.event_gliders FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "event_gliders update auth" ON public.event_gliders FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "event_gliders delete auth" ON public.event_gliders FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER event_gliders_set_updated_at BEFORE UPDATE ON public.event_gliders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX event_gliders_date_idx ON public.event_gliders (flight_date, position);

ALTER TABLE public.daily_gfes
  ADD COLUMN assigned_glider_id uuid REFERENCES public.event_gliders(id) ON DELETE SET NULL,
  ADD COLUMN launch_time text;