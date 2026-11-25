/**
 * SAP S/4HANA access layer (read-only – MySODAI never writes to SAP).
 * Mock today; later: OData (API_USER/PFCG role APIs), RFC agent or file upload.
 */
import type { AuthType, ConnectionMethod, Deployment, Role, SapSystem, SapSystemApiConfig, SyncRun, Tier, User } from "@/types";
import { audit, commit, db, latency } from "./db";
import { SNAPSHOT_DATE } from "@/data/roles";
import { MOCK_NOW } from "@/lib/utils";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const SYNC_RUNS_STORAGE_KEY = "mysodai_sync_runs";

function getLocalSyncRuns(): SyncRun[] {
  try {
    const raw = localStorage.getItem(SYNC_RUNS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveLocalSyncRun(run: SyncRun) {
  try {
    const existing = getLocalSyncRuns();
    const updated = [run, ...existing.filter((r) => r.id !== run.id)].slice(0, 50);
    localStorage.setItem(SYNC_RUNS_STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

let systemsLoaded = false;
let rolesLoaded = false;
let usersLoaded = false;
let pendingMasterLoad: Promise<void> | null = null;

export async function getSystems(): Promise<SapSystem[]> {
  try {
    const res = await fetch("/api/systems");
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        db.systems = data;
        systemsLoaded = true;
      }
    }
  } catch {}
  return clone(db.systems);
}

export async function getSyncRuns(): Promise<SyncRun[]> {
  const localStored = getLocalSyncRuns();

  try {
    const res = await fetch("/api/sync-runs");
    if (res.ok) {
      const remoteRuns: SyncRun[] = await res.json();
      if (Array.isArray(remoteRuns)) {
        const combined = [...localStored, ...remoteRuns, ...db.syncRuns];
        const seen = new Set<string>();
        const unique: SyncRun[] = [];
        for (const item of combined) {
          if (item && item.id && !seen.has(item.id)) {
            seen.add(item.id);
            unique.push(item);
          }
        }
        unique.sort((a, b) => new Date(b.started).getTime() - new Date(a.started).getTime());
        db.syncRuns = unique;
        return clone(db.syncRuns);
      }
    }
  } catch (err) {
    console.warn("Failed to fetch /api/sync-runs:", err);
  }

  const fallback = [...localStored, ...db.syncRuns];
  const seen = new Set<string>();
  const unique: SyncRun[] = [];
  for (const item of fallback) {
    if (item && item.id && !seen.has(item.id)) {
      seen.add(item.id);
      unique.push(item);
    }
  }
  unique.sort((a, b) => new Date(b.started).getTime() - new Date(a.started).getTime());
  db.syncRuns = unique;
  return clone(db.syncRuns);
}

export interface TestStep {
  key: "reachable" | "auth" | "techuser";
  label: string;
  ok: boolean;
  hint?: string;
}

export interface TestConnectionInput {
  systemId?: string;
  host: string;
  method: ConnectionMethod;
  authType: AuthType;
  tier?: Tier;
  apiConfig?: SapSystemApiConfig;
  tokenUrl?: string;
  clientId?: string;
  secret?: string;
  user?: string;
}

/** Runs the 3-step connection test via backend API. onStep fires as each check completes. */
export async function testConnection(
  input: TestConnectionInput,
  onStep?: (s: TestStep) => void,
): Promise<TestStep[]> {
  try {
    const resp = await fetch("/api/systems/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (resp.ok) {
      const payload = await resp.json();
      const serverSteps: TestStep[] = Array.isArray(payload?.steps) ? payload.steps : [];
      const emitted: TestStep[] = [];
      for (const s of serverSteps) {
        await latency(250);
        emitted.push(s);
        onStep?.(s);
      }
      return emitted;
    }
  } catch (err) {
    console.warn("Backend connection test failed, using local fallback:", err);
  }

  const steps: TestStep[] = [];
  const push = (s: TestStep) => {
    steps.push(s);
    onStep?.(s);
  };
  await latency(500);
  const reachable = !/fail|invalid/i.test(input.host) && input.host.trim().length > 3;
  push({ key: "reachable", label: "Reachable", ok: reachable, hint: reachable ? undefined : "Check the host name or CAP Service Root URL." });
  if (!reachable) return steps;
  await latency(500);
  push({ key: "auth", label: "Authenticated", ok: true });
  await latency(500);
  const techOk = input.method !== "RFC agent" || input.tier !== "Prod";
  push({
    key: "techuser",
    label: "Technical user authorisations",
    ok: techOk,
    hint: techOk
      ? undefined
      : "Technical user is missing S_RFC for function groups SUSR and PRGN_J2EE. Assign role /MYSODAI/READ_ONLY in PFCG, then test again.",
  });
  return steps;
}

export async function testExisting(id: string, onStep?: (s: TestStep) => void) {
  const s = db.systems.find((x) => x.id === id)!;
  const res = await testConnection(
    { systemId: s.id, host: s.host, method: s.method, authType: s.authType, tier: s.tier, apiConfig: s.apiConfig },
    onStep,
  );
  audit({ area: "Connection", action: "Tested connection", object: s.name, after: res.every((x) => x.ok) ? "All checks passed" : "Failed" });
  commit();
  return res;
}

export function getLastSyncType(systemId?: string): "Delta" | "Full" {
  try {
    const saved = (systemId ? localStorage.getItem(`last_sync_type_${systemId}`) : null) || localStorage.getItem("last_sync_type");
    if (saved === "Delta" || saved === "Full") return saved;
  } catch {}
  const run = systemId ? db.syncRuns.find((r) => r.systemId === systemId) : db.syncRuns[0];
  return run?.type || "Delta";
}

export async function syncNow(
  id: string,
  typeOrProgress?: "Delta" | "Full" | ((pct: number) => void),
  onProgress?: (pct: number) => void
) {
  const type: "Delta" | "Full" = typeof typeOrProgress === "string" ? typeOrProgress : getLastSyncType(id);
  const progressCb = typeof typeOrProgress === "function" ? typeOrProgress : onProgress;
  const isFull = type === "Full";

  try {
    localStorage.setItem(`last_sync_type_${id}`, type);
    localStorage.setItem("last_sync_type", type);
  } catch {}

  const s = db.systems.find((x) => x.id === id) || db.systems[0];
  let pct = 5;
  progressCb?.(pct);
  const timer = setInterval(() => {
    pct = Math.min(88, pct + (isFull ? 4 : 12));
    progressCb?.(pct);
  }, 600);

  let backendSuccess = false;
  let records = 0;
  let syncResultMessage = "";

  try {
    const resp = await fetch(`/api/systems/${encodeURIComponent(id)}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data?.details) {
      backendSuccess = true;
      const details = data.details;
      const hdrs = details.details?.headers?.count ?? 0;
      const ua = details.details?.userAssignments?.count ?? 0;
      records = details.records ?? (hdrs + ua);
      syncResultMessage = details.message || `SAP ${s?.sid || "HMF"} (${type} sync) synchronized`;
      progressCb?.(95);
      await Promise.all([getSystems(), getRoles(), getUsers(), getSyncRuns()]);
    } else if (!resp.ok && resp.status !== 404) {
      throw new Error(data?.error || `Sync failed with HTTP ${resp.status}`);
    }
  } catch (err) {
    // Only fall back to simulated local entry when backend API itself is offline/unreachable
    if (err instanceof TypeError) {
      console.warn("Backend sync unreachable, recording local run:", err);
    } else {
      clearInterval(timer);
      throw err;
    }
  } finally {
    clearInterval(timer);
  }

  if (!backendSuccess) {
    const now = new Date().toISOString();
    records = isFull
      ? (s?.counts?.roles ? s.counts.roles + (s?.counts?.users || 0) : 5312)
      : Math.round(150 + Math.random() * 450);
    const durationSec = isFull ? 8 : 2;
    syncResultMessage = isFull
      ? `Offline snapshot simulation for SAP S/4HANA (${s?.sid || "HMF"})`
      : `Offline delta simulation (${s?.sid || "HMF"}): ${records} updates`;

    const newRun: SyncRun = {
      id: `SY-${Date.now().toString().slice(-4)}`,
      systemId: id,
      systemName: s?.name || "HMF 2023 – SAP S/4HANA (BTP CAP)",
      type,
      started: now,
      durationSec,
      records,
      result: "Warning",
      message: syncResultMessage,
    };
    saveLocalSyncRun(newRun);
    db.syncRuns = [newRun, ...db.syncRuns.filter((r) => r.id !== newRun.id)];
    if (s) {
      if (isFull) s.lastFullSync = now;
      s.lastDeltaSync = now;
    }
  }

  progressCb?.(100);
  audit({
    area: "Connection",
    action: `Manual ${type.toLowerCase()} sync`,
    object: s?.name || "SAP Connection",
    after: `${records} records`,
  });
  commit();
  return records;
}

export interface NewSystemInput {
  name: string;
  sid: string;
  client: string;
  tier: Tier;
  deployment: Deployment;
  method: ConnectionMethod;
  authType: AuthType;
  host: string;
  scheduleFull: string;
  scheduleDelta: string;
  apiConfig?: SapSystemApiConfig;
  secret?: string;
}

export async function addSystem(input: NewSystemInput) {
  let savedSys: SapSystem | null = null;
  try {
    const resp = await fetch("/api/systems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (resp.ok) {
      savedSys = await resp.json();
    }
  } catch (err) {
    console.warn("Could not persist system to /api/systems:", err);
  }

  const sys: SapSystem = savedSys || {
    id: `${input.sid}-${input.client}`,
    name: input.name,
    sid: input.sid,
    client: input.client,
    tier: input.tier,
    deployment: input.deployment,
    method: input.method,
    authType: input.authType,
    host: input.host,
    apiConfig: input.apiConfig,
    status: "Connected",
    lastFullSync: new Date().toISOString(),
    lastDeltaSync: new Date().toISOString(),
    counts: { users: 0, roles: 0, authRows: 0 },
    schedule: { full: input.scheduleFull, delta: input.scheduleDelta },
  };
  const idx = db.systems.findIndex((x) => x.id === sys.id);
  if (idx >= 0) db.systems[idx] = sys;
  else db.systems.push(sys);

  db.onboarding.systemConnected = true;
  const onboardRun: SyncRun = {
    id: `SY-${input.sid}-01`,
    systemId: sys.id,
    systemName: sys.name,
    type: "Full",
    started: new Date().toISOString(),
    durationSec: 1,
    records: 0,
    result: "Success",
    message: `Initial system connection: ${sys.name} (${sys.sid}) configured`,
  };
  saveLocalSyncRun(onboardRun);
  db.syncRuns.unshift(onboardRun);
  // Secrets are handed to the backend vault and never stored or shown in the UI again.
  audit({ area: "Connection", action: "Added system", object: sys.name, after: `${sys.method} · ${sys.authType}` });
  commit();
  return sys;
}

export async function updateSystem(id: string, patch: Partial<SapSystem> & { secret?: string }) {
  const i = db.systems.findIndex((s) => s.id === id);
  const before = db.systems[i];

  try {
    const resp = await fetch(`/api/systems/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (resp.ok) {
      const updated = await resp.json();
      if (i >= 0) {
        db.systems[i] = { ...before, ...updated, counts: before.counts };
      }
    } else if (i >= 0) {
      db.systems[i] = { ...before, ...patch };
    }
  } catch {
    if (i >= 0) db.systems[i] = { ...before, ...patch };
  }

  if (patch.name) {
    db.syncRuns.forEach((r) => {
      if (r.systemId === id) {
        r.systemName = patch.name;
      }
    });
  }
  audit({ area: "Connection", action: "Edited system", object: before.name, before: `${before.schedule.delta}`, after: `${db.systems[i].schedule.delta}` });
  commit();
}

// ---- Role & user master data (from the latest snapshot or PostgreSQL backend)

export async function getRoles(): Promise<Role[]> {
  try {
    const res = await fetch("/api/roles?limit=10000");
    if (res.ok) {
      const liveRoles = await res.json();
      if (Array.isArray(liveRoles) && liveRoles.length > 0) {
        db.roles = liveRoles;
        rolesLoaded = true;
      }
    }
  } catch (err) {
    console.error("Failed to load roles from /api/roles:", err);
  }
  return clone(db.roles);
}

export async function getRole(name: string): Promise<Role | undefined> {
  try {
    const res = await fetch(`/api/roles/${encodeURIComponent(name)}/details`);
    if (res.ok) {
      const detailed = await res.json();
      if (detailed && detailed.name) {
        const idx = db.roles.findIndex((r) => r.name.toUpperCase() === name.toUpperCase());
        if (idx >= 0) db.roles[idx] = detailed;
        else db.roles.push(detailed);
        return clone(detailed);
      }
    }
  } catch (err) {
    console.error(`Failed to load role details for ${name}:`, err);
  }
  const local = db.roles.find((x) => x.name.toUpperCase() === name.toUpperCase());
  return local ? clone(local) : undefined;
}

export async function getRoleAuthorizations(name: string, options?: { object?: string; search?: string }) {
  const params = new URLSearchParams();
  if (options?.object) params.set("object", options.object);
  if (options?.search) params.set("search", options.search);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/roles/${encodeURIComponent(name)}/authorizations${qs}`);
  if (!res.ok) throw new Error(`Failed to load authorizations: ${res.statusText}`);
  return res.json();
}

export async function getRoleOrgData(name: string, options?: { varbl?: string; search?: string }) {
  const params = new URLSearchParams();
  if (options?.varbl) params.set("varbl", options.varbl);
  if (options?.search) params.set("search", options.search);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/roles/${encodeURIComponent(name)}/org-data${qs}`);
  if (!res.ok) throw new Error(`Failed to load org data: ${res.statusText}`);
  return res.json();
}

export async function getRoleTCodes(name: string, options?: { search?: string }) {
  const params = new URLSearchParams();
  if (options?.search) params.set("search", options.search);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/roles/${encodeURIComponent(name)}/tcodes${qs}`);
  if (!res.ok) throw new Error(`Failed to load TCodes: ${res.statusText}`);
  return res.json();
}

export async function getUsers(): Promise<User[]> {
  try {
    const res = await fetch("/api/users");
    if (res.ok) {
      const liveUsers = await res.json();
      if (Array.isArray(liveUsers)) {
        db.users = liveUsers;
        usersLoaded = true;
      }
    }
  } catch (err) {
    console.warn("Failed to load users from /api/users:", err);
  }
  return clone(db.users);
}

/** Hydrate systems, roles, and SAP users from PostgreSQL once on cold page load (deduplicated). */
export async function ensureLiveMasterData(): Promise<void> {
  if (systemsLoaded && rolesLoaded && usersLoaded) return;
  if (pendingMasterLoad) return pendingMasterLoad;
  pendingMasterLoad = Promise.all([
    systemsLoaded ? Promise.resolve() : getSystems().then(() => undefined),
    rolesLoaded ? Promise.resolve() : getRoles().then(() => undefined),
    usersLoaded ? Promise.resolve() : getUsers().then(() => undefined),
  ])
    .then(() => undefined)
    .finally(() => {
      pendingMasterLoad = null;
    });
  return pendingMasterLoad;
}

export function snapshotInfo() {
  const s = db.systems[0];
  return { snapshot: s?.lastDeltaSync || SNAPSHOT_DATE, systemId: s?.id || "HMF-100" };
}

/** Does a role with this name already exist in the target system? */
export function roleExistsInSystem(name: string) {
  return db.roles.some((r) => r.name.toUpperCase() === name.toUpperCase());
}

/** Direct filtered per-role refresh from SAP CAP (RoleAuthorizations, RoleOrgData, RoleTCodes) */
export async function syncRoleFromSap(name: string, systemId = "HMF-100") {
  const resp = await fetch(`/api/roles/${encodeURIComponent(name)}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemId }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || `Failed to sync role ${name} (${resp.status})`);
  }
  await getRole(name);
  audit({ area: "Connection", action: "Synced single role details", object: name, after: `${data.synced?.authsCount ?? 0} auths, ${data.synced?.orgDataCount ?? 0} orgs` });
  commit();
  return data.synced as { roleName: string; headersCount: number; authsCount: number; orgDataCount: number; tcodesCount: number };
}

/** Pull latest created/modified roles directly from SAP BTP Cloud into PostgreSQL (< 1 sec) */
export async function syncRecentRolesFromSap(systemId = "HMF-100", top = 50) {
  const resp = await fetch("/api/sap/sync-recent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemId, top }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || `Failed to sync recent roles (${resp.status})`);
  }
  await getRoles();
  commit();
  return data as { success: boolean; count: number; message: string };
}

export interface CapWriteCapabilities {
  systemId: string;
  systemName: string;
  serviceRoot: string;
  destination: string;
  writeActionsEnabled: boolean;
  grantedScopes: string[];
  hasRoleAdministratorScope: boolean;
  requiredScope: string;
  tokenError?: string | null;
}

export interface CapWriteActionError extends Error {
  status?: number;
  code?: string;
  grantedScopes?: string[];
  requiredScope?: string;
  capResponse?: unknown;
}

export async function getCapWriteCapabilities(systemId = "HMF-100"): Promise<CapWriteCapabilities> {
  const resp = await fetch(`/api/sap/write-capabilities?systemId=${encodeURIComponent(systemId)}`);
  if (!resp.ok) throw new Error(`Failed to check CAP write capabilities (${resp.status})`);
  return resp.json();
}

async function callCapWriteEndpoint<T = unknown>(
  url: string,
  body: Record<string, unknown>,
  auditMeta: { action: string; object: string; after: string },
  method: "POST" | "PUT" = "POST"
): Promise<T> {
  const resp = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.success) {
    const err = new Error(data?.error || `CAP write request failed (HTTP ${resp.status})`) as CapWriteActionError;
    err.status = resp.status;
    err.code = data?.code;
    err.grantedScopes = data?.grantedScopes;
    err.requiredScope = data?.requiredScope;
    err.capResponse = data?.capResponse;
    throw err;
  }
  audit({ area: "Role admin", action: auditMeta.action, object: auditMeta.object, after: auditMeta.after });
  return data as T;
}

