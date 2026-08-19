ALTER TABLE public.daily_gfes
  ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cancel_reason text;