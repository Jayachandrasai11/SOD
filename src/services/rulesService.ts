/**
 * Ruleset service – risks, functions, versions, import/export.
 * Mock implementation over the in-memory db; swap bodies for GRC backend calls.
 */
import * as XLSX from "xlsx";
import type { Process, Risk, RiskLevel, RiskType, RulesetVersion, SodFunction } from "@/types";
import { PROCESSES, RISK_LEVELS, RISK_TYPES } from "@/types";
import { audit, commit, db, latency } from "./db";
import { TCODE_MAP, describeTcode } from "@/data/tcodes";
import { FUNCTIONS, RISKS } from "@/data/rules";
import { todayStamp } from "@/lib/utils";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export async function getRisks(): Promise<Risk[]> {
  await latency();
  return clone(db.risks);
}

export async function getFunctions(): Promise<SodFunction[]> {
  await latency(150);
  return clone(db.functions);
}

export function functionUsage(fnId: string, exceptRiskId?: string): Risk[] {
  return db.risks.filter((r) => r.functionIds.includes(fnId) && r.id !== exceptRiskId);
}

export async function saveRisk(risk: Risk, functions: SodFunction[], reason?: string) {
  await latency(300);
  const idx = db.risks.findIndex((r) => r.id === risk.id);
  const before = idx >= 0 ? db.risks[idx] : undefined;
  if (idx >= 0) db.risks[idx] = clone(risk);
  else db.risks.push(clone(risk));
  for (const f of functions) {
    const fi = db.functions.findIndex((x) => x.id === f.id);
    if (fi >= 0) db.functions[fi] = clone(f);
    else db.functions.push(clone(f));
  }
  db.draftChanges++;
  audit({
    area: "Rules",
    action: before ? "Edited risk" : "Created risk",
    object: risk.id,
    before: before ? `${before.level} · ${before.owner}` : undefined,
    after: `${risk.level} · ${risk.owner}`,
    reason,
  });
  commit();
}

export async function bulkUpdate(ids: string[], patch: Partial<Pick<Risk, "active" | "level" | "owner">>) {
  await latency(250);
  const prev = db.risks.filter((r) => ids.includes(r.id)).map((r) => ({ ...r }));
  db.risks = db.risks.map((r) => (ids.includes(r.id) ? { ...r, ...patch } : r));
  db.draftChanges += ids.length;
  const what = Object.entries(patch)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  audit({ area: "Rules", action: "Bulk update", object: `${ids.length} risk(s): ${ids.join(", ")}`, after: what });
  commit();
  /** Undo handle for the toast */
  return async () => {
    db.risks = db.risks.map((r) => prev.find((p) => p.id === r.id) ?? r);
    db.draftChanges = Math.max(0, db.draftChanges - ids.length);
    audit({ area: "Rules", action: "Undo bulk update", object: ids.join(", ") });
    commit();
  };
}

export async function getVersions(): Promise<RulesetVersion[]> {
  await latency(200);
  const draft = db.versions.find((v) => v.status !== "Published" && v.version === currentDraftVersion());
  if (draft) {
    draft.risks = clone(db.risks);
    draft.functions = clone(db.functions);
    draft.status = db.draftStatus;
  }
  return clone(db.versions);
}

export const currentDraftVersion = () => db.versions[0].version;
export const publishedVersion = () => db.versions.find((v) => v.status === "Published")?.version ?? "—";

export function draftInfo() {
  return { version: currentDraftVersion(), status: db.draftStatus, changes: db.draftChanges, published: publishedVersion() };
}

export async function advanceLifecycle(reason?: string) {
  await latency(400);
  const order: RulesetVersion["status"][] = ["Draft", "Submitted", "Approved", "Published"];
  const before = db.draftStatus;
  const next = order[Math.min(order.indexOf(before) + 1, order.length - 1)];
  db.draftStatus = next;
  db.versions[0].status = next;
  if (next === "Published") {
    db.draftChanges = 0;
    db.versions.slice(1).forEach((v) => v.status === "Published" && (v.status = "Approved"));
  }
  audit({ area: "Rules", action: `Version ${next.toLowerCase()}`, object: `Ruleset v${currentDraftVersion()}`, before, after: next, reason });
  commit();
  return next;
}

