import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { BookOpen, Pencil, Save, X } from "lucide-react";

export const Route = createFileRoute("/help")({
  component: HelpPage,
  head: () => ({
    meta: [
      { title: "Help — ESGC Logs" },
      { name: "description", content: "How to log flights from the caravan." },
    ],
  }),
});

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
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-muted text-xs">$1</code>');

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeAll(); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeAll();
      const lvl = h[1].length;
      const sizes = ["text-2xl font-bold mt-6 mb-3", "text-xl font-semibold mt-5 mb-2", "text-lg font-semibold mt-4 mb-2", "text-base font-semibold mt-3 mb-1"];
      html += `<h${lvl} class="${sizes[lvl - 1]}">${inline(h[2])}</h${lvl}>`;
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) { closeP(); closeOl(); if (!inUl) { html += '<ul class="list-disc pl-6 space-y-1 my-2">'; inUl = true; } html += `<li>${inline(ul[1])}</li>`; continue; }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) { closeP(); closeUl(); if (!inOl) { html += '<ol class="list-decimal pl-6 space-y-1 my-2">'; inOl = true; } html += `<li>${inline(ol[1])}</li>`; continue; }
    closeUl(); closeOl();
    if (!inP) { html += '<p class="my-2 leading-relaxed">'; inP = true; } else { html += " "; }
    html += inline(line);
  }
  closeAll();
  return html;
}

function HelpPage() {
  const [body, setBody] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isOffice, setIsOffice] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = (data.user?.email || "").toLowerCase();
      setIsOffice(email === "office@esgc.local");
    });
    supabase.from("help_content").select("body").eq("id", 1).maybeSingle().then(({ data }) => {
      setBody(data?.body ?? "");
      setLoading(false);
    });
  }, []);

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

  return (
    <div className="max-w-3xl mx-auto">
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
    </div>
  );
}
