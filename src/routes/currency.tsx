import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, Pencil, Save, X } from "lucide-react";
import { differenceInDays } from "date-fns";
import { toast } from "sonner";
import { fmtUKDate, todayUKDate } from "@/lib/uktime";

export const Route = createFileRoute("/currency")({
  beforeLoad: requireAuth,
  component: CurrencyPage,
});

// BGA-recommended currency thresholds (days since last launch of that type).
// Within 90 days = current (green); 90–180 = caution (amber); >180 = lapsed (red).
const GREEN_DAYS = 90;
const AMBER_DAYS = 180;

type Member = {
  id: string;
  full_name: string;
  membership_number: string;
  currency_aerotow_override: string | null;
  currency_winch_override: string | null;
};
type FlightRow = {
  flight_date: string;
  launch_type: "aerotow" | "winch" | null;
  p1_kind: string | null; p1_name: string | null; p1_membership: string | null;
  p2_kind: string | null; p2_name: string | null; p2_membership: string | null;
};

type Entry = {
  key: string;
  memberId: string | null;
  name: string;
  membership: string;
  lastAerotowFlight: string | null;
  lastWinchFlight: string | null;
  aerotowOverride: string | null;
  winchOverride: string | null;
};

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function CurrencyPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [flights, setFlights] = useState<FlightRow[]>([]);
  const [filter, setFilter] = useState("");
  const [isOffice, setIsOffice] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAerotow, setEditAerotow] = useState("");
  const [editWinch, setEditWinch] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    const [{ data: m }, { data: f }] = await Promise.all([
      supabase
        .from("club_members")
        .select("id, full_name, membership_number, currency_aerotow_override, currency_winch_override")
        .order("full_name"),
      supabase
        .from("flights")
        .select("flight_date, launch_type, p1_kind, p1_name, p1_membership, p2_kind, p2_name, p2_membership")
        .in("launch_type", ["aerotow", "winch"])
        .order("flight_date", { ascending: false })
        .limit(20000),
    ]);
    setMembers((m as Member[]) ?? []);
    setFlights((f as FlightRow[]) ?? []);
  };

  useEffect(() => {
    reload();
    supabase.auth.getUser().then(({ data }) => {
      setIsOffice((data.user?.email || "").toLowerCase() === "office@esgc.local");
    });
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const map = new Map<string, Entry>();
    const ensure = (memberId: string | null, membership: string, name: string, overrides?: { a: string | null; w: string | null }) => {
      const key = (memberId && `id:${memberId}`) || (membership.trim().toLowerCase() && `m:${membership.trim().toLowerCase()}`) || `n:${name.trim().toLowerCase()}`;
      if (!key) return null;
      let e = map.get(key);
      if (!e) {
        e = {
          key,
          memberId,
          name: name.trim(),
          membership: membership.trim(),
          lastAerotowFlight: null,
          lastWinchFlight: null,
          aerotowOverride: overrides?.a ?? null,
          winchOverride: overrides?.w ?? null,
        };
        map.set(key, e);
      } else {
        if (memberId && !e.memberId) e.memberId = memberId;
        if (!e.name && name) e.name = name.trim();
        if (!e.membership && membership) e.membership = membership.trim();
        if (overrides) {
          if (overrides.a) e.aerotowOverride = overrides.a;
          if (overrides.w) e.winchOverride = overrides.w;
        }
      }
      return e;
    };

    for (const mem of members) {
      ensure(mem.id, mem.membership_number, mem.full_name, {
        a: mem.currency_aerotow_override,
        w: mem.currency_winch_override,
      });
    }

    for (const f of flights) {
      if (!f.launch_type) continue;
      for (const side of [
        { kind: f.p1_kind, name: f.p1_name, mem: f.p1_membership },
        { kind: f.p2_kind, name: f.p2_name, mem: f.p2_membership },
      ]) {
        if (side.kind !== "member") continue;
        if (!side.mem && !side.name) continue;
        const e = ensure(null, side.mem || "", side.name || "");
        if (!e) continue;
        if (f.launch_type === "aerotow" && (!e.lastAerotowFlight || f.flight_date > e.lastAerotowFlight)) e.lastAerotowFlight = f.flight_date;
        if (f.launch_type === "winch" && (!e.lastWinchFlight || f.flight_date > e.lastWinchFlight)) e.lastWinchFlight = f.flight_date;
      }
    }

    const arr = Array.from(map.values());
    const eff = (e: Entry) => maxDate(maxDate(e.lastAerotowFlight, e.aerotowOverride), maxDate(e.lastWinchFlight, e.winchOverride));
    arr.sort((a, b) => {
      const ea = eff(a), eb = eff(b);
      if (ea && eb) return ea < eb ? 1 : -1;
      if (ea) return -1;
      if (eb) return 1;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }, [members, flights]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q) || e.membership.toLowerCase().includes(q));
  }, [entries, filter]);

  const fmtCell = (d: string | null) => {
    if (!d) return "—";
    const days = differenceInDays(new Date(`${todayUKDate()}T12:00:00Z`), new Date(`${d}T12:00:00Z`));
    return `${fmtUKDate(d)} · ${days === 0 ? "today" : `${days}d`}`;
  };

  const currencyBadge = (d: string | null) => {
    if (!d) return <Badge variant="destructive">never</Badge>;
    const days = differenceInDays(new Date(`${todayUKDate()}T12:00:00Z`), new Date(`${d}T12:00:00Z`));
    if (days <= GREEN_DAYS) return <Badge className="bg-emerald-600 hover:bg-emerald-600">current</Badge>;
    if (days <= AMBER_DAYS) return <Badge className="bg-amber-500 hover:bg-amber-500">watch</Badge>;
    return <Badge variant="destructive">lapsed</Badge>;
  };

  const startEdit = (e: Entry) => {
    if (!e.memberId) {
      toast.error("This pilot isn't in the members table — add them in Members first.");
      return;
    }
    setEditingId(e.memberId);
    setEditAerotow(e.aerotowOverride ?? "");
    setEditWinch(e.winchOverride ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAerotow("");
    setEditWinch("");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    const { error } = await supabase
      .from("club_members")
      .update({
        currency_aerotow_override: editAerotow || null,
        currency_winch_override: editWinch || null,
      })
      .eq("id", editingId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Currency updated");
    cancelEdit();
    reload();
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Activity className="size-6 md:size-7 text-primary" /> Currency
        </h1>
        <p className="text-sm text-muted-foreground">
          Last aerotow and winch per pilot. BGA recommendation: current ≤ {GREEN_DAYS} days, watch ≤ {AMBER_DAYS} days, otherwise lapsed.
          {isOffice && " Office account: click the pencil to override last-flown dates."}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <CardTitle className="text-base">{filtered.length} pilots</CardTitle>
            <div className="ml-auto w-full sm:w-auto">
              <Label className="text-xs">Filter</Label>
              <Input
                placeholder="Name or membership #"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full sm:w-56"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead>Pilot</TableHead>
                <TableHead>Membership</TableHead>
                <TableHead>Last aerotow</TableHead>
                <TableHead>Aerotow</TableHead>
                <TableHead>Last winch</TableHead>
                <TableHead>Winch</TableHead>
                {isOffice && <TableHead className="text-right">Edit</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => {
                const aEff = maxDate(e.lastAerotowFlight, e.aerotowOverride);
                const wEff = maxDate(e.lastWinchFlight, e.winchOverride);
                const isEditing = editingId && e.memberId === editingId;
                return (
                  <TableRow key={e.key}>
                    <TableCell className="font-medium">{e.name || "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{e.membership || "—"}</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Input type="date" value={editAerotow} onChange={(ev) => setEditAerotow(ev.target.value)} className="h-8 w-40" />
                      ) : (
                        <>
                          {fmtCell(aEff)}
                          {e.aerotowOverride && (
                            <div className="text-[10px] text-muted-foreground">override</div>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell>{currencyBadge(aEff)}</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Input type="date" value={editWinch} onChange={(ev) => setEditWinch(ev.target.value)} className="h-8 w-40" />
                      ) : (
                        <>
                          {fmtCell(wEff)}
                          {e.winchOverride && (
                            <div className="text-[10px] text-muted-foreground">override</div>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell>{currencyBadge(wEff)}</TableCell>
                    {isOffice && (
                      <TableCell className="text-right whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <Button size="icon" variant="ghost" onClick={saveEdit} disabled={saving}>
                              <Save className="size-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={cancelEdit} disabled={saving}>
                              <X className="size-4" />
                            </Button>
                          </>
                        ) : (
                          <Button size="icon" variant="ghost" onClick={() => startEdit(e)}>
                            <Pencil className="size-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isOffice ? 7 : 6} className="text-center text-muted-foreground py-8">
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
