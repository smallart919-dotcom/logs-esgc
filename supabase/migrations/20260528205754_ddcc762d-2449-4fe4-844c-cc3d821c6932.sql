ALTER TABLE public.email_settings ADD COLUMN IF NOT EXISTS cc_email text NOT NULL DEFAULT 'accounts@sussexgliding.co.uk';

ALTER TABLE public.help_content ADD COLUMN IF NOT EXISTS checklist_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.help_content ADD COLUMN IF NOT EXISTS checklist_items jsonb NOT NULL DEFAULT '[{"id":"sync","label":"DI & DP names synced"},{"id":"launch","label":"Launch type confirmed (aerotow / winch)"},{"id":"tow","label":"Tow height confirmed"}]'::jsonb;