import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  BookOpen, Pencil, Save, X, CheckCircle2, ListChecks, Plus, Trash2,
  Printer, ArrowUp, Type, Search, Sparkles, MapPin, FileText, HelpCircle,
} from "lucide-react";
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
        "text-3xl md:text-4xl font-bold tracking-tight mt-10 mb-5 pb-2 border-b scroll-mt-32",
        "text-2xl md:text-3xl font-semibold tracking-tight mt-8 mb-3 text-primary scroll-mt-32",
        "text-lg md:text-xl font-semibold mt-5 mb-2 uppercase tracking-wide text-muted-foreground scroll-mt-32",
        "text-base md:text-lg font-semibold mt-4 mb-1.5 scroll-mt-32",
      ];
      const id = slugify(h[2]);
      html += `<h${lvl} id="${id}" class="${sizes[lvl - 1]}">${inline(h[2])}</h${lvl}>`;
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) { closeP(); closeOl(); if (!inUl) { html += '<ul class="space-y-2.5 my-4 pl-1">'; inUl = true; } html += `<li class="flex gap-2.5 items-start"><span class="text-primary mt-1 shrink-0">▸</span><span>${inline(ul[1])}</span></li>`; continue; }
    const ol = line.match(/^(\d+)\.\s+(.*)$/);
    if (ol) { closeP(); closeUl(); if (!inOl) { html += '<ol class="space-y-2.5 my-4 pl-1 counter-reset:item">'; inOl = true; } html += `<li class="flex gap-2.5 items-start"><span class="text-primary font-semibold mt-0.5 shrink-0 min-w-[1.75rem]">${ol[1]}.</span><span>${inline(ol[2])}</span></li>`; continue; }
    closeUl(); closeOl();
    if (!inP) { html += '<p class="my-3 leading-[1.75] text-foreground/90">'; inP = true; } else { html += " "; }
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

type ChecklistItem = { id: string; label: string };

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: "sync", label: "DI & DP names synced" },
  { id: "launch", label: "Launch type confirmed (aerotow / winch)" },
  { id: "tow", label: "Tow height confirmed" },
];

type TextSize = "sm" | "md" | "lg" | "xl";
const TEXT_SIZE_KEY = "esgc.help.textSize";
const SIZE_CLASS: Record<TextSize, string> = {
  sm: "text-sm md:text-base",
  md: "text-base md:text-lg",
  lg: "text-lg md:text-xl",
  xl: "text-xl md:text-2xl",
};
const SIZE_ORDER: TextSize[] = ["sm", "md", "lg", "xl"];

