import { Outlet, Link, createRootRoute, HeadContent, Scripts, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Plane,
  Users,
  ListChecks,
  LogOut,
  History,
  Receipt,
  Activity,
  BookOpen,
  BarChart3,
  Map as MapIcon,
  CloudSun,
  Settings as SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShapesBackground } from "@/components/shapes-background";
import { MacDock } from "@/components/mac-dock";
import { AirborneBadge } from "@/components/airborne-badge";
import { SkyStrip } from "@/components/sky-strip";
import { HorizonGradient } from "@/components/horizon-gradient";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProximityWatcher } from "@/components/ProximityWatcher";
import esgcLogo from "@/assets/esgc-logo.png";

/** Sailplane silhouette — long slender wings, slim fuselage, T-tail. */
function GliderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 24" className={className} fill="currentColor" aria-hidden>
      {/* Long slender wings */}
      <path d="M2 12 Q 18 9 32 12 Q 46 9 62 12 L 62 12.6 Q 46 11 32 13 Q 18 11 2 12.6 Z" />
      {/* Fuselage */}
      <path d="M22 11.6 Q 32 10.8 50 12 L 50 12.6 Q 32 13.2 22 12.4 Z" />
      {/* Cockpit bubble */}
      <ellipse cx="48" cy="11.6" rx="2.4" ry="1.1" />
      {/* T-tail */}
      <path d="M22 9.6 L 24 9.6 L 24 14.6 L 22 14.6 Z" />
      <path d="M20 9 L 26 9 L 26 9.8 L 20 9.8 Z" />
    </svg>
  );
}

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
        <Link to="/" className="mt-6 inline-block underline">
          Go home
        </Link>
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
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/0ceabb1e-b10c-4647-af03-c6f2663dfd57",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/0ceabb1e-b10c-4647-af03-c6f2663dfd57",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
      { name: "theme-color", content: "#ffffff" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "ESGC Logs" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap",
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Apply the saved theme before first paint to avoid a flash of light. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('esgc.theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}",
          }}
        />
      </head>
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

  if (isAuth)
    return (
      <>
        <Outlet />
        <Toaster />
      </>
    );

  return (
    <div className="min-h-screen flex flex-col relative">
      <HorizonGradient />
      <ShapesBackground routeKey={path} />
      <header className="border-b backdrop-blur-md bg-background/80 sticky top-0 z-40 relative overflow-hidden">
        {/* Wave animation behind the logo/signout bar */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <svg
            className="absolute inset-0 w-full h-full opacity-40 dark:opacity-30"
            viewBox="0 0 1200 56"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="waveStroke" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.25" />
                <stop offset="25%" stopColor="var(--sky-deep)" stopOpacity="0.18" />
                <stop offset="50%" stopColor="var(--primary)" stopOpacity="0.9" />
                <stop offset="75%" stopColor="var(--sky)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.25" />
              </linearGradient>
            </defs>
            <g fill="none" stroke="url(#waveStroke)" strokeLinecap="round">
              <path className="wave-line wl-1" strokeWidth="1.2" d="M-200,28 Q100,8 400,28 T1000,28 T1600,28" />
              <path className="wave-line wl-2" strokeWidth="1" d="M-200,32 Q150,14 450,32 T1050,32 T1650,32" />
              <path className="wave-line wl-3" strokeWidth="0.8" d="M-200,24 Q120,44 420,24 T1020,24 T1620,24" />
              <path className="wave-line wl-4" strokeWidth="0.8" d="M-200,36 Q180,20 480,36 T1080,36 T1680,36" />
              <path className="wave-line wl-5" strokeWidth="0.6" d="M-200,20 Q160,40 460,20 T1060,20 T1660,20" />
            </g>
          </svg>
        </div>
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-3 relative">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg shrink-0 group">
            <img
              src={esgcLogo}
              alt="ESGC"
              className="size-8 object-contain transition-transform duration-500 group-hover:rotate-[-6deg] group-hover:scale-105"
            />
            <span className="hidden sm:inline">ESGC Logs</span>
            <AirborneBadge />
            <SkyStrip />
          </Link>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <ThemeToggle />
            {userEmail ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.href = "/auth";
                }}
              >
                <LogOut className="size-4 sm:mr-1" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            ) : (
              <Link to="/auth">
                <Button size="sm">Sign in</Button>
              </Link>
            )}
          </div>
        </div>
      </header>
      {/* Navigation bar — separate row below the logo/waves bar */}
      <nav className="border-b bg-background/80 backdrop-blur-md sticky top-14 z-30">
        <div className="container mx-auto px-2 sm:px-4 flex items-center gap-1 overflow-x-auto py-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {(() => {
            const email = (userEmail || "").toLowerCase();
            const isOffice = email === "office@esgc.local";
            return (
              <>
                <NavLink to="/" icon={<ListChecks className="size-4" />} label="Flights" compact />
                <NavLink to="/billing" icon={<Receipt className="size-4" />} label="Billing" compact />
                <NavLink to="/currency" icon={<Activity className="size-4" />} label="Currency" compact />
                <NavLink to="/logbook" icon={<BookOpen className="size-4" />} label="Logbook" compact />
                <NavLink to="/map" icon={<MapIcon className="size-4" />} label="Map" compact />
                <NavLink to="/weather" icon={<CloudSun className="size-4" />} label="Weather" compact />
                
                <NavLink to="/stats" icon={<BarChart3 className="size-4" />} label="Stats" compact />
                <NavLink to="/help" icon={<BookOpen className="size-4" />} label="Help" compact />
                {isOffice && (
                  <>
                    <NavLink to="/history" icon={<History className="size-4" />} label="History" compact />
                    <NavLink to="/audit" icon={<History className="size-4" />} label="Audit" compact />
                    <NavLink to="/fleet" icon={<Plane className="size-4" />} label="Fleet" compact />
                    <NavLink to="/members" icon={<Users className="size-4" />} label="Members" compact />
                    <NavLink to="/settings" icon={<SettingsIcon className="size-4" />} label="Settings" compact />
                  </>
                )}
              </>
            );
          })()}
        </div>
      </nav>
      <main key={path} className="flex-1 container mx-auto px-4 py-6 pb-28 sm:pb-24 soft-rise" style={{ paddingBottom: "calc(7rem + env(safe-area-inset-bottom, 0px))" }}>
        <Outlet />
      </main>
      {(() => {
        const email = (userEmail || "").toLowerCase();
        const isOffice = email === "office@esgc.local";
        if (!userEmail) return null;
        const items = [
          { to: "/", label: "Flights", icon: <ListChecks className="size-5" /> },
          { to: "/billing", label: "Billing", icon: <Receipt className="size-5" /> },
          { to: "/currency", label: "Currency", icon: <Activity className="size-5" /> },
          { to: "/logbook", label: "Logbook", icon: <BookOpen className="size-5" /> },
          { to: "/map", label: "Map", icon: <MapIcon className="size-5" /> },
          { to: "/weather", label: "Weather", icon: <CloudSun className="size-5" /> },
          { to: "/stats", label: "Stats", icon: <BarChart3 className="size-5" /> },
          { to: "/help", label: "Help", icon: <BookOpen className="size-5" /> },
          ...(isOffice
            ? [
                { to: "/history", label: "History", icon: <History className="size-5" /> },
                { to: "/audit", label: "Audit", icon: <History className="size-5" /> },
                { to: "/fleet", label: "Fleet", icon: <Plane className="size-5" /> },
                { to: "/members", label: "Users", icon: <Users className="size-5" /> },
                { to: "/settings", label: "Settings", icon: <SettingsIcon className="size-5" /> },
              ]
            : []),
        ];
        return <MacDock items={items} />;
      })()}
      {userEmail && <ProximityWatcher />}
      <Toaster />
    </div>
  );
}

function NavLink({
  to,
  icon,
  label,
  compact,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  compact?: boolean;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = path === to;
  return (
    <Link
      to={to}
      className={`shrink-0 flex items-center gap-1.5 rounded-md text-sm font-medium transition ${
        compact ? "px-2.5 py-1.5" : "px-3 py-2"
      } ${active ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
    >
      {icon}
      <span className={compact ? "" : "hidden sm:inline"}>{label}</span>
    </Link>
  );
}
