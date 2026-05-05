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

type OgnSource = {
  airfield?: string;
  synced_at?: string;
  match?: { flarm?: string; registration?: string; confidence?: "high" | "low" };
  device?: { address?: string; registration?: string; cn?: string };
} | null;
type PilotKind = "member" | "visitor" | "gfe";
type Flight = {
  id: string; flight_date: string;
  glider_id: string | null; glider_registration: string | null; flarm_id: string | null;
  takeoff_time: string | null; landing_time: string | null;
  p1_name: string | null; p1_membership: string | null; p1_kind: PilotKind | null;
  p2_name: string | null; p2_membership: string | null; p2_kind: PilotKind | null;
  launch_type: "aerotow" | "winch" | null;
  aerotow_height_ft: number | null;
  manual: boolean; notes: string | null;
  ogn_source: OgnSource;
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
  const [bulkOpen, setBulkOpen] = useState(false);

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

  const [icao, setIcao] = useState<string>(() => (typeof window !== "undefined" ? localStorage.getItem("ogn_icao") || "" : ""));

  const syncOgn = async () => {
    let code = icao;
    if (!code) {
      code = (prompt("Enter your airfield ICAO (e.g. EGHL, LFNB) — used to fetch OGN flights.") || "").toUpperCase().trim();
      if (!code) return;
      localStorage.setItem("ogn_icao", code);
      setIcao(code);
    }
    setSyncing(true);
    try {
      const res = await fetch("/api/public/hooks/ogn-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ icao: code, date }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sync failed");
      toast.success(`OGN ${code}: ${j.created} new, ${j.updated} updated, ${j.skipped} skipped`);
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
          <Button onClick={syncOgn} disabled={syncing} variant="secondary"
            title={icao ? `Airfield: ${icao}. Right-click to change.` : "Click to set airfield"}
            onContextMenu={(e) => { e.preventDefault(); const v = prompt("Airfield ICAO", icao) || ""; if (v) { localStorage.setItem("ogn_icao", v.toUpperCase()); setIcao(v.toUpperCase()); } }}>
            <RefreshCw className={`size-4 mr-1 ${syncing ? "animate-spin" : ""}`} />Sync OGN{icao && <span className="ml-1 text-xs opacity-70">({icao})</span>}
          </Button>
          <Button onClick={exportXlsx} variant="outline"><Download className="size-4 mr-1" />Export XLSX</Button>
          <Button onClick={() => setAdding(true)} variant="outline"><Plus className="size-4 mr-1" />Add manual</Button>
          <Button onClick={() => setBulkOpen(true)}><Plus className="size-4 mr-1" />Bulk add</Button>
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
                    <TableCell><OgnSourceCell flight={f} /></TableCell>
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
      <BulkAddDialog open={bulkOpen} onOpenChange={setBulkOpen} date={date} gliders={gliders} members={members} onSaved={() => { setBulkOpen(false); load(); }} />
    </div>
  );
}

function OgnSourceCell({ flight }: { flight: Flight }) {
  if (flight.manual) return <Badge variant="outline">Manual</Badge>;
  const src = flight.ogn_source;
  const matched = !!src?.match?.flarm;
  const conf = src?.match?.confidence ?? (matched ? "high" : "low");
  const synced = src?.synced_at ? format(new Date(src.synced_at), "HH:mm:ss") : null;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1">
        <Badge variant="default">OGN</Badge>
        {matched ? (
          <Badge variant={conf === "high" ? "secondary" : "outline"} className="text-[10px]">{conf}</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">no match</Badge>
        )}
      </div>
      {src?.match?.flarm && (
        <div className="text-[11px] font-mono text-muted-foreground">
          {src.match.flarm}{src.device?.cn ? ` · ${src.device.cn}` : ""}
        </div>
      )}
      {synced && <div className="text-[10px] text-muted-foreground">synced {synced}</div>}
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

function GliderPicker({ gliders, registration, onSelect, onChangeText, onCreated }: {
  gliders: Glider[]; registration: string;
  onSelect: (g: Glider | null) => void; onChangeText: (t: string) => void;
  onCreated?: (g: Glider) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ registration: "", callsign: "", flarm_id: "", glider_type: "" });
  const create = async () => {
    if (!draft.registration.trim()) return toast.error("Registration required");
    const { data, error } = await supabase.from("fleet_gliders").insert({
      registration: draft.registration.trim(),
      callsign: draft.callsign.trim() || null,
      flarm_id: draft.flarm_id.trim().toUpperCase() || null,
      glider_type: draft.glider_type.trim() || null,
    }).select().single();
    if (error) return toast.error(error.message);
    toast.success("Glider added to fleet");
    setAddOpen(false);
    setDraft({ registration: "", callsign: "", flarm_id: "", glider_type: "" });
    onCreated?.(data as Glider);
    onSelect(data as Glider);
  };
  return (
    <div className="flex flex-wrap gap-2">
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
                <CommandItem value="__add__" onSelect={() => { setOpen(false); setAddOpen(true); }}>
                  <Plus className="size-4 mr-2" /> Add new glider…
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input placeholder="Or type registration manually" value={registration} onChange={(e) => onChangeText(e.target.value)} className="flex-1 min-w-[180px]" />
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add glider to fleet</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Registration *</Label><Input value={draft.registration} onChange={(e) => setDraft({ ...draft, registration: e.target.value })} placeholder="G-ABCD" /></div>
            <div><Label>Callsign</Label><Input value={draft.callsign} onChange={(e) => setDraft({ ...draft, callsign: e.target.value })} /></div>
            <div><Label>FLARM ID</Label><Input value={draft.flarm_id} onChange={(e) => setDraft({ ...draft, flarm_id: e.target.value })} placeholder="DD1234" /></div>
            <div className="col-span-2"><Label>Type</Label><Input value={draft.glider_type} onChange={(e) => setDraft({ ...draft, glider_type: e.target.value })} placeholder="ASK-21" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={create}>Add to fleet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PilotPicker({ label, members, value, onPick, onText }: {
  label: string; members: Member[]; value: string;
  onPick: (m: Member) => void; onText: (t: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return members.filter((m) => m.full_name.toLowerCase().includes(q)).slice(0, 6);
  }, [members, value]);
  const showList = focused && filtered.length > 0;
  return (
    <div className="relative">
      <Label>{label}</Label>
      <Input
        value={value}
        placeholder="Type a name…"
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => onText(e.target.value)}
      />
      {showList && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.map((m) => (
            <button
              type="button"
              key={m.id}
              className="w-full text-left px-3 py-2 hover:bg-accent"
              onMouseDown={(e) => { e.preventDefault(); onPick(m); setFocused(false); }}
            >
              <div className="text-sm">{m.full_name}</div>
              <div className="text-xs text-muted-foreground">#{m.membership_number}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type BulkRow = {
  glider_id: string | null; glider_registration: string; flarm_id: string;
  takeoff_time: string; landing_time: string;
  p1_name: string; p1_membership: string;
  p2_name: string; p2_membership: string;
  launch_type: "aerotow" | "winch"; aerotow_height_ft: number;
};

const blankRow = (): BulkRow => ({
  glider_id: null, glider_registration: "", flarm_id: "",
  takeoff_time: "", landing_time: "",
  p1_name: "", p1_membership: "", p2_name: "", p2_membership: "",
  launch_type: "aerotow", aerotow_height_ft: 2000,
});

function BulkAddDialog({ open, onOpenChange, date, gliders, members, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  date: string; gliders: Glider[]; members: Member[]; onSaved: () => void;
}) {
  const [rows, setRows] = useState<BulkRow[]>([blankRow(), blankRow(), blankRow()]);

  useEffect(() => { if (open) setRows([blankRow(), blankRow(), blankRow()]); }, [open]);

  const update = (i: number, patch: Partial<BulkRow>) => {
    setRows((r) => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  };

  const fromLocal = (s: string) => s ? new Date(s).toISOString() : null;

  const saveAll = async () => {
    const valid = rows.filter((r) => r.glider_registration.trim() || r.flarm_id.trim() || r.takeoff_time);
    if (valid.length === 0) return toast.error("Add at least one row");
    const payload = valid.map((r) => ({
      flight_date: date,
      glider_id: r.glider_id || null,
      glider_registration: r.glider_registration || null,
      flarm_id: r.flarm_id ? r.flarm_id.toUpperCase() : null,
      takeoff_time: fromLocal(r.takeoff_time),
      landing_time: fromLocal(r.landing_time),
      p1_name: r.p1_name || null, p1_membership: r.p1_membership || null,
      p2_name: r.p2_name || null, p2_membership: r.p2_membership || null,
      launch_type: r.launch_type,
      aerotow_height_ft: r.launch_type === "aerotow" ? r.aerotow_height_ft : null,
      manual: true,
    }));
    const { error } = await supabase.from("flights").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(`${payload.length} flights logged`);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] md:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk add flights — {date}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 border rounded-lg">
              <div className="md:col-span-3">
                <Label className="text-xs">Glider</Label>
                <GliderPicker
                  gliders={gliders}
                  registration={r.glider_registration}
                  onSelect={(g) => update(i, { glider_id: g?.id ?? null, glider_registration: g?.registration ?? r.glider_registration, flarm_id: g?.flarm_id ?? r.flarm_id })}
                  onChangeText={(t) => update(i, { glider_registration: t, glider_id: null })}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Takeoff</Label>
                <Input type="datetime-local" value={r.takeoff_time} onChange={(e) => update(i, { takeoff_time: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Landing</Label>
                <Input type="datetime-local" value={r.landing_time} onChange={(e) => update(i, { landing_time: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <PilotPicker label="P1" members={members} value={r.p1_name}
                  onPick={(m) => update(i, { p1_name: m.full_name, p1_membership: m.membership_number })}
                  onText={(t) => update(i, { p1_name: t })} />
                <Input className="mt-1" placeholder="P1 #" value={r.p1_membership} onChange={(e) => update(i, { p1_membership: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <PilotPicker label="P2" members={members} value={r.p2_name}
                  onPick={(m) => update(i, { p2_name: m.full_name, p2_membership: m.membership_number })}
                  onText={(t) => update(i, { p2_name: t })} />
                <Input className="mt-1" placeholder="P2 #" value={r.p2_membership} onChange={(e) => update(i, { p2_membership: e.target.value })} />
              </div>
              <div className="md:col-span-1">
                <Label className="text-xs">Launch</Label>
                <Select value={r.launch_type} onValueChange={(v) => update(i, { launch_type: v as "aerotow" | "winch" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aerotow">Aerotow</SelectItem>
                    <SelectItem value="winch">Winch</SelectItem>
                  </SelectContent>
                </Select>
                {r.launch_type === "aerotow" && (
                  <Select value={String(r.aerotow_height_ft)} onValueChange={(v) => update(i, { aerotow_height_ft: parseInt(v) })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000].map((h) => (
                        <SelectItem key={h} value={String(h)}>{h}ft</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="md:col-span-12 flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-4 mr-1" />Remove row
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" onClick={() => setRows((r) => [...r, blankRow()])}>
            <Plus className="size-4 mr-1" />Add another row
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={saveAll}>Save {rows.length} flights</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
