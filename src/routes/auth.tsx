import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Briefcase, Caravan, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import esgcLogo from "@/assets/esgc-logo.png";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — ESGC Logs" }] }),
  component: AuthPage,
});

type Quick = {
  id: "office" | "caravan";
  label: string;
  email: string;
  icon: typeof Briefcase;
  desc: string;
};
const QUICK: Quick[] = [
  { id: "office", label: "Office", email: "office@esgc.local", icon: Briefcase, desc: "Past logs & billing" },
  { id: "caravan", label: "Caravan", email: "caravan@esgc.local", icon: Caravan, desc: "Field operations — log keeper & flight recording" },
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
        <motion.div
          className="flex flex-col items-center mb-6"
          initial={{ opacity: 0, y: -18, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
        >
          <motion.img
            src={esgcLogo}
            alt="ESGC"
            className="size-20 object-contain mb-3"
            initial={{ rotate: -8 }}
            animate={{ rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 14, delay: 0.05 }}
          />
          <h1 className="text-2xl font-bold">ESGC Logs</h1>
          <p className="text-muted-foreground text-sm">Sign in to log today's flights</p>
        </motion.div>

        <AnimatePresence mode="wait">
          {!picked ? (
            <motion.div
              key="pick"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
            >
              <Card>
                <CardHeader><CardTitle>Who's signing in?</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {QUICK.map((q, i) => {
                    const Icon = q.icon;
                    return (
                      <motion.button
                        key={q.id}
                        onClick={() => { setPicked(q); setPassword(""); }}
                        className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-secondary transition text-left"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.1 + i * 0.08 }}
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <Icon className="size-5" />
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold">{q.label}</div>
                          <div className="text-xs text-muted-foreground">{q.desc}</div>
                        </div>
                        <div className="text-xs font-mono text-muted-foreground">{q.email}</div>
                      </motion.button>
                    );
                  })}
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32 }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
            >
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
