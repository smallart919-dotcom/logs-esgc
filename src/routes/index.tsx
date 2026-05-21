import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { computeFlightCharge, fmtGBP } from "@/lib/pricing";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { toast } from "sonner";
import { Download, Plus, RefreshCw, Pencil, Trash2, Plane, ChevronsUpDown, Mail, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import ExcelJS from "exceljs";
import { fmtUKTime, toUKLocalInput, fromUKLocalInput, fmtUKDate, fmtUKTimeSec, todayUKDate } from "@/lib/uktime";
import { useDayOffset } from "@/lib/clock-offset";
import { ClockSyncCard } from "@/components/clock-sync-card";

function FlightsErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <RefreshCw className="size-6 text-destructive" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">Couldn't load flights</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {error?.message ? error.message : "Something went wrong loading the daily log."}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          <RefreshCw className="size-4 mr-2" /> Retry
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Hard refresh
        </Button>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  beforeLoad: requireAuth,
  component: FlightsPage,
  errorComponent: FlightsErrorComponent,
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
  p1_name: string | null; p1_membership: string | null; p1_kind: PilotKind | null; p1_charge: boolean | null;
  p2_name: string | null; p2_membership: string | null; p2_kind: PilotKind | null; p2_charge: boolean | null;
  launch_type: "aerotow" | "winch" | null;
  aerotow_height_ft: number | null;
  manual: boolean; notes: string | null;
  logged_by: string | null;
  ogn_source: OgnSource;
};
type Glider = { id: string; registration: string; callsign: string | null; flarm_id: string | null; glider_type: string | null };
type Member = { id: string; full_name: string; membership_number: string };

const todayStr = () => todayUKDate();

async function maybeAddMember(existing: Member[], kind: PilotKind | null | undefined, name: string | null, membership: string | null) {
  if (kind !== "member") return;
  const n = (name || "").trim();
  const m = (membership || "").trim();
  if (!n || !m) return;
  const exists = existing.some((e) => e.membership_number.trim().toLowerCase() === m.toLowerCase() || e.full_name.trim().toLowerCase() === n.toLowerCase());
  if (exists) return;
  await supabase.from("club_members").insert({ full_name: n, membership_number: m });
}

async function maybeUpsertFleet(
  gliders: Glider[],
  registration: string | null,
  glider_type: string,
  callsign: string,
  flarm_id: string | null,
) {
  const reg = (registration || "").trim();
  if (!reg) return;
  const type = (glider_type || "").trim();
  const cs = (callsign || "").trim();
  if (!type && !cs) return;
  const existing = gliders.find((g) => (g.registration || "").toUpperCase().trim() === reg.toUpperCase());
  if (existing) {
    const patch: Partial<Glider> = {};
    if (type && !existing.glider_type) patch.glider_type = type;
    if (cs && !existing.callsign) patch.callsign = cs;
    if (Object.keys(patch).length === 0) return;
    await supabase.from("fleet_gliders").update(patch).eq("id", existing.id);
  } else {
    await supabase.from("fleet_gliders").insert({
      registration: reg,
      glider_type: type || null,
      callsign: cs || null,
      flarm_id: (flarm_id || "").trim().toUpperCase() || null,
    });
  }
}

