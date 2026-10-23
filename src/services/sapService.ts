/**
 * SAP S/4HANA access layer (read-only – MySODAI never writes to SAP).
 * Mock today; later: OData (API_USER/PFCG role APIs), RFC agent or file upload.
 */
import type { AuthType, ConnectionMethod, Deployment, Role, SapSystem, SyncRun, Tier, User } from "@/types";
import { audit, commit, db, latency } from "./db";
import { SNAPSHOT_DATE } from "@/data/roles";
import { MOCK_NOW } from "@/lib/utils";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export async function getSystems(): Promise<SapSystem[]> {
  await latency();
  return clone(db.systems);
}

export async function getSyncRuns(): Promise<SyncRun[]> {
  await latency(200);
  return clone(db.syncRuns);
}

export interface TestStep {
  key: "reachable" | "auth" | "techuser";
  label: string;
  ok: boolean;
  hint?: string;
}

/** Runs the 3-step connection test. onStep fires as each check completes. */
export async function testConnection(
  input: { host: string; method: ConnectionMethod; authType: AuthType; tier?: Tier },
  onStep?: (s: TestStep) => void,
): Promise<TestStep[]> {
  const steps: TestStep[] = [];
  const push = (s: TestStep) => {
    steps.push(s);
    onStep?.(s);
  };
  await latency(700);
  const reachable = !/fail|invalid/i.test(input.host) && input.host.trim().length > 3;
  push({ key: "reachable", label: "Reachable", ok: reachable, hint: reachable ? undefined : "Check the host name and that port 443 (OData) or the RFC agent port is open from the MySODAI network." });
  if (!reachable) return steps;
  await latency(800);
  push({ key: "auth", label: "Authenticated", ok: true });
  await latency(900);
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
  const res = await testConnection({ host: s.host, method: s.method, authType: s.authType, tier: s.tier }, onStep);
  audit({ area: "Connection", action: "Tested connection", object: s.name, after: res.every((x) => x.ok) ? "All checks passed" : "Failed" });
  commit();
  return res;
}

export async function syncNow(id: string, onProgress?: (pct: number) => void) {
  const s = db.systems.find((x) => x.id === id)!;
  for (let p = 0; p <= 100; p += 10) {
    onProgress?.(p);
    await latency(220);
  }
  const now = new Date().toISOString();
  const records = Math.round(800 + Math.random() * 3000);
  db.syncRuns.unshift({ id: `SY-${2211 + db.syncRuns.length}`, systemId: id, type: "Delta", started: now, durationSec: 2 + Math.round(Math.random() * 5), records, result: "Success" });
  s.lastDeltaSync = MOCK_NOW.toISOString();
  s.status = "Connected";
  s.statusMessage = undefined;
  audit({ area: "Connection", action: "Manual delta sync", object: s.name, after: `${records} records` });
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
}

export async function addSystem(input: NewSystemInput) {
  await latency(500);
  const sys: SapSystem = {
    id: `${input.sid}-${input.client}`,
    name: input.name,
    sid: input.sid,
    client: input.client,
    tier: input.tier,
    deployment: input.deployment,
    method: input.method,
    authType: input.authType,
    host: input.host,
    status: "Connected",
    lastFullSync: new Date().toISOString(),
    lastDeltaSync: new Date().toISOString(),
    counts: { users: 0, roles: 0, authRows: 0 },
    schedule: { full: input.scheduleFull, delta: input.scheduleDelta },
  };
  db.systems.push(sys);
  db.onboarding.systemConnected = true;
  // Secrets are handed to the vault and never stored or shown in the UI again.
  audit({ area: "Connection", action: "Added system", object: sys.name, after: `${sys.method} · ${sys.authType}` });
  commit();
  return sys;
}

export async function updateSystem(id: string, patch: Partial<SapSystem>) {
  await latency(300);
  const i = db.systems.findIndex((s) => s.id === id);
  const before = db.systems[i];
  db.systems[i] = { ...before, ...patch };
  audit({ area: "Connection", action: "Edited system", object: before.name, before: `${before.schedule.delta}`, after: `${db.systems[i].schedule.delta}` });
  commit();
}

// ---- Role & user master data (from the latest snapshot)

export async function getRoles(): Promise<Role[]> {
  await latency(400);
  return clone(db.roles);
}

export async function getRole(name: string): Promise<Role | undefined> {
  await latency(250);
  const r = db.roles.find((x) => x.name === name);
  return r ? clone(r) : undefined;
}

export async function getUsers(): Promise<User[]> {
  await latency(300);
  return clone(db.users);
}

export function snapshotInfo() {
  return { snapshot: SNAPSHOT_DATE, systemId: "S4P-100" };
}

/** Does a role with this name already exist in the target system? */
export function roleExistsInSystem(name: string) {
  return db.roles.some((r) => r.name.toUpperCase() === name.toUpperCase());
}
