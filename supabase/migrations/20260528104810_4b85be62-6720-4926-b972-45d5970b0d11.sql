CREATE TABLE IF NOT EXISTS public.help_content (
  id integer PRIMARY KEY DEFAULT 1,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT help_content_singleton CHECK (id = 1)
);

GRANT SELECT, INSERT, UPDATE ON public.help_content TO authenticated;
GRANT ALL ON public.help_content TO service_role;

ALTER TABLE public.help_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "help_content read all" ON public.help_content
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "help_content update office" ON public.help_content
  FOR UPDATE TO authenticated USING (is_office()) WITH CHECK (is_office());

CREATE POLICY "help_content insert office" ON public.help_content
  FOR INSERT TO authenticated WITH CHECK (is_office());

INSERT INTO public.help_content (id, body) VALUES (1,
$md$# Caravan — How to log flights

Welcome! This guide explains the day-to-day flow for keeping the log straight from the caravan.

## 1. Start the day
- Open **Flights** — it lands on today by default.
- Set the **Duty Instructor** and **Duty Pilot** at the top of the page.
- Tap **Caravan clock sync** and type the time shown on the caravan clock so all takeoff/landing times match.

## 2. Logging a flight
- New flights from OGN appear automatically when a glider takes off.
- Tap a flight row to fill in:
  - **Glider registration** (auto-detected when possible)
  - **P1 / P2** — pick *Member*, *GFE* or *Visitor* and add the name / membership number
  - **Launch type** — Winch or Aerotow (add aerotow height in ft)
  - **Charge ticks** — tick the pilot who pays
  - **Notes** — trial lesson, voucher number, training flight, etc.
- Add your initials in **Logged by**.

## 3. Manual entries
- If OGN missed a flight, tap **Add manual flight** and enter takeoff / landing times by hand.

## 4. End of day
- Check **Airborne** in the header reads 0 (it flashes red while nothing is up — that's expected once everyone has landed).
- Logs auto-send at **midnight UK** to the office. You can also tap **Send logs now** to send them early.

## 5. Tips
- Times are always UK local — the caravan offset handles any clock drift.
- GFEs sync from CNG automatically — check the GFE card to see today's list.
- Use **History** (office only) to fix anything from previous days.

If something looks off, ask the office — they can edit this guide too.
$md$)
ON CONFLICT (id) DO NOTHING;