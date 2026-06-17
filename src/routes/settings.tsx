import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Settings as SettingsIcon } from "lucide-react";
import { fmtOffset } from "@/lib/clock-offset";
import { fmtUKDate, todayUKDate } from "@/lib/uktime";
import { EmailSettingsCard } from "@/components/email-settings-card";
import { QaChecklistCard } from "@/components/qa-checklist-card";

export const Route = createFileRoute("/settings")({
  beforeLoad: async () => {
    await requireAuth();
    const { data } = await supabase.auth.getUser();
    if ((data.user?.email || "").toLowerCase() !== "office@esgc.local") {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({ meta: [{ title: "Settings — ESGC Logs" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [permanent, setPermanent] = useState(0);
  const [permInput, setPermInput] = useState("0");
  const [savingPerm, setSavingPerm] = useState(false);
  const [caravanCanEdit, setCaravanCanEdit] = useState(true);
  const [savingCaravan, setSavingCaravan] = useState(false);
  const [caravanAudit, setCaravanAudit] = useState<{ at: string | null; by: string | null }>({ at: null, by: null });

  const todayStr = todayUKDate();
  const [date, setDate] = useState(todayStr);
  const [override, setOverride] = useState<number | null>(null);
  const [overInput, setOverInput] = useState("");
  const [savingOver, setSavingOver] = useState(false);

  const loadPerm = async () => {
    const { data } = await supabase.from("clock_settings").select("permanent_offset_seconds, caravan_can_edit, updated_at, updated_by").eq("id", 1).maybeSingle();
    const sec = data?.permanent_offset_seconds ?? 0;
    setPermanent(sec);
    setPermInput(String(Math.round(sec / 60)));
    setCaravanCanEdit(data?.caravan_can_edit ?? true);
    let byName: string | null = null;
    if (data?.updated_by) {
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", data.updated_by).maybeSingle();
      byName = prof?.full_name ?? null;
    }
    setCaravanAudit({ at: data?.updated_at ?? null, by: byName });
  };
  const loadOver = async (d: string) => {
    const { data } = await supabase.from("clock_offsets").select("offset_seconds").eq("flight_date", d).maybeSingle();
    const o = data ? data.offset_seconds : null;
    setOverride(o);
    setOverInput(o === null ? "" : String(Math.round(o / 60)));
  };

  useEffect(() => { loadPerm(); }, []);
  useEffect(() => { loadOver(date); }, [date]);

  const savePerm = async () => {
    const n = parseInt(permInput, 10);
    if (Number.isNaN(n)) { toast.error("Enter minutes as a number"); return; }
    setSavingPerm(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("clock_settings").update({
      permanent_offset_seconds: n * 60, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString(),
    }).eq("id", 1);
    setSavingPerm(false);
    if (error) toast.error(error.message); else { toast.success("Permanent offset saved"); loadPerm(); }
  };
  const clearPerm = async () => {
    setSavingPerm(true);
    const { error } = await supabase.from("clock_settings").update({
      permanent_offset_seconds: 0, updated_at: new Date().toISOString(),
    }).eq("id", 1);
    setSavingPerm(false);
    if (error) toast.error(error.message); else { toast.success("Permanent offset cleared"); loadPerm(); }
  };

  const saveOver = async () => {
    const n = parseInt(overInput, 10);
    if (Number.isNaN(n)) { toast.error("Enter minutes as a number"); return; }
    setSavingOver(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("clock_offsets").upsert({
      flight_date: date, offset_seconds: n * 60, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "flight_date" });
    setSavingOver(false);
    if (error) toast.error(error.message); else { toast.success(`Offset for ${fmtUKDate(date)} saved`); loadOver(date); }
  };
  const clearOver = async () => {
    setSavingOver(true);
    const { error } = await supabase.from("clock_offsets").delete().eq("flight_date", date);
    setSavingOver(false);
    if (error) toast.error(error.message); else { toast.success("Override cleared"); loadOver(date); }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <SettingsIcon className="size-6 md:size-7 text-primary" /> Settings
        </h1>
        <p className="text-sm text-muted-foreground">Office-only controls.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permanent clock offset</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Applied to every day's flight times unless that day has a per-date override below.
            Currently: <Badge variant={permanent ? "default" : "outline"}>{fmtOffset(permanent)}</Badge>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Offset (minutes, can be negative)</Label>
              <Input type="number" value={permInput} onChange={(e) => setPermInput(e.target.value)} className="w-40" />
            </div>
            <Button onClick={savePerm} disabled={savingPerm} size="sm">Save</Button>
            <Button onClick={clearPerm} disabled={savingPerm} variant="outline" size="sm">Clear to 0</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Caravan account permissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Caravan can edit the daily clock offset:{" "}
            <Badge variant={caravanCanEdit ? "default" : "outline"}>{caravanCanEdit ? "Allowed" : "Restricted"}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={caravanCanEdit ? "outline" : "default"}
              disabled={savingCaravan || !caravanCanEdit}
              onClick={async () => {
                setSavingCaravan(true);
                const { data: u } = await supabase.auth.getUser();
                const { error } = await supabase.from("clock_settings").update({
                  caravan_can_edit: false, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString(),
                }).eq("id", 1);
                setSavingCaravan(false);
                if (error) toast.error(error.message); else { toast.success("Caravan editing restricted"); loadPerm(); }
              }}
            >Restrict caravan</Button>
            <Button
              size="sm"
              variant={caravanCanEdit ? "default" : "outline"}
              disabled={savingCaravan || caravanCanEdit}
              onClick={async () => {
                setSavingCaravan(true);
                const { data: u } = await supabase.auth.getUser();
                const { error } = await supabase.from("clock_settings").update({
                  caravan_can_edit: true, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString(),
                }).eq("id", 1);
                setSavingCaravan(false);
                if (error) toast.error(error.message); else { toast.success("Caravan editing allowed"); loadPerm(); }
              }}
            >Allow caravan</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            When restricted, the caravan account sees the offset as read-only on the daily log.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-date offset override</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            </div>
            <div>
              <Label className="text-xs">Offset (minutes)</Label>
              <Input type="number" value={overInput} onChange={(e) => setOverInput(e.target.value)} className="w-40"
                placeholder={override === null ? "(no override)" : ""} />
            </div>
            <Button onClick={saveOver} disabled={savingOver} size="sm">Save override</Button>
            <Button onClick={clearOver} disabled={savingOver || override === null} variant="outline" size="sm">
              Clear override
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            {override === null
              ? `No override for ${fmtUKDate(date)} — falls back to permanent (${fmtOffset(permanent)}).`
              : `Override active for ${fmtUKDate(date)}: ${fmtOffset(override)}.`}
          </div>
        </CardContent>
      </Card>

      <EmailSettingsCard />
      <QaChecklistCard />
    </div>
  );
}
