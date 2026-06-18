import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ClipboardCheck, Play, CheckCircle2, XCircle, AlertTriangle, MinusCircle, Loader2, ChevronDown } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { runQaChecks, type QaReport, type QaCheck } from "@/lib/qa-runner.functions";
import { toast } from "sonner";

const STATUS_META: Record<QaCheck["status"], { icon: typeof CheckCircle2; color: string; label: string }> = {
  pass: { icon: CheckCircle2, color: "text-green-600", label: "PASS" },
  fail: { icon: XCircle, color: "text-red-600", label: "FAIL" },
  warn: { icon: AlertTriangle, color: "text-amber-600", label: "WARN" },
  skip: { icon: MinusCircle, color: "text-muted-foreground", label: "SKIP" },
};

const MANUAL_STEPS: { title: string; tag: string; steps: { do: string; expect: string }[] }[] = [
  {
    title: "Autosave (Flight dialog) — manual UI check",
    tag: "Daily Logs",
    steps: [
      { do: "Open an existing flight, edit P2 name.", expect: "~1.5s later persists silently, dialog stays open." },
      { do: "Edit several fields rapidly.", expect: "One save fires after typing stops; no flicker." },
      { do: "Press ✅ Save.", expect: "Final save runs and dialog closes." },
      { do: "Manual Add → type → tab between inputs.", expect: "Autosave creates/updates draft; ✅ closes." },
    ],
  },
  {
    title: "Proximity chime — manual",
    tag: "Map + Global",
    steps: [
      { do: "Enable proximity on A; fly within range on B.", expect: "A chimes on /logs or /history (not /map)." },
      { do: "Trigger an aircraft from your own fleet.", expect: "No alert (own-fleet excluded)." },
    ],
  },
];

export function QaChecklistCard() {
  const run = useServerFn(runQaChecks);
  const [report, setReport] = useState<QaReport | null>(null);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const onRun = async () => {
    setRunning(true);
    try {
      const res = await run({ data: { live } });
      setReport(res);
      if (res.fail > 0) toast.error(`QA: ${res.fail} failure${res.fail === 1 ? "" : "s"}`);
      else if (res.warn > 0) toast.warning(`QA: ${res.warn} warning${res.warn === 1 ? "" : "s"}`);
      else toast.success(`QA: all ${res.pass} checks passed`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "QA runner failed");
    } finally {
      setRunning(false);
    }
  };

  const byGroup = report
    ? report.checks.reduce<Record<string, QaCheck[]>>((acc, c) => {
        (acc[c.group] ||= []).push(c);
        return acc;
      }, {})
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardCheck className="size-4" />
          Automated QA
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Runs in-process checks against auth gates, dedup, schema, OGN and CnG. Office-only.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onRun} disabled={running} size="sm" className="gap-2">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? "Running…" : "Run all checks"}
          </Button>
          <div className="flex items-center gap-2">
            <Switch id="qa-live" checked={live} onCheckedChange={setLive} disabled={running} />
            <Label htmlFor="qa-live" className="text-xs cursor-pointer">
              Live mode (hit OGN + CnG)
            </Label>
          </div>
          {report && (
            <div className="flex items-center gap-2 ml-auto text-xs">
              <Badge variant="outline" className="text-green-700 border-green-400">{report.pass} pass</Badge>
              {report.warn > 0 && <Badge variant="outline" className="text-amber-700 border-amber-400">{report.warn} warn</Badge>}
              {report.fail > 0 && <Badge variant="outline" className="text-red-700 border-red-400">{report.fail} fail</Badge>}
              {report.skip > 0 && <Badge variant="outline">{report.skip} skip</Badge>}
              <span className="text-muted-foreground">{report.duration_ms}ms</span>
            </div>
          )}
        </div>

        {byGroup && (
          <div className="space-y-4">
            {Object.entries(byGroup).map(([group, checks]) => (
              <section key={group} className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</h3>
                <ul className="space-y-1">
                  {checks.map((c) => {
                    const meta = STATUS_META[c.status];
                    const Icon = meta.icon;
                    return (
                      <li key={c.id} className="flex items-start gap-2 text-sm rounded-md border border-border/60 px-2.5 py-1.5">
                        <Icon className={`size-4 mt-0.5 shrink-0 ${meta.color}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-medium">{c.name}</span>
                            <span className="text-[10px] text-muted-foreground">{c.ms}ms</span>
                          </div>
                          <div className="text-xs text-muted-foreground break-words">{c.detail}</div>
                        </div>
                        <Badge variant="outline" className={`text-[10px] ${meta.color}`}>{meta.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        {!report && !running && (
          <p className="text-xs text-muted-foreground">No report yet — click "Run all checks".</p>
        )}

        <div className="pt-2 border-t">
          <button
            type="button"
            onClick={() => setShowManual((s) => !s)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ChevronDown className={`size-3 transition-transform ${showManual ? "" : "-rotate-90"}`} />
            Manual UI checks ({MANUAL_STEPS.length} sections)
          </button>
          {showManual && (
            <div className="mt-3 space-y-4">
              {MANUAL_STEPS.map((s) => (
                <section key={s.title} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold">{s.title}</h4>
                    <Badge variant="outline" className="text-[10px]">{s.tag}</Badge>
                  </div>
                  <ol className="space-y-1 list-decimal list-inside text-sm">
                    {s.steps.map((st, i) => (
                      <li key={i} className="leading-snug">
                        <span>{st.do}</span>
                        <div className="ml-5 text-xs text-muted-foreground">→ {st.expect}</div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
