import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plane, Briefcase, Caravan, ArrowLeft, User } from "lucide-react";

export const Route = createFileRoute("/auth")({ component: AuthPage });

type Quick = {
  id: "office" | "caravan";
  label: string;
  email: string;
  icon: typeof Briefcase;
  desc: string;
};
const QUICK: Quick[] = [
  { id: "office", label: "Office", email: "office@esgc.local", icon: Briefcase, desc: "Past logs & billing" },
  { id: "caravan", label: "Caravan", email: "caravan@esgc.local", icon: Caravan, desc: "Daily flight log & billing" },
];

function AuthPage() {
  const nav = useNavigate();
  const [picked, setPicked] = useState<Quick | "other" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) nav({ to: "/" }); });
  }, [nav]);

  const effectiveEmail = picked && picked !== "other" ? picked.email : email;

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: effectiveEmail, password });
    setLoading(false);
    if (error) toast.error(error.message); else nav({ to: "/" });
  };
  const signUp = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/`, data: { full_name: name } },
    });
    setLoading(false);
    if (error) toast.error(error.message); else toast.success("Check your email to confirm.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="size-14 rounded-xl bg-gradient-to-br from-primary to-[var(--sky-deep)] flex items-center justify-center text-primary-foreground mb-3">
            <Plane className="size-7" />
          </div>
          <h1 className="text-2xl font-bold">Club Daily Log</h1>
          <p className="text-muted-foreground text-sm">Sign in to log today's flights</p>
        </div>

        {!picked ? (
          <Card>
            <CardHeader><CardTitle>Who's signing in?</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {QUICK.map((q) => {
                const Icon = q.icon;
                return (
                  <button key={q.id} onClick={() => { setPicked(q); setPassword(""); }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-secondary transition text-left">
                    <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      <Icon className="size-5" />
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold">{q.label}</div>
                      <div className="text-xs text-muted-foreground">{q.desc}</div>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">{q.email}</div>
                  </button>
                );
              })}
              <button onClick={() => setPicked("other")}
                className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-secondary transition text-left">
                <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
                  <User className="size-5" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold">Other account</div>
                  <div className="text-xs text-muted-foreground">Sign in or create a new account</div>
                </div>
              </button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <button onClick={() => setPicked(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2">
                <ArrowLeft className="size-3" /> Choose a different account
              </button>
              <CardTitle>
                {picked === "other" ? "Welcome" : `Sign in as ${picked.label}`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {picked !== "other" ? (
                <form onSubmit={signIn} className="space-y-3 pt-1">
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={picked.email} disabled />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>Sign in</Button>
                </form>
              ) : (
                <Tabs defaultValue="signin">
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="signin">Sign in</TabsTrigger>
                    <TabsTrigger value="signup">Sign up</TabsTrigger>
                  </TabsList>
                  <TabsContent value="signin">
                    <form onSubmit={signIn} className="space-y-3 pt-2">
                      <div><Label>Email</Label><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                      <div><Label>Password</Label><Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                      <Button type="submit" className="w-full" disabled={loading}>Sign in</Button>
                    </form>
                  </TabsContent>
                  <TabsContent value="signup">
                    <form onSubmit={signUp} className="space-y-3 pt-2">
                      <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                      <div><Label>Email</Label><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                      <div><Label>Password</Label><Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                      <Button type="submit" className="w-full" disabled={loading}>Create account</Button>
                    </form>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
