import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requireAuth } from "@/lib/auth-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Plane } from "lucide-react";

export const Route = createFileRoute("/fleet")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Fleet — ESGC Logs" }, { name: "description", content: "Manage club gliders and FLARM IDs." }] }),
  component: FleetPage,
});

type Glider = {
  id: string; registration: string; callsign: string | null;
  flarm_id: string | null; glider_type: string | null;
};

function FleetPage() {
  const [items, setItems] = useState<Glider[]>([]);
  const [form, setForm] = useState({ registration: "", callsign: "", flarm_id: "", glider_type: "" });
  const [isOffice, setIsOffice] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("fleet_gliders").select("*").order("registration");
    if (error) toast.error(error.message); else setItems(data ?? []);
  };
  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => {
      setIsOffice((data.user?.email || "").toLowerCase() === "office@esgc.local");
    });
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.registration.trim()) return;
    const { error } = await supabase.from("fleet_gliders").insert({
      registration: form.registration.trim(),
      callsign: form.callsign.trim() || null,
      flarm_id: form.flarm_id.trim().toUpperCase() || null,
      glider_type: form.glider_type.trim() || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Glider added");
    setForm({ registration: "", callsign: "", flarm_id: "", glider_type: "" });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this glider?")) return;
    const { error } = await supabase.from("fleet_gliders").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Removed"); load(); }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Plane className="size-7 text-primary" /> Club Fleet</h1>
        <p className="text-muted-foreground">Maintain registration, callsign and FLARM ID for OGN matching.{!isOffice && " Read-only — sign in as the office account to edit."}</p>
      </div>
      {isOffice && (
        <Card>
          <CardHeader><CardTitle>Add glider</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div><Label>Registration *</Label><Input value={form.registration} onChange={(e) => setForm({ ...form, registration: e.target.value })} placeholder="G-ABCD" /></div>
              <div><Label>Callsign</Label><Input value={form.callsign} onChange={(e) => setForm({ ...form, callsign: e.target.value })} placeholder="K2" /></div>
              <div><Label>FLARM ID</Label><Input value={form.flarm_id} onChange={(e) => setForm({ ...form, flarm_id: e.target.value })} placeholder="DD1234" /></div>
              <div><Label>Type</Label><Input value={form.glider_type} onChange={(e) => setForm({ ...form, glider_type: e.target.value })} placeholder="ASK-21" /></div>
              <Button type="submit"><Plus className="size-4 mr-1" />Add</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Fleet ({items.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Registration</TableHead><TableHead>Callsign</TableHead>
              <TableHead>FLARM ID</TableHead><TableHead>Type</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {items.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.registration}</TableCell>
                  <TableCell>{g.callsign || "—"}</TableCell>
                  <TableCell className="font-mono">{g.flarm_id || <span className="text-muted-foreground">no FLARM</span>}</TableCell>
                  <TableCell>{g.glider_type || "—"}</TableCell>
                  <TableCell className="text-right">{isOffice && <Button size="icon" variant="ghost" onClick={() => remove(g.id)}><Trash2 className="size-4" /></Button>}</TableCell>
                </TableRow>
              ))}
              {items.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No gliders yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
