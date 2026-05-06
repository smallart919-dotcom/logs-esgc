
CREATE TABLE public.flight_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_date date NOT NULL,
  flarm_id text,
  glider_registration text,
  takeoff_time timestamptz,
  landing_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX idx_flight_tombstones_date ON public.flight_tombstones (flight_date);

ALTER TABLE public.flight_tombstones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tombstones read all" ON public.flight_tombstones FOR SELECT TO authenticated USING (true);
CREATE POLICY "tombstones insert auth" ON public.flight_tombstones FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "tombstones delete auth" ON public.flight_tombstones FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