export interface DiffRow {
  id: string;
  kind: "added" | "removed" | "changed" | "same";
  left?: Risk;
  right?: Risk;
  fields: string[];
}

export function diffVersions(a: RulesetVersion, b: RulesetVersion): DiffRow[] {
  const ids = [...new Set([...a.risks.map((r) => r.id), ...b.risks.map((r) => r.id)])].sort();
  return ids.map((id) => {
    const left = a.risks.find((r) => r.id === id);
    const right = b.risks.find((r) => r.id === id);
    if (!left) return { id, kind: "added", right, fields: [] };
    if (!right) return { id, kind: "removed", left, fields: [] };
    const fields = (["description", "level", "type", "process", "owner", "active"] as const).filter(
      (k) => left[k] !== right[k],
    );
    if (left.functionIds.join() !== right.functionIds.join()) (fields as string[]).push("functionIds");
    return { id, kind: fields.length ? "changed" : "same", left, right, fields };
  });
}

// ---------------------------------------------------------------- Import

export const IMPORT_FIELDS = [
  { key: "riskId", label: "Risk ID", required: true },
  { key: "description", label: "Risk description", required: true },
  { key: "process", label: "Business process", required: true },
  { key: "level", label: "Risk level", required: true },
  { key: "type", label: "Risk type", required: false },
  { key: "functionId", label: "Function ID", required: true },
  { key: "functionName", label: "Function name", required: false },
  { key: "action", label: "Action (transaction code)", required: false },
  { key: "owner", label: "Risk owner", required: false },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type ColumnMapping = Record<ImportFieldKey, string | "">;

export interface ParsedFile {
  fileName: string;
  columns: string[];
  rows: Record<string, string>[];
}

const SYNONYMS: Record<ImportFieldKey, string[]> = {
  riskId: ["risk id", "risk", "riskid", "risk_id"],
  description: ["description", "risk description", "desc"],
  process: ["process", "business process", "bp"],
  level: ["level", "risk level", "severity"],
  type: ["type", "risk type"],
  functionId: ["function id", "function", "func id", "function_id"],
  functionName: ["function name", "function description"],
  action: ["action", "tcode", "transaction", "transaction code", "t-code"],
  owner: ["owner", "risk owner"],
};

export function autoMap(columns: string[]): ColumnMapping {
  const m = {} as ColumnMapping;
  for (const f of IMPORT_FIELDS) {
    const hit = columns.find((c) => SYNONYMS[f.key].includes(c.trim().toLowerCase()));
    m[f.key] = hit ?? "";
  }
  return m;
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames.find((n) => /rule/i.test(n)) ?? wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return {
    fileName: file.name,
    columns,
    rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v).trim()]))),
  };
}

/** A realistic sample upload (with deliberate errors) for demos */
export function sampleFile(): ParsedFile {
  const columns = ["Risk ID", "Description", "Business Process", "Risk Level", "Risk Type", "Function ID", "Function Name", "Tcode", "Owner"];
  const rows: string[][] = [];
  for (const r of RISKS) {
    for (const fid of r.functionIds) {
      const f = FUNCTIONS.find((x) => x.id === fid)!;
      for (const a of f.actions) rows.push([r.id, r.description, r.process, r.level, r.type, f.id, f.name, a.tcode, r.owner.split(" (")[0]]);
    }
  }
  rows.push(["MG-FI-P010", "Create and approve credit memos", "Finance", "High", "SoD", "MG-F-FI09", "Create credit memo", "FB75", "Priya Raman"]);
  rows.push(["MG-FI-P010", "Create and approve credit memos", "Finance", "High", "SoD", "MG-F-FI10", "Approve credit memo", "FBV0", "Priya Raman"]);
  rows.push(["MG-MM-P007", "Maintain vendor and create PO", "Procurement", "Severe", "SoD", "MG-F-FI04", "Maintain vendor master", "BP", "Martin Keller"]);
  rows.push(["MG-FI-P011", "Change house bank and pay", "Finance", "Critical", "SoD", "MG-F-FI02", "", "", "Priya Raman"]);
  rows.push(["", "Unnamed risk", "Finance", "Low", "SoD", "MG-F-FI03", "Maintain G/L account master", "FS00", ""]);
  rows.push(["MG-SD-P005", "Change pricing and bill", "Distribution", "Medium", "SoD", "MG-F-SD02", "Maintain prices", "VK11", "Elena Rossi"]);
  // Make the "no actions" error land on row 14 as in the spec example
  const noAction = rows.splice(rows.length - 3, 1)[0];
  rows.splice(12, 0, noAction);
  return { fileName: "MyGo_rules_Q4.xlsx", columns, rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))) };
}