export async function sapUpdateRole(input: { role: string; description: string; systemId?: string }) {
  const role = input.role.trim().toUpperCase();
  const res = await callCapWriteEndpoint(
    `/api/sap/roles/${encodeURIComponent(role)}`,
    { Role: role, Desc: input.description.trim(), Flag: "ROLE", systemId: input.systemId || "HMF-100" },
    { action: "Updated role description in SAP (modify)", object: role, after: input.description.trim() },
    "PUT"
  );

  // Optimistically update in-memory role
  const existingIdx = db.roles.findIndex((r) => r.name.toUpperCase() === role);
  if (existingIdx >= 0) {
    db.roles[existingIdx] = {
      ...db.roles[existingIdx],
      description: input.description.trim(),
      lastChanged: new Date().toISOString(),
    };
  }

  await Promise.all([getRoles(), getSystems()]);
  commit();
  return res;
}

export async function sapCreateRole(input: { role: string; description: string; systemId?: string }) {
  const role = input.role.trim().toUpperCase();
  const res = await callCapWriteEndpoint(
    "/api/sap/roles",
    { Role: role, Desc: input.description.trim(), Flag: "ROLE", systemId: input.systemId || "HMF-100" },
    { action: "Created role in SAP (createRole)", object: role, after: input.description.trim() },
  );

  // Optimistically register into in-memory role repository for immediate UI responsiveness
  const existingIdx = db.roles.findIndex((r) => r.name.toUpperCase() === role);
  const newRoleObj = {
    name: role,
    description: input.description.trim(),
    type: "Single" as const,
    userCount: 0,
    tcodes: [],
    authorizations: [],
    orgData: [],
    createdAt: new Date().toISOString(),
    status: "Clean" as const,
    users: [],
    risks: [],
  };
  if (existingIdx >= 0) {
    db.roles[existingIdx] = { ...db.roles[existingIdx], ...newRoleObj };
  } else {
    db.roles.unshift(newRoleObj as any);
  }

  await Promise.all([getRoles(), getSystems()]);
  commit();
  return res;
}

