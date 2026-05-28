import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Mail, Calendar, FileText, Link2, Clock, GripVertical, RotateCcw } from "lucide-react";

type Settings = {
  enabled: boolean;
  to_email: string;
  from_email: string;
  subject_template: string;
  body_template: string;
};

const DEFAULT_SUBJECT = "Logs {date}";
const DEFAULT_BODY =
  "Please find today's logs attached via the link below:\n\n{link}\n\nFrom Caravan, have a good evening.";

const PRESETS: { token: string; label: string; description: string; icon: React.ReactNode }[] = [
  { token: "{date}", label: "date", description: "e.g. Sat 24 May 2026", icon: <Calendar className="size-3.5" /> },
  { token: "{document}", label: "document", description: "Linked file name", icon: <FileText className="size-3.5" /> },
  { token: "{link}", label: "link", description: "Secure download link", icon: <Link2 className="size-3.5" /> },
  { token: "{filename}", label: "filename", description: "Plain file name", icon: <FileText className="size-3.5" /> },
  { token: "{time}", label: "time", description: "Send time (UK)", icon: <Clock className="size-3.5" /> },
];

function TokenChip({ token, label, icon }: { token: string; label: string; icon: React.ReactNode }) {
  return (
    <span
      className="token-chip"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/token", token);
        e.dataTransfer.setData("text/plain", token);
        e.dataTransfer.effectAllowed = "copy";
        e.currentTarget.dataset.dragging = "true";
      }}
      onDragEnd={(e) => { e.currentTarget.dataset.dragging = "false"; }}
      title={`Drag or tap to insert ${token}`}
    >
      <GripVertical className="size-3 opacity-50" />
      {icon}
      <span>{label}</span>
    </span>
  );
}

function useDroppable(
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  onInsert: (text: string) => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onOver = (e: Event) => {
      const ev = e as DragEvent;
      if (!ev.dataTransfer?.types.includes("text/plain")) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      el.dataset.dropActive = "true";
    };
    const onLeave = () => { el.dataset.dropActive = "false"; };
    const onDrop = (e: Event) => {
      const ev = e as DragEvent;
      const t = ev.dataTransfer?.getData("text/token") || ev.dataTransfer?.getData("text/plain");
      if (!t) return;
      ev.preventDefault();
      el.dataset.dropActive = "false";
      onInsert(t);
    };
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [ref, onInsert]);
}

function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
  setValue: (v: string) => void,
  token: string,
) {
  if (!el) { setValue(value + token); return; }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  });
}

function previewTemplate(tpl: string) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    switch (k) {
      case "date": return "Sat 24 May 2026";
      case "filename":
      case "document": return "flight-log-2026-05-24.xlsx";
      case "link": return "https://…signed-url…";
      case "time": return "18:42";
      default: return `{${k}}`;
    }
  });
}

const SENDER_DOMAIN = "notify.spaghettigalleries.uk";
const DEFAULT_FROM = `Jacob Abundy <caravan@${SENDER_DOMAIN}>`;

// Parse "Name <user@domain>" or "user@domain" into { name, local }
function parseFrom(raw: string): { name: string; local: string } {
  const m = raw.match(/^\s*(.*?)\s*<\s*([^@\s]+)@([^>\s]+)\s*>\s*$/);
  if (m) return { name: m[1] ?? "", local: m[2] ?? "" };
  const m2 = raw.match(/^\s*([^@\s]+)@([^\s]+)\s*$/);
  if (m2) return { name: "", local: m2[1] ?? "" };
  return { name: raw.trim(), local: "" };
}
function buildFrom(name: string, local: string): string {
  const n = name.trim();
  const l = local.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!l) return "";
  return n ? `${n} <${l}@${SENDER_DOMAIN}>` : `${l}@${SENDER_DOMAIN}`;
}

