import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { BookOpen, ChevronsUpDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { dateToUKShortLabel, todayUKDate } from "@/lib/uktime";

export const Route = createFileRoute("/logbook")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Logbook — ESGC Logs" }, { name: "description", content: "Pilot logbook with totals and filters." }] }),
  component: LogbookPage,
});

type Member = { id: string; full_name: string; membership_number: string };
type Flight = {
  id: string;
  flight_date: string;
  glider_registration: string | null;
  flarm_id: string | null;
  manual: boolean;
  launch_type: "aerotow" | "winch" | null;
  aerotow_height_ft: number | null;
  takeoff_time: string | null;
  landing_time: string | null;
  p1_name: string | null; p1_membership: string | null; p1_kind: string | null;
  p2_name: string | null; p2_membership: string | null; p2_kind: string | null;
  notes: string | null;
};

function durationMin(f: Flight): number {
  if (!f.takeoff_time || !f.landing_time) return 0;
  return Math.max(0, Math.round((+new Date(f.landing_time) - +new Date(f.takeoff_time)) / 60000));
}

function fmtHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function matchesPilot(f: Flight, m: Member): "P1" | "P2" | null {
  const memUp = m.membership_number.trim().toUpperCase();
  const nameUp = m.full_name.trim().toUpperCase();
  const p1m = (f.p1_membership || "").trim().toUpperCase();
  const p2m = (f.p2_membership || "").trim().toUpperCase();
  const p1n = (f.p1_name || "").trim().toUpperCase();
  const p2n = (f.p2_name || "").trim().toUpperCase();
  if (p1m === memUp || p1n === nameUp) return "P1";
  if (p2m === memUp || p2n === nameUp) return "P2";
  return null;
}

function LogbookPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [memberId, setMemberId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [filterLaunch, setFilterLaunch] = useState<"all" | "aerotow" | "winch">("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: f }] = await Promise.all([
        supabase.from("club_members").select("id, full_name, membership_number").order("full_name"),
        supabase.from("flights")
          .select("id, flight_date, glider_registration, flarm_id, manual, launch_type, aerotow_height_ft, takeoff_time, landing_time, p1_name, p1_membership, p1_kind, p1_charge, p2_name, p2_membership, p2_kind, p2_charge, notes")
          .neq("glider_registration", "G-ESGC")
          .order("flight_date", { ascending: false })
          .order("takeoff_time", { ascending: false, nullsFirst: false })
          .limit(20000),
      ]);
      setMembers((m as Member[]) ?? []);
      setFlights((f as Flight[]) ?? []);
      // Auto-pick the current user's member by email-name match if possible
      const { data: u } = await supabase.auth.getUser();
      const email = (u.user?.email || "").toLowerCase();
      const guess = (m as Member[] | null)?.find((x) => email.startsWith(x.full_name.split(" ")[0].toLowerCase()));
      if (guess) setMemberId(guess.id);
    })();
  }, []);

  const member = useMemo(() => members.find((m) => m.id === memberId) ?? null, [members, memberId]);

  const myFlights = useMemo(() => {
    if (!member) return [] as (Flight & { role: "P1" | "P2"; mins: number })[];
    return flights
      .map((f) => {
        const role = matchesPilot(f, member);
        if (!role) return null;
        return { ...f, role, mins: durationMin(f) };
      })
      .filter((x): x is Flight & { role: "P1" | "P2"; mins: number } => x !== null)
      .filter((f) => filterLaunch === "all" || f.launch_type === filterLaunch)
      .filter((f) => (!fromDate || f.flight_date >= fromDate) && (!toDate || f.flight_date <= toDate));
  }, [flights, member, filterLaunch, fromDate, toDate]);

  const totals = useMemo(() => {
    const t = { count: 0, mins: 0, aerotow: 0, winch: 0, p1: 0, p2: 0, gliders: new Set<string>(), thisYear: 0, last30: 0 };
    const yr = todayUKDate().slice(0, 4);
    const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const f of myFlights) {
      t.count++;
      t.mins += f.mins;
      if (f.launch_type === "aerotow") t.aerotow++;
      if (f.launch_type === "winch") t.winch++;
      if (f.role === "P1") t.p1++; else t.p2++;
      if (f.glider_registration) t.gliders.add(f.glider_registration.toUpperCase());
      if (f.flight_date.startsWith(yr)) t.thisYear++;
      if (f.flight_date >= cutoffStr) t.last30++;
    }
    return t;
  }, [myFlights]);

  const filteredMembers = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return members.slice(0, 50);
    return members.filter((m) =>
      m.full_name.toLowerCase().includes(q) || m.membership_number.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [members, pickerQuery]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">Pilot logbook</h1>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Pilot &amp; filters</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-2">
            <Label>Pilot</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between mt-1 font-normal">
                  <span className="truncate">{member ? `${member.full_name} (${member.membership_number})` : "Select pilot…"}</span>
                  <ChevronsUpDown className="size-4 opacity-60 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(92vw,360px)] p-2" align="start">
                <Input autoFocus placeholder="Search name or member #" value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} />
                <div className="mt-2 max-h-64 overflow-auto">
                  {filteredMembers.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setMemberId(m.id); setPickerOpen(false); setPickerQuery(""); }}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-accent text-sm"
                    >
                      <div className="font-medium">{m.full_name}</div>
                      <div className="text-xs text-muted-foreground">{m.membership_number}</div>
                    </button>
                  ))}
                  {filteredMembers.length === 0 && (
                    <div className="text-sm text-muted-foreground p-2">No members</div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label>Launch</Label>
            <select
              className="w-full h-9 mt-1 rounded-md border bg-background px-2 text-sm"
              value={filterLaunch}
              onChange={(e) => setFilterLaunch(e.target.value as typeof filterLaunch)}
            >
              <option value="all">All</option>
              <option value="aerotow">Aerotow</option>
              <option value="winch">Winch</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>From</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {member && (
        <>
          <Card className="overflow-hidden">
            <CardContent className="p-5 sm:p-6 flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Logbook total</div>
                <div className="text-4xl sm:text-5xl font-bold tabular-nums leading-none mt-1">
                  {fmtHM(totals.mins)}
                </div>
              </div>
              <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span><b className="text-foreground tabular-nums">{totals.count}</b> flights</span>
                <span>·</span>
                <span><b className="text-foreground tabular-nums">{totals.p1}</b> P1 / <b className="text-foreground tabular-nums">{totals.p2}</b> P2</span>
                <span>·</span>
                <span><b className="text-foreground tabular-nums">{totals.thisYear}</b> this year</span>
                <span>·</span>
                <span><b className="text-foreground tabular-nums">{totals.last30}</b> last 30d</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <StatCard label="Flights" value={String(totals.count)} />
            <StatCard label="Total time" value={fmtHM(totals.mins)} />
            <StatCard label="P1 / P2" value={`${totals.p1} / ${totals.p2}`} />
            <StatCard label="Aerotow / Winch" value={`${totals.aerotow} / ${totals.winch}`} />
            <StatCard label="This year" value={String(totals.thisYear)} />
            <StatCard label="Last 30 days" value={String(totals.last30)} />
            <StatCard label="Gliders flown" value={String(totals.gliders.size)} />
            <StatCard label="Avg flight" value={totals.count ? fmtHM(Math.round(totals.mins / totals.count)) : "—"} />
          </div>

          <Card>
            <CardHeader><CardTitle>Flights ({myFlights.length})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table className="min-w-[680px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Glider</TableHead>
                    <TableHead>Launch</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Other pilot</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myFlights.map((f) => {
                    const other = f.role === "P1" ? f.p2_name : f.p1_name;
                    return (
                      <TableRow key={f.id}>
                        <TableCell>{dateToUKShortLabel(f.flight_date)}</TableCell>
                        <TableCell className="font-mono">{f.glider_registration || "—"}</TableCell>
                        <TableCell>
                          {f.launch_type === "aerotow"
                            ? <Badge variant="secondary">Aerotow {f.aerotow_height_ft ?? "?"}ft</Badge>
                            : f.launch_type === "winch"
                            ? <Badge variant="outline">Winch</Badge>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell><Badge>{f.role}</Badge></TableCell>
                        <TableCell>{other || <span className="text-muted-foreground">solo</span>}</TableCell>
                        <TableCell className="text-right font-mono">{f.mins ? fmtHM(f.mins) : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            onClick={async () => {
                              if (!confirm(`Delete this flight on ${dateToUKShortLabel(f.flight_date)}? This removes it from the daily log as well.`)) return;
                              if (!f.manual) {
                                await supabase.from("flight_tombstones").insert({
                                  flight_date: f.flight_date,
                                  flarm_id: f.flarm_id,
                                  glider_registration: f.glider_registration,
                                  takeoff_time: f.takeoff_time,
                                  landing_time: f.landing_time,
                                });
                              }
                              const { error } = await supabase.from("flights").delete().eq("id", f.id);
                              if (error) { toast.error(error.message); return; }
                              setFlights((prev) => prev.filter((x) => x.id !== f.id));
                              toast.success("Flight deleted");
                            }}
                            aria-label="Delete flight"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {myFlights.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No flights for this pilot in range.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {!member && (
        <p className="text-muted-foreground text-sm">Select a pilot to view their logbook.</p>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