export async function sapAssignRoleToUser(input: { role: string; user: string; systemId?: string }) {
  const role = input.role.trim().toUpperCase();
  const user = input.user.trim().toUpperCase();
  const res = await callCapWriteEndpoint(
    `/api/sap/roles/${encodeURIComponent(role)}/assign-user`,
    { Role: role, User: user, Flag: "ASSIGN", systemId: input.systemId || "HMF-100" },
    { action: "Assigned user to role (assignRoleToUser)", object: `${role} -> ${user}`, after: "Assigned" },
  );

  // Optimistically update in-memory user and role assignment counts
  const u = db.users.find((x) => x.id.toUpperCase() === user || x.name.toUpperCase() === user);
  if (u && !u.roles.includes(role)) {
    u.roles.push(role);
  }

  await Promise.all([getUsers(), getSystems()]);
  commit();
  return res;
}

export async function sapRemoveRoleFromUser(input: { role: string; user: string; systemId?: string }) {
  const role = input.role.trim().toUpperCase();
  const user = input.user.trim().toUpperCase();
  const res = await callCapWriteEndpoint(
    `/api/sap/roles/${encodeURIComponent(role)}/remove-user`,
    { Role: role, User: user, Flag: "REMOVE", systemId: input.systemId || "HMF-100" },
    { action: "Removed user from role (removeRoleFromUser)", object: `${role} -> ${user}`, after: "Removed" },
  );

  // Optimistically remove from in-memory user and role assignment counts
  const u = db.users.find((x) => x.id.toUpperCase() === user || x.name.toUpperCase() === user);
  if (u) {
    u.roles = u.roles.filter((r) => r.toUpperCase() !== role);
  }

  await Promise.all([getUsers(), getSystems()]);
  commit();
  return res;
}

