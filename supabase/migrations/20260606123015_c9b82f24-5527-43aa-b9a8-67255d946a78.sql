-- Push notification subscriptions (per-user, per-device)
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  notify_proximity boolean NOT NULL DEFAULT true,
  notify_own_fleet boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subscriptions own select" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "push_subscriptions own insert" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "push_subscriptions own update" ON public.push_subscriptions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "push_subscriptions own delete" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions(user_id);

-- NOTAMs / airspace activations (refreshed daily from NATS)
CREATE TABLE public.notams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notam_ref text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'notam', -- 'notam' | 'tra' | 'danger' | 'manual'
  centre_lat double precision NOT NULL,
  centre_lon double precision NOT NULL,
  radius_nm double precision,
  polygon jsonb,                       -- optional [[lat,lon],...] ring
  lower_ft integer,
  upper_ft integer,
  valid_from timestamptz,
  valid_to timestamptz,
  description text NOT NULL DEFAULT '',
  raw text,
  source text NOT NULL DEFAULT 'nats',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notams TO authenticated;
GRANT ALL ON public.notams TO service_role;
ALTER TABLE public.notams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notams read all auth" ON public.notams
  FOR SELECT TO authenticated USING (true);

CREATE INDEX notams_valid_idx ON public.notams(valid_from, valid_to);

CREATE TRIGGER set_notams_updated_at
  BEFORE UPDATE ON public.notams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();