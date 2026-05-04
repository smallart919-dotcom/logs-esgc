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
import { Plus, Trash2, Users } from "lucide-react";

export const Route = createFileRoute("/members")({
  beforeLoad: requireAuth,
  component: MembersPage,
});

type Member = { id: string; full_name: string; membership_number: string };

function MembersPage() {
  const [items, setItems] = useState<Member[]>([]);
  const [form, setForm] = useState({ full_name: "", membership_number: "" });

  const load = async () => {
    const { data, error } = await supabase.from("club_members").select("*").order("full_name");
    if (error) toast.error(error.message); else setItems(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim() || !form.membership_number.trim()) return;
    const { error } = await supabase.from("club_members").insert({
      full_name: form.full_name.trim(), membership_number: form.membership_number.trim(),
    });
    if (error) return toast.error(error.message);
    toast.success("Member added");
    setForm({ full_name: "", membership_number: "" });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this member?")) return;
    const { error } = await supabase.from("club_members").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Removed"); load(); }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Users className="size-7 text-primary" /> Club Members</h1>
        <p className="text-muted-foreground">Used to autocomplete P1/P2 in the daily log.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Add member</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div><Label>Full name *</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div><Label>Membership # *</Label><Input value={form.membership_number} onChange={(e) => setForm({ ...form, membership_number: e.target.value })} /></div>
            <Button type="submit"><Plus className="size-4 mr-1" />Add</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Members ({items.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Membership #</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.full_name}</TableCell>
                  <TableCell className="font-mono">{m.membership_number}</TableCell>
                  <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => remove(m.id)}><Trash2 className="size-4" /></Button></TableCell>
                </TableRow>
              ))}
              {items.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No members yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
