/**
 * SoD analysis service. Mock runs the local engine; a real implementation
 * would submit a job to the analysis backend and poll for results.
 */
import type { AnalysisRun, Process, RiskHit, Role, Status, SubjectResult, User } from "@/types";
import { PROCESSES } from "@/types";
import { audit, commit, db, latency } from "./db";
import { authsForRole, bestRemediation, evaluate, evaluateRole, grantsForRole, isStale, worstStatus, type EvalContext, type Remediation } from "@/lib/sod";
import { LAST_RUN_ID, SNAPSHOT_DATE } from "@/data/roles";
import { currentDraftVersion, publishedVersion } from "./rulesService";
import { MOCK_NOW } from "@/lib/utils";

const ctx = (): EvalContext => ({ risks: db.risks, functions: db.functions, mitigations: db.mitigations, settings: db.settings });
const roleMap = () => new Map(db.roles.map((r) => [r.name, r]));

/** Children of composites / parents of derived that are stale make the result partial */
function rolePartial(role: Role, map: Map<string, Role>): boolean {
  if (role.type !== "Composite") return false;
  return (role.children ?? []).some((c) => {
    const ch = map.get(c);
    return !ch || isStale(ch.lastAnalysed, db.settings);
  });
}

export function roleResult(role: Role): SubjectResult {
  const map = roleMap();
  if (isStale(role.lastAnalysed, db.settings)) return { subject: role.name, subjectKind: "Role", status: "grey", hits: [] };
  const res = evaluateRole(role, map, ctx());
  if (rolePartial(role, map)) res.status = worstStatus([res.status, "amber"]);
  return res;
}

export function userResult(user: User): SubjectResult {
  const map = roleMap();
  const roles = user.roles.map((r) => map.get(r)).filter(Boolean) as Role[];
  const grants = roles.flatMap((r) => grantsForRole(r, map));
  const auths = roles.flatMap((r) => authsForRole(r, map));
  const res = evaluate(user.id, "User", grants, auths, ctx());
  const anyStale = roles.some((r) => isStale(r.lastAnalysed, db.settings));
  if (anyStale && roles.every((r) => isStale(r.lastAnalysed, db.settings))) return { ...res, status: "grey", hits: [] };
  if (anyStale) res.status = worstStatus([res.status, "amber"]); // partial data
  return res;
}

export function roleStatuses(): Record<string, Status> {
  return Object.fromEntries(db.roles.map((r) => [r.name, roleResult(r).status]));
}

export function remediationFor(result: SubjectResult): Remediation | undefined {
  const map = roleMap();
  if (result.subjectKind === "Role") {
    const role = map.get(result.subject);
    if (!role) return undefined;
    return bestRemediation(result, grantsForRole(role, map), authsForRole(role, map), ctx());
  }
  const user = db.users.find((u) => u.id === result.subject);
  if (!user) return undefined;
  const roles = user.roles.map((r) => map.get(r)).filter(Boolean) as Role[];
  return bestRemediation(result, roles.flatMap((r) => grantsForRole(r, map)), roles.flatMap((r) => authsForRole(r, map)), ctx());
}

function baselineRun(): AnalysisRun {
  return {
    runId: LAST_RUN_ID,
    startedAt: SNAPSHOT_DATE,
    rulesetVersion: publishedVersion(),
    snapshot: SNAPSHOT_DATE,
    systemId: "S4P-100",
    scope: "Nightly scheduled analysis · all roles and users",
    results: [...db.roles.map(roleResult), ...db.users.map(userResult)],
  };
}

export async function getLatestRun(): Promise<AnalysisRun> {
  await latency(300);
  return db.runs[0] ?? baselineRun();
}

export async function getRun(runId?: string | null): Promise<AnalysisRun> {
  await latency(300);
  if (!runId) return db.runs[0] ?? baselineRun();
  return db.runs.find((r) => r.runId === runId) ?? baselineRun();
}

