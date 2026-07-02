DO $$
BEGIN
  -- Ensure the column exists and has the correct type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clock_settings' AND column_name = 'ogn_source'
  ) THEN
    ALTER TABLE public.clock_settings ADD COLUMN ogn_source text;
  END IF;

  -- Update the default for new/existing rows to flightbook
  ALTER TABLE public.clock_settings ALTER COLUMN ogn_source SET DEFAULT 'flightbook';

  -- Migrate existing rows that are still on the legacy HTML source to flightbook
  UPDATE public.clock_settings
  SET ogn_source = 'flightbook'
  WHERE ogn_source IS NULL OR ogn_source = 'html';
END
$$;