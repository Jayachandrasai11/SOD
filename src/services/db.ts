/**
 * In-memory mock database. Every service reads/writes through here so the
 * whole app reacts consistently. Replace each service's body with real API
 * calls (SAP OData / RFC agent / GRC backend) – components never touch `db`.
 */
import { useEffect, useState, useSyncExternalStore, useCallback } from "react";
import type { AnalysisRun, AuditEntry, Mitigation, Risk, Role, RulesetVersion, SapSystem, Settings, SodFunction, SyncRun, User } from "@/types";
import { FUNCTIONS, RISKS, VERSIONS } from "@/data/rules";
import { ROLES, MITIGATIONS } from "@/data/roles";
import { USERS, APP_USERS } from "@/data/users";
import { SYSTEMS, SYNC_RUNS } from "@/data/systems";
import { AUDIT } from "@/data/audit";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export const DEFAULT_SETTINGS: Settings = {
  levelToStatus: { Critical: "red", High: "red", Medium: "amber", Low: "amber" },
  mitigatedStatus: "amber",
  stalenessDays: 7,
  namingPrefixes: ["Z_", "Y_"],
  namingPattern: "Z_<PROCESS>_<FUNCTION>",
  maxRoleNameLength: 30,
};

export interface Onboarding {
  rulesImported: boolean;
  systemConnected: boolean;
  analysisRun: boolean;
}

export interface Db {
  risks: Risk[];
  functions: SodFunction[];
  versions: RulesetVersion[];
  draftChanges: number;
  draftStatus: RulesetVersion["status"];
  systems: SapSystem[];
  syncRuns: SyncRun[];
  roles: Role[];
  users: User[];
  mitigations: Mitigation[];
  runs: AnalysisRun[];
  audit: AuditEntry[];
  settings: Settings;
  appUsers: typeof APP_USERS;
  onboarding: Onboarding;
  builderDrafts: (Role & { version: number })[];
}

export const db: Db = {
  risks: clone(RISKS),
  functions: clone(FUNCTIONS),
  versions: clone(VERSIONS),
  draftChanges: 6,
  draftStatus: "Draft",
  systems: clone(SYSTEMS),
  syncRuns: clone(SYNC_RUNS),
  roles: clone(ROLES),
  users: clone(USERS),
  mitigations: clone(MITIGATIONS),
  runs: [],
  audit: clone(AUDIT),
  settings: clone(DEFAULT_SETTINGS),
  appUsers: clone(APP_USERS),
  onboarding: { rulesImported: true, systemConnected: true, analysisRun: false },
  builderDrafts: [],
};

let version = 0;
const listeners = new Set<() => void>();

export function commit() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const getVersion = () => version;

export const useDbVersion = () => useSyncExternalStore(subscribe, getVersion);

/** Simulated network latency so skeleton loaders are visible */
export const latency = (ms = 350) => new Promise((r) => setTimeout(r, ms));

/**
 * Load data from an async service and re-run whenever the mock db changes.
 * `deps` lets callers re-query when filters change.
 */
export function useService<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const v = useDbVersion();
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>();
  const run = useCallback(fn, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    // Only show skeletons on first load – later refreshes are silent
    if (data === undefined) setLoading(true);
    run()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [run, v]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error };
}

export function audit(entry: Omit<AuditEntry, "id" | "timestamp" | "user"> & { user?: string }) {
  db.audit.unshift({
    ...entry,
    id: `A-${1029 + db.audit.length}`,
    timestamp: new Date().toISOString(),
    user: entry.user ?? currentUserName(),
  });
}

let currentUser = "Anna Schmidt";
export const setCurrentUserName = (n: string) => (currentUser = n);
export const currentUserName = () => currentUser;
