-- Helper: detect caravan account
CREATE OR REPLACE FUNCTION public.is_caravan()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE id = auth.uid() AND lower(email) = 'caravan@esgc.local'
  )
$$;

-- Helper: is caravan currently allowed to edit offsets?
CREATE OR REPLACE FUNCTION public.caravan_offset_editing_allowed()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT caravan_can_edit FROM public.clock_settings WHERE id = 1), true)
$$;

-- Replace clock_offsets insert/update policies to block caravan when restricted
DROP POLICY IF EXISTS "clock_offsets insert office" ON public.clock_offsets;
DROP POLICY IF EXISTS "clock_offsets update office" ON public.clock_offsets;

CREATE POLICY "clock_offsets insert auth"
ON public.clock_offsets
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (NOT public.is_caravan() OR public.caravan_offset_editing_allowed())
);

CREATE POLICY "clock_offsets update auth"
ON public.clock_offsets
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (NOT public.is_caravan() OR public.caravan_offset_editing_allowed())
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (NOT public.is_caravan() OR public.caravan_offset_editing_allowed())
);
