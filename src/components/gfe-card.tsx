import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Plane } from "lucide-react";
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
  raw_text: string;
  source: string;
};

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

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plane className="size-4 shrink-0" />
            <span className="truncate">GFEs — {fmtUKDate(date)}</span>
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
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No GFEs booked for this day.</p>
        ) : (
          <ul className="divide-y divide-border/60 -my-2">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start gap-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground w-14 shrink-0 mt-0.5 tabular-nums">
                  {r.time_text ?? "—"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium break-words">
                    {r.passenger_name ?? r.raw_text}
                  </div>
                  {(r.gfe_type || r.ref) && (
                    <div className="text-xs text-muted-foreground break-words">
                      {[r.gfe_type, r.ref].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                {r.source === "cng-tmg" && (
                  <Badge variant="secondary" className="shrink-0">TMG</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

