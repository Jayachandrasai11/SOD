import * as React from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpen,
  Hammer,
  Home,
  Loader2,
  Menu,
  Moon,
  Plug,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { db, useDbVersion } from "@/services/db";
import { cn, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/rules", label: "Rules", icon: BookOpen },
  { to: "/connections", label: "Connections", icon: Plug },
  { to: "/roles", label: "Roles & Analysis", icon: ShieldCheck },
  { to: "/builder", label: "Role Builder", icon: Hammer },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 flex items-center gap-2 px-2 pt-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div className="leading-tight">
          <div className="font-semibold">MySODAI</div>
          <div className="text-[11px] text-muted-foreground">SoD workbench · GRC</div>
        </div>
      </div>
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              isActive && "bg-accent text-accent-foreground",
            )
          }
        >
          <n.icon className="h-4 w-4" aria-hidden />
          {n.label}
        </NavLink>
      ))}
      <div className="mt-auto rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Read-only
        </div>
        MySODAI never writes to SAP.
      </div>
    </nav>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);
  useDbVersion();

  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const s = q.trim().toLowerCase();
  const results = s
    ? [
        ...db.roles.filter((r) => r.name.toLowerCase().includes(s) || r.description.toLowerCase().includes(s)).slice(0, 5).map((r) => ({ kind: "Role", label: r.name, sub: r.description, to: `/roles/${encodeURIComponent(r.name)}` })),
        ...db.risks.filter((r) => r.id.toLowerCase().includes(s) || r.description.toLowerCase().includes(s)).slice(0, 4).map((r) => ({ kind: "Risk", label: r.description, sub: r.id, to: `/rules?risk=${r.id}` })),
        ...db.users.filter((u) => u.name.toLowerCase().includes(s) || u.id.toLowerCase().includes(s)).slice(0, 4).map((u) => ({ kind: "User", label: u.name, sub: `${u.id} · ${u.department}`, to: `/roles/analysis?kind=User&subject=${u.id}` })),
      ]
    : [];

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={ref}
        type="search"
        aria-label="Search roles, risks and users"
        placeholder="Search roles, risks, users…  (Ctrl K)"
        className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            navigate(results[0].to);
            setQ("");
            setOpen(false);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && s && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border bg-popover shadow-lg">
          {results.length ? (
            <ul>
              {results.map((r) => (
                <li key={r.kind + r.to}>
                  <button
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      navigate(r.to);
                      setQ("");
                      setOpen(false);
                    }}
                  >
                    <span className="w-10 shrink-0 text-[11px] font-semibold uppercase text-muted-foreground">{r.kind}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-sm text-muted-foreground">No roles, risks or users match “{q}”.</p>
          )}
        </div>
      )}
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { theme, toggleTheme, systemId, setSystemId, user, setUser, notifications, markAllRead, jobs } = useApp();
  const navigate = useNavigate();
  useDbVersion();
  const unread = notifications.filter((n) => !n.read).length;
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .join("");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu />
      </Button>
      <Select value={systemId} onValueChange={setSystemId}>
        <SelectTrigger className="w-auto min-w-[220px] max-w-[280px]" aria-label="SAP system">
          <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {db.systems.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}, client {s.client}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="hidden flex-1 justify-center md:flex">
        <GlobalSearch />
      </div>
      <div className="ml-auto flex items-center gap-1">
        {jobs.length > 0 && (
          <div className="mr-2 hidden w-48 items-center gap-2 sm:flex" role="status" aria-live="polite">
            <Loader2 className={cn("h-4 w-4 text-primary", !jobs[0].done && "animate-spin")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs">{jobs[0].label} · {jobs[0].progress}%</div>
              <Progress value={jobs[0].progress} className="h-1.5" aria-label={`${jobs[0].label} progress`} />
            </div>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <DropdownMenu onOpenChange={(o) => !o && unread && markAllRead()}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Notifications, ${unread} unread`} className="relative">
              <Bell />
              {unread > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {unread}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            {notifications.map((n) => (
              <DropdownMenuItem key={n.id} className="flex-col items-start gap-0.5" onSelect={() => n.link && navigate(n.link)}>
                <span className="flex w-full items-center gap-2 font-medium">
                  {!n.read && <span className="h-2 w-2 rounded-full bg-primary" aria-label="unread" />}
                  {n.title}
                </span>
                <span className="text-xs text-muted-foreground">{n.body}</span>
                <span className="text-[11px] text-muted-foreground">{relativeTime(n.time)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Account: ${user.name}, ${user.role}`}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials}</span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-medium">{user.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {user.role}
                  {user.role === "Auditor" && " (read-only)"}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Switch demo user</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={user.id} onValueChange={(id) => setUser(db.appUsers.find((u) => u.id === id)!)}>
              {db.appUsers.map((u) => (
                <DropdownMenuRadioItem key={u.id} value={u.id}>
                  <span className="flex flex-col">
                    <span>{u.name}</span>
                    <span className="text-xs text-muted-foreground">{u.role}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/settings")}>
              <Settings /> Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const location = useLocation();
  React.useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-card lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r bg-card shadow-xl">
            <Button variant="ghost" size="icon" className="absolute right-2 top-2" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
              <X />
            </Button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
