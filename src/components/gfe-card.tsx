import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Plane, Phone } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { cngSyncNow } from "@/lib/cng-sync.functions";
import { fmtUKDate } from "@/lib/uktime";

type GfeRow = {
  id: string;
  position: number;
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

function sortByTime(rows: GfeRow[]): GfeRow[] {
  return [...rows].sort((a, b) => {
    if (!a.time_text && !b.time_text) return 0;
    if (!a.time_text) return 1;
    if (!b.time_text) return -1;
    return a.time_text.localeCompare(b.time_text);
  });
}

export function GfeCard({ date }: { date: string }) {
  const [rows, setRows] = useState<GfeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const sync = useServerFn(cngSyncNow);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: gfes }, { data: settings }] = await Promise.all([
      supabase
        .from("daily_gfes")
        .select("*")
        .eq("flight_date", date)
        .order("position", { ascending: true }),
      supabase.from("cng_settings").select("last_sync_at").eq("id", 1).maybeSingle(),
    ]);
    setRows((gfes ?? []) as GfeRow[]);
    setLastSync(settings?.last_sync_at ?? null);
    setLoading(false);
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  // Realtime: keep tick-off state in sync across devices/sessions.
  useEffect(() => {
    // Coalesce bursts (a CNG sync can fire many row events in a row) into one
    // refetch so the list never thrashes, while still feeling instant.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; void load(); }, 100);
    };
    const ch = supabase
      .channel(`daily-gfes-rt-${date}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_gfes", filter: `flight_date=eq.${date}` },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cng_settings" },
        () => { void load(); },
      )
      .subscribe();
    return () => { if (pending) clearTimeout(pending); supabase.removeChannel(ch); };
  }, [date, load]);

  const onSync = async () => {
    setSyncing(true);
    try {
      const res = await sync({ data: { date } });
      if (res.skipped) {
        toast.info(res.reason ?? "Sync disabled");
      } else {
        toast.success(`Synced ${res.gfes_inserted ?? 0} GFEs from Click n' Glide`);
      }
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleToggle = async (id: string, val: boolean) => {
    const nowIso = new Date().toISOString();
    // Optimistic update
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

  const gfeRows = sortByTime(rows.filter((r) => r.source === "cng"));
  const tmgRows = sortByTime(rows.filter((r) => r.source === "cng-tmg"));
  const gfeDone = gfeRows.filter((r) => r.checked).length;
  const tmgDone = tmgRows.filter((r) => r.checked).length;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2 text-base flex-wrap">
            <Plane className="size-4 shrink-0" />
            <span className="truncate">GFEs — {fmtUKDate(date)}</span>
            <Badge variant="secondary" className="text-xs">{gfeRows.length} glider</Badge>
            {tmgRows.length > 0 && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">
                {tmgRows.length} TMG
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            From Click n&apos; Glide ·{" "}
            {lastSync
              ? `Last sync ${new Date(lastSync).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}`
              : "Not yet synced"}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onSync} disabled={syncing} className="shrink-0">
          <RefreshCw className={`size-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-xs italic text-muted-foreground mb-3">Jeffries as Russ says</p>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No GFEs booked for this day.</p>
        ) : (
          <>
            {/* Glider GFEs */}
            {gfeRows.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground mb-2">
                  {gfeDone}/{gfeRows.length} completed
                </p>
                <ul className="divide-y divide-border/60 -my-2">
                  {gfeRows.map((r) => (
                    <GfeRowItem key={r.id} row={r} onToggle={handleToggle} />
                  ))}
                </ul>
              </>
            )}

            {/* TMG section */}
            {tmgRows.length > 0 && (
              <div className="mt-5 pt-4 border-t">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <span className="w-1 h-4 rounded-full bg-amber-400 inline-block" />
                  TMG GFEs (G-KIAU)
                  <Badge variant="outline" className="text-xs">{tmgRows.length}</Badge>
                </h3>
                <p className="text-xs text-muted-foreground mb-2">
                  {tmgDone}/{tmgRows.length} completed
                </p>
                <ul className="divide-y divide-border/60 -my-2">
                  {tmgRows.map((r) => (
                    <GfeRowItem key={r.id} row={r} onToggle={handleToggle} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GfeRowItem({ row: r, onToggle }: { row: GfeRow; onToggle: (id: string, val: boolean) => void }) {
  const hasName = !!r.passenger_name?.trim();
  const meta = [r.gfe_type, r.ref].filter(Boolean).join(" · ");
  const telHref = r.phone ? `tel:${r.phone.replace(/[^\d+]/g, "")}` : null;
  return (
    <li className={`flex items-start gap-3 py-2 text-sm transition-opacity ${r.checked ? "opacity-50" : ""}`}>
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
        {r.source === "cng-tmg" && <Badge variant="secondary">TMG</Badge>}
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