export function EmailSettingsCard() {
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<Settings>({
    enabled: true,
    to_email: "office@sussexgliding.co.uk",
    from_email: DEFAULT_FROM,
    subject_template: DEFAULT_SUBJECT,
    body_template: DEFAULT_BODY,
  });

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("email_settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => {
      if (data) {
        setState({
          enabled: data.enabled,
          to_email: data.to_email ?? "",
          from_email: (data as { from_email?: string }).from_email ?? DEFAULT_FROM,
          subject_template: data.subject_template ?? DEFAULT_SUBJECT,
          body_template: data.body_template ?? DEFAULT_BODY,
        });
      }
      setLoaded(true);
    });
  }, []);


  useDroppable(subjectRef, (t) => insertAtCursor(subjectRef.current, state.subject_template, (v) => setState((s) => ({ ...s, subject_template: v })), t));
  useDroppable(bodyRef, (t) => insertAtCursor(bodyRef.current, state.body_template, (v) => setState((s) => ({ ...s, body_template: v })), t));
  useDroppable(toRef, () => toast.info("Tokens only work in subject and message"));

  const insertInto = (target: "subject" | "body", token: string) => {
    if (target === "subject") {
      insertAtCursor(subjectRef.current, state.subject_template, (v) => setState((s) => ({ ...s, subject_template: v })), token);
    } else {
      insertAtCursor(bodyRef.current, state.body_template, (v) => setState((s) => ({ ...s, body_template: v })), token);
    }
  };

  const save = async () => {
    const to = state.to_email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast.error("Enter a valid email"); return; }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("email_settings").update({
      enabled: state.enabled,
      to_email: to,
      from_email: state.from_email,
      subject_template: state.subject_template,
      body_template: state.body_template,
      updated_by: u.user?.id ?? null,
      updated_at: new Date().toISOString(),
    } as never).eq("id", 1);
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Email settings saved");
  };

  const resetDefaults = () => {
    setState((s) => ({ ...s, subject_template: DEFAULT_SUBJECT, body_template: DEFAULT_BODY }));
    toast.success("Reset to defaults — remember to save");
  };

  if (!loaded) return null;

  return (
    <Card className="liquid-glass">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="size-4 text-primary" /> Send logs to office
          <Badge variant={state.enabled ? "default" : "outline"} className="ml-1">
            {state.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/40 p-3 backdrop-blur">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Enable "Email to office"</div>
            <p className="text-xs text-muted-foreground">
              When off, the menu item on the daily log is disabled and no emails will be sent.
            </p>
          </div>
          <Switch
            checked={state.enabled}
            onCheckedChange={(c) => setState((s) => ({ ...s, enabled: c }))}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">From (sender)</Label>
          {(() => {
            const { name, local } = parseFrom(state.from_email);
            const update = (n: string, l: string) =>
              setState((s) => ({ ...s, from_email: buildFrom(n, l) || s.from_email }));
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Display name</Label>
                  <Input
                    type="text"
                    value={name}
                    onChange={(e) => update(e.target.value, local)}
                    placeholder="Jacob Abundy"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Address</Label>
                  <div className="flex items-stretch rounded-md border bg-transparent focus-within:ring-1 focus-within:ring-ring overflow-hidden">
                    <input
                      ref={fromRef}
                      type="text"
                      autoCapitalize="none"
                      autoComplete="off"
                      spellCheck={false}
                      className="flex-1 min-w-0 bg-transparent px-3 py-1 text-sm outline-none"
                      value={local}
                      onChange={(e) => update(name, e.target.value)}
                      placeholder="caravan"
                    />
                    <span className="px-2 py-1 text-xs text-muted-foreground bg-muted/40 border-l whitespace-nowrap flex items-center">
                      @{SENDER_DOMAIN}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
          <p className="text-[11px] text-muted-foreground">
            Preview: <span className="text-foreground font-mono">{state.from_email}</span>
            <br />
            The domain is fixed — only the display name and username before <code>@</code> can change.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Recipient</Label>

          <Input
            ref={toRef}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="email"
            spellCheck={false}
            className="token-drop-target"
            value={state.to_email}
            onChange={(e) => setState((s) => ({ ...s, to_email: e.target.value }))}
            placeholder="office@sussexgliding.co.uk"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Drag presets into the subject or message — or tap to insert</Label>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.token}
                className="contents"
                onClick={() => insertInto("body", p.token)}
                aria-label={`Insert ${p.token} into message`}
              >
                <TokenChip token={p.token} label={p.label} icon={p.icon} />
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tap a chip to drop it into the message. On desktop you can also drag it into the subject.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Subject</Label>
          <Input
            ref={subjectRef}
            className="token-drop-target font-mono text-sm"
            value={state.subject_template}
            onChange={(e) => setState((s) => ({ ...s, subject_template: e.target.value }))}
            placeholder={DEFAULT_SUBJECT}
          />
          <div className="text-[11px] text-muted-foreground truncate">
            Preview: <span className="text-foreground">{previewTemplate(state.subject_template)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Message</Label>
          <Textarea
            ref={bodyRef}
            className="token-drop-target font-mono text-sm min-h-[160px]"
            value={state.body_template}
            onChange={(e) => setState((s) => ({ ...s, body_template: e.target.value }))}
            placeholder={DEFAULT_BODY}
          />
          <div className="rounded-lg border bg-background/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
            <div className="text-[10px] uppercase tracking-wider mb-1 text-foreground/60">Preview</div>
            {previewTemplate(state.body_template)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? "Saving…" : "Save email settings"}
          </Button>
          <Button onClick={resetDefaults} variant="outline" size="sm" className="gap-1.5">
            <RotateCcw className="size-3.5" /> Reset templates
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
