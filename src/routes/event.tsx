import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PartyPopper, Plane, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { fmtUKDate } from "@/lib/uktime";

export const Route = createFileRoute("/event")({
  head: () => ({
    meta: [
      { title: "Event Day Planner — ESGC Logs" },
      { name: "description", content: "Plan Friends & Family Day: name each glider, set the pilot flying and slot every voucher passenger into a launch time." },
      { property: "og:title", content: "Event Day Planner — ESGC Logs" },
      { property: "og:description", content: "Assign voucher passengers to gliders and launch times for club event days." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EventPage,
});

type Glider = {
  id: string;
  flight_date: string;
  name: string;
  pilot_name: string | null;
  position: number;
};

type Gfe = {
  id: string;
  position: number;
  passenger_name: string | null;
  gfe_type: string | null;
  ref: string | null;
  time_text: string | null;
  cancelled: boolean;
  checked: boolean;
  assigned_glider_id: string | null;
  launch_time: string | null;
  weight_kg: number | null;
  member_name: string | null;
};

const UNASSIGNED = "__none__";
/** Friends & Family Day — the planner is only used for this one event day. */
const EVENT_DATE = "2026-08-22";

function EventPage() {
  const date = EVENT_DATE;
  const [gliders, setGliders] = useState<Glider[]>([]);
  const [gfes, setGfes] = useState<Gfe[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberNames, setMemberNames] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("club_members").select("full_name").order("full_name");
      setMemberNames(((data ?? []) as { full_name: string }[]).map((m) => m.full_name).filter(Boolean));
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: g }, { data: v }] = await Promise.all([
      supabase.from("event_gliders").select("*").eq("flight_date", date).order("position"),
      supabase.from("daily_gfes").select("*").eq("flight_date", date).order("position"),
    ]);
    setGliders((g ?? []) as Glider[]);
    setGfes((v ?? []) as unknown as Gfe[]);
    setLoading(false);
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  // Live updates across devices while the day is running.
  useEffect(() => {
    const ch = supabase
      .channel(`event-day-${date}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_gliders", filter: `flight_date=eq.${date}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_gfes", filter: `flight_date=eq.${date}` }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [date, load]);

  const addGlider = async () => {
    const position = (gliders.at(-1)?.position ?? 0) + 1;
    const { error } = await supabase
      .from("event_gliders")
      .insert({ flight_date: date, name: `Glider ${position}`, position });
    if (error) { toast.error(error.message); return; }
    toast.success("Glider added");
    void load();
  };

  const patchGlider = async (id: string, patch: Partial<Glider>) => {
    setGliders((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    const { error } = await supabase.from("event_gliders").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  };

  const removeGlider = async (id: string) => {
    const { error } = await supabase.from("event_gliders").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Glider removed");
    void load();
  };

  const patchGfe = async (id: string, patch: Partial<Gfe>) => {
    setGfes((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("daily_gfes").update(patch as never).eq("id", id);
    if (error) toast.error(error.message);
  };

  const live = useMemo(() => gfes.filter((r) => !r.cancelled), [gfes]);
  const unassigned = useMemo(
    () => live.filter((r) => !r.assigned_glider_id || !gliders.some((g) => g.id === r.assigned_glider_id)),
    [live, gliders],
  );
  const byGlider = useCallback(
    (id: string) =>
      live
        .filter((r) => r.assigned_glider_id === id)
        .sort((a, b) => (a.launch_time || "zz").localeCompare(b.launch_time || "zz")),
    [live],
  );

  const memberKey = (r: Gfe) => (r.member_name ?? "").trim();
  const groups = useMemo(() => {
    const map = new Map<string, Gfe[]>();
    for (const r of unassigned) {
      const k = memberKey(r) || "";
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()].sort((a, b) => (a[0] || "zzz").localeCompare(b[0] || "zzz"));
  }, [unassigned]);

  const assignGroup = async (rows: Gfe[], gliderId: string) => {
    setGfes((prev) => prev.map((r) => (rows.some((x) => x.id === r.id) ? { ...r, assigned_glider_id: gliderId } : r)));
    const { error } = await supabase
      .from("daily_gfes")
      .update({ assigned_glider_id: gliderId } as never)
      .in("id", rows.map((r) => r.id));
    if (error) toast.error(error.message);
    else toast.success("Group assigned");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <PartyPopper className="size-7 text-primary" /> Friends &amp; Family Day Planner
        </h1>
        <p className="text-muted-foreground">
          Friends &amp; Family Day only. Name each glider, set the pilot flying it, then slot each voucher
          passenger into a glider with their launch time and weight.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Badge className="text-sm">{fmtUKDate(date)}</Badge>
          <Badge variant="secondary">{live.length} flying</Badge>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {gliders.map((g) => {
          const list = byGlider(g.id);
          return (
            <Card key={g.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2"><Plane className="size-4 text-primary" /> Glider</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${g.name}`}
                    onClick={() => removeGlider(g.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`name-${g.id}`}>Glider name</Label>
                    <Input
                      id={`name-${g.id}`}
                      value={g.name}
                      placeholder="e.g. K21 G-CKLM"
                      onChange={(e) => setGliders((p) => p.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))}
                      onBlur={(e) => void patchGlider(g.id, { name: e.target.value.trim() || "Glider" })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`pilot-${g.id}`}>Pilot flying</Label>
                    <Input
                      id={`pilot-${g.id}`}
                      value={g.pilot_name ?? ""}
                      placeholder="Pilot name"
                      onChange={(e) => setGliders((p) => p.map((x) => (x.id === g.id ? { ...x, pilot_name: e.target.value } : x)))}
                      onBlur={(e) => void patchGlider(g.id, { pilot_name: e.target.value.trim() || null })}
                    />
                  </div>
                </div>

                <div className="rounded-lg border divide-y">
                  {list.length === 0 && (
                    <p className="p-3 text-sm text-muted-foreground">No passengers assigned yet.</p>
                  )}
                  {list.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 p-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{r.passenger_name || r.gfe_type || "Passenger"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[r.member_name ? `with ${r.member_name}` : null, r.ref, r.time_text, r.weight_kg ? `${r.weight_kg} kg` : null].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                      <Input
                        list="event-member-names"
                        aria-label="Club member they are flying with"
                        placeholder="Member"
                        className="w-[9rem]"
                        value={r.member_name ?? ""}
                        onChange={(e) => setGfes((p) => p.map((x) => (x.id === r.id ? { ...x, member_name: e.target.value } : x)))}
                        onBlur={(e) => void patchGfe(r.id, { member_name: e.target.value.trim() || null })}
                      />
                      <Input
                        type="time"
                        aria-label="Launch time"
                        className="w-[7.5rem]"
                        value={r.launch_time ?? ""}
                        onChange={(e) => void patchGfe(r.id, { launch_time: e.target.value || null })}
                      />
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={200}
                        aria-label="Passenger weight in kilograms"
                        placeholder="kg"
                        className="w-[5.5rem]"
                        value={r.weight_kg ?? ""}
                        onChange={(e) =>
                          void patchGfe(r.id, { weight_kg: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                      <Button variant="ghost" size="sm" onClick={() => void patchGfe(r.id, { assigned_glider_id: null })}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button onClick={addGlider} variant="outline" className="gap-2">
        <Plus className="size-4" /> Add glider
      </Button>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-primary" /> Passengers to assign
            <Badge variant="secondary">{unassigned.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && unassigned.length === 0 && (
            <p className="text-sm text-muted-foreground">Everyone is assigned to a glider.</p>
          )}
          {groups.map(([member, rows]) => (
            <div key={member || "__no_member__"} className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1.5">
                <span className="text-sm font-medium">
                  {member || "No member linked"}
                </span>
                <Badge variant="secondary">{rows.length}</Badge>
                {gliders.length > 0 && member && (
                  <Select onValueChange={(v) => void assignGroup(rows, v)}>
                    <SelectTrigger className="ml-auto w-[12rem]" aria-label={`Assign all of ${member} to a glider`}>
                      <SelectValue placeholder="Assign whole group" />
                    </SelectTrigger>
                    <SelectContent>
                      {gliders.map((g) => (
                        <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="divide-y">
                {rows.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.passenger_name || r.gfe_type || "Passenger"}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[r.ref, r.time_text].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <Input
                      list="event-member-names"
                      aria-label="Club member they are flying with"
                      placeholder="Member name"
                      className="w-[11rem]"
                      value={r.member_name ?? ""}
                      onChange={(e) => setGfes((p) => p.map((x) => (x.id === r.id ? { ...x, member_name: e.target.value } : x)))}
                      onBlur={(e) => void patchGfe(r.id, { member_name: e.target.value.trim() || null })}
                    />
                    <Select
                      value={r.assigned_glider_id ?? UNASSIGNED}
                      onValueChange={(v) => void patchGfe(r.id, { assigned_glider_id: v === UNASSIGNED ? null : v })}
                    >
                      <SelectTrigger className="w-[11rem]" aria-label="Assign to glider">
                        <SelectValue placeholder="Assign to glider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {gliders.map((g) => (
                          <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="time"
                      aria-label="Launch time"
                      className="w-[7.5rem]"
                      value={r.launch_time ?? ""}
                      onChange={(e) => void patchGfe(r.id, { launch_time: e.target.value || null })}
                    />
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={200}
                      aria-label="Passenger weight in kilograms"
                      placeholder="kg"
                      className="w-[5.5rem]"
                      value={r.weight_kg ?? ""}
                      onChange={(e) =>
                        void patchGfe(r.id, { weight_kg: e.target.value === "" ? null : Number(e.target.value) })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <datalist id="event-member-names">
            {memberNames.map((n) => <option key={n} value={n} />)}
          </datalist>
          {gliders.length === 0 && (
            <p className="text-xs text-muted-foreground">Add a glider first to start assigning.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
