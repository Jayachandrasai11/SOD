import * as React from "react";
import { toast } from "sonner";
import type { AppRole, AppUser } from "@/types";
import { db, setCurrentUserName } from "@/services/db";

export interface Job {
  id: string;
  label: string;
  progress: number;
  done: boolean;
  link?: string;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
  link?: string;
}

interface Ctx {
  theme: "light" | "dark";
  toggleTheme: () => void;
  systemId: string;
  setSystemId: (id: string) => void;
  user: AppUser;
  setUser: (u: AppUser) => void;
  /** Auditors are read-only; Risk Owners can approve but not edit rules/roles */
  can: (perm: "edit" | "approve" | "admin") => boolean;
  jobs: Job[];
  startJob: (label: string, work: (setProgress: (p: number) => void) => Promise<{ message: string; link?: string }>) => void;
  notifications: Notification[];
  markAllRead: () => void;
}

const AppContext = React.createContext<Ctx | null>(null);

const initialNotifications: Notification[] = [
  { id: "n1", title: "Delta sync failed on S4P", body: "Two scheduled runs timed out. Data is 2 days old.", time: "2026-10-23T02:30:00Z", read: false, link: "/settings?tab=connections" },
  { id: "n2", title: "Ruleset v1.4 awaiting submission", body: "6 unsaved changes in draft.", time: "2026-10-22T15:12:00Z", read: false, link: "/settings?tab=rules" },
  { id: "n3", title: "Nightly analysis finished", body: "RUN-20261022-0200 · 14 roles need action.", time: "2026-10-22T02:40:00Z", read: true, link: "/roles/analysis" },
];

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [systemId, setSystemId] = React.useState("S4P-100");
  const [user, setUserState] = React.useState<AppUser>(db.appUsers[0]);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [notifications, setNotifications] = React.useState(initialNotifications);

  const toggleTheme = React.useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("mysodai-theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const setUser = (u: AppUser) => {
    setUserState(u);
    setCurrentUserName(u.name);
    toast.info(`Viewing as ${u.name} · ${u.role}`);
  };

  const can = React.useCallback(
    (perm: "edit" | "approve" | "admin") => {
      const r: AppRole = user.role;
      if (perm === "admin") return r === "Administrator";
      if (perm === "approve") return r === "Administrator" || r === "Risk Owner";
      return r === "Administrator" || r === "Security Analyst";
    },
    [user.role],
  );

  const startJob: Ctx["startJob"] = (label, work) => {
    const id = Math.random().toString(36).slice(2);
    setJobs((j) => [...j, { id, label, progress: 0, done: false }]);
    work((p) => setJobs((j) => j.map((x) => (x.id === id ? { ...x, progress: p } : x))))
      .then(({ message, link }) => {
        setJobs((j) => j.map((x) => (x.id === id ? { ...x, progress: 100, done: true, link } : x)));
        setNotifications((n) => [{ id, title: `${label} finished`, body: message, time: new Date().toISOString(), read: false, link }, ...n]);
        toast.success(`${label} finished`, { description: message });
        setTimeout(() => setJobs((j) => j.filter((x) => x.id !== id)), 6000);
      })
      .catch((e: Error) => {
        setJobs((j) => j.filter((x) => x.id !== id));
        toast.error(`${label} failed`, { description: e.message });
      });
  };

  const markAllRead = () => setNotifications((n) => n.map((x) => ({ ...x, read: true })));

  return (
    <AppContext.Provider value={{ theme, toggleTheme, systemId, setSystemId, user, setUser, can, jobs, startJob, notifications, markAllRead }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
