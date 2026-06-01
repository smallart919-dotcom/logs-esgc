# ESGC Logs — Multi-feature update

## 1. GFE card improvements (`src/components/gfe-card.tsx`)
- Split into two sections: "Introductory Flights (GFE)" (`source=cng`) and "TMG GFEs" (`source=cng-tmg`)
- Sort each section by `time_text` (earliest first, nulls last)
- Show `Glider`/`TMG` counts in header badges
- Per-section completion counter (`n/total completed`)
- Extract `GfeRow` sub-component with a tick-off checkbox; ticked rows show line-through + 50% opacity
- Persist `checked` / `checked_at` to `daily_gfes`

## 2. Database migration
- Add `checked BOOLEAN DEFAULT false` and `checked_at TIMESTAMPTZ` to `daily_gfes`

## 3. Flight dialog autofill (`src/routes/index.tsx` + FlightDialog)
- Load `daily_gfes` for selected date alongside other queries
- Derive `cngGfeSuggestions` (glider) and `cngTmgSuggestions` (TMG) — unchecked passenger names
- Pass into `FlightDialog`; when pilot kind === "gfe", feed names to `PilotPicker.preferredNames`
  - Use TMG suggestions when glider is `G-KIAU`, else glider suggestions
- On save success: fuzzy-match flight passenger name to a `daily_gfes` row and auto-tick it

## 4. WhatsApp share (`src/routes/index.tsx` `shareWhatsApp`)
- Mobile: keep `navigator.share` file path
- Desktop fallback: auto-download xlsx, open `wa.me` with pre-typed message, show explicit "now attach the file" toast

## 5. Live Map (NEW route `/map`)
- Install `react-leaflet`, `leaflet`, `@types/leaflet`
- Fetch OGN (FLARM gliders) + ADS-B Exchange public globe endpoint in parallel; merge dedupe by reg
- Differentiated SVG icons per type (glider/powered/heli/own fleet), rotated by course
- Permanent airfield marker at Kitson Field with tooltip + popup
- Airspace GeoJSON overlay (`src/lib/airspace-ukrin.ts`): Shoreham ATZ, Gatwick CTR/CTA, Lydd ATZ
- Control panel: tile toggle (dark/light/satellite), airspace/own-fleet/stale toggles, live counts, status
- Polls every ~10s; marks aircraft `isStale` if pos > 60s old
- Tooltip CSS in `src/styles.css`

## 6. Navigation
- Add `Map` icon to top nav (`__root.tsx`) and dock (`mac-dock.tsx`) for all signed-in users

## Technical notes
- ADS-B Exchange public endpoint is rate-limited but key-free; `VITE_ADSB_KEY` optional via RapidAPI
- Airspace GeoJSON is approximated and labelled "situational awareness only"
- Migration runs first (separate tool call); types.ts regenerates automatically
- Sort by `time_text` uses string compare (HH:MM 24h format from CnG)