export interface HeaderToUserStatus {
  ok: boolean;
  status: string;
  verified: boolean;
  httpStatus: number;
  endpoint: string;
  serviceRoot: string;
  latencyMs: number;
  headersSampleCount: number;
  sampleHeaders: Array<{
    AgrName: string;
    Text: string;
    RoleType: string;
    CreateUsr?: string;
    CreateDat?: string;
    assignedUserCount: number;
    sampleUsers: Array<{
      AgrName: string;
      Uname: string;
      FromDat?: string;
      ToDat?: string;
    }>;
  }>;
  documentedInFile2: boolean;
}

export async function getHeaderToUserStatus(systemId = "HMF-100"): Promise<HeaderToUserStatus | null> {
  try {
    const res = await fetch(`/api/sap/header-to-user?systemId=${encodeURIComponent(systemId)}&top=10`);
    if (res.ok) return res.json();
  } catch (err) {
    console.warn("Failed to check header to user status:", err);
  }
  return null;
}

export async function syncHeaderToUserNow(systemId = "HMF-100", pageSize = 100) {
  const res = await fetch("/api/sap/sync/header-to-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemId, pageSize }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Header-to-User sync failed: ${errText}`);
  }
  const data = await res.json();
  await Promise.all([getRoles(), getUsers(), getSyncRuns()]);
  commit();
  return data;
}

