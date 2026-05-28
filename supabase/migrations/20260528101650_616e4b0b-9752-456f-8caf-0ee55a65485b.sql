CREATE TABLE public.flight_audit (
  id bigserial PRIMARY KEY,
  flight_id uuid NOT NULL,
  flight_date date,
  glider_registration text,
  action text NOT NULL CHECK (action IN ('insert','update','delete')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  changed_by_email text,
  before_row jsonb,
  after_row jsonb,
  changed_fields text[]
);

CREATE INDEX flight_audit_changed_at_idx ON public.flight_audit (changed_at DESC);
CREATE INDEX flight_audit_flight_id_idx ON public.flight_audit (flight_id);
CREATE INDEX flight_audit_flight_date_idx ON public.flight_audit (flight_date);

GRANT SELECT ON public.flight_audit TO authenticated;
GRANT ALL ON public.flight_audit TO service_role;

ALTER TABLE public.flight_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Office can view audit log"
ON public.flight_audit
FOR SELECT
TO authenticated
USING (public.is_office());

CREATE OR REPLACE FUNCTION public.log_flight_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  email text := NULLIF(auth.jwt() ->> 'email', '');
  changed text[] := '{}';
  k text;
  before_j jsonb;
  after_j jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    after_j := to_jsonb(NEW);
    INSERT INTO public.flight_audit (flight_id, flight_date, glider_registration, action, changed_by, changed_by_email, before_row, after_row)
    VALUES (NEW.id, NEW.flight_date, NEW.glider_registration, 'insert', uid, email, NULL, after_j);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    before_j := to_jsonb(OLD);
    after_j := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(after_j) LOOP
      IF (before_j -> k) IS DISTINCT FROM (after_j -> k) AND k NOT IN ('updated_at') THEN
        changed := array_append(changed, k);
      END IF;
    END LOOP;
    IF array_length(changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.flight_audit (flight_id, flight_date, glider_registration, action, changed_by, changed_by_email, before_row, after_row, changed_fields)
    VALUES (NEW.id, NEW.flight_date, NEW.glider_registration, 'update', uid, email, before_j, after_j, changed);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    before_j := to_jsonb(OLD);
    INSERT INTO public.flight_audit (flight_id, flight_date, glider_registration, action, changed_by, changed_by_email, before_row, after_row)
    VALUES (OLD.id, OLD.flight_date, OLD.glider_registration, 'delete', uid, email, before_j, NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS flights_audit_trg ON public.flights;
CREATE TRIGGER flights_audit_trg
AFTER INSERT OR UPDATE OR DELETE ON public.flights
FOR EACH ROW EXECUTE FUNCTION public.log_flight_change();
