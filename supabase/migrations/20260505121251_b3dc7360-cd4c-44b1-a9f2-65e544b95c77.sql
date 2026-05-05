
CREATE TABLE public.daily_logs (
  flight_date date PRIMARY KEY,
  duty_instructor text,
  duty_pilot text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_logs read all" ON public.daily_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "daily_logs insert auth" ON public.daily_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "daily_logs update auth" ON public.daily_logs FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "daily_logs delete auth" ON public.daily_logs FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER daily_logs_set_updated_at BEFORE UPDATE ON public.daily_logs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