export async function getRuns(): Promise<AnalysisRun[]> {
  await latency(100);
  return db.runs.length ? db.runs : [baselineRun()];
}

let runSeq = 1;

/** Analyse roles (by name) or every user. Progress callback 0–100. */
export async function runAnalysis(scope: { roles?: string[]; allUsers?: boolean }, onProgress?: (pct: number) => void): Promise<AnalysisRun> {
  const targets = scope.allUsers ? db.users.length : scope.roles?.length ?? 0;
  const steps = Math.max(5, Math.min(20, targets));
  for (let i = 0; i <= steps; i++) {
    onProgress?.(Math.round((i / steps) * 100));
    await latency(scope.allUsers ? 260 : 120);
  }
  const now = MOCK_NOW.toISOString();
  let results: SubjectResult[];
  if (scope.allUsers) {
    db.roles.forEach((r) => (r.lastAnalysed = now));
    results = db.users.map(userResult);
  } else {
    const names = new Set(scope.roles);
    db.roles.forEach((r) => names.has(r.name) && (r.lastAnalysed = now));
    results = db.roles.filter((r) => names.has(r.name)).map(roleResult);
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const run: AnalysisRun = {
    runId: `RUN-${stamp.slice(0, 8)}-${stamp.slice(8, 12)}-${String(runSeq++).padStart(2, "0")}`,
    startedAt: new Date().toISOString(),
    rulesetVersion: `${currentDraftVersion()} (draft)`,
    snapshot: SNAPSHOT_DATE,
    systemId: "S4P-100",
    scope: scope.allUsers ? `All users (${db.users.length})` : `${scope.roles!.length} selected role(s)`,
    results,
  };
  db.runs.unshift(run);
  db.onboarding.analysisRun = true;
  const red = results.filter((r) => r.status === "red").length;
  audit({ area: "Analysis", action: "Ran analysis", object: run.scope, after: `${run.runId} · ${red} Red` });
  commit();
  return run;
}

// ---- Aggregations for dashboards

export interface Summary {
  counts: Record<Status, number>;
  redByProcess: { process: Process; count: number }[];
  byLevel: { level: string; red: number; amber: number }[];
  usersWithRed: number;
  topRoles: { role: Role; result: SubjectResult; red: number; amber: number }[];
}

export async function getSummary(): Promise<Summary> {
  await latency(400);
  const results = db.roles.map((r) => ({ role: r, result: roleResult(r) }));
  const counts: Record<Status, number> = { red: 0, amber: 0, green: 0, grey: 0 };
  results.forEach((x) => counts[x.result.status]++);
  const allHits = results.flatMap((x) => x.result.hits);
  const redByProcess = PROCESSES.map((p) => ({ process: p, count: allHits.filter((h) => h.process === p && h.status === "red").length }));
  const byLevel = ["Critical", "High", "Medium", "Low"].map((l) => ({
    level: l,
    red: allHits.filter((h) => h.level === l && h.status === "red").length,
    amber: allHits.filter((h) => h.level === l && h.status === "amber").length,
  }));
  const usersWithRed = db.users.map(userResult).filter((r) => r.status === "red").length;
  const topRoles = results
    .map((x) => ({ ...x, red: x.result.hits.filter((h) => h.status === "red").length, amber: x.result.hits.filter((h) => h.status === "amber").length }))
    .filter((x) => x.red + x.amber > 0)
    .sort((a, b) => b.red - a.red || b.amber - a.amber || a.role.name.localeCompare(b.role.name))
    .slice(0, 5);
  return { counts, redByProcess, byLevel, usersWithRed, topRoles };
}

export function heatmapCell(result: SubjectResult, process: Process): Status {
  if (result.status === "grey") return "grey";
  const hits = result.hits.filter((h: RiskHit) => h.process === process);
  return worstStatus(hits.map((h) => h.status));
}
