import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3 } from "lucide-react";
import { format, subDays, eachDayOfInterval, startOfMonth } from "date-fns";
import { fmtUKDate, todayUKDate } from "@/lib/uktime";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";

export const Route = createFileRoute("/stats")({
  beforeLoad: requireAuth,
  component: StatsPage,
});

type Flight = {
  id: string;
  flight_date: string;
  glider_registration: string | null;
  launch_type: "aerotow" | "winch" | null;
  takeoff_time: string | null;
  landing_time: string | null;
  p1_name: string | null; p1_membership: string | null; p1_charge: boolean | null;
  p2_name: string | null; p2_membership: string | null; p2_charge: boolean | null;
};

const COLORS = ["hsl(220 80% 55%)", "hsl(35 90% 55%)", "hsl(160 60% 45%)", "hsl(280 60% 55%)", "hsl(0 70% 55%)"];

function durationMin(f: Flight): number {
  if (!f.takeoff_time || !f.landing_time) return 0;
  return Math.max(0, Math.round((+new Date(f.landing_time) - +new Date(f.takeoff_time)) / 60000));
}

function StatsPage() {
  const today = todayUKDate();
  const defaultFrom = format(subDays(new Date(`${today}T12:00:00Z`), 89), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(today);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("flights")
        .select("id, flight_date, glider_registration, launch_type, takeoff_time, landing_time, p1_name, p1_membership, p1_charge, p2_name, p2_membership, p2_charge")
        .gte("flight_date", fromDate).lte("flight_date", toDate)
        .neq("glider_registration", "G-ESGC")
        .order("flight_date", { ascending: true })
        .limit(20000);
      setFlights((data as Flight[]) ?? []);
      setLoading(false);
    })();
  }, [fromDate, toDate]);

  const totals = useMemo(() => {
    let mins = 0, aerotow = 0, winch = 0;
    for (const f of flights) {
      mins += durationMin(f);
      if (f.launch_type === "aerotow") aerotow++;
      else if (f.launch_type === "winch") winch++;
    }
    return { count: flights.length, mins, aerotow, winch };
  }, [flights]);

  const dailyData = useMemo(() => {
    const days = eachDayOfInterval({ start: new Date(`${fromDate}T12:00:00Z`), end: new Date(`${toDate}T12:00:00Z`) });
    const byDay = new Map<string, { date: string; flights: number; aerotow: number; winch: number; hours: number }>();
    for (const d of days) {
      const k = format(d, "yyyy-MM-dd");
      byDay.set(k, { date: fmtUKDate(k), flights: 0, aerotow: 0, winch: 0, hours: 0 });
    }
    for (const f of flights) {
      const row = byDay.get(f.flight_date);
      if (!row) continue;
      row.flights++;
      if (f.launch_type === "aerotow") row.aerotow++;
      if (f.launch_type === "winch") row.winch++;
      row.hours += durationMin(f) / 60;
    }
    return Array.from(byDay.values()).map((r) => ({ ...r, hours: +r.hours.toFixed(1) }));
  }, [flights, fromDate, toDate]);

  const monthlyData = useMemo(() => {
    const byMonth = new Map<string, { month: string; flights: number; hours: number }>();
    for (const f of flights) {
      const k = format(startOfMonth(new Date(f.flight_date + "T12:00:00Z")), "yyyy-MM");
      const label = format(startOfMonth(new Date(f.flight_date + "T12:00:00Z")), "MM-yyyy");
      const row = byMonth.get(k) ?? { month: label, flights: 0, hours: 0 };
      row.flights++;
      row.hours += durationMin(f) / 60;
      byMonth.set(k, row);
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({ ...v, hours: +v.hours.toFixed(1) }));
  }, [flights]);

  const launchPie = useMemo(() => {
    const data = [
      { name: "Aerotow", value: totals.aerotow },
      { name: "Winch", value: totals.winch },
    ].filter((d) => d.value > 0);
    return data;
  }, [totals]);

  const gliderData = useMemo(() => {
    const map = new Map<string, { reg: string; flights: number; hours: number }>();
    for (const f of flights) {
      const reg = (f.glider_registration || "—").toUpperCase();
      const row = map.get(reg) ?? { reg, flights: 0, hours: 0 };
      row.flights++;
      row.hours += durationMin(f) / 60;
      map.set(reg, row);
    }
    return Array.from(map.values())
      .sort((a, b) => b.flights - a.flights)
      .map((r) => ({ ...r, hours: +r.hours.toFixed(1) }));
  }, [flights]);

  const pilotLeaderboard = useMemo(() => {
    const map = new Map<string, { name: string; flights: number; mins: number }>();
    for (const f of flights) {
      const mins = durationMin(f);
      const credited: (string | null)[] = [];
      if (f.p1_charge && f.p1_name) credited.push(f.p1_name);
      if (f.p2_charge && f.p2_name) credited.push(f.p2_name);
      for (const name of credited) {
        if (!name) continue;
        const key = name.trim().toUpperCase();
        const row = map.get(key) ?? { name: name.trim(), flights: 0, mins: 0 };
        row.flights++;
        row.mins += mins;
        map.set(key, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.flights - a.flights).slice(0, 15);
  }, [flights]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="size-6 text-primary" />
        <h1 className="text-2xl md:text-3xl font-bold">Club statistics</h1>
      </div>

      <Card>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>From</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-end gap-2">
            {[7, 30, 90, 365].map((d) => (
              <button key={d} onClick={() => { setFromDate(format(subDays(new Date(`${today}T12:00:00Z`), d - 1), "yyyy-MM-dd")); setToDate(today); }}
                className="flex-1 sm:flex-none px-3 py-2 text-sm rounded-md border hover:bg-accent whitespace-nowrap">
                Last {d}d
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <StatCard label="Flights" value={totals.count} />
        <StatCard label="Hours" value={totals.mins / 60} decimals={1} />
        <StatCard label="Aerotow" value={totals.aerotow} />
        <StatCard label="Winch" value={totals.winch} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Flights per day</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="aerotow" stackId="a" fill={COLORS[0]} name="Aerotow" />
                <Bar dataKey="winch" stackId="a" fill={COLORS[1]} name="Winch" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Hours per month</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="hours" stroke={COLORS[2]} strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Launch type</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={launchPie} dataKey="value" nameKey="name" outerRadius={90} label>
                  {launchPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Glider utilisation</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gliderData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="reg" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Legend />
                <Bar dataKey="flights" fill={COLORS[0]} name="Flights" />
                <Bar dataKey="hours" fill={COLORS[2]} name="Hours" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top pilots</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Pilot</TableHead>
                <TableHead className="text-right">Flights</TableHead>
                <TableHead className="text-right">Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pilotLeaderboard.map((p, i) => (
                <TableRow key={p.name + i}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right font-mono">{p.flights}</TableCell>
                  <TableCell className="text-right font-mono">{(p.mins / 60).toFixed(1)}</TableCell>
                </TableRow>
              ))}
              {pilotLeaderboard.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">{loading ? "Loading…" : "No flights in range."}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
