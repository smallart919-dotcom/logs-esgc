import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { Download, Plus, RefreshCw, Pencil, Trash2, Plane, ChevronsUpDown } from "lucide-react";
import * as XLSX from "xlsx";
import { format } from "date-fns";

export const Route = createFileRoute("/")({
  beforeLoad: requireAuth,
  component: FlightsPage,
});

type Flight = {
  id: string; flight_date: string;
  glider_id: string | null; glider_registration: string | null; flarm_id: string | null;
  takeoff_time: string | null; landing_time: string | null;
  p1_name: string | null; p1_membership: string | null;
  p2_name: string | null; p2_membership: string | null;
  launch_type: "aerotow" | "winch" | null;
  aerotow_height_ft: number | null;
  manual: boolean; notes: string | null;
};
type Glider = { id: string; registration: string; callsign: string | null; flarm_id: string | null; glider_type: string | null };
type Member = { id: string; full_name: string; membership_number: string };

const todayStr = () => format(new Date(), "yyyy-MM-dd");

function FlightsPage() {
  const [date, setDate] = useState(todayStr());
  const [flights, setFlights] = useState<Flight[]>([]);
  const [gliders, setGliders] = useState<Glider[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<Flight | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [{ data: f }, { data: g }, { data: m }] = await Promise.all([
      supabase.from("flights").select("*").eq("flight_date", date).order("takeoff_time", { ascending: true, nullsFirst: false }),
      supabase.from("fleet_gliders").select("*").order("registration"),
      supabase.from("club_members").select("*").order("full_name"),
    ]);
    setFlights((f as Flight[]) ?? []);
    setGliders((g as Glider[]) ?? []);
    setMembers((m as Member[]) ?? []);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  // Realtime updates for the day
  useEffect(() => {
    const ch = supabase.channel("flights-rt").on("postgres_changes",
      { event: "*", schema: "public", table: "flights" }, () => load()
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const syncOgn = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/public/hooks/ogn-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sync failed");
      toast.success(`OGN sync: ${j.created} new, ${j.updated} updated`);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSyncing(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this flight?")) return;
    const { error } = await supabase.from("flights").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  };

  const exportXlsx = () => {
    const rows = flights.map((f, i) => ({
      "#": i + 1,
      Date: f.flight_date,
      Glider: f.glider_registration || "",
      "FLARM ID": f.flarm_id || "",
      "Takeoff (UTC)": f.takeoff_time ? format(new Date(f.takeoff_time), "HH:mm:ss") : "",
      "Landing (UTC)": f.landing_time ? format(new Date(f.landing_time), "HH:mm:ss") : "",
      "Duration (min)": f.takeoff_time && f.landing_time
        ? Math.round((+new Date(f.landing_time) - +new Date(f.takeoff_time)) / 60000)
        : "",
      "P1 Name": f.p1_name || "",
      "P1 Membership #": f.p1_membership || "",
      "P2 Name": f.p2_name || "",
      "P2 Membership #": f.p2_membership || "",
      Launch: f.launch_type || "",
      "Tow Height (ft)": f.aerotow_height_ft ?? "",
      Source: f.manual ? "Manual" : "OGN",
      Notes: f.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Flights");
    XLSX.writeFile(wb, `daily-log-${date}.xlsx`);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Plane className="size-7 text-primary" /> Daily Flight Log</h1>
          <p className="text-muted-foreground">OGN-fed flights for your club fleet. Add pilot details and export.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          </div>
          <Button onClick={syncOgn} disabled={syncing} variant="secondary">
            <RefreshCw className={`size-4 mr-1 ${syncing ? "animate-spin" : ""}`} />Sync OGN
          </Button>
          <Button onClick={exportXlsx} variant="outline"><Download className="size-4 mr-1" />Export XLSX</Button>
          <Button onClick={() => setAdding(true)}><Plus className="size-4 mr-1" />Add manual</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>{flights.length} flights on {date}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Glider</TableHead><TableHead>Takeoff</TableHead><TableHead>Landing</TableHead>
              <TableHead>Dur</TableHead><TableHead>P1</TableHead><TableHead>P2</TableHead>
              <TableHead>Launch</TableHead><TableHead>Source</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {flights.map((f) => {
                const dur = f.takeoff_time && f.landing_time
                  ? Math.round((+new Date(f.landing_time) - +new Date(f.takeoff_time)) / 60000) + "m"
                  : f.takeoff_time ? "in air" : "—";
                return (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">
                      {f.glider_registration || <span className="text-muted-foreground">unknown</span>}
                      {f.flarm_id && <div className="text-xs font-mono text-muted-foreground">{f.flarm_id}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{f.takeoff_time ? format(new Date(f.takeoff_time), "HH:mm") : "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{f.landing_time ? format(new Date(f.landing_time), "HH:mm") : "—"}</TableCell>
                    <TableCell className="text-sm">{dur}</TableCell>
                    <TableCell>{f.p1_name ? <div><div>{f.p1_name}</div><div className="text-xs text-muted-foreground">{f.p1_membership}</div></div> : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                    <TableCell>{f.p2_name ? <div><div>{f.p2_name}</div><div className="text-xs text-muted-foreground">{f.p2_membership}</div></div> : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                    <TableCell>
                      {f.launch_type ? (
                        <Badge variant="secondary">
                          {f.launch_type}{f.launch_type === "aerotow" && f.aerotow_height_ft ? ` ${f.aerotow_height_ft}ft` : ""}
                        </Badge>
                      ) : <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell><Badge variant={f.manual ? "outline" : "default"}>{f.manual ? "Manual" : "OGN"}</Badge></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(f)}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(f.id)}><Trash2 className="size-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {flights.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                No flights yet. Click <strong>Sync OGN</strong> or <strong>Add manual</strong>.
              </TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <FlightDialog
        open={!!editing || adding}
        onOpenChange={(o) => { if (!o) { setEditing(null); setAdding(false); } }}
        flight={editing}
        manual={adding}
        date={date}
        gliders={gliders}
        members={members}
        onSaved={() => { setEditing(null); setAdding(false); load(); }}
      />
    </div>
  );
}

function FlightDialog({
  open, onOpenChange, flight, manual, date, gliders, members, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  flight: Flight | null; manual: boolean; date: string;
  gliders: Glider[]; members: Member[]; onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Flight>>({});

  useEffect(() => {
    if (flight) setForm(flight);
    else if (manual) setForm({
      flight_date: date, manual: true, launch_type: "aerotow",
      glider_id: null, glider_registration: "", flarm_id: "",
      takeoff_time: null, landing_time: null,
      p1_name: "", p1_membership: "", p2_name: "", p2_membership: "",
      aerotow_height_ft: 2000, notes: "",
    });
  }, [flight, manual, date, open]);

  const setPilot = (which: 1 | 2, name: string, membership: string) => {
    setForm((f) => ({ ...f, [`p${which}_name`]: name, [`p${which}_membership`]: membership }));
  };

  const save = async () => {
    const payload: any = {
      flight_date: form.flight_date || date,
      glider_id: form.glider_id || null,
      glider_registration: form.glider_registration || null,
      flarm_id: form.flarm_id || null,
      takeoff_time: form.takeoff_time || null,
      landing_time: form.landing_time || null,
      p1_name: form.p1_name || null, p1_membership: form.p1_membership || null,
      p2_name: form.p2_name || null, p2_membership: form.p2_membership || null,
      launch_type: form.launch_type || null,
      aerotow_height_ft: form.launch_type === "aerotow" ? (form.aerotow_height_ft ?? null) : null,
      manual: !!form.manual,
      notes: form.notes || null,
    };
    let error;
    if (flight?.id) ({ error } = await supabase.from("flights").update(payload).eq("id", flight.id));
    else ({ error } = await supabase.from("flights").insert(payload));
    if (error) toast.error(error.message); else { toast.success("Saved"); onSaved(); }
  };

  // local time -> ISO helper
  const toLocalInput = (iso: string | null | undefined) => iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "";
  const fromLocal = (s: string) => s ? new Date(s).toISOString() : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{flight ? "Edit flight" : "Add manual flight"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label>Glider</Label>
            <GliderPicker
              gliders={gliders}
              registration={form.glider_registration ?? ""}
              onSelect={(g) => setForm({ ...form, glider_id: g?.id ?? null, glider_registration: g?.registration ?? form.glider_registration, flarm_id: g?.flarm_id ?? form.flarm_id })}
              onChangeText={(t) => setForm({ ...form, glider_registration: t, glider_id: null })}
            />
          </div>
          <div>
            <Label>Takeoff time</Label>
            <Input type="datetime-local" value={toLocalInput(form.takeoff_time)} onChange={(e) => setForm({ ...form, takeoff_time: fromLocal(e.target.value) })} />
          </div>
          <div>
            <Label>Landing time</Label>
            <Input type="datetime-local" value={toLocalInput(form.landing_time)} onChange={(e) => setForm({ ...form, landing_time: fromLocal(e.target.value) })} />
          </div>

          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 p-3 rounded-lg bg-secondary/40">
            <div className="md:col-span-2 font-semibold text-sm">P1 (Pilot in command)</div>
            <PilotPicker label="Name" members={members} value={form.p1_name ?? ""}
              onPick={(m) => setPilot(1, m.full_name, m.membership_number)}
              onText={(t) => setForm({ ...form, p1_name: t })} />
            <div><Label>Membership #</Label><Input value={form.p1_membership ?? ""} onChange={(e) => setForm({ ...form, p1_membership: e.target.value })} /></div>
          </div>
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 p-3 rounded-lg bg-secondary/40">
            <div className="md:col-span-2 font-semibold text-sm">P2 (Second pilot)</div>
            <PilotPicker label="Name" members={members} value={form.p2_name ?? ""}
              onPick={(m) => setPilot(2, m.full_name, m.membership_number)}
              onText={(t) => setForm({ ...form, p2_name: t })} />
            <div><Label>Membership #</Label><Input value={form.p2_membership ?? ""} onChange={(e) => setForm({ ...form, p2_membership: e.target.value })} /></div>
          </div>

          <div>
            <Label>Launch type</Label>
            <Select value={form.launch_type ?? ""} onValueChange={(v) => setForm({ ...form, launch_type: v as any })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="aerotow">Aerotow</SelectItem>
                <SelectItem value="winch">Winch</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.launch_type === "aerotow" && (
            <div>
              <Label>Tow release height (ft)</Label>
              <Select value={String(form.aerotow_height_ft ?? "")} onValueChange={(v) => setForm({ ...form, aerotow_height_ft: parseInt(v) })}>
                <SelectTrigger><SelectValue placeholder="Select height" /></SelectTrigger>
                <SelectContent>
                  {[1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000].map((h) => (
                    <SelectItem key={h} value={String(h)}>{h} ft</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="md:col-span-2">
            <Label>Notes</Label>
            <Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GliderPicker({ gliders, registration, onSelect, onChangeText }: {
  gliders: Glider[]; registration: string;
  onSelect: (g: Glider | null) => void; onChangeText: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="justify-between min-w-[200px]">
            {registration || "Pick from fleet…"}
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[300px]">
          <Command>
            <CommandInput placeholder="Search registration / callsign…" />
            <CommandList>
              <CommandEmpty>No matches</CommandEmpty>
              <CommandGroup>
                {gliders.map((g) => (
                  <CommandItem key={g.id} value={`${g.registration} ${g.callsign} ${g.flarm_id}`}
                    onSelect={() => { onSelect(g); setOpen(false); }}>
                    <div>
                      <div className="font-medium">{g.registration} {g.callsign && <span className="text-muted-foreground">({g.callsign})</span>}</div>
                      <div className="text-xs text-muted-foreground">{g.glider_type || ""} {g.flarm_id ? `· ${g.flarm_id}` : "· no FLARM"}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input placeholder="Or type registration manually" value={registration} onChange={(e) => onChangeText(e.target.value)} />
    </div>
  );
}

function PilotPicker({ label, members, value, onPick, onText }: {
  label: string; members: Member[]; value: string;
  onPick: (m: Member) => void; onText: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => members.filter((m) => m.full_name.toLowerCase().includes(value.toLowerCase())).slice(0, 8), [members, value]);
  return (
    <div>
      <Label>{label}</Label>
      <Popover open={open && filtered.length > 0} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Input value={value} onFocus={() => setOpen(true)} onChange={(e) => { onText(e.target.value); setOpen(true); }} placeholder="Type or select…" />
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[280px]" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
          <Command>
            <CommandList>
              <CommandGroup>
                {filtered.map((m) => (
                  <CommandItem key={m.id} value={m.full_name} onSelect={() => { onPick(m); setOpen(false); }}>
                    <div>
                      <div>{m.full_name}</div>
                      <div className="text-xs text-muted-foreground">#{m.membership_number}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
