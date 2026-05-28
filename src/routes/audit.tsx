import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { History, ChevronDown, RefreshCw } from "lucide-react";
import { fmtUKDate, fmtUKTimeSec, todayUKDate } from "@/lib/uktime";
import { format, subDays } from "date-fns";

export const Route = createFileRoute("/audit")({
  beforeLoad: async () => {
    await requireAuth();
    const { data } = await supabase.auth.getUser();
    if ((data.user?.email || "").toLowerCase() !== "office@esgc.local") {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({ meta: [{ title: "Audit log — ESGC Logs" }, { name: "description", content: "Who edited which flight, and when." }] }),
  component: AuditPage,
});

type AuditRow = {
  id: number;
  flight_id: string;
  flight_date: string | null;
  glider_registration: string | null;
  action: "insert" | "update" | "delete";
  changed_at: string;
  changed_by: string | null;
  changed_by_email: string | null;
  before_row: any;
  after_row: any;
  changed_fields: string[] | null;
};

const HIDDEN_FIELDS = new Set(["updated_at", "created_at", "id"]);

function describeValue(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtUKTimeSec(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function AuditPage() {
  const today = todayUKDate();
  const defaultFrom = format(subDays(new Date(`${today}T12:00:00Z`), 13), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(today);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    // changed_at filter: from 00:00:00 of fromDate to 23:59:59 of toDate in UK time approximation
    const fromIso = new Date(`${fromDate}T00:00:00Z`).toISOString();
    const toIso = new Date(`${toDate}T23:59:59Z`).toISOString();
    const { data, error } = await supabase
      .from("flight_audit")
      .select("*")
      .gte("changed_at", fromIso)
      .lte("changed_at", toIso)
      .order("changed_at", { ascending: false })
      .limit(1000);
    if (error) console.error(error);
    const list = (data as AuditRow[]) ?? [];
    setRows(list);
    // Load profiles for names
    const ids = Array.from(new Set(list.map((r) => r.changed_by).filter(Boolean) as string[]));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const map: Record<string, string> = {};
      for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
        if (p.full_name) map[p.id] = p.full_name;
      }
      setProfiles(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [fromDate, toDate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.glider_registration, r.changed_by_email, r.flight_date, r.action, ...(r.changed_fields || [])]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const stats = useMemo(() => {
    let ins = 0, upd = 0, del = 0;
    for (const r of filtered) {
      if (r.action === "insert") ins++;
      else if (r.action === "update") upd++;
      else if (r.action === "delete") del++;
    }
    return { ins, upd, del, total: filtered.length };
  }, [filtered]);

  const who = (r: AuditRow) =>
    (r.changed_by && profiles[r.changed_by]) || r.changed_by_email || "system";

  const actionVariant = (a: AuditRow["action"]) =>
    a === "insert" ? "default" : a === "update" ? "secondary" : "destructive";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <History className="size-6 text-primary" />
        <h1 className="text-2xl md:text-3xl font-bold">Audit log</h1>
      </div>

      <Card>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Search (reg, user, field)</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="G-CKHU, jane@…, takeoff_time" />
          </div>
          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2 pt-2">
            <Badge variant="default">{stats.ins} created</Badge>
            <Badge variant="secondary">{stats.upd} edited</Badge>
            <Badge variant="destructive">{stats.del} deleted</Badge>
            <span className="text-xs text-muted-foreground ml-auto">{stats.total} entries</span>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {filtered.map((r) => {
          const fields = (r.changed_fields || []).filter((k) => !HIDDEN_FIELDS.has(k));
          return (
            <Collapsible key={r.id}>
              <Card>
                <CollapsibleTrigger asChild>
                  <div className="p-3 flex flex-wrap items-center gap-2 cursor-pointer hover:bg-accent/40">
                    <Badge variant={actionVariant(r.action) as any}>{r.action}</Badge>
                    <span className="font-medium">{r.glider_registration || "—"}</span>
                    <span className="text-sm text-muted-foreground">
                      {r.flight_date ? fmtUKDate(r.flight_date) : "—"}
                    </span>
                    {fields.length > 0 && (
                      <span className="text-xs text-muted-foreground truncate max-w-full">
                        · {fields.slice(0, 4).join(", ")}{fields.length > 4 ? "…" : ""}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {fmtUKDate(r.changed_at.slice(0, 10))} {fmtUKTimeSec(r.changed_at)}
                    </span>
                    <span className="text-xs text-muted-foreground hidden sm:inline">· {who(r)}</span>
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 text-sm">
                    <div className="text-xs text-muted-foreground mb-2 sm:hidden">by {who(r)}</div>
                    {r.action === "update" && fields.length > 0 && (
                      <div className="rounded-md border divide-y">
                        {fields.map((k) => (
                          <div key={k} className="grid grid-cols-12 gap-2 p-2 text-xs">
                            <div className="col-span-3 sm:col-span-2 font-mono text-muted-foreground">{k}</div>
                            <div className="col-span-4 sm:col-span-5 font-mono text-destructive line-through truncate">
                              {describeValue(r.before_row?.[k])}
                            </div>
                            <div className="col-span-5 sm:col-span-5 font-mono text-primary truncate">
                              {describeValue(r.after_row?.[k])}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {r.action === "insert" && (
                      <div className="text-xs text-muted-foreground">Flight created.</div>
                    )}
                    {r.action === "delete" && (
                      <div className="text-xs text-muted-foreground">Flight deleted.</div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}

        {!loading && filtered.length === 0 && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">No audit entries in this range.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
