
CREATE TABLE public.email_settings (
  id integer PRIMARY KEY DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  to_email text NOT NULL DEFAULT 'office@sussexgliding.co.uk',
  subject_template text NOT NULL DEFAULT 'Logs {date}',
  body_template text NOT NULL DEFAULT E'Please find today''s logs attached via the link below:\n\n{link}\n\nFrom Caravan, have a good evening.',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT email_settings_singleton CHECK (id = 1)
);

INSERT INTO public.email_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_settings read all" ON public.email_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "email_settings update office" ON public.email_settings
  FOR UPDATE TO authenticated USING (public.is_office()) WITH CHECK (public.is_office());
