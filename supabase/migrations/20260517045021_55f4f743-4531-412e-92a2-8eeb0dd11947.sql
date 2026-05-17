-- Clean up existing duplicate automated OGN rows before adding safeguards.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        flight_date,
        upper(trim(coalesce(glider_registration, ''))),
        CASE
          WHEN takeoff_time IS NOT NULL THEN 'takeoff:' || takeoff_time::text
          WHEN landing_time IS NOT NULL THEN 'landing:' || landing_time::text
          ELSE 'notime'
        END
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.flights
  WHERE manual = false
    AND glider_registration IS NOT NULL
    AND trim(glider_registration) <> ''
)
DELETE FROM public.flights f
USING ranked r
WHERE f.id = r.id
  AND r.rn > 1;

-- One automated OGN row per glider/takeoff timestamp.
CREATE UNIQUE INDEX IF NOT EXISTS flights_ogn_unique_takeoff_time_idx
ON public.flights (
  flight_date,
  upper(trim(glider_registration)),
  takeoff_time
)
WHERE manual = false
  AND glider_registration IS NOT NULL
  AND trim(glider_registration) <> ''
  AND takeoff_time IS NOT NULL;

-- One automated OGN row per glider/landing timestamp when no takeoff is available.
CREATE UNIQUE INDEX IF NOT EXISTS flights_ogn_unique_landing_time_idx
ON public.flights (
  flight_date,
  upper(trim(glider_registration)),
  landing_time
)
WHERE manual = false
  AND glider_registration IS NOT NULL
  AND trim(glider_registration) <> ''
  AND takeoff_time IS NULL
  AND landing_time IS NOT NULL;

-- At most one no-time automated placeholder per glider/date.
CREATE UNIQUE INDEX IF NOT EXISTS flights_ogn_unique_no_time_idx
ON public.flights (
  flight_date,
  upper(trim(glider_registration))
)
WHERE manual = false
  AND glider_registration IS NOT NULL
  AND trim(glider_registration) <> ''
  AND takeoff_time IS NULL
  AND landing_time IS NULL;

CREATE INDEX IF NOT EXISTS flights_daily_takeoff_idx
ON public.flights (flight_date, takeoff_time);

CREATE INDEX IF NOT EXISTS flight_tombstones_daily_time_idx
ON public.flight_tombstones (flight_date, takeoff_time, landing_time);