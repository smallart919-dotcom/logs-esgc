import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck } from "lucide-react";

type Step = { do: string; expect: string };
type Section = { title: string; tag?: string; steps: Step[] };

const SECTIONS: Section[] = [
  {
    title: "Autosave (Flight dialog)",
    tag: "Daily Logs",
    steps: [
      { do: "Open the dialog on an existing flight and edit a field (e.g. P2 name).", expect: "Within ~1.5s the change persists silently; the dialog stays open and you can keep editing." },
      { do: "Edit several fields in quick succession.", expect: "Only one save fires after you stop typing; no flicker, no dialog close." },
      { do: "Press the ✅ Save button.", expect: "Final save runs and the dialog closes." },
      { do: "Press Cancel/Escape after silent autosave.", expect: "The autosaved changes remain in the row (autosave is authoritative)." },
      { do: "Manual Add → fill fields → tab between inputs.", expect: "Autosave creates / updates the draft as you type; ✅ Save closes." },
    ],
  },
  {
    title: "OGN sync matching",
    tag: "Flights",
    steps: [
      { do: "Trigger OGN sync with one open in-air row for a registration, then deliver a landing for that reg.", expect: "Landing is paired into the existing row (no duplicate created)." },
      { do: "Create two open in-air rows for the same reg, then deliver a landing.", expect: "A NEW row is created for the landing (ambiguous match is not merged)." },
      { do: "Deliver a takeoff for a reg with one open in-air row missing takeoff time.", expect: "Takeoff is paired into that row." },
      { do: "Deliver a takeoff for a reg with multiple open in-air rows.", expect: "A new row is created — no risky merge." },
      { do: "Check audit log after each.", expect: "An entry exists describing pair vs create." },
    ],
  },
  {
    title: "Midnight email dedup",
    tag: "Auto-send",
    steps: [
      { do: "Hit /api/public/hooks/auto-send-logs twice in quick succession (cron retry simulation).", expect: "Second call sees the reservation and skips — only ONE email is sent." },
      { do: "Check auto_send_log table.", expect: "One row per (flight_date, recipient) per day; status = sent." },
      { do: "Disable auto-send in Email Settings, run hook.", expect: "Hook returns skipped (disabled)." },
      { do: "Run hook for a date with zero flights.", expect: "Hook skips — no empty email sent." },
    ],
  },
  {
    title: "Click n' Glide sync",
    tag: "GFE Card",
    steps: [
      { do: "Click \"Sync now\" on the GFE card.", expect: "Toast \"Synced N GFEs\"; list refreshes; \"Last sync\" timestamp updates." },
      { do: "On a second device, tick off a GFE.", expect: "Tick appears on the first device within ~1s (realtime)." },
      { do: "Tap a phone number badge.", expect: "OS dial prompt opens with the cleaned number." },
      { do: "Sync a date that has both glider and TMG bookings.", expect: "TMG GFEs render in their own section under \"TMG GFEs (G-KIAU)\"." },
      { do: "Trigger cron via /api/public/hooks/cng-sync with the CRON_SECRET header.", expect: "200 OK; without the header → 401." },
    ],
  },
  {
    title: "Proximity chime",
    tag: "Map + Global",
    steps: [
      { do: "On account A enable proximity alerts; on account B fly (or simulate) within range.", expect: "Account A chimes + notification fires, even while on /logs or /history (not /map)." },
      { do: "On /map page only.", expect: "Chime is suppressed (visual indicators handle it on-map)." },
      { do: "Trigger an aircraft from your own fleet.", expect: "No alert (own-fleet excluded)." },
    ],
  },
];

export function QaChecklistCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardCheck className="size-4" />
          End-to-end QA checklist
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Run through this whenever something is changed in autosave, OGN, midnight email, or CnG sync.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {SECTIONS.map((s) => (
          <section key={s.title} className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{s.title}</h3>
              {s.tag && <Badge variant="outline" className="text-[10px]">{s.tag}</Badge>}
            </div>
            <ol className="space-y-1.5 list-decimal list-inside text-sm">
              {s.steps.map((st, i) => (
                <li key={i} className="leading-snug">
                  <span>{st.do}</span>
                  <div className="ml-5 text-xs text-muted-foreground">→ {st.expect}</div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
