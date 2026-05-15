import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format, subDays } from "date-fns";
import { History } from "lucide-react";
import { dateToUKShortLabel, todayUKDate } from "@/lib/uktime";

export const Route = createFileRoute("/history")({
  beforeLoad: requireAuth,
  component: HistoryPage,
});

type DayRow = {
  date: string;
  total: number;
  aerotow: number;
  winch: number;
  motor: number;
  tug: number;
  duty_pilot: string | null;
  duty_instructor: string | null;
};

function HistoryPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [rangeDays, setRangeDays] = useState(14);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const ok = (data.user?.email || "").toLowerCase() === "office@esgc.local";
      setAllowed(ok);
    });
  }, []);

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      const today = new Date(`${todayUKDate()}T12:00:00Z`);
      const since = format(subDays(today, rangeDays - 1), "yyyy-MM-dd");
      const [{ data: f }, { data: logs }] = await Promise.all([
        supabase.from("flights").select("flight_date, launch_type, glider_registration").gte("flight_date", since),
        supabase.from("daily_logs").select("flight_date, duty_pilot, duty_instructor").gte("flight_date", since),
      ]);
      const map = new Map<string, DayRow>();
      for (let i = 0; i < rangeDays; i++) {
        const d = format(subDays(today, i), "yyyy-MM-dd");
        map.set(d, { date: d, total: 0, aerotow: 0, winch: 0, motor: 0, tug: 0, duty_pilot: null, duty_instructor: null });
      }
      (f ?? []).forEach((row: any) => {
        const r = map.get(row.flight_date);
        if (!r) return;
        const reg = (row.glider_registration || "").toUpperCase().trim();
        r.total++;
        if (reg === "G-ESGC") r.tug++;
        else if (reg === "G-KIAU") r.motor++;
        else if (row.launch_type === "aerotow") r.aerotow++;
        else if (row.launch_type === "winch") r.winch++;
      });
      (logs ?? []).forEach((row: any) => {
        const r = map.get(row.flight_date);
        if (!r) return;
        r.duty_pilot = row.duty_pilot;
        r.duty_instructor = row.duty_instructor;
      });
      setDays([...map.values()].sort((a, b) => b.date.localeCompare(a.date)));
    })();
  }, [allowed, rangeDays]);

  if (allowed === null) return <div className="text-muted-foreground">Loading…</div>;
  if (!allowed) return (
    <div className="max-w-md mx-auto text-center py-20">
      <h1 className="text-2xl font-bold">Restricted</h1>
      <p className="text-muted-foreground mt-2">Past logs are only available to the office account.</p>
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><History className="size-7 text-primary" /> Past Daily Logs</h1>
          <p className="text-muted-foreground">Review previous days. Click a date to open the full log.</p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30, 60].map((n) => (
            <button key={n} onClick={() => setRangeDays(n)}
              className={`px-3 py-1.5 rounded-md text-sm border ${rangeDays === n ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>
              {n}d
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Last {rangeDays} days</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Aerotow</TableHead>
              <TableHead>Winch</TableHead>
              <TableHead>Motor</TableHead>
              <TableHead>Tug</TableHead>
              <TableHead>Duty pilot</TableHead>
              <TableHead>Duty instructor</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {days.map((d) => (
                <TableRow key={d.date}>
                  <TableCell className="font-medium">
                    <Link to="/" search={{ date: d.date } as any} className="underline underline-offset-2">
                      {dateToUKShortLabel(d.date)}
                    </Link>
                  </TableCell>
                  <TableCell><Badge variant={d.total ? "default" : "outline"}>{d.total}</Badge></TableCell>
                  <TableCell>{d.aerotow || "—"}</TableCell>
                  <TableCell>{d.winch || "—"}</TableCell>
                  <TableCell>{d.motor || "—"}</TableCell>
                  <TableCell>{d.tug || "—"}</TableCell>
                  <TableCell className="text-sm">{d.duty_pilot || "—"}</TableCell>
                  <TableCell className="text-sm">{d.duty_instructor || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
