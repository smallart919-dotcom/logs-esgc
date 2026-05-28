import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { BookOpen, Pencil, Save, X, CheckCircle2, ListChecks } from "lucide-react";
import { todayUKDate } from "@/lib/uktime";

export const Route = createFileRoute("/help")({
  component: HelpPage,
  head: () => ({
    meta: [
      { title: "Help — ESGC Logs" },
      { name: "description", content: "How to log flights from the caravan." },
    ],
  }),
});

/** Slugify a heading for use as a stable in-page anchor id. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "section";
}

/** Tiny markdown → HTML renderer covering headings, bold, italic, lists, and paragraphs. */
function renderMarkdown(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split(/\r?\n/);
  let html = "";
  let inUl = false;
  let inOl = false;
  let inP = false;
  const closeP = () => { if (inP) { html += "</p>"; inP = false; } };
  const closeUl = () => { if (inUl) { html += "</ul>"; inUl = false; } };
  const closeOl = () => { if (inOl) { html += "</ol>"; inOl = false; } };
  const closeAll = () => { closeP(); closeUl(); closeOl(); };
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground font-semibold">$1</strong>')
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[0.85em] font-mono">$1</code>');

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeAll(); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeAll();
      const lvl = h[1].length;
      const sizes = [
        "text-3xl font-bold tracking-tight mt-8 mb-4 pb-2 border-b scroll-mt-32",
        "text-xl font-semibold tracking-tight mt-6 mb-2 text-primary scroll-mt-32",
        "text-base font-semibold mt-4 mb-1.5 uppercase tracking-wide text-muted-foreground scroll-mt-32",
        "text-sm font-semibold mt-3 mb-1 scroll-mt-32",
      ];
      const id = slugify(h[2]);
      html += `<h${lvl} id="${id}" class="${sizes[lvl - 1]}">${inline(h[2])}</h${lvl}>`;
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) { closeP(); closeOl(); if (!inUl) { html += '<ul class="space-y-1.5 my-3 pl-1">'; inUl = true; } html += `<li class="flex gap-2 items-start"><span class="text-primary mt-1 shrink-0">▸</span><span>${inline(ul[1])}</span></li>`; continue; }
    const ol = line.match(/^(\d+)\.\s+(.*)$/);
    if (ol) { closeP(); closeUl(); if (!inOl) { html += '<ol class="space-y-1.5 my-3 pl-1 counter-reset:item">'; inOl = true; } html += `<li class="flex gap-2 items-start"><span class="text-primary font-semibold mt-0.5 shrink-0 min-w-[1.5rem]">${ol[1]}.</span><span>${inline(ol[2])}</span></li>`; continue; }
    closeUl(); closeOl();
    if (!inP) { html += '<p class="my-2 leading-relaxed text-foreground/90">'; inP = true; } else { html += " "; }
    html += inline(line);
  }
  closeAll();
  return html;
}

