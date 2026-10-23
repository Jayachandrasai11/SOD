import type { AppUser, Settings } from "@/types";
import { audit, commit, db, latency } from "./db";

export async function getSettings(): Promise<Settings> {
  await latency(200);
  return JSON.parse(JSON.stringify(db.settings));
}

export async function saveSettings(next: Settings, reason?: string) {
  await latency(300);
  const before = db.settings;
  const changes: string[] = [];
  (Object.keys(next.levelToStatus) as (keyof Settings["levelToStatus"])[]).forEach((k) => {
    if (before.levelToStatus[k] !== next.levelToStatus[k]) changes.push(`${k}: ${before.levelToStatus[k]} → ${next.levelToStatus[k]}`);
  });
  if (before.stalenessDays !== next.stalenessDays) changes.push(`staleness ${before.stalenessDays} → ${next.stalenessDays} days`);
  if (before.mitigatedStatus !== next.mitigatedStatus) changes.push(`mitigated → ${next.mitigatedStatus}`);
  if (before.namingPrefixes.join() !== next.namingPrefixes.join()) changes.push(`prefixes ${next.namingPrefixes.join(", ")}`);
  db.settings = JSON.parse(JSON.stringify(next));
  audit({ area: "Settings", action: "Changed settings", object: "Traffic light & naming", after: changes.join("; ") || "No changes", reason });
  commit();
}

export async function getAppUsers(): Promise<AppUser[]> {
  await latency(200);
  return db.appUsers.map((u) => ({ ...u }));
}

export async function setAppUserRole(id: string, role: AppUser["role"]) {
  await latency(200);
  const u = db.appUsers.find((x) => x.id === id)!;
  const before = u.role;
  u.role = role;
  audit({ area: "Settings", action: "Changed app user role", object: u.name, before, after: role });
  commit();
}

export function namingCheck(name: string, settings: Settings = db.settings): string | undefined {
  const n = name.trim();
  if (!n) return "Enter a technical role name.";
  if (!settings.namingPrefixes.some((p) => n.toUpperCase().startsWith(p)))
    return `Role names must start with ${settings.namingPrefixes.join(" or ")} (customer namespace).`;
  if (!/^[A-Z0-9_/]+$/.test(n)) return "Use upper-case letters, digits and underscores only.";
  if (n.length > settings.maxRoleNameLength) return `Maximum ${settings.maxRoleNameLength} characters (currently ${n.length}).`;
  return undefined;
}

export const onboarding = () => ({ ...db.onboarding });
