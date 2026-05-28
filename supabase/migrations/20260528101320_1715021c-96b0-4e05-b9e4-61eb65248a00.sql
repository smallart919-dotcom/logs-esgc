CREATE TABLE public.auto_send_log (
  flight_date date PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now(),
  message_id text,
  recipient text,
  flights_count integer NOT NULL DEFAULT 0,
  note text
);

GRANT SELECT ON public.auto_send_log TO authenticated;
GRANT ALL ON public.auto_send_log TO service_role;

ALTER TABLE public.auto_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Office can view auto-send log"
ON public.auto_send_log
FOR SELECT
TO authenticated
USING (public.is_office());
