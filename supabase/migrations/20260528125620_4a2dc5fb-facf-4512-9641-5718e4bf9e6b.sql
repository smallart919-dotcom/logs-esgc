CREATE OR REPLACE FUNCTION public.is_office()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid() AND lower(email) = 'office@esgc.local'
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'office'
  )
$$;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'office'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'office@esgc.local'
ON CONFLICT DO NOTHING;