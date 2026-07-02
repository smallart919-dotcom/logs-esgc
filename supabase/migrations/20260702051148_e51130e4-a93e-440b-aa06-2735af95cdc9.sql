ALTER TABLE public.clock_settings
ADD COLUMN IF NOT EXISTS ogn_source TEXT NOT NULL DEFAULT 'html'
CHECK (ogn_source IN ('html', 'flightbook'));