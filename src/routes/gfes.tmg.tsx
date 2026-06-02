import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plane, RefreshCw, Search, Phone } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { cngSyncNow } from "@/lib/cng-sync.functions";
import { fmtUKDate, todayUKDate } from "@/lib/uktime";

type GfeRow = {
  id: string;
  position: number;
  flight_date: string;
  time_text: string | null;
  passenger_name: string | null;
  gfe_type: string | null;
  ref: string | null;
  phone: string | null;
  notes: string | null;
  raw_text: string;
  source: string;
  checked: boolean;
  checked_at: string | null;
};

export const Route = createFileRoute("/gfes/tmg")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "TMG GFEs — ESGC Logs" },
      { name: "description", content: "Dedicated TMG GFE management — G-KIAU bookings from Click n' Glide." },
    ],
  }),
  component: TmgGfePage,
});

function TmgGfePage() {
  const [date, setDate] = useState<string>(() => todayUKDate());
  const [rows, setRows] = useState<GfeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const sync = useServerFn(cngSyncNow);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("daily_gfes")
      .select("*")
      .eq("flight_date", date)
      .eq("source", "cng-tmg")
      .order("position", { ascending: true });
    setRows((data ?? []) as GfeRow[]);
    setLoading(false);
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  // Realtime updates so multiple devices stay in sync.
  useEffect(() => {
    const ch = supabase
      .channel(`tmg-gfes-rt-${date}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_gfes", filter: `flight_date=eq.${date}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [date, load]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => filter === "all" || (filter === "done" ? r.checked : !r.checked))
      .filter((r) => {
        if (!needle) return true;
        return [r.passenger_name, r.gfe_type, r.ref, r.phone, r.notes, r.raw_text]
          .some((v) => (v ?? "").toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        if (!a.time_text && !b.time_text) return 0;
        if (!a.time_text) return 1;
        if (!b.time_text) return -1;
        return a.time_text.localeCompare(b.time_text);
      });
  }, [rows, q, filter]);

  const total = rows.length;
  const done = rows.filter((r) => r.checked).length;

  const handleToggle = async (id: string, val: boolean) => {
    const nowIso = new Date().toISOString();
    setRows((prev) => prev.map((x) =>
      x.id === id ? { ...x, checked: val, checked_at: val ? nowIso : null } : x,
    ));
    const { error } = await supabase
      .from("daily_gfes")
      .update({ checked: val, checked_at: val ? nowIso : null })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      void load();
    }
  };

  const onSync = async () => {
    setSyncing(true);
    try {
      const res = await sync({ data: { date } });
      if (res.skipped) toast.info(res.reason ?? "Sync disabled");
      else toast.success(`Synced ${res.gfes_inserted ?? 0} GFEs from Click n' Glide`);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Plane className="size-6 text-amber-500" /> TMG GFEs
          </h1>
          <p className="text-sm text-muted-foreground">G-KIAU bookings from Click n&apos; Glide · {fmtUKDate(date)}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </div>
          <Button variant="outline" size="sm" onClick={onSync} disabled={syncing}>
            <RefreshCw className={`size-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Badge variant="outline" className="text-amber-600 border-amber-400">G-KIAU</Badge>
            <span>{done}/{total} completed</span>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, ref, phone…"
                className="pl-7 h-8 w-56"
              />
            </div>
            <div className="flex rounded-md border overflow-hidden text-xs">
              {(["all", "pending", "done"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`px-2.5 py-1 transition ${filter === k ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                >
                  {k === "all" ? "All" : k === "pending" ? "Pending" : "Done"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {total === 0 ? "No TMG GFEs booked for this day." : "No matches for current filter."}
            </p>
          ) : (
            <ul className="divide-y divide-border/60 -my-2">
              {visible.map((r) => <TmgRow key={r.id} row={r} onToggle={handleToggle} />)}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TmgRow({ row: r, onToggle }: { row: GfeRow; onToggle: (id: string, val: boolean) => void }) {
  const hasName = !!r.passenger_name?.trim();
  const meta = [r.gfe_type, r.ref].filter(Boolean).join(" · ");
  const telHref = r.phone ? `tel:${r.phone.replace(/[^\d+]/g, "")}` : null;
  return (
    <li className={`flex items-start gap-3 py-3 text-sm transition-opacity ${r.checked ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={r.checked}
        aria-label={`Mark ${r.passenger_name ?? "GFE"} as flown`}
        onChange={(e) => onToggle(r.id, e.target.checked)}
        className="mt-1 size-4 rounded shrink-0 cursor-pointer accent-primary"
      />
      <span className={`font-mono text-xs text-muted-foreground w-14 shrink-0 mt-0.5 tabular-nums ${r.checked ? "line-through" : ""}`}>
        {r.time_text?.trim() || "—"}
      </span>
      <div className="flex-1 min-w-0">
        <div className={`font-medium break-words ${r.checked ? "line-through text-muted-foreground" : ""} ${!hasName ? "italic text-muted-foreground" : ""}`}>
          {hasName ? r.passenger_name : (r.raw_text?.trim() || "No details")}
        </div>
        {meta && <div className="text-xs text-muted-foreground break-words">{meta}</div>}
        {r.notes && (
          <div className="text-xs text-muted-foreground/90 italic break-words mt-0.5">{r.notes}</div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {telHref ? (
          <Button asChild size="sm" variant="outline" className="h-7 px-2 gap-1">
            <a href={telHref} aria-label={`Call ${r.passenger_name ?? "passenger"}`}>
              <Phone className="size-3" />
              <span className="tabular-nums text-xs">{r.phone}</span>
            </a>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground/60">no phone</span>
        )}
      </div>
    </li>
  );
}
