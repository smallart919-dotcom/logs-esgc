
-- Enable realtime change streams for the tables the UI subscribes to.
-- Without these, postgres_changes subscriptions never fire, so OGN/CNG updates
-- only appeared after a manual refresh or the next polling tick.
ALTER TABLE public.flights REPLICA IDENTITY FULL;
ALTER TABLE public.daily_gfes REPLICA IDENTITY FULL;
ALTER TABLE public.fleet_gliders REPLICA IDENTITY FULL;
ALTER TABLE public.email_settings REPLICA IDENTITY FULL;
ALTER TABLE public.clock_settings REPLICA IDENTITY FULL;
ALTER TABLE public.clock_offsets REPLICA IDENTITY FULL;
ALTER TABLE public.cng_settings REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'flights','daily_gfes','fleet_gliders','email_settings',
    'clock_settings','clock_offsets','cng_settings'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