/** Extract all level 1-2 headings from the markdown body for the jump-link bar. */
function extractHeadings(md: string): { id: string; text: string; level: number }[] {
  const out: { id: string; text: string; level: number }[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const m = raw.trim().match(/^(#{1,2})\s+(.*)$/);
    if (m) out.push({ id: slugify(m[2]), text: m[2], level: m[1].length });
  }
  return out;
}

/** Jump-link targets — matched fuzzily against headings in the guide. */
const JUMP_TARGETS = [
  { label: "Duty", match: /duty/i },
  { label: "Names sync", match: /(names?\s*sync|di.*dp.*sync|dp.*di.*sync|sync)/i },
  { label: "Logging steps", match: /(logging|log\s*(a\s*)?flight|how to log)/i },
];

const CHECKLIST_ITEMS = [
  { id: "sync", label: "DI & DP names synced" },
  { id: "launch", label: "Launch type confirmed (aerotow / winch)" },
  { id: "tow", label: "Tow height confirmed" },
] as const;

function HelpPage() {
  const [body, setBody] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isOffice, setIsOffice] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const today = todayUKDate();
  const storageKey = `esgc.help.checklist.${today}`;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = (data.user?.email || "").toLowerCase();
      setIsOffice(email === "office@esgc.local");
    });
    supabase.from("help_content").select("body").eq("id", 1).maybeSingle().then(({ data }) => {
      setBody(data?.body ?? "");
      setLoading(false);
    });
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setChecked(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [storageKey]);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const resetChecklist = () => {
    setChecked({});
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  };

  const headings = useMemo(() => extractHeadings(body), [body]);
  const jumpLinks = useMemo(() => {
    return JUMP_TARGETS.map((t) => {
      const hit = headings.find((h) => t.match.test(h.text));
      return { label: t.label, id: hit?.id };
    });
  }, [headings]);

  const allChecked = CHECKLIST_ITEMS.every((c) => checked[c.id]);
  const checkedCount = CHECKLIST_ITEMS.filter((c) => checked[c.id]).length;

  const startEdit = () => { setDraft(body); setEditing(true); };
  const cancel = () => { setEditing(false); setDraft(""); };
  const save = async () => {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("help_content").upsert(
      { id: 1, body: draft, updated_at: new Date().toISOString(), updated_by: u.user?.id ?? null },
      { onConflict: "id" },
    );
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setBody(draft);
    setEditing(false);
    toast.success("Help guide updated");
  };

  const scrollTo = (id?: string) => {
    if (!id) { toast.info("Heading not found in the guide yet."); return; }
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Card className="liquid-glass">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" /> Help & Caravan guide
          </CardTitle>
          {isOffice && !editing && (
            <Button size="sm" variant="outline" onClick={startEdit}>
              <Pencil className="size-4 mr-1" /> Edit
            </Button>
          )}
          {isOffice && editing && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>
                <X className="size-4 mr-1" /> Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                <Save className="size-4 mr-1" /> {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {/* Jump-link bar — hidden while editing */}
          {!editing && !loading && body.trim() && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-background/40 p-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
                Jump to
              </span>
              {jumpLinks.map((j) => (
                <Button
                  key={j.label}
                  size="sm"
                  variant={j.id ? "secondary" : "ghost"}
                  className="h-7 text-xs"
                  onClick={() => scrollTo(j.id)}
                  disabled={!j.id}
                  title={j.id ? `Jump to ${j.label}` : "No matching heading yet"}
                >
                  {j.label}
                </Button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : editing ? (
            <div className="space-y-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={24}
                className="font-mono text-sm"
                placeholder="Write the guide in markdown — # headings, **bold**, *italic*, - lists."
              />
              <p className="text-xs text-muted-foreground">
                Markdown supported: <code>#</code> headings, <code>**bold**</code>, <code>*italic*</code>, <code>-</code> lists.
                Jump links match headings named <em>Duty</em>, <em>Names sync</em>, and <em>Logging</em>.
              </p>
            </div>
          ) : body.trim() ? (
            <div
              className="prose-sm max-w-none text-foreground"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No help content yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Pre-publish checklist */}
      {!editing && (
        <Card className={`liquid-glass transition-colors ${allChecked ? "ring-1 ring-emerald-500/40" : ""}`}>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-5 text-primary" />
              Pre-publish checklist
              <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                {checkedCount}/{CHECKLIST_ITEMS.length}
              </span>
            </CardTitle>
            {checkedCount > 0 && (
              <Button size="sm" variant="ghost" onClick={resetChecklist}>
                Reset
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Tick each item before sending today's log. Saved locally for {today}.
            </p>
            <ul className="space-y-2">
              {CHECKLIST_ITEMS.map((item) => (
                <li key={item.id}>
                  <label className="flex items-center gap-3 rounded-md border bg-background/40 p-2.5 cursor-pointer hover:bg-background/70 transition-colors">
                    <Checkbox
                      checked={!!checked[item.id]}
                      onCheckedChange={() => toggle(item.id)}
                    />
                    <span className={`text-sm ${checked[item.id] ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {item.label}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {allChecked && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" />
                All checks complete — safe to publish today's log.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
