import { Outlet, Link, createRootRoute, HeadContent, Scripts, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { Plane, Users, ListChecks, LogOut, History, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import esgcLogo from "@/assets/esgc-logo.png";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
        <Link to="/" className="mt-6 inline-block underline">Go home</Link>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ESGC Logs" },
      { name: "description", content: "East Sussex Gliding Club daily flight log with OGN integration." },
      { property: "og:title", content: "ESGC Logs" },
      { name: "twitter:title", content: "ESGC Logs" },
      { property: "og:description", content: "East Sussex Gliding Club daily flight log with OGN integration." },
      { name: "twitter:description", content: "East Sussex Gliding Club daily flight log with OGN integration." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/722cdbfa-c76a-4ec7-9ed6-b52b3020ff3e/id-preview-646f6bf4--76d2b799-a1e7-4714-a7a2-c6accd336401.lovable.app-1777926613169.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/722cdbfa-c76a-4ec7-9ed6-b52b3020ff3e/id-preview-646f6bf4--76d2b799-a1e7-4714-a7a2-c6accd336401.lovable.app-1777926613169.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isAuth = path === "/auth";

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (isAuth) return <><Outlet /><Toaster /></>;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b backdrop-blur-md bg-background/70 sticky top-0 z-40">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg">
            <img src={esgcLogo} alt="ESGC" className="size-9 object-contain" />
            <span className="hidden sm:inline">ESGC Logs</span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" icon={<ListChecks className="size-4" />} label="Flights" />
            {(userEmail || "").toLowerCase() === "office@esgc.local" && (
              <NavLink to="/history" icon={<History className="size-4" />} label="History" />
            )}
            {["office@esgc.local", "caravan@esgc.local"].includes((userEmail || "").toLowerCase()) && (
              <NavLink to="/billing" icon={<Receipt className="size-4" />} label="Billing" />
            )}
            <NavLink to="/fleet" icon={<Plane className="size-4" />} label="Fleet" />
            <NavLink to="/members" icon={<Users className="size-4" />} label="Members" />
          </nav>
          <div className="flex items-center gap-2">
            {userEmail ? (
              <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); window.location.href = "/auth"; }}>
                <LogOut className="size-4 mr-1" /><span className="hidden sm:inline">Sign out</span>
              </Button>
            ) : (
              <Link to="/auth"><Button size="sm">Sign in</Button></Link>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-6">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}

function NavLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = path === to;
  return (
    <Link
      to={to}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
      }`}
    >
      {icon}<span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
