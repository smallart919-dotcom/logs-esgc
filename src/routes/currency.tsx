import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import { format, differenceInDays } from "date-fns";

export const Route = createFileRoute("/currency")({
  beforeLoad: requireAuth,
  component: CurrencyPage,
});

type Member = { id: string; full_name: string; membership_number: string };
type FlightRow = {
  flight_date: string;
  takeoff_time: string | null;
  launch_type: "aerotow" | "winch" | null;
  p1_kind: string | null; p1_name: string | null; p1_membership: string | null;
  p2_kind: string | null; p2_name: string | null; p2_membership: string | null;
};

type Entry = {
  key: string;
  name: string;
  membership: string;
  lastAerotow: string | null;
  lastWinch: string | null;
  lastAny: string | null;
};

function CurrencyPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [flights, setFlights] = useState<FlightRow[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: f }] = await Promise.all([
        supabase.from("club_members").select("id, full_name, membership_number").order("full_name"),
        supabase
          .from("flights")
          .select("flight_date, takeoff_time, launch_type, p1_kind, p1_name, p1_membership, p2_kind, p2_name, p2_membership")
          .in("launch_type", ["aerotow", "winch"])
          .order("flight_date", { ascending: false })
          .limit(20000),
      ]);
      setMembers((m as Member[]) ?? []);
      setFlights((f as FlightRow[]) ?? []);
    })();
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const map = new Map<string, Entry>();
    const ensure = (membership: string, name: string) => {
      const key = membership.trim().toLowerCase() || `name:${name.trim().toLowerCase()}`;
      if (!key) return null;
      let e = map.get(key);
      if (!e) {
        e = { key, name: name.trim(), membership: membership.trim(), lastAerotow: null, lastWinch: null, lastAny: null };
        map.set(key, e);
      } else {
        if (!e.name && name) e.name = name.trim();
        if (!e.membership && membership) e.membership = membership.trim();
      }
      return e;
    };

    // seed with members so everyone shows even if no flights
    for (const mem of members) ensure(mem.membership_number, mem.full_name);

    for (const f of flights) {
      if (!f.launch_type) continue;
      const date = f.flight_date;
      for (const side of [
        { kind: f.p1_kind, name: f.p1_name, mem: f.p1_membership },
        { kind: f.p2_kind, name: f.p2_name, mem: f.p2_membership },
      ]) {
        if (side.kind !== "member") continue;
        if (!side.mem && !side.name) continue;
        const e = ensure(side.mem || "", side.name || "");
        if (!e) continue;
        if (f.launch_type === "aerotow" && (!e.lastAerotow || date > e.lastAerotow)) e.lastAerotow = date;
        if (f.launch_type === "winch" && (!e.lastWinch || date > e.lastWinch)) e.lastWinch = date;
        if (!e.lastAny || date > e.lastAny) e.lastAny = date;
      }
    }

    const arr = Array.from(map.values()).filter((e) => e.lastAny || e.membership);
    arr.sort((a, b) => {
      if (a.lastAny && b.lastAny) return a.lastAny < b.lastAny ? 1 : -1;
      if (a.lastAny) return -1;
      if (b.lastAny) return 1;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }, [members, flights]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.name.toLowerCase().includes(q) || e.membership.toLowerCase().includes(q)
    );
  }, [entries, filter]);

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const days = differenceInDays(new Date(), new Date(d));
    return `${format(new Date(d), "d MMM yyyy")} (${days === 0 ? "today" : `${days}d`})`;
  };

  const currencyBadge = (d: string | null) => {
    if (!d) return <Badge variant="outline">never</Badge>;
    const days = differenceInDays(new Date(), new Date(d));
    if (days <= 30) return <Badge className="bg-emerald-600 hover:bg-emerald-600">current</Badge>;
    if (days <= 90) return <Badge className="bg-amber-500 hover:bg-amber-500">watch</Badge>;
    return <Badge variant="destructive">lapsed</Badge>;
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Activity className="size-7 text-primary" /> Currency
        </h1>
        <p className="text-muted-foreground">Last aerotow and winch flight per member.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <CardTitle>{filtered.length} pilots</CardTitle>
            <div className="ml-auto">
              <Label className="text-xs">Filter</Label>
              <Input
                placeholder="Name or membership #"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-56"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead>Pilot</TableHead>
                <TableHead>Membership</TableHead>
                <TableHead>Last aerotow</TableHead>
                <TableHead>Last winch</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.key}>
                  <TableCell className="font-medium">{e.name || "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{e.membership || "—"}</TableCell>
                  <TableCell>{fmtDate(e.lastAerotow)}</TableCell>
                  <TableCell>{fmtDate(e.lastWinch)}</TableCell>
                  <TableCell>{currencyBadge(e.lastAny)}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No matching pilots.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