function FlightsPage() {
  const initialDate = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("date") || todayStr())
    : todayStr();
  const [date, setDate] = useState(initialDate);
  const [isOffice, setIsOffice] = useState(false);
  const [isCaravan, setIsCaravan] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = (data.user?.email || "").toLowerCase();
      setIsOffice(email === "office@esgc.local");
      setIsCaravan(email === "caravan@esgc.local");
    });
  }, []);
  const { offsetSec } = useDayOffset(date);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [gliders, setGliders] = useState<Glider[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [loadingFlights, setLoadingFlights] = useState(false);
  const [syncResult, setSyncResult] = useState<null | { icao: string; date: string; created: number; updated: number; skipped: number; total: number; synced_at: string; errors: Array<{ flarm: string | null; registration: string | null; message: string }>; matches: Array<any> }>(null);
  const [editing, setEditing] = useState<Flight | null>(null);
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Track which flight IDs we've already seen and which were still in-air,
  // so we can animate brand-new rows and the moment a landing time appears.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const inAirIdsRef = useRef<Set<string>>(new Set());
  const syncInFlightRef = useRef(false);
  const [freshlyAdded, setFreshlyAdded] = useState<Set<string>>(new Set());
  const [freshlyLanded, setFreshlyLanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoadingFlights(true);
    try {
      const [{ data: f, error: fErr }, { data: g, error: gErr }, { data: m, error: mErr }] = await Promise.all([
        supabase.from("flights").select("*").eq("flight_date", date).order("takeoff_time", { ascending: true, nullsFirst: false }),
        supabase.from("fleet_gliders").select("*").order("registration"),
        supabase.from("club_members").select("*").order("full_name"),
      ]);
      const err = fErr || gErr || mErr;
      if (err) throw err;
      const next = (f as Flight[]) ?? [];

      // Detect newly arrived flights and newly-landed flights for subtle animations.
      const seen = seenIdsRef.current;
      const inAir = inAirIdsRef.current;
      const newIds = new Set<string>();
      const landedIds = new Set<string>();
      const isInitial = seen.size === 0;
      for (const fl of next) {
        if (!seen.has(fl.id)) { if (!isInitial) newIds.add(fl.id); seen.add(fl.id); }
        if (fl.landing_time == null) inAir.add(fl.id);
        else if (inAir.has(fl.id)) { inAir.delete(fl.id); if (!isInitial) landedIds.add(fl.id); }
      }
      // Drop ids that no longer exist (e.g. deletion)
      const present = new Set(next.map((x) => x.id));
      for (const id of Array.from(seen)) if (!present.has(id)) seen.delete(id);
      for (const id of Array.from(inAir)) if (!present.has(id)) inAir.delete(id);

      setFlights(next);
      if (newIds.size) {
        setFreshlyAdded((prev) => { const s = new Set(prev); newIds.forEach((id) => s.add(id)); return s; });
        setTimeout(() => setFreshlyAdded((prev) => { const s = new Set(prev); newIds.forEach((id) => s.delete(id)); return s; }), 1600);
      }
      if (landedIds.size) {
        setFreshlyLanded((prev) => { const s = new Set(prev); landedIds.forEach((id) => s.add(id)); return s; });
        setTimeout(() => setFreshlyLanded((prev) => { const s = new Set(prev); landedIds.forEach((id) => s.delete(id)); return s; }), 1400);
      }
      setGliders((g as Glider[]) ?? []);
      setMembers((m as Member[]) ?? []);
    } finally {
      if (!silent) setLoadingFlights(false);
    }
  }, [date]);

  useEffect(() => { load().catch((e) => toast.error(e.message || "Could not refresh the daily log")); }, [load]);

  // Reset tracking when the date changes so we don't fire animations for the whole new day.
  useEffect(() => { seenIdsRef.current = new Set(); inAirIdsRef.current = new Set(); }, [date]);

  // Realtime updates for the day
  useEffect(() => {
    const ch = supabase.channel("flights-rt").on("postgres_changes",
      { event: "*", schema: "public", table: "flights" }, () => { load(true).catch(() => undefined); }
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const [icao] = useState<string>("UKRIN");

  const syncOgn = useCallback(async (silent = false) => {
    const code = icao;
    if (!code) return;
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    if (!silent) { setSyncing(true); setSyncResult(null); }
    try {
      const res = await fetch("/api/public/hooks/ogn-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ icao: code, date }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sync failed");
      if (!silent) setSyncResult(j);
      await load(silent);
    } catch (e: any) {
      if (!silent) {
        toast.error(e.message);
        setSyncResult({ icao: code, date, created: 0, updated: 0, skipped: 0, total: 0, synced_at: new Date().toISOString(), errors: [{ flarm: null, registration: null, message: e.message }], matches: [] });
      }
    }
    finally { syncInFlightRef.current = false; if (!silent) setSyncing(false); }
  }, [icao, date, load]);

  const toggleOgnSync = useCallback(() => {
    setAutoSyncEnabled((enabled) => {
      const next = !enabled;
      if (next) void syncOgn(false);
      return next;
    });
  }, [syncOgn]);

  // Silent auto-sync so landing times appear naturally. Fast cadence when the
  // tab is visible, lighter cadence in the background to save bandwidth.
  useEffect(() => {
    if (!icao || !autoSyncEnabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (cancelled) return;
      const visible = typeof document !== "undefined" && document.visibilityState === "visible";
      syncOgn(true).finally(() => {
        if (cancelled) return;
        timer = setTimeout(tick, visible ? 3000 : 15000);
      });
    };
    tick();
    const onVis = () => {
      if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); tick(); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [autoSyncEnabled, icao, syncOgn]);


  const remove = async (id: string) => {
    if (!confirm("Delete this flight?")) return;
    const f = flights.find((x) => x.id === id);
    if (f && !f.manual) {
      // Record a tombstone so the next OGN sync won't recreate this flight.
      await supabase.from("flight_tombstones").insert({
        flight_date: f.flight_date,
        flarm_id: f.flarm_id,
        glider_registration: f.glider_registration,
        takeoff_time: f.takeoff_time,
        landing_time: f.landing_time,
      });
    }
    const { error } = await supabase.from("flights").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  };

  const landNow = async (id: string) => {
    // Stamp landing_time with the current instant (adjusted for the day's clock offset).
    const now = new Date(Date.now() - offsetSec * 1000).toISOString();
    // Optimistic update so the row reflects immediately.
    setFlights((prev) => prev.map((x) => x.id === id ? { ...x, landing_time: now } : x));
    const { error } = await supabase.from("flights").update({ landing_time: now }).eq("id", id);
    if (error) { toast.error(error.message); load(); return; }
    toast.success("Landing time set");
    // Kick OGN once to also try to capture the official landing time if it arrives.
    syncOgn(true).catch(() => undefined);
  };

  const exportXlsx = async () => {
    const fmtTime = (iso: string | null) => iso ? fmtUKTime(iso, offsetSec) : "";
    const dur = (a: string | null, b: string | null) => {
      if (!a || !b) return "";
      const m = Math.round((+new Date(b) - +new Date(a)) / 60000);
      const h = Math.floor(m / 60), mm = m % 60;
      return `${h}:${String(mm).padStart(2, "0")}`;
    };
    const pilotName = (kind: PilotKind | null, name: string | null) =>
      kind === "gfe" ? "GFE" : kind === "visitor" ? (name ? `Visitor (${name})` : "Visitor") : (name || "");

    const { data: daily } = await supabase.from("daily_logs").select("duty_instructor,duty_pilot").eq("flight_date", date).maybeSingle();
    const dutyInstructor = daily?.duty_instructor ?? "";
    const dutyPilot = daily?.duty_pilot ?? "";

    const wb = new ExcelJS.Workbook();

    const RED = "FFC00000";
    const PINK = "FFFCE4E6";
    const thin: Partial<ExcelJS.Borders> = {
      top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" },
    };

    const fleetTypeByReg = new Map(
      gliders.filter((g) => g.registration).map((g) => [g.registration.toUpperCase().trim(), g.glider_type || ""])
    );
    const typeFor = (f: Flight) => {
      const r = (f.glider_registration || "").toUpperCase().trim();
      const fleetT = fleetTypeByReg.get(r);
      if (fleetT) return fleetT;
      const dev = (f.ogn_source as any)?.raw && (f.ogn_source as any)?.device;
      return (dev?.aircraft as string) || "";
    };
    const buildSheet = (name: string, rows: Flight[], launch: "aerotow" | "winch" | null) => {
      const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
      ws.columns = [
        { width: 4 }, { width: 8 }, { width: 7 },
        { width: 7 }, { width: 20 }, { width: 4 },
        { width: 7 }, { width: 20 }, { width: 4 },
        { width: 7 }, { width: 9 }, { width: 9 }, { width: 7 },
        { width: 28 }, { width: 5 },
      ];

      const setBox = (range: string, opts: { fill?: string; bold?: boolean; color?: string; size?: number; align?: "left" | "center" | "right"; value?: any }) => {
        ws.mergeCells(range);
        const cell = ws.getCell(range.split(":")[0]);
        if (opts.value !== undefined) cell.value = opts.value;
        cell.alignment = { vertical: "middle", horizontal: opts.align ?? "center", wrapText: true };
        cell.font = { bold: opts.bold, color: opts.color ? { argb: opts.color } : undefined, size: opts.size, name: "Calibri" };
        if (opts.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
        cell.border = thin;
      };

      ws.getRow(1).height = 28;
      ws.getRow(2).height = 22;
      setBox("A1:C2", { value: "ESGC", bold: true, color: "FF1F4E79", size: 16 });
      setBox("D1:F2", { value: "Flight Log", bold: true, color: RED, size: 18, fill: PINK });
      setBox("G1:I1", { value: "Launch Type ✓", bold: true, size: 10 });
      setBox("G2:H2", { value: "Aerotow", align: "left" });
      setBox("I2:I2", { value: launch === "aerotow" ? "✓" : "", bold: true });
      setBox("J1:L1", { value: "Sheet", bold: true });
      setBox("J2:K2", { value: "Winch", align: "left" });
      setBox("L2:L2", { value: launch === "winch" ? "✓" : "", bold: true });
      setBox("M1:M2", { value: "Of", bold: true });
      setBox("N1:O1", { value: "Day & Date", bold: true });
      setBox("N2:O2", { value: fmtUKDate(date) });

      ws.getRow(3).height = 40;
      setBox("A3:I3", { value: "LOG KEEPERS PLEASE MAKE ALL ENTRIES IN BLOCK CAPITALS AND LEGIBLE", bold: true, color: "FFFFFFFF", fill: RED, size: 10 });
      setBox("J3:O3", { value: "Enter comment against each flight eg trial lesson, voucher number, training flight etc. Enter tick in \"Ch\" against pilot who is to pay for the flight. Logged By: - please enter your initials in the \"LB\" Column", size: 8, align: "left" });

      ws.getRow(4).height = 22;
      setBox("A4:A4", { value: "Duty Instructor", bold: true, size: 9 });
      setBox("B4:E4", { value: dutyInstructor, align: "left", bold: true });
      setBox("F4:F4", { value: "Duty Pilot", bold: true, size: 9 });
      setBox("G4:O4", { value: dutyPilot, align: "left", bold: true });

      ws.getRow(5).height = 18;
      ws.getRow(6).height = 22;
      setBox("A5:A6", { value: "No", bold: true, fill: PINK });
      setBox("B5:B6", { value: "Reg", bold: true, fill: PINK });
      setBox("C5:C6", { value: "Type", bold: true, fill: PINK });
      setBox("D5:F5", { value: "P1", bold: true, fill: PINK });
      setBox("D6:D6", { value: "No", bold: true, fill: PINK });
      setBox("E6:E6", { value: "Name", bold: true, fill: PINK });
      setBox("F6:F6", { value: "Ch", bold: true, fill: PINK });
      setBox("G5:I5", { value: "P2", bold: true, fill: PINK });
      setBox("G6:G6", { value: "No", bold: true, fill: PINK });
      setBox("H6:H6", { value: "Name", bold: true, fill: PINK });
      setBox("I6:I6", { value: "Ch", bold: true, fill: PINK });
      setBox("J5:J6", { value: "Height", bold: true, fill: PINK });
      setBox("K5:K5", { value: "Take off", bold: true, fill: PINK });
      setBox("K6:K6", { value: "h:m", bold: true, fill: PINK, size: 9 });
      setBox("L5:L5", { value: "Landing", bold: true, fill: PINK });
      setBox("L6:L6", { value: "h:m", bold: true, fill: PINK, size: 9 });
      setBox("M5:M5", { value: "Time", bold: true, fill: PINK });
      setBox("M6:M6", { value: "h:m", bold: true, fill: PINK, size: 9 });
      setBox("N5:N6", { value: "Comments", bold: true, fill: PINK });
      setBox("O5:O6", { value: "LB", bold: true, fill: PINK });

      const startRow = 7;
      rows.forEach((f, i) => {
        const r = startRow + i;
        const row = ws.getRow(r);
        row.height = 20;
        const vals = [
          i + 1,
          f.glider_registration || "",
          typeFor(f),
          f.p1_kind === "member" ? (f.p1_membership || "") : "",
          pilotName(f.p1_kind, f.p1_name),
          f.p1_charge ? "✓" : "",
          f.p2_kind === "member" ? (f.p2_membership || "") : "",
          pilotName(f.p2_kind, f.p2_name),
          f.p2_charge ? "✓" : "",
          f.launch_type === "aerotow" ? (f.aerotow_height_ft ?? "") : "",
          fmtTime(f.takeoff_time),
          fmtTime(f.landing_time),
          dur(f.takeoff_time, f.landing_time),
          f.notes || "",
          f.logged_by || "",
        ];
        vals.forEach((v, c) => {
          const cell = row.getCell(c + 1);
          cell.value = v as any;
          cell.border = thin;
          cell.font = { name: "Calibri", size: 10 };
          cell.alignment = { vertical: "middle", horizontal: c === 4 || c === 7 || c === 13 ? "left" : "center", wrapText: true };
        });
      });

      const minRows = Math.max(20, rows.length);
      for (let i = rows.length; i < minRows; i++) {
        const r = startRow + i;
        const row = ws.getRow(r);
        row.height = 20;
        row.getCell(1).value = i + 1;
        for (let c = 1; c <= 15; c++) {
          row.getCell(c).border = thin;
          row.getCell(c).font = { name: "Calibri", size: 10 };
          row.getCell(c).alignment = { vertical: "middle", horizontal: "center" };
        }
      }

      ws.pageSetup = {
        orientation: "landscape",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.2, footer: 0.2 },
      };
    };

    const reg = (f: Flight) => (f.glider_registration || "").toUpperCase().trim();
    const isExcluded = (f: Flight) => reg(f) === "G-ESGC" || reg(f) === "G-KIAU";
    const aerotow = flights.filter((f) => f.launch_type === "aerotow" && !isExcluded(f));
    const winch = flights.filter((f) => f.launch_type === "winch" && !isExcluded(f));
    const other = flights.filter((f) => f.launch_type !== "aerotow" && f.launch_type !== "winch" && !isExcluded(f));
    const kiau = flights.filter((f) => reg(f) === "G-KIAU");

    buildSheet("Aerotow", aerotow, "aerotow");
    buildSheet("Winch", winch, "winch");
    if (other.length) buildSheet("Other", other, null);
    if (kiau.length) buildSheet("G-KIAU", kiau, null);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const filename = `flight-log-${date}.xlsx`;
    return { blob, filename };
  };

  const downloadXlsx = async () => {
    const { blob, filename } = await exportXlsx();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const emailXlsx = async () => {
    const { blob, filename } = await exportXlsx();
    const subject = `Logs ${fmtUKDate(date)}`;
    const body = `${filename}\n\nFrom Caravan, have a good evening.`;
    const file = new File([blob], filename, { type: blob.type });
    // Try native share sheet (iOS Mail will pre-fill subject/body and attach the file).
    const navAny = navigator as any;
    if (navAny.canShare && navAny.canShare({ files: [file] })) {
      try {
        await navAny.share({ files: [file], title: subject, text: body });
        return;
      } catch (err: any) {
        if (err?.name === "AbortError") return;
      }
    }
    // Fallback: download the file and open the user's mail client with prefilled subject/body.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.message("Excel downloaded — attach it in your email", { description: "Opening your mail app…" });
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };



  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Plane className="size-6 md:size-7 text-primary" /> Daily Flight Log</h1>
          <p className="text-sm text-muted-foreground">OGN-fed flights for your club fleet. Add pilot details and export.</p>
        </div>
        <div className="flex flex-col gap-2 w-full sm:w-auto sm:flex-row sm:items-end sm:flex-wrap">
          <div className="w-full sm:w-auto">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full sm:w-44"
              max={todayStr()} min={isOffice ? undefined : todayStr()} />
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant={autoSyncEnabled ? "secondary" : "outline"}
              size="sm"
              onClick={toggleOgnSync}
              className="gap-1.5 whitespace-nowrap"
              title={autoSyncEnabled ? `Auto-syncing ${icao} from OGN — tap to pause.` : `OGN sync paused for ${icao} — tap to resume.`}
            >
              <RefreshCw className={`size-3.5 ${syncing || loadingFlights ? "animate-spin" : ""}`} />
              <span>OGN Live {autoSyncEnabled ? "On" : "Off"}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => syncOgn(false)}
              disabled={syncing}
              className="gap-1.5 whitespace-nowrap"
              title="Run a one-off OGN sync now"
            >
              <RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span>Manual Sync</span>
            </Button>
            <div className="flex flex-wrap gap-2 ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm"><Download className="size-4 mr-1" />Export<ChevronDown className="size-3.5 ml-1 opacity-70" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={downloadXlsx}><Download className="size-4 mr-2" />Download Excel</DropdownMenuItem>
                  <DropdownMenuItem onClick={emailXlsx}><Mail className="size-4 mr-2" />Email to office</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={() => setAdding(true)} variant="outline" size="sm"><Plus className="size-4 mr-1" />Add</Button>
              <Button onClick={() => setBulkOpen(true)} size="sm"><Plus className="size-4 mr-1" />Bulk add</Button>
            </div>
          </div>
        </div>
      </div>

      <DailyLogCard date={date} members={members} />

      <ClockSyncCard date={date} isCaravan={isCaravan} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span aria-hidden className="inline-flex glider-touchdown text-primary/70">
              <Plane className="size-4 rotate-[18deg]" />
            </span>
            {flights.filter((f) => { const r = (f.glider_registration || "").toUpperCase().trim(); return r !== "G-ESGC" && r !== "G-KIAU"; }).length} flights on {fmtUKDate(date)}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader><TableRow>
              <TableHead>Glider</TableHead><TableHead>Takeoff</TableHead><TableHead>Landing</TableHead>
              <TableHead>Dur</TableHead><TableHead>P1</TableHead><TableHead>P2</TableHead>
              <TableHead>Launch</TableHead><TableHead>LB</TableHead><TableHead>Source</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {flights.filter((f) => { const r = (f.glider_registration || "").toUpperCase().trim(); return r !== "G-ESGC" && r !== "G-KIAU"; }).slice().sort((a, b) => {
                const ta = a.takeoff_time ? +new Date(a.takeoff_time) : Number.POSITIVE_INFINITY;
                const tb = b.takeoff_time ? +new Date(b.takeoff_time) : Number.POSITIVE_INFINITY;
                return ta - tb;
              }).map((f) => {
                const dur = (() => {
                  if (!f.takeoff_time) return "—";
                  if (!f.landing_time) return "in air";
                  const m = Math.round((+new Date(f.landing_time) - +new Date(f.takeoff_time)) / 60000);
                  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
                })();
                const isNew = freshlyAdded.has(f.id);
                const justLanded = freshlyLanded.has(f.id);
                return (
                  <TableRow key={f.id} className={`transition-colors hover:bg-muted/40 ${isNew ? "row-land-in" : "row-glide-in"}`}>
                    <TableCell className="font-medium">
                      {f.glider_registration || <span className="text-muted-foreground">unknown</span>}
                      {f.flarm_id && <div className="text-xs font-mono text-muted-foreground">{f.flarm_id}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{fmtUKTime(f.takeoff_time, offsetSec)}</TableCell>
                    <TableCell className={`font-mono text-sm ${justLanded ? "landing-pop" : ""}`}>
                      {f.landing_time ? (
                        fmtUKTime(f.landing_time, offsetSec)
                      ) : f.takeoff_time ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 gap-1 text-xs font-normal"
                          onClick={() => landNow(f.id)}
                          title="Stamp landing time as now (OGN will still fill the exact time if it arrives)"
                        >
                          <Plane className="size-3 rotate-90" />
                          Land now
                        </Button>
                      ) : ""}
                    </TableCell>
                    <TableCell className="text-sm">{dur}</TableCell>
                    <TableCell><PilotCell name={f.p1_name} membership={f.p1_membership} kind={f.p1_kind} /></TableCell>
                    <TableCell><PilotCell name={f.p2_name} membership={f.p2_membership} kind={f.p2_kind} /></TableCell>
                    <TableCell>
                      {f.launch_type ? (
                        <Badge variant="secondary">
                          {f.launch_type}{f.launch_type === "aerotow" && f.aerotow_height_ft ? ` ${f.aerotow_height_ft}ft` : ""}
                        </Badge>
                      ) : <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{f.logged_by || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell><OgnSourceCell flight={f} /></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(f)}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(f.id)}><Trash2 className="size-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {flights.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-12">
                No flights yet — they'll appear here automatically from OGN, or click <strong>Add</strong>.
              </TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <MotorGliderCosts flights={flights} offsetSec={offsetSec} onEdit={setEditing} onDelete={remove} />

      <DeletedFlights date={date} offsetSec={offsetSec} onRestored={load} />

      <FlightDialog
        open={!!editing || adding}
        onOpenChange={(o) => { if (!o) { setEditing(null); setAdding(false); } }}
        flight={editing}
        manual={adding}
        date={date}
        gliders={gliders}
        members={members}
        previousInitials={Array.from(new Set(flights.map((f) => (f.logged_by || "").trim()).filter(Boolean))).sort()}
        onSaved={async (savedDate) => {
          setEditing(null);
          setAdding(false);
          if (savedDate && savedDate !== date) setDate(savedDate);
          else await load();
        }}
      />
      <BulkAddDialog open={bulkOpen} onOpenChange={setBulkOpen} date={date} gliders={gliders} members={members} onSaved={() => { setBulkOpen(false); load(); }} />
    </div>
  );
}

type Tombstone = {
  id: string;
  flight_date: string;
  flarm_id: string | null;
  glider_registration: string | null;
  takeoff_time: string | null;
  landing_time: string | null;
  created_at: string;
};

function DeletedFlights({ date, offsetSec, onRestored }: { date: string; offsetSec: number; onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Tombstone[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("flight_tombstones")
      .select("*")
      .eq("flight_date", date)
      .order("takeoff_time", { ascending: true, nullsFirst: false });
    setRows((data as Tombstone[]) ?? []);
    setLoading(false);
  }, [date]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  const restore = async (t: Tombstone) => {
    // Removing the tombstone allows the next OGN sync to recreate the flight.
    const { error } = await supabase.from("flight_tombstones").delete().eq("id", t.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Flight will be re-added on next sync");
    setRows((rs) => rs.filter((r) => r.id !== t.id));
    onRestored();
  };

  const fmt = (iso: string | null) => fmtUKTime(iso, offsetSec);

  return (
    <div className="mt-2">
      <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Show"} deleted flights
      </Button>
      {open && (
        <Card className="mt-2">
          <CardHeader><CardTitle className="text-base">Deleted on {fmtUKDate(date)}</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">No deleted flights for this date.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Glider</TableHead>
                    <TableHead>FLARM</TableHead>
                    <TableHead>Take off</TableHead>
                    <TableHead>Landing</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.glider_registration || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="font-mono text-xs">{t.flarm_id || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{fmt(t.takeoff_time)}</TableCell>
                      <TableCell>{fmt(t.landing_time)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="secondary" onClick={() => restore(t)}>Re-add</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MotorGliderCosts({ flights, offsetSec, onEdit, onDelete }: { flights: Flight[]; offsetSec: number; onEdit: (f: Flight) => void; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const mg = flights.filter((f) => (f.glider_registration || "").toUpperCase().trim() === "G-KIAU");
  const rows = mg.map((f) => {
    const std = computeFlightCharge(f, false);
    const u21 = computeFlightCharge(f, true);
    const mins = f.takeoff_time && f.landing_time
      ? Math.round((+new Date(f.landing_time) - +new Date(f.takeoff_time)) / 60000) : 0;
    return { f, std, u21, mins };
  });
  const totalStd = rows.reduce((a, r) => a + r.std.total, 0);
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/40 transition-colors">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Motor Glider Costs (G-KIAU) — {mg.length} flight{mg.length === 1 ? "" : "s"}</span>
              <span className="text-sm text-muted-foreground">{open ? "Hide" : "Show"} · Total {fmtGBP(totalStd)}</span>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="overflow-x-auto">
            {mg.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">No motor glider flights on this date.</div>
            ) : (
              <Table className="min-w-[900px]">
                <TableHeader><TableRow>
                  <TableHead>Glider</TableHead><TableHead>Takeoff</TableHead><TableHead>Landing</TableHead>
                  <TableHead>Dur</TableHead>
                  <TableHead>P1</TableHead><TableHead>P1 Ch</TableHead>
                  <TableHead>P2</TableHead><TableHead>P2 Ch</TableHead>
                  <TableHead className="text-right">Normal</TableHead>
                  <TableHead className="text-right">U21</TableHead>
                  <TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map(({ f, std, u21, mins }) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.glider_registration}</TableCell>
                      <TableCell className="font-mono text-sm">{fmtUKTime(f.takeoff_time, offsetSec)}</TableCell>
                      <TableCell className="font-mono text-sm">{fmtUKTime(f.landing_time, offsetSec)}</TableCell>
                      <TableCell className="text-sm">{`${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`}</TableCell>
                      <TableCell><PilotCell name={f.p1_name} membership={f.p1_membership} kind={f.p1_kind} /></TableCell>
                      <TableCell>{f.p1_charge ? <Badge variant="default">✓</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell><PilotCell name={f.p2_name} membership={f.p2_membership} kind={f.p2_kind} /></TableCell>
                      <TableCell>{f.p2_charge ? <Badge variant="default">✓</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right font-medium">{fmtGBP(std.total)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmtGBP(u21.total)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="icon" variant="ghost" onClick={() => onEdit(f)}><Pencil className="size-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => onDelete(f.id)}><Trash2 className="size-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function DailyLogCard({ date, members }: { date: string; members: Member[] }) {
  const [duty_instructor, setDI] = useState("");
  const [duty_pilot, setDP] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.from("daily_logs").select("*").eq("flight_date", date).maybeSingle().then(({ data }) => {
      if (!active) return;
      setDI(data?.duty_instructor ?? "");
      setDP(data?.duty_pilot ?? "");
      setNotes(data?.notes ?? "");
      setLoading(false);
    });
    return () => { active = false; };
  }, [date]);

  const save = useCallback(async (silent = false) => {
    if (loading) return;
    setSaving(true);
    const { error } = await supabase.from("daily_logs").upsert({
      flight_date: date, duty_instructor: duty_instructor || null, duty_pilot: duty_pilot || null, notes: notes || null,
    }, { onConflict: "flight_date" });
    setSaving(false);
    if (error) { if (!silent) toast.error(error.message); }
    else if (!silent) toast.success("Daily log saved");
  }, [loading, date, duty_instructor, duty_pilot, notes]);

  // Debounced autosave whenever any field changes.
  useEffect(() => {
    if (loading) return;
    const id = setTimeout(() => { save(true); }, 1500);
    return () => clearTimeout(id);
  }, [duty_instructor, duty_pilot, notes, loading, save]);

  // Force-save at midnight so the day's log is always persisted.
  useEffect(() => {
    const now = new Date();
    const next = new Date(now); next.setHours(24, 0, 5, 0);
    const id = setTimeout(() => { save(true); }, next.getTime() - now.getTime());
    return () => clearTimeout(id);
  }, [save]);

  return (
    <Card>
      <CardHeader><CardTitle>Daily Log — {fmtUKDate(date)}</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Duty Instructor</Label>
          <MemberNamePicker members={members} value={duty_instructor} onChange={setDI} disabled={loading} />
        </div>
        <div>
          <Label>Duty Pilot</Label>
          <MemberNamePicker members={members} value={duty_pilot} onChange={setDP} disabled={loading} />
        </div>
        <div className="md:col-span-2">
          <Label>Notes</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={loading} />
        </div>
        <div className="md:col-span-2 flex justify-end items-center gap-2 text-xs text-muted-foreground">
          {saving ? "Saving…" : "Auto-saved"}
        </div>
      </CardContent>
    </Card>
  );
}

function OgnSourceCell({ flight }: { flight: Flight }) {
  if (flight.manual) return <Badge variant="outline">Manual</Badge>;
  const src = flight.ogn_source;
  const matched = !!src?.match?.flarm;
  const conf = src?.match?.confidence ?? (matched ? "high" : "low");
  const synced = src?.synced_at ? fmtUKTimeSec(src.synced_at) : null;
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

function PilotCell({ name, membership, kind }: { name: string | null; membership: string | null; kind: PilotKind | null }) {
  if (kind === "gfe") return <Badge variant="secondary">GFE</Badge>;
  if (kind === "visitor") return (
    <div><div>{name || <span className="text-muted-foreground">Visitor</span>}</div><Badge variant="outline" className="text-[10px]">Visitor</Badge></div>
  );
  if (!name) return <span className="text-muted-foreground text-sm">—</span>;
  return <div><div>{name}</div><div className="text-xs text-muted-foreground">{membership}</div></div>;
}

function FlightDialog({
  open, onOpenChange, flight, manual, date, gliders, members, previousInitials = [], onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  flight: Flight | null; manual: boolean; date: string;
  gliders: Glider[]; members: Member[]; previousInitials?: string[]; onSaved: (savedDate?: string) => void;
}) {
  const [form, setForm] = useState<Partial<Flight>>({});
  const [gliderType, setGliderType] = useState("");
  const [gliderCallsign, setGliderCallsign] = useState("");

  const lookupFleet = (reg: string) => {
    const r = (reg || "").toUpperCase().trim();
    if (!r) return null;
    return gliders.find((g) => (g.registration || "").toUpperCase().trim() === r) ?? null;
  };

  useEffect(() => {
    const f = flight;
    if (f) {
      setForm(f);
      const fleet = lookupFleet(f.glider_registration || "");
      const ognType = (f.ogn_source?.device as any)?.aircraft as string | undefined;
      setGliderType(fleet?.glider_type || ognType || "");
      setGliderCallsign(fleet?.callsign || "");
    } else if (manual) {
      setGliderType("");
      setGliderCallsign("");
      setForm({
      flight_date: date, manual: true, launch_type: "aerotow",
      glider_id: null, glider_registration: "", flarm_id: "",
      takeoff_time: null, landing_time: null,
      p1_name: "", p1_membership: "", p1_kind: "member", p1_charge: false,
      p2_name: "", p2_membership: "", p2_kind: "member", p2_charge: false,
      aerotow_height_ft: 2000, notes: "",
    });
    }
  }, [flight, manual, date, open]);

  const setPilot = (which: 1 | 2, name: string, membership: string) => {
    setForm((f) => ({ ...f, [`p${which}_name`]: name, [`p${which}_membership`]: membership }));
  };

  const p1Kind = (form.p1_kind ?? "member") as PilotKind;
  const p2Kind = (form.p2_kind ?? "member") as PilotKind;
  const notes = (form.notes ?? "").trim();
  // If a GFE is ticked, a voucher ID (digits) must be recorded in the comments.
  const gfeChargedNeedsVoucher = (p1Kind === "gfe" || p2Kind === "gfe");
  const hasVoucherId = /\d{3,}/.test(notes); // e.g. "1234"

  const save = async () => {
    if (gfeChargedNeedsVoucher && !hasVoucherId) {
      toast.error("Voucher ID required in comments for a GFE flight (digits only, e.g. \"1234\").");
      return;
    }
    const payload: any = {
      flight_date: form.flight_date || date,
      glider_id: form.glider_id || null,
      glider_registration: form.glider_registration || null,
      flarm_id: form.flarm_id || null,
      takeoff_time: form.takeoff_time || null,
      landing_time: form.landing_time || null,
      p1_kind: p1Kind,
      p1_name: p1Kind === "gfe" ? null : (form.p1_name || null),
      p1_membership: p1Kind === "member" ? (form.p1_membership || null) : null,
      p1_charge: !!form.p1_charge,
      p2_kind: p2Kind,
      p2_name: p2Kind === "gfe" ? null : (form.p2_name || null),
      p2_membership: p2Kind === "member" ? (form.p2_membership || null) : null,
      p2_charge: !!form.p2_charge,
      launch_type: form.launch_type || null,
      aerotow_height_ft: form.launch_type === "aerotow" ? (form.aerotow_height_ft ?? null) : null,
      manual: !!form.manual,
      notes: notes || null,
      logged_by: form.logged_by || null,
    };
    let error;
    if (flight?.id) ({ error } = await supabase.from("flights").update(payload).eq("id", flight.id));
    else ({ error } = await supabase.from("flights").insert(payload));
    if (error) return toast.error(error.message);
    // Auto-add new members
    await Promise.all([
      maybeAddMember(members, p1Kind, payload.p1_name, payload.p1_membership),
      maybeAddMember(members, p2Kind, payload.p2_name, payload.p2_membership),
    ]);
    // Auto-sync glider type/callsign into fleet so it auto-fills next time
    await maybeUpsertFleet(gliders, payload.glider_registration, gliderType, gliderCallsign, payload.flarm_id);
    toast.success("Saved");
    onSaved(payload.flight_date);
  };

  // Edit times in UK local (Europe/London) — handles BST/GMT automatically.
  const toLocalInput = (iso: string | null | undefined) => toUKLocalInput(iso);
  const fromLocal = (s: string) => fromUKLocalInput(s);

  const renderPilot = (which: 1 | 2, label: string) => {
    const kind = ((which === 1 ? form.p1_kind : form.p2_kind) ?? "member") as PilotKind;
    const name = (which === 1 ? form.p1_name : form.p2_name) ?? "";
    const mem = (which === 1 ? form.p1_membership : form.p2_membership) ?? "";
    const setKind = (k: PilotKind) => setForm((f) => ({ ...f, [`p${which}_kind`]: k }));
    return (
      <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 p-3 rounded-lg bg-secondary/40">
        <div className="md:col-span-2 flex items-center justify-between gap-2 flex-wrap">
          <div className="font-semibold text-sm">{label}</div>
          <div className="flex gap-3 text-sm flex-wrap">
            <label className="flex items-center gap-1"><input type="checkbox" checked={!!(which === 1 ? form.p1_charge : form.p2_charge)} onChange={(e) => setForm((f) => ({ ...f, [`p${which}_charge`]: e.target.checked }))} /> Ch (charge)</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={kind === "visitor"} onChange={(e) => setKind(e.target.checked ? "visitor" : "member")} /> Visitor</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={kind === "gfe"} onChange={(e) => setKind(e.target.checked ? "gfe" : "member")} /> GFE</label>
          </div>
        </div>
        {kind !== "gfe" && (
          <PilotPicker label="Name" members={members} value={name}
            onPick={(m) => setPilot(which, m.full_name, m.membership_number)}
            onText={(t) => setForm({ ...form, [`p${which}_name`]: t })} />
        )}
        {kind === "member" && (
          <div><Label>Membership #</Label><Input value={mem} onChange={(e) => setForm({ ...form, [`p${which}_membership`]: e.target.value })} /></div>
        )}
      </div>
    );
  };

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
              onSelect={(g) => {
                setForm({ ...form, glider_id: g?.id ?? null, glider_registration: g?.registration ?? form.glider_registration, flarm_id: g?.flarm_id ?? form.flarm_id });
                if (g?.glider_type) setGliderType(g.glider_type);
                if (g?.callsign) setGliderCallsign(g.callsign);
              }}
              onChangeText={(t) => {
                setForm({ ...form, glider_registration: t, glider_id: null });
                const fleet = lookupFleet(t);
                if (fleet) {
                  if (fleet.glider_type) setGliderType(fleet.glider_type);
                  if (fleet.callsign) setGliderCallsign(fleet.callsign);
                }
              }}
            />
          </div>
          <div>
            <Label>Type</Label>
            <Input placeholder="e.g. ASK-21" value={gliderType} onChange={(e) => setGliderType(e.target.value)} />
          </div>
          <div>
            <Label>Callsign</Label>
            <Input placeholder="e.g. KA" value={gliderCallsign} onChange={(e) => setGliderCallsign(e.target.value)} />
          </div>
          <div>
            <Label>Takeoff time (UK local)</Label>
            <Input type="datetime-local" step="1" value={toLocalInput(form.takeoff_time)} onChange={(e) => setForm({ ...form, takeoff_time: fromLocal(e.target.value) })} />
          </div>
          <div>
            <Label>Landing time (UK local)</Label>
            <Input type="datetime-local" step="1" value={toLocalInput(form.landing_time)} onChange={(e) => setForm({ ...form, landing_time: fromLocal(e.target.value) })} />
          </div>

          {renderPilot(1, "P1 (Pilot in command)")}
          {renderPilot(2, "P2 (Second pilot)")}

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
            <Label>
              Comments {gfeChargedNeedsVoucher && (
                <span className={hasVoucherId ? "text-muted-foreground text-xs ml-1" : "text-destructive text-xs ml-1"}>
                  · Voucher ID required (digits only, e.g. "1234")
                </span>
              )}
            </Label>
            <Textarea
              rows={3}
              placeholder={gfeChargedNeedsVoucher ? "Voucher ID required, e.g. 1234" : "Add any comments about this flight…"}
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={gfeChargedNeedsVoucher && !hasVoucherId ? "border-destructive/60 focus-visible:ring-destructive/40" : ""}
            />
          </div>
          <div>
            <Label>Logged By (initials)</Label>
            <InitialsPicker
              value={form.logged_by ?? ""}
              options={previousInitials}
              onChange={(v) => setForm({ ...form, logged_by: v.toUpperCase() })}
            />
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
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return members.filter((m) => m.full_name.toLowerCase().includes(q)).slice(0, 6);
  }, [members, value]);
  const showList = focused && filtered.length > 0;
  const handleText = (t: string) => {
    onText(t);
    const exact = members.find((m) => norm(m.full_name) === norm(t));
    if (exact) onPick(exact);
  };
  return (
    <div className="relative">
      <Label>{label}</Label>
      <Input
        value={value}
        placeholder="Type a name…"
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => handleText(e.target.value)}
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

function MemberNamePicker({ members, value, onChange, disabled }: {
  members: Member[]; value: string; onChange: (name: string) => void; disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return members.filter((m) => {
      const name = m.full_name.toLowerCase();
      if (name.includes(q)) return true;
      const initials = m.full_name.split(/\s+/).filter(Boolean).map((p) => p[0]?.toLowerCase() ?? "").join("");
      return initials.startsWith(q.replace(/\s+/g, ""));
    }).slice(0, 6);
  }, [members, value]);
  const showList = focused && filtered.length > 0;
  return (
    <div className="relative">
      <Input
        value={value}
        placeholder="Type a name…"
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => onChange(e.target.value)}
      />
      {showList && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.map((m) => (
            <button
              type="button"
              key={m.id}
              className="w-full text-left px-3 py-2 hover:bg-accent"
              onMouseDown={(e) => { e.preventDefault(); onChange(m.full_name); setFocused(false); }}
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

function InitialsPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return list.slice(0, 8);
  }, [options, value]);
  const showList = focused && filtered.length > 0;
  return (
    <div className="relative">
      <Input
        maxLength={5}
        placeholder="e.g. RC"
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => onChange(e.target.value)}
      />
      {showList && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.map((o) => (
            <button
              type="button"
              key={o}
              className="w-full text-left px-3 py-2 hover:bg-accent text-sm font-mono"
              onMouseDown={(e) => { e.preventDefault(); onChange(o); setFocused(false); }}
            >
              {o}
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
  p1_name: string; p1_membership: string; p1_kind: PilotKind;
  p2_name: string; p2_membership: string; p2_kind: PilotKind;
  launch_type: "aerotow" | "winch"; aerotow_height_ft: number;
};

const blankRow = (): BulkRow => ({
  glider_id: null, glider_registration: "", flarm_id: "",
  takeoff_time: "", landing_time: "",
  p1_name: "", p1_membership: "", p1_kind: "member",
  p2_name: "", p2_membership: "", p2_kind: "member",
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

    // Bulk row times are entered as UK local time and stored as UTC.
  const fromLocal = (s: string) => {
      return fromUKLocalInput(s);
  };

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
      p1_kind: r.p1_kind,
      p1_name: r.p1_kind === "gfe" ? null : (r.p1_name || null),
      p1_membership: r.p1_kind === "member" ? (r.p1_membership || null) : null,
      p2_kind: r.p2_kind,
      p2_name: r.p2_kind === "gfe" ? null : (r.p2_name || null),
      p2_membership: r.p2_kind === "member" ? (r.p2_membership || null) : null,
      launch_type: r.launch_type,
      aerotow_height_ft: r.launch_type === "aerotow" ? r.aerotow_height_ft : null,
      manual: true,
    }));
    const { error } = await supabase.from("flights").insert(payload);
    if (error) return toast.error(error.message);
    await Promise.all(payload.flatMap((p) => [
      maybeAddMember(members, p.p1_kind, p.p1_name, p.p1_membership),
      maybeAddMember(members, p.p2_kind, p.p2_name, p.p2_membership),
    ]));
    toast.success(`${payload.length} flights logged`);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] md:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk add flights — {fmtUKDate(date)}</DialogTitle>
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
                  <Label className="text-xs">Takeoff (UK local)</Label>
                <Input type="datetime-local" step="1" value={r.takeoff_time} onChange={(e) => update(i, { takeoff_time: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                  <Label className="text-xs">Landing (UK local)</Label>
                <Input type="datetime-local" step="1" value={r.landing_time} onChange={(e) => update(i, { landing_time: e.target.value })} />
              </div>
              <div className="md:col-span-2 space-y-1">
                <div className="flex gap-2 text-xs">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={r.p1_kind === "visitor"} onChange={(e) => update(i, { p1_kind: e.target.checked ? "visitor" : "member" })} />Visitor</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={r.p1_kind === "gfe"} onChange={(e) => update(i, { p1_kind: e.target.checked ? "gfe" : "member" })} />GFE</label>
                </div>
                {r.p1_kind !== "gfe" && (
                  <PilotPicker label="P1" members={members} value={r.p1_name}
                    onPick={(m) => update(i, { p1_name: m.full_name, p1_membership: m.membership_number })}
                    onText={(t) => update(i, { p1_name: t })} />
                )}
                {r.p1_kind === "member" && (
                  <Input className="mt-1" placeholder="P1 #" value={r.p1_membership} onChange={(e) => update(i, { p1_membership: e.target.value })} />
                )}
              </div>
              <div className="md:col-span-2 space-y-1">
                <div className="flex gap-2 text-xs">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={r.p2_kind === "visitor"} onChange={(e) => update(i, { p2_kind: e.target.checked ? "visitor" : "member" })} />Visitor</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={r.p2_kind === "gfe"} onChange={(e) => update(i, { p2_kind: e.target.checked ? "gfe" : "member" })} />GFE</label>
                </div>
                {r.p2_kind !== "gfe" && (
                  <PilotPicker label="P2" members={members} value={r.p2_name}
                    onPick={(m) => update(i, { p2_name: m.full_name, p2_membership: m.membership_number })}
                    onText={(t) => update(i, { p2_name: t })} />
                )}
                {r.p2_kind === "member" && (
                  <Input className="mt-1" placeholder="P2 #" value={r.p2_membership} onChange={(e) => update(i, { p2_membership: e.target.value })} />
                )}
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