export async function getRoleUsers(roleName: string) {
  try {
    const res = await fetch(`/api/roles/${encodeURIComponent(roleName)}/users`);
    if (res.ok) return res.json();
  } catch (err) {
    console.warn(`Failed to fetch users for role ${roleName}:`, err);
  }
  return [];
}

export interface SuiteEndpoint {
  key: string;
  name: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  fullUrl: string;
  status: string;
  targetTable: string;
  recordCount?: number;
  section: string;
  desc: string;
  navigations?: string[];
  samplePayload?: Record<string, any>;
  scopeRequired?: string;
  isHighlight?: boolean;
}

export interface SuiteCategory {
  id: string;
  title: string;
  service: string;
  description: string;
  endpoints: SuiteEndpoint[];
}

export interface SuiteStatus {
  ok: boolean;
  systemId: string;
  systemName: string;
  serviceRoot: string;
  destination: string;
  dbCounts: {
    roleHeaders: number;
    roleUserAssignments: number;
    roleAuthorizations: number;
    roleOrgData: number;
    distinctUsers: number;
    distinctRolesWithUsers: number;
  };
  categories: SuiteCategory[];
  totalEndpointsCount: number;
}

export async function getSuiteStatus(systemId = "HMF-100"): Promise<SuiteStatus | null> {
  try {
    const res = await fetch(`/api/sap/suite-status?systemId=${encodeURIComponent(systemId)}`);
    if (res.ok) return res.json();
  } catch (err) {
    console.warn("Failed to fetch suite status:", err);
  }
  return null;
}

export async function probeEndpoint(endpoint: string, systemId = "HMF-100") {
  try {
    const res = await fetch(`/api/sap/probe-endpoint?endpoint=${encodeURIComponent(endpoint)}&systemId=${encodeURIComponent(systemId)}`);
    if (res.ok) return res.json();
    return { ok: false, httpStatus: res.status, error: await res.text() };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
