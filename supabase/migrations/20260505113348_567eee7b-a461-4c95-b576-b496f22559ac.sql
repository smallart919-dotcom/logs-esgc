ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS p1_charge boolean NOT NULL DEFAULT false;
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS p2_charge boolean NOT NULL DEFAULT false;