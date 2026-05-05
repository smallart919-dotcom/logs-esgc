ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS p1_kind text,
  ADD COLUMN IF NOT EXISTS p2_kind text;