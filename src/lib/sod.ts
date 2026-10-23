/**
 * Pure SoD evaluation engine. No I/O – used by analysisService (batch runs)
 * and Role Builder (live check) so both always agree.
 */
import type {
  FunctionEvidence,
  Mitigation,
  Risk,
  RiskHit,
  Role,
  RoleAuth,
  Settings,
  SodFunction,
  Status,
  SubjectResult,
} from "@/types";
import { describeTcode } from "@/data/tcodes";
import { daysBetween } from "./utils";

export interface Grant {
  tcode: string;
  grantedBy: string;
}

export const STATUS_RANK: Record<Status, number> = { green: 0, grey: 1, amber: 2, red: 3 };

export function worstStatus(statuses: Status[], empty: Status = "green"): Status {
  if (!statuses.length) return empty;
  return statuses.reduce((a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a));
}

/** Expand a role into the transactions it grants, following composite children / derived parents */
export function grantsForRole(role: Role, roleMap: Map<string, Role>, seen = new Set<string>()): Grant[] {
  if (seen.has(role.name)) return [];
  seen.add(role.name);
  if (role.type === "Composite") {
    return (role.children ?? []).flatMap((c) => {
      const child = roleMap.get(c);
      return child ? grantsForRole(child, roleMap, seen) : [];
    });
  }
  return role.tcodes.map((tcode) => ({ tcode, grantedBy: role.name }));
}

export function authsForRole(role: Role, roleMap: Map<string, Role>, seen = new Set<string>()): (RoleAuth & { role: string })[] {
  if (seen.has(role.name)) return [];
  seen.add(role.name);
  if (role.type === "Composite") {
    return (role.children ?? []).flatMap((c) => {
      const child = roleMap.get(c);
      return child ? authsForRole(child, roleMap, seen) : [];
    });
  }
  return role.auths.map((a) => ({ ...a, role: role.name }));
}

export interface EvalContext {
  risks: Risk[];
  functions: SodFunction[];
  mitigations: Mitigation[];
  settings: Settings;
}

export function evaluate(
  subject: string,
  subjectKind: "Role" | "User",
  grants: Grant[],
  auths: (RoleAuth & { role: string })[],
  ctx: EvalContext,
): SubjectResult {
  const fnMap = new Map(ctx.functions.map((f) => [f.id, f]));
  const byTcode = new Map<string, Set<string>>();
  for (const g of grants) {
    if (!byTcode.has(g.tcode)) byTcode.set(g.tcode, new Set());
    byTcode.get(g.tcode)!.add(g.grantedBy);
  }

  const evidenceFor = (f: SodFunction): FunctionEvidence => {
    const objects = new Set(f.permissions.map((p) => p.object));
    return {
      functionId: f.id,
      functionName: f.name,
      actions: f.actions
        .filter((a) => byTcode.has(a.tcode))
        .map((a) => {
          const grantedBy = [...byTcode.get(a.tcode)!];
          return {
            tcode: a.tcode,
            description: a.description || describeTcode(a.tcode),
            grantedBy,
            auths: auths
              .filter((x) => grantedBy.includes(x.role) && (objects.has(x.object) || (x.object === "S_TCODE" && x.low === a.tcode)))
              .map(({ object, field, low, high }) => ({ object, field, low, high })),
          };
        }),
    };
  };

  const hits: RiskHit[] = [];
  for (const risk of ctx.risks) {
    if (!risk.active) continue;
    const fns = risk.functionIds.map((id) => fnMap.get(id)).filter(Boolean) as SodFunction[];
    if (!fns.length) continue;
    const ev = fns.map(evidenceFor);
    const fires = risk.type === "SoD" ? fns.length >= 2 && ev.every((e) => e.actions.length > 0) : ev.some((e) => e.actions.length > 0);
    if (!fires) continue;
    const mitigation = ctx.mitigations.find((m) => m.subject === subject && m.riskId === risk.id);
    const status: Status = mitigation ? ctx.settings.mitigatedStatus : ctx.settings.levelToStatus[risk.level];
    hits.push({
      subject,
      subjectKind,
      riskId: risk.id,
      description: risk.description,
      process: risk.process,
      level: risk.level,
      type: risk.type,
      status,
      mitigation,
      functions: ev.filter((e) => e.actions.length > 0),
    });
  }

  return { subject, subjectKind, status: worstStatus(hits.map((h) => h.status)), hits };
}

export function evaluateRole(role: Role, roleMap: Map<string, Role>, ctx: EvalContext): SubjectResult {
  return evaluate(role.name, "Role", grantsForRole(role, roleMap), authsForRole(role, roleMap), ctx);
}

/** Grey when never analysed or analysed longer ago than the staleness limit */
export function isStale(lastAnalysed: string | undefined, settings: Settings) {
  return !lastAnalysed || daysBetween(lastAnalysed) > settings.stalenessDays;
}

export interface Remediation {
  tcode: string;
  fromRole: string;
  cleared: number;
  totalRed: number;
  text: string;
}

/** Find the single action removal that clears the most Red risks */
export function bestRemediation(
  result: SubjectResult,
  grants: Grant[],
  auths: (RoleAuth & { role: string })[],
  ctx: EvalContext,
): Remediation | undefined {
  const red = result.hits.filter((h) => h.status === "red");
  const target = red.length ? red : result.hits.filter((h) => h.status === "amber");
  if (!target.length) return undefined;
  const candidates = new Map<string, Grant>();
  for (const h of target)
    for (const f of h.functions)
      for (const a of f.actions) for (const r of a.grantedBy) candidates.set(`${a.tcode}|${r}`, { tcode: a.tcode, grantedBy: r });

  let best: Remediation | undefined;
  for (const c of candidates.values()) {
    const remaining = grants.filter((g) => !(g.tcode === c.tcode && g.grantedBy === c.grantedBy));
    const after = evaluate(result.subject, result.subjectKind, remaining, auths, ctx);
    const stillIds = new Set(after.hits.map((h) => h.riskId));
    const cleared = target.filter((h) => !stillIds.has(h.riskId)).length;
    if (!best || cleared > best.cleared) {
      const label = red.length ? "Red" : "Amber";
      best = {
        tcode: c.tcode,
        fromRole: c.grantedBy,
        cleared,
        totalRed: target.length,
        text: `Removing ${c.tcode} from ${c.grantedBy} clears ${cleared} of ${target.length} ${label} risk${target.length === 1 ? "" : "s"}.`,
      };
    }
  }
  return best && best.cleared > 0 ? best : undefined;
}
