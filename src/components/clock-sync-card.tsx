import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { computeOffsetFromCaravanHHMM, fmtOffset, useDayOffset } from "@/lib/clock-offset";
import { fmtUKDate } from "@/lib/uktime";

/** A small card on the daily log letting the user sync the day's offset
 * to the caravan clock. Disabled for the caravan account. */
export function ClockSyncCard({ date, isCaravan }: { date: string; isCaravan: boolean }) {
  const { offsetSec, permanent, override, caravanCanEdit, refresh } = useDayOffset(date);
  const [caravan, setCaravan] = useState("");
  const [saving, setSaving] = useState(false);

  const sync = async () => {
    const diff = computeOffsetFromCaravanHHMM(caravan.trim());
    if (diff === null) { toast.error("Enter caravan time as HH:mm"); return; }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("clock_offsets").upsert({
      flight_date: date, offset_seconds: diff, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "flight_date" });
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success(`Offset set: ${fmtOffset(diff)}`); setCaravan(""); refresh(); }
  };

  const clearToday = async () => {
    const { error } = await supabase.from("clock_offsets").delete().eq("flight_date", date);
    if (error) toast.error(error.message); else { toast.success("Today's offset cleared"); refresh(); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="size-4 text-primary" /> Caravan clock sync — {fmtUKDate(date)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(() => { const locked = isCaravan && !caravanCanEdit; return (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={offsetSec ? "default" : "outline"}>Effective offset: {fmtOffset(offsetSec)}</Badge>
              {override !== null && <Badge variant="secondary">Today override</Badge>}
              {permanent !== 0 && override === null && <Badge variant="outline">Permanent {fmtOffset(permanent)}</Badge>}
              {locked && <Badge variant="destructive">Restricted by office</Badge>}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label className="text-xs">Time shown on caravan clock</Label>
                <Input
                  type="time"
                  value={caravan}
                  onChange={(e) => setCaravan(e.target.value)}
                  className="w-32"
                  disabled={locked}
                />
              </div>
              <Button onClick={sync} disabled={locked || saving || !caravan} size="sm">
                {saving ? "Syncing…" : "Sync now"}
              </Button>
              {override !== null && (
                <Button onClick={clearToday} variant="ghost" size="sm" disabled={locked}>Clear today</Button>
              )}
            </div>
            {locked ? (
              <p className="text-xs text-muted-foreground">
                Editing the clock offset has been restricted by the office. Ask them to adjust it from Settings.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Read the caravan clock and type the time it currently shows. We'll record the difference and shift every flight time on {date} to match.
              </p>
            )}
          </>
        ); })()}
      </CardContent>
    </Card>
  );
}
