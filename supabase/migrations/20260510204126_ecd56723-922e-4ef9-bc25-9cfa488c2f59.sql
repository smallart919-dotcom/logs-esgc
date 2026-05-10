ALTER TABLE public.club_members
  ADD COLUMN IF NOT EXISTS currency_aerotow_override date,
  ADD COLUMN IF NOT EXISTS currency_winch_override date;