function HelpPage() {
  const [body, setBody] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isOffice, setIsOffice] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(DEFAULT_CHECKLIST);
  const [checklistEnabled, setChecklistEnabled] = useState(true);
  const [editingChecklist, setEditingChecklist] = useState(false);
  const [draftItems, setDraftItems] = useState<ChecklistItem[]>([]);
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [textSize, setTextSize] = useState<TextSize>("lg");
  const [search, setSearch] = useState("");
  const [showTop, setShowTop] = useState(false);
  const today = todayUKDate();
  const storageKey = `esgc.help.checklist.${today}`;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = (data.user?.email || "").toLowerCase();
      setIsOffice(email === "office@esgc.local");
    });
    supabase.from("help_content").select("*").eq("id", 1).maybeSingle().then(({ data }) => {
      setBody(data?.body ?? "");
      const row = data as { checklist_items?: ChecklistItem[] | null; checklist_enabled?: boolean | null } | null;
      if (Array.isArray(row?.checklist_items) && row!.checklist_items!.length > 0) {
        setChecklistItems(row!.checklist_items as ChecklistItem[]);
      }
      if (typeof row?.checklist_enabled === "boolean") setChecklistEnabled(row.checklist_enabled);
      setLoading(false);
    });
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setChecked(JSON.parse(raw));
      const s = localStorage.getItem(TEXT_SIZE_KEY) as TextSize | null;
      if (s && SIZE_ORDER.includes(s)) setTextSize(s);
    } catch { /* ignore */ }
  }, [storageKey]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const changeSize = (s: TextSize) => {
    setTextSize(s);
    try { localStorage.setItem(TEXT_SIZE_KEY, s); } catch { /* ignore */ }
  };
  const bumpSize = (dir: 1 | -1) => {
    const idx = SIZE_ORDER.indexOf(textSize);
    const next = SIZE_ORDER[Math.min(SIZE_ORDER.length - 1, Math.max(0, idx + dir))];
    changeSize(next);
  };

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

  const startEditChecklist = () => {
    setDraftItems(checklistItems.map((i) => ({ ...i })));
    setDraftEnabled(checklistEnabled);
    setEditingChecklist(true);
  };
  const cancelEditChecklist = () => { setEditingChecklist(false); };
  const saveChecklist = async () => {
    const cleaned = draftItems
      .map((i) => ({ id: i.id.trim() || crypto.randomUUID(), label: i.label.trim() }))
      .filter((i) => i.label);
    setSavingChecklist(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("help_content").upsert(
      {
        id: 1,
        body,
        checklist_items: cleaned,
        checklist_enabled: draftEnabled,
        updated_at: new Date().toISOString(),
        updated_by: u.user?.id ?? null,
      } as never,
      { onConflict: "id" },
    );
    setSavingChecklist(false);
    if (error) { toast.error(error.message); return; }
    setChecklistItems(cleaned);
    setChecklistEnabled(draftEnabled);
    setEditingChecklist(false);
    toast.success("Checklist updated");
  };
  const addItem = () => setDraftItems((arr) => [...arr, { id: crypto.randomUUID(), label: "" }]);
  const removeItem = (idx: number) => setDraftItems((arr) => arr.filter((_, i) => i !== idx));
  const updateItem = (idx: number, label: string) =>
    setDraftItems((arr) => arr.map((it, i) => (i === idx ? { ...it, label } : it)));


  const headings = useMemo(() => extractHeadings(body), [body]);
  const jumpLinks = useMemo(() => {
    return JUMP_TARGETS.map((t) => {
      const hit = headings.find((h) => t.match.test(h.text));
      return { label: t.label, id: hit?.id };
    });
  }, [headings]);

  const filteredHeadings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return headings;
    return headings.filter((h) => h.text.toLowerCase().includes(q));
  }, [headings, search]);

  const allChecked = checklistItems.length > 0 && checklistItems.every((c) => checked[c.id]);
  const checkedCount = checklistItems.filter((c) => checked[c.id]).length;

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
  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const printGuide = () => window.print();

  const replayMapTour = () => {
    try { localStorage.removeItem("esgc.map.tour.v1"); } catch { /* ignore */ }
    toast.success("Tour will replay next time you open the Map.");
  };

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-6">
        <div className="space-y-4 min-w-0">
          {/* Plain-language welcome — always visible at the top */}
          {!editing && (
            <Card className="liquid-glass print:hidden border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-xl md:text-2xl">
                  <Sparkles className="size-6 text-primary" /> Welcome — start here
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-base md:text-lg leading-relaxed text-foreground/90">
                  This app helps the duty team at <strong>ESGC Ringmer</strong> log every flight,
                  see what's flying nearby, and share the day's record with the office.
                  Everything is written in plain English. If anything looks confusing,
                  press the big <strong>A+</strong> button at the top to make the text larger.
                </p>
                <div className="grid sm:grid-cols-3 gap-3">
                  <a href="/logbook" className="group rounded-xl border bg-background/40 p-4 hover:bg-primary/5 hover:border-primary/40 transition-colors block">
                    <FileText className="size-6 text-primary mb-2" />
                    <div className="font-semibold text-base mb-1">Log a flight</div>
                    <div className="text-sm text-muted-foreground">Add launches, landings, who's on board.</div>
                  </a>
                  <a href="/map" className="group rounded-xl border bg-background/40 p-4 hover:bg-primary/5 hover:border-primary/40 transition-colors block">
                    <MapPin className="size-6 text-primary mb-2" />
                    <div className="font-semibold text-base mb-1">See the live map</div>
                    <div className="text-sm text-muted-foreground">Aircraft nearby, weather, and NOTAMs.</div>
                  </a>
                  <button onClick={replayMapTour} className="group rounded-xl border bg-background/40 p-4 hover:bg-primary/5 hover:border-primary/40 transition-colors text-left">
                    <HelpCircle className="size-6 text-primary mb-2" />
                    <div className="font-semibold text-base mb-1">Replay map tour</div>
                    <div className="text-sm text-muted-foreground">Re-show the welcome walkthrough.</div>
                  </button>
                </div>
              </CardContent>
            </Card>
          )}


          <Card className="liquid-glass print:shadow-none print:border-0">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-xl md:text-2xl">
                <BookOpen className="size-6 text-primary" /> Help &amp; Caravan guide
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap print:hidden">
                {/* Text size control */}
                <div
                  role="group"
                  aria-label="Adjust text size"
                  className="flex items-center gap-0.5 rounded-md border bg-background/50 p-0.5"
                >
                  <Button
                    size="sm" variant="ghost"
                    className="h-9 w-9 p-0 text-base font-semibold"
                    onClick={() => bumpSize(-1)}
                    disabled={textSize === SIZE_ORDER[0]}
                    aria-label="Smaller text"
                    title="Smaller text"
                  >A−</Button>
                  <Type className="size-4 text-muted-foreground mx-0.5" aria-hidden />
                  <Button
                    size="sm" variant="ghost"
                    className="h-9 w-9 p-0 text-base font-semibold"
                    onClick={() => bumpSize(1)}
                    disabled={textSize === SIZE_ORDER[SIZE_ORDER.length - 1]}
                    aria-label="Larger text"
                    title="Larger text"
                  >A+</Button>
                </div>
                <Button size="sm" variant="outline" onClick={printGuide} className="h-9" aria-label="Print this guide">
                  <Printer className="size-4 sm:mr-1.5" /> <span className="hidden sm:inline">Print</span>
                </Button>
                {isOffice && !editing && (
                  <Button size="sm" variant="outline" onClick={startEdit} className="h-9">
                    <Pencil className="size-4 mr-1" /> Edit
                  </Button>
                )}
                {isOffice && editing && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={cancel} disabled={saving} className="h-9">
                      <X className="size-4 mr-1" /> Cancel
                    </Button>
                    <Button size="sm" onClick={save} disabled={saving} className="h-9">
                      <Save className="size-4 mr-1" /> {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* Jump-link bar — hidden while editing */}
              {!editing && !loading && body.trim() && (
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-background/40 p-2 print:hidden">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
                    Jump to
                  </span>
                  {jumpLinks.map((j) => (
                    <Button
                      key={j.label}
                      size="sm"
                      variant={j.id ? "secondary" : "ghost"}
                      className="h-9 text-sm"
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
                  className={`prose-sm max-w-none text-foreground ${SIZE_CLASS[textSize]}`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No help content yet.</p>
              )}
            </CardContent>
          </Card>

          {/* Pre-publish checklist */}
          {!editing && (checklistEnabled || isOffice) && (
            <Card className={`liquid-glass transition-colors print:hidden ${allChecked && checklistEnabled ? "ring-1 ring-emerald-500/40" : ""}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <ListChecks className="size-5 text-primary" />
                  Pre-publish checklist
                  {checklistEnabled ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                      {checkedCount}/{checklistItems.length}
                    </span>
                  ) : (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(hidden — office only)</span>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {checklistEnabled && checkedCount > 0 && !editingChecklist && (
                    <Button size="sm" variant="ghost" onClick={resetChecklist} className="h-9">Reset</Button>
                  )}
                  {isOffice && !editingChecklist && (
                    <Button size="sm" variant="outline" onClick={startEditChecklist} className="h-9">
                      <Pencil className="size-4 mr-1" /> Edit
                    </Button>
                  )}
                  {isOffice && editingChecklist && (
                    <>
                      <Button size="sm" variant="ghost" onClick={cancelEditChecklist} disabled={savingChecklist} className="h-9">
                        <X className="size-4 mr-1" /> Cancel
                      </Button>
                      <Button size="sm" onClick={saveChecklist} disabled={savingChecklist} className="h-9">
                        <Save className="size-4 mr-1" /> {savingChecklist ? "Saving…" : "Save"}
                      </Button>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {editingChecklist ? (
                  <>
                    <div className="flex items-center justify-between gap-3 rounded-md border bg-background/40 p-2.5">
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">Show checklist to caravan</div>
                        <p className="text-xs text-muted-foreground">Turn off to hide it from everyone except office.</p>
                      </div>
                      <Switch checked={draftEnabled} onCheckedChange={setDraftEnabled} />
                    </div>
                    <ul className="space-y-2">
                      {draftItems.map((item, idx) => (
                        <li key={item.id} className="flex items-center gap-2">
                          <Input
                            value={item.label}
                            onChange={(e) => updateItem(idx, e.target.value)}
                            placeholder="Checklist item"
                          />
                          <Button size="icon" variant="ghost" onClick={() => removeItem(idx)} aria-label="Remove">
                            <Trash2 className="size-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <Button size="sm" variant="outline" onClick={addItem} className="gap-1.5 h-9">
                      <Plus className="size-4" /> Add item
                    </Button>
                  </>
                ) : checklistEnabled ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Tick each item before sending today's log. Saved for {today}.
                    </p>
                    <ul className="space-y-2">
                      {checklistItems.map((item) => (
                        <li key={item.id}>
                          <label className="flex items-center gap-3 rounded-md border bg-background/40 p-3 cursor-pointer hover:bg-background/70 transition-colors min-h-12">
                            <Checkbox
                              checked={!!checked[item.id]}
                              onCheckedChange={() => toggle(item.id)}
                              className="size-5"
                            />
                            <span className={`text-base ${checked[item.id] ? "line-through text-muted-foreground" : "text-foreground"}`}>
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
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Checklist is currently turned off.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sticky Table of Contents (sidebar on xl+) */}
        {!editing && !loading && headings.length > 0 && (
          <aside className="hidden xl:block print:hidden">
            <div className="sticky top-24 space-y-3">
              <div className="rounded-lg border bg-background/40 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Search className="size-4 text-muted-foreground" aria-hidden />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a section…"
                    className="h-9 text-sm"
                    aria-label="Search sections"
                  />
                </div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 px-1">
                  Contents
                </div>
                <nav className="space-y-0.5 max-h-[60vh] overflow-y-auto pr-1">
                  {filteredHeadings.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">No matches.</p>
                  ) : filteredHeadings.map((h) => (
                    <button
                      key={h.id + h.text}
                      onClick={() => scrollTo(h.id)}
                      className={`block w-full text-left rounded px-2 py-1.5 text-sm hover:bg-primary/10 hover:text-primary transition-colors ${h.level === 2 ? "pl-5 text-muted-foreground" : "font-medium"}`}
                    >
                      {h.text}
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Back to top */}
      {showTop && (
        <Button
          size="icon"
          onClick={scrollTop}
          aria-label="Back to top"
          title="Back to top"
          className="fixed bottom-6 right-6 z-40 size-12 rounded-full shadow-lg print:hidden"
        >
          <ArrowUp className="size-5" />
        </Button>
      )}
    </div>
  );
}
