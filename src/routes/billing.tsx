import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Receipt, Download } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { computeFlightCharge, fmtGBP, type FlightLike } from "@/lib/pricing";

export const Route = createFileRoute("/billing")({
  beforeLoad: requireAuth,
  component: BillingPage,
});

const ALLOWED_EMAILS = ["office@esgc.local", "caravan@esgc.local"];

type Member = { id: string; full_name: string; membership_number: string; under_21: boolean };
type Flight = FlightLike & {
  id: string;
  flight_date: string;
  p1_name: string | null; p1_membership: string | null; p1_kind: string | null; p1_charge: boolean | null;
  p2_name: string | null; p2_membership: string | null; p2_kind: string | null; p2_charge: boolean | null;
};

type Mode = "day" | "month";

function BillingPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("day");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setAllowed(ALLOWED_EMAILS.includes((data.user?.email || "").toLowerCase()));
    });
  }, []);

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      const [from, to] = mode === "day"
        ? [date, date]
        : [format(startOfMonth(new Date(month + "-01")), "yyyy-MM-dd"),
           format(endOfMonth(new Date(month + "-01")), "yyyy-MM-dd")];
      const [{ data: m }, { data: f }] = await Promise.all([
        supabase.from("club_members").select("*").order("full_name"),
        supabase.from("flights").select("id, flight_date, glider_registration, takeoff_time, landing_time, launch_type, aerotow_height_ft, p1_name, p1_membership, p1_kind, p1_charge, p2_name, p2_membership, p2_kind, p2_charge")
          .gte("flight_date", from).lte("flight_date", to)
          .order("flight_date", { ascending: true })
          .order("takeoff_time", { ascending: true, nullsFirst: false })
          .limit(20000),
      ]);
      setMembers((m as Member[]) ?? []);
      setFlights((f as Flight[]) ?? []);
    })();
  }, [allowed, mode, date, month]);

  const memberByKey = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) {
      map.set(`m:${m.membership_number.trim().toUpperCase()}`, m);
      map.set(`n:${m.full_name.trim().toUpperCase()}`, m);
    }
    return map;
  }, [members]);

  // Build per-pilot bills — show both standard and U21 prices
  type FlightEntry = {
    flight: Flight;
    role: "P1" | "P2";
    standard: ReturnType<typeof computeFlightCharge>;
    u21: ReturnType<typeof computeFlightCharge>;
    applied: ReturnType<typeof computeFlightCharge>;
  };
  type Row = {
    member: Member;
    flights: FlightEntry[];
    totalStandard: number;
    totalU21: number;
    totalApplied: number;
  };

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    const addCharge = (flight: Flight, role: "P1" | "P2") => {
      const kind = role === "P1" ? flight.p1_kind : flight.p2_kind;
      const charge = role === "P1" ? flight.p1_charge : flight.p2_charge;
      const name = (role === "P1" ? flight.p1_name : flight.p2_name) || "";
      const memNo = (role === "P1" ? flight.p1_membership : flight.p2_membership) || "";
      if (!charge || kind !== "member") return;
      const member =
        memberByKey.get(`m:${memNo.trim().toUpperCase()}`) ??
        memberByKey.get(`n:${name.trim().toUpperCase()}`);
      if (!member) return;
      const standard = computeFlightCharge(flight, false);
      const u21 = computeFlightCharge(flight, true);
      const applied = member.under_21 ? u21 : standard;
      if (applied.total <= 0) return;
      let row = map.get(member.id);
      if (!row) { row = { member, flights: [], totalStandard: 0, totalU21: 0, totalApplied: 0 }; map.set(member.id, row); }
      row.flights.push({ flight, role, standard, u21, applied });
      row.totalStandard = +(row.totalStandard + standard.total).toFixed(2);
      row.totalU21 = +(row.totalU21 + u21.total).toFixed(2);
      row.totalApplied = +(row.totalApplied + applied.total).toFixed(2);
    };
    for (const f of flights) { addCharge(f, "P1"); addCharge(f, "P2"); }
    let arr = [...map.values()].sort((a, b) => b.totalApplied - a.totalApplied);
    const q = search.trim().toLowerCase();
    if (q) arr = arr.filter((r) =>
      r.member.full_name.toLowerCase().includes(q) ||
      r.member.membership_number.toLowerCase().includes(q));
    return arr;
  }, [flights, memberByKey, search]);

  const grandTotal = rows.reduce((s, r) => s + r.totalApplied, 0);

  const periodLabel = mode === "day" ? date : month;
  const csvEscape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  function downloadCSV(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
  function exportGeneric() {
    const headers = ["Date","Member #","Member Name","U21","Glider","Role","Launch","Soaring","TMG","Total","Notes"];
    const lines = [headers.join(",")];
    for (const r of rows) for (const fe of r.flights) {
      lines.push([
        fe.flight.flight_date, r.member.membership_number, r.member.full_name,
        r.member.under_21 ? "Y" : "N",
        fe.flight.glider_registration || "", fe.role,
        fe.applied.launch.toFixed(2), fe.applied.soaring.toFixed(2), fe.applied.motorGlider.toFixed(2),
        fe.applied.total.toFixed(2), fe.applied.notes.join(" · "),
      ].map(csvEscape).join(","));
    }
    downloadCSV(`billing-${periodLabel}.csv`, lines.join("\n"));
  }
  function exportAeroLog() {
    const headers = ["MemberNumber","Date","Description","Amount","Reference"];
    const lines = [headers.join(",")];
    for (const r of rows) for (const fe of r.flights) {
      const desc = `${fe.flight.glider_registration || "Flight"} ${fe.role} — ${fe.applied.notes.join("; ")}`;
      lines.push([
        r.member.membership_number, fe.flight.flight_date, desc,
        fe.applied.total.toFixed(2), fe.flight.id.slice(0, 8),
      ].map(csvEscape).join(","));
    }
    downloadCSV(`aerolog-${periodLabel}.csv`, lines.join("\n"));
  }


  if (allowed === null) return <div className="text-muted-foreground">Loading…</div>;
  if (!allowed) return (
    <div className="max-w-md mx-auto text-center py-20">
      <h1 className="text-2xl font-bold">Restricted</h1>
      <p className="text-muted-foreground mt-2">Billing is only available to office and caravan accounts.</p>
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Receipt className="size-6 md:size-7 text-primary" /> Billing</h1>
        <p className="text-sm text-muted-foreground">Charges per member, computed from the daily flight log using ESGC 2026 prices.</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Period &amp; search</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <div className="flex gap-1">
            <button onClick={() => setMode("day")} className={`flex-1 px-3 py-2 rounded-md text-sm border ${mode === "day" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>Day</button>
            <button onClick={() => setMode("month")} className={`flex-1 px-3 py-2 rounded-md text-sm border ${mode === "month" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>Month</button>
          </div>
          {mode === "day" ? (
            <div><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full" /></div>
          ) : (
            <div><Label className="text-xs">Month</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-full" /></div>
          )}
          <div className="sm:col-span-2 lg:col-span-1">
            <Label className="text-xs">Search name or membership #</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Smith or 1234" />
          </div>
          <div className="flex items-center justify-between gap-2 sm:col-span-2 lg:col-span-1">
            <Badge variant="default" className="text-sm px-3 py-1.5 truncate">Total {fmtGBP(grandTotal)}</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={rows.length === 0}>
                  <Download className="size-4 mr-1" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportGeneric}>Generic CSV (Excel)</DropdownMenuItem>
                <DropdownMenuItem onClick={exportAeroLog}>AeroLog Cloud CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      {rows.map((r) => (
        <Card key={r.member.id}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between flex-wrap gap-2">
              <span className="flex items-center gap-2">
                {r.member.full_name}
                <span className="font-mono text-sm text-muted-foreground">#{r.member.membership_number}</span>
                {r.member.under_21 && <Badge variant="secondary">U21</Badge>}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-sm">Normal {fmtGBP(r.totalStandard)}</Badge>
                <Badge variant="outline" className="text-sm">U21 {fmtGBP(r.totalU21)}</Badge>
                <Badge className="text-base">{r.member.under_21 ? "U21" : "Normal"} {fmtGBP(r.totalApplied)}</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="min-w-[980px]">
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Glider</TableHead><TableHead>Role</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Launch (N)</TableHead>
                <TableHead className="text-right">Soaring (N)</TableHead>
                <TableHead className="text-right">TMG (N)</TableHead>
                <TableHead className="text-right border-l">Launch (U21)</TableHead>
                <TableHead className="text-right">Soaring (U21)</TableHead>
                <TableHead className="text-right">TMG (U21)</TableHead>
                <TableHead className="text-right border-l">Normal</TableHead>
                <TableHead className="text-right">U21</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {r.flights.map(({ flight, standard, u21, role }, i) => (
                  <TableRow key={flight.id + role + i}>
                    <TableCell className="font-mono text-xs">{flight.flight_date}</TableCell>
                    <TableCell className="font-medium">{flight.glider_registration || "—"}</TableCell>
                    <TableCell>{role}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{standard.notes.join(" · ")}</TableCell>
                    <TableCell className="text-right">{standard.launch ? fmtGBP(standard.launch) : "—"}</TableCell>
                    <TableCell className="text-right">{standard.soaring ? fmtGBP(standard.soaring) : "—"}</TableCell>
                    <TableCell className="text-right">{standard.motorGlider ? fmtGBP(standard.motorGlider) : "—"}</TableCell>
                    <TableCell className="text-right border-l">{u21.launch ? fmtGBP(u21.launch) : "—"}</TableCell>
                    <TableCell className="text-right">{u21.soaring ? fmtGBP(u21.soaring) : "—"}</TableCell>
                    <TableCell className="text-right">{u21.motorGlider ? fmtGBP(u21.motorGlider) : "—"}</TableCell>
                    <TableCell className={`text-right font-semibold border-l ${!r.member.under_21 ? "text-primary" : ""}`}>{fmtGBP(standard.total)}</TableCell>
                    <TableCell className={`text-right font-semibold ${r.member.under_21 ? "text-primary" : ""}`}>{fmtGBP(u21.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {rows.length === 0 && (
        <Card><CardContent className="text-center text-muted-foreground py-12">No charges in this period{search ? " for that search" : ""}.</CardContent></Card>
      )}
    </div>
  );
}