export interface ImportIssue {
  row: number;
  message: string;
}

export interface ImportPreview {
  toAdd: string[];
  toUpdate: string[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  risks: Risk[];
  functions: SodFunction[];
  errorRows: Set<number>;
}

export function validateImport(file: ParsedFile, map: ColumnMapping): ImportPreview {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const errorRows = new Set<number>();
  const risks = new Map<string, Risk>();
  const fns = new Map<string, SodFunction>();
  const get = (r: Record<string, string>, k: ImportFieldKey) => (map[k] ? r[map[k]] ?? "" : "");

  file.rows.forEach((r, i) => {
    const row = i + 2; // header is row 1
    const fail = (m: string) => {
      errors.push({ row, message: `Row ${row}: ${m}` });
      errorRows.add(row);
    };
    const riskId = get(r, "riskId");
    const fnId = get(r, "functionId");
    const level = get(r, "level");
    const process = get(r, "process");
    const action = get(r, "action").toUpperCase();
    const type = get(r, "type") || "SoD";
    if (!riskId) return fail("Risk ID is empty – every row needs a risk ID.");
    if (!RISK_LEVELS.includes(level as RiskLevel))
      return fail(`level "${level}" is not valid. Use Critical, High, Medium or Low.`);
    if (!PROCESSES.includes(process as Process))
      return fail(`business process "${process}" is not recognised. Use ${PROCESSES.join(", ")}.`);
    if (!RISK_TYPES.includes(type as RiskType)) return fail(`risk type "${type}" is not valid.`);
    if (!fnId) return fail(`risk ${riskId} has no function ID.`);
    if (!action) return fail(`function ${fnId} has no actions.`);
    if (!TCODE_MAP[action]) warnings.push({ row, message: `Row ${row}: transaction ${action} is not in the S4P catalogue – it will be imported but never fire until it exists.` });

    const risk = risks.get(riskId) ?? {
      id: riskId,
      description: get(r, "description"),
      explanation: "",
      process: process as Process,
      level: level as RiskLevel,
      type: type as RiskType,
      functionIds: [],
      owner: get(r, "owner"),
      active: true,
    };
    if (!risk.functionIds.includes(fnId)) risk.functionIds.push(fnId);
    risks.set(riskId, risk);
    const fn = fns.get(fnId) ?? {
      id: fnId,
      name: get(r, "functionName") || fnId,
      process: process as Process,
      actions: [],
      permissions: [],
    };
    if (!fn.actions.some((a) => a.tcode === action)) fn.actions.push({ tcode: action, description: describeTcode(action) });
    fns.set(fnId, fn);
  });

  const existing = new Set(db.risks.map((r) => r.id));
  const ids = [...risks.keys()];
  return {
    toAdd: ids.filter((id) => !existing.has(id)),
    toUpdate: ids.filter((id) => existing.has(id)),
    errors,
    warnings,
    risks: [...risks.values()],
    functions: [...fns.values()],
    errorRows,
  };
}

export type ImportMode = "add" | "upsert" | "replace";

export async function commitImport(preview: ImportPreview, mode: ImportMode, reason?: string) {
  await latency(800);
  const newVersion = bumpVersion(currentDraftVersion());
  if (mode === "replace") {
    db.risks.forEach((r) => (r.active = false)); // never delete – deactivate
    for (const r of preview.risks) upsert(r);
  } else {
    for (const r of preview.risks) {
      const exists = db.risks.some((x) => x.id === r.id);
      if (mode === "add" && exists) continue;
      upsert(r);
    }
  }
  for (const f of preview.functions) {
    const i = db.functions.findIndex((x) => x.id === f.id);
    if (i >= 0 && mode !== "add") db.functions[i] = { ...db.functions[i], actions: f.actions, name: f.name };
    else if (i < 0) db.functions.push(f);
  }
  db.versions.unshift({
    version: newVersion,
    status: "Draft",
    author: "Anna Schmidt",
    date: new Date().toISOString(),
    note: `Imported (${mode === "add" ? "add new only" : mode === "upsert" ? "add and update" : "replace"})`,
    risks: clone(db.risks),
    functions: clone(db.functions),
  });
  db.draftStatus = "Draft";
  db.draftChanges = preview.risks.length;
  db.onboarding.rulesImported = true;
  audit({ area: "Rules", action: "Imported rules", object: `Ruleset v${newVersion}`, after: `${preview.toAdd.length} added · ${preview.toUpdate.length} updated · mode ${mode}`, reason });
  commit();
  return newVersion;

  function upsert(r: Risk) {
    const i = db.risks.findIndex((x) => x.id === r.id);
    if (i >= 0) db.risks[i] = { ...db.risks[i], ...r, explanation: db.risks[i].explanation || r.explanation, active: true };
    else db.risks.push(r);
  }
}

const bumpVersion = (v: string) => {
  const [maj, min] = v.split(".").map(Number);
  return `${maj}.${min + 1}`;
};

export async function loadStarterLibrary() {
  await latency(700);
  for (const r of RISKS) if (!db.risks.some((x) => x.id === r.id)) db.risks.push(clone(r));
  for (const f of FUNCTIONS) if (!db.functions.some((x) => x.id === f.id)) db.functions.push(clone(f));
  db.onboarding.rulesImported = true;
  audit({ area: "Rules", action: "Loaded MyGo starter library", object: `Ruleset v${currentDraftVersion()}`, after: `${RISKS.length} risks` });
  commit();
}

export function saveMappingProfile(name: string, map: ColumnMapping) {
  try {
    const all = JSON.parse(localStorage.getItem("mysodai-mappings") ?? "{}");
    all[name] = map;
    localStorage.setItem("mysodai-mappings", JSON.stringify(all));
  } catch {
    /* storage unavailable – ignore */
  }
}

// ---------------------------------------------------------------- Export

function flatRows(risks: Risk[], functions: SodFunction[]) {
  return risks.flatMap((r) =>
    r.functionIds.flatMap((fid) => {
      const f = functions.find((x) => x.id === fid);
      return (f?.actions.length ? f.actions : [{ tcode: "", description: "" }]).map((a) => ({
        "Risk ID": r.id,
        Description: r.description,
        "Business Process": r.process,
        "Risk Level": r.level,
        "Risk Type": r.type,
        "Function ID": fid,
        "Function Name": f?.name ?? "",
        Tcode: a.tcode,
        "Tcode description": a.description,
        Owner: r.owner,
        Active: r.active ? "Yes" : "No",
      }));
    }),
  );
}

export function exportRulesExcel(risks: Risk[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flatRows(risks, db.functions)), "Rules");
  XLSX.writeFile(wb, `MySODAI_rules_v${currentDraftVersion()}_${todayStamp()}.xlsx`);
}

export function downloadRulesTemplate() {
  const wb = XLSX.utils.book_new();
  const instructions = XLSX.utils.aoa_to_sheet([
    ["MySODAI rules template"],
    ["One row per Risk × Function × Action. Repeat the risk columns on every row."],
    ["Risk Level: Critical, High, Medium or Low. Business Process: Finance, Procurement, Sales, HR, Basis."],
    ["Risk Type: SoD (needs 2+ functions), Critical action or Critical permission."],
  ]);
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flatRows(RISKS.slice(0, 2), FUNCTIONS)), "Rules");
  XLSX.writeFile(wb, "MySODAI_rules_template.xlsx");
}
