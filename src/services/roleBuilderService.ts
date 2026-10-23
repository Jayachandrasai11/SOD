/**
 * Role Builder service – live SoD check, validation, export and the
 * SoD role template (download + upload).
 */
import * as XLSX from "xlsx";
import type { Role, RoleType, SubjectResult, Process } from "@/types";
import { PROCESSES } from "@/types";
import { audit, commit, db, latency } from "./db";
import { authsForRole, evaluate, grantsForRole, bestRemediation, type EvalContext, type Remediation } from "@/lib/sod";
import { TCODE_MAP, describeTcode, ORG_LEVEL_DEFS, SU24 } from "@/data/tcodes";
import { FUNCTIONS } from "@/data/rules";
import { namingCheck } from "./settingsService";
import { roleExistsInSystem } from "./sapService";
import { downloadBlob, downloadText, todayStamp } from "@/lib/utils";

const ctx = (): EvalContext => ({ risks: db.risks, functions: db.functions, mitigations: db.mitigations, settings: db.settings });

export function emptyDraft(): Role {
  return {
    name: "Z_",
    description: "",
    type: "Single",
    process: "Finance",
    owner: "",
    tcodes: [],
    auths: [],
    orgLevels: [],
    children: [],
    lastChanged: new Date().toISOString(),
  };
}

/** Copy an existing role into a new draft ("Start from existing role") */
export function draftFromRole(name: string, keepName = false): Role | undefined {
  const r = db.roles.find((x) => x.name === name) ?? db.builderDrafts.find((x) => x.name === name);
  if (!r) return undefined;
  const map = new Map(db.roles.map((x) => [x.name, x]));
  const tcodes = r.type === "Derived" && r.parent ? map.get(r.parent)?.tcodes ?? r.tcodes : r.tcodes;
  return {
    ...JSON.parse(JSON.stringify(r)),
    name: keepName ? r.name : `${r.name}_COPY`.slice(0, 30),
    type: r.type === "Derived" ? "Single" : r.type,
    parent: undefined,
    tcodes: [...tcodes],
    orgLevels: syncOrgLevels(tcodes, r.orgLevels),
  };
}

/** Live SoD check for a draft – instant, synchronous */
export function liveCheck(draft: Role): { result: SubjectResult; remediation?: Remediation } {
  const map = new Map(db.roles.map((r) => [r.name, r]));
  map.set(draft.name, draft);
  const grants = grantsForRole(draft, map);
  const auths = authsForRole(draft, map);
  const result = evaluate(draft.name || "(new role)", "Role", grants, auths, ctx());
  return { result, remediation: bestRemediation(result, grants, auths, ctx()) };
}

/** SU24 proposals for newly added transactions, tagged "Proposed" */
export function proposedAuths(tcode: string) {
  return (SU24[tcode] ?? []).map((p) => ({ ...p, low: p.low.startsWith("$") ? p.low : p.low, proposed: true }));
}

/** Org-level fields required by the auth objects in this draft */
export function syncOrgLevels(tcodes: string[], current: Role["orgLevels"]): Role["orgLevels"] {
  const needed = new Set<string>();
  for (const tc of tcodes) for (const p of SU24[tc] ?? []) if (p.low.startsWith("$")) needed.add(p.low.slice(1));
  const out = [...needed].map((field) => {
    const existing = current.find((o) => o.field === field);
    return { field, label: ORG_LEVEL_DEFS[field] ?? field, low: existing?.low ?? "", high: existing?.high, required: true };
  });
  // Keep optional ones the user added manually
  for (const o of current) if (!needed.has(o.field)) out.push({ ...o, required: false });
  return out;
}

export interface CheckItem {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export function validateDraft(draft: Role, opts: { isUpdate?: boolean } = {}): CheckItem[] {
  const naming = namingCheck(draft.name);
  const missing: string[] = [];
  if (!draft.description.trim()) missing.push("description");
  if (!draft.owner.trim()) missing.push("role owner");
  if (draft.type === "Single" && !draft.tcodes.length) missing.push("at least one transaction");
  if (draft.type === "Composite" && !(draft.children ?? []).length) missing.push("at least one child role");
  const emptyOrg = draft.orgLevels.filter((o) => o.required && !o.low.trim());
  const pending = draft.auths.filter((a) => a.proposed).length;
  const dup = !opts.isUpdate && roleExistsInSystem(draft.name);
  return [
    { key: "naming", label: "Naming convention", ok: !naming, detail: naming },
    { key: "mandatory", label: "Mandatory fields", ok: !missing.length, detail: missing.length ? `Missing: ${missing.join(", ")}` : undefined },
    {
      key: "org",
      label: "Org levels filled",
      ok: draft.type === "Composite" || !emptyOrg.length,
      detail: emptyOrg.length ? `Fill ${emptyOrg.map((o) => `${o.label} (${o.field})`).join(", ")}` : undefined,
    },
    {
      key: "proposals",
      label: "Proposed authorisations reviewed",
      ok: pending === 0,
      detail: pending ? `${pending} proposed value(s) not yet accepted` : undefined,
    },
    { key: "dup", label: "No duplicate in target system", ok: !dup, detail: dup ? `${draft.name} already exists in S4P – choose a new name.` : opts.isUpdate ? "Updates the existing role as a new version" : undefined },
  ];
}

export async function saveDraft(draft: Role) {
  await latency(300);
  const i = db.builderDrafts.findIndex((d) => d.name === draft.name);
  const version = i >= 0 ? db.builderDrafts[i].version : currentVersion(draft.name);
  const rec = { ...JSON.parse(JSON.stringify(draft)), version, lastChanged: new Date().toISOString() };
  if (i >= 0) db.builderDrafts[i] = rec;
  else db.builderDrafts.push(rec);
  commit();
}

export type ExportFormat = "pfcg" | "business" | "spec-xlsx" | "spec-pdf";

export const EXPORT_FORMATS: { value: ExportFormat; label: string; hint: string; ext: string }[] = [
  { value: "pfcg", label: "PFCG upload file (.SAP)", hint: "On-premise and Private Cloud – upload in PFCG › Role › Upload", ext: "SAP" },
  { value: "business", label: "Business role file (.json)", hint: "S/4HANA Public Cloud – Maintain Business Roles › Upload", ext: "json" },
  { value: "spec-xlsx", label: "Role specification (Excel)", hint: "For review and sign-off", ext: "xlsx" },
  { value: "spec-pdf", label: "Role specification (PDF)", hint: "For review and sign-off", ext: "pdf" },
];

/** Existing roles in SAP count as v2 (live) so the first re-export is v3 */
const currentVersion = (name: string) => db.builderDrafts.find((d) => d.name === name)?.version ?? (roleExistsInSystem(name) ? 2 : 0);

/** Next file version for this role name: Z_ROLE_NAME_v3_2026-10-23.SAP */
export function exportFileName(draft: Role, format: ExportFormat) {
  const v = currentVersion(draft.name) + 1;
  const ext = EXPORT_FORMATS.find((f) => f.value === format)!.ext;
  return `${draft.name}_v${v}_${todayStamp()}.${ext}`;
}

export async function exportRole(
  draft: Role,
  format: ExportFormat,
  opts: { status: string; justification?: string; approver?: string },
) {
  await latency(500);
  const fileName = exportFileName(draft, format);
  const { result } = liveCheck(draft);
  const lines = [
    `* MySODAI mock export – ${format === "pfcg" ? "PFCG upload" : format === "business" ? "Business role" : "Role specification"}`,
    `* Generated ${new Date().toISOString()} · SoD status ${opts.status.toUpperCase()}`,
    opts.justification ? `* Justification: ${opts.justification} · Approver: ${opts.approver}` : "",
    `AGR_DEFINE|${draft.name}|${draft.type}|${draft.description}|${draft.owner}`,
    ...(draft.children ?? []).map((c) => `AGR_AGRS|${draft.name}|${c}`),
    ...draft.tcodes.map((t) => `AGR_TCODES|${draft.name}|TR|${t}|${describeTcode(t)}`),
    ...draft.auths.map((a) => `AGR_1251|${draft.name}|${a.object}|${a.field}|${a.low}|${a.high ?? ""}`),
    ...draft.orgLevels.map((o) => `AGR_1252|${draft.name}|${o.field}|${o.low}|${o.high ?? ""}`),
    ...result.hits.map((h) => `* SOD|${h.riskId}|${h.level}|${h.status}|${h.description}`),
  ].filter(Boolean);
  if (format === "business") {
    downloadText(JSON.stringify({ businessRole: draft.name, description: draft.description, apps: draft.tcodes, restrictions: draft.orgLevels, sod: result.hits.map((h) => h.riskId) }, null, 2), fileName, "application/json");
  } else {
    downloadText(lines.join("\n"), fileName);
  }
  const i = db.builderDrafts.findIndex((d) => d.name === draft.name);
  if (i >= 0) db.builderDrafts[i].version++;
  else db.builderDrafts.push({ ...JSON.parse(JSON.stringify(draft)), version: currentVersion(draft.name) + 1 });
  audit({
    area: "Role export",
    action: opts.justification ? "Exported with justification" : "Exported role file",
    object: draft.name,
    after: `${fileName} · ${opts.status}${opts.approver ? ` · approver ${opts.approver}` : ""}`,
    reason: opts.justification,
  });
  commit();
  return fileName;
}

// ---------------------------------------------------------------- Template

const ROLE_TYPES: RoleType[] = ["Single", "Composite"];

export async function downloadRoleTemplate(prefill: string[] = []) {
  // exceljs ships CJS/UMD – normalise default vs namespace interop
  const mod = await import("exceljs");
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "MySODAI";
  const header = (ws: import("exceljs").Worksheet, cols: { header: string; key: string; width: number }[]) => {
    ws.columns = cols;
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3730A3" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const list = (ws: import("exceljs").Worksheet, col: string, values: string[], rows = 500) => {
    for (let r = 2; r <= rows; r++)
      ws.getCell(`${col}${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${values.join(",")}"`],
        showErrorMessage: true,
        errorTitle: "Invalid value",
        error: `Choose one of: ${values.join(", ")}`,
      };
  };

  const ins = wb.addWorksheet("Instructions");
  ins.getColumn(1).width = 110;
  [
    "MySODAI – SoD role template",
    "",
    "1. Fill the Roles sheet: one row per role. Names must start with Z_ or Y_ (max 30 characters).",
    "2. Role_Actions: one row per transaction or Fiori app ID per role.",
    "3. Role_Authorisations: auth object / field / value range. Leave empty to accept SU24 proposals.",
    "4. Role_OrgLevels: BUKRS (company code), WERKS (plant), EKORG (purchasing org), VKORG (sales org).",
    "5. Composite_Roles: link composite roles to their single roles.",
    "6. SoD_Reference is read-only – check which action combinations create risks before you submit.",
    "7. Upload the file in MySODAI › Role Builder › Upload completed template. Nothing is written to SAP.",
  ].forEach((l, i) => {
    ins.addRow([l]);
    if (i === 0) ins.getRow(1).font = { bold: true, size: 14 };
  });

  const roles = wb.addWorksheet("Roles");
  header(roles, [
    { header: "Role name", key: "name", width: 28 },
    { header: "Description", key: "description", width: 40 },
    { header: "Role type", key: "type", width: 14 },
    { header: "Parent role", key: "parent", width: 24 },
    { header: "Business process", key: "process", width: 18 },
    { header: "Role owner", key: "owner", width: 22 },
  ]);
  list(roles, "C", ROLE_TYPES);
  list(roles, "E", PROCESSES);

  const actions = wb.addWorksheet("Role_Actions");
  header(actions, [
    { header: "Role name", key: "role", width: 28 },
    { header: "Transaction/App ID", key: "tcode", width: 20 },
    { header: "Description", key: "description", width: 40 },
  ]);
  const auths = wb.addWorksheet("Role_Authorisations");
  header(auths, [
    { header: "Role name", key: "role", width: 28 },
    { header: "Auth object", key: "object", width: 16 },
    { header: "Field", key: "field", width: 12 },
    { header: "Value low", key: "low", width: 14 },
    { header: "Value high", key: "high", width: 14 },
  ]);
  const org = wb.addWorksheet("Role_OrgLevels");
  header(org, [
    { header: "Role name", key: "role", width: 28 },
    { header: "Org-level field", key: "field", width: 16 },
    { header: "Value low", key: "low", width: 14 },
    { header: "Value high", key: "high", width: 14 },
  ]);
  list(org, "B", Object.keys(ORG_LEVEL_DEFS));
  const comp = wb.addWorksheet("Composite_Roles");
  header(comp, [
    { header: "Composite role", key: "composite", width: 28 },
    { header: "Single role", key: "single", width: 28 },
  ]);

  const selected = db.roles.filter((r) => prefill.includes(r.name));
  if (selected.length) {
    for (const r of selected) {
      roles.addRow({ name: r.name, description: r.description, type: r.type === "Derived" ? "Single" : r.type, parent: r.parent ?? "", process: r.process, owner: r.owner });
      r.tcodes.forEach((t) => actions.addRow({ role: r.name, tcode: t, description: describeTcode(t) }));
      r.auths.filter((a) => a.object !== "S_TCODE").forEach((a) => auths.addRow({ role: r.name, ...a, high: a.high ?? "" }));
      r.orgLevels.forEach((o) => org.addRow({ role: r.name, field: o.field, low: o.low, high: o.high ?? "" }));
      (r.children ?? []).forEach((c) => comp.addRow({ composite: r.name, single: c }));
    }
  } else {
    // Two example rows
    roles.addRow({ name: "Z_FI_AP_INVOICE_ENTRY", description: "Enter vendor invoices", type: "Single", parent: "", process: "Finance", owner: "Priya Raman" });
    roles.addRow({ name: "Z_C_AP_TEAM", description: "AP team (composite)", type: "Composite", parent: "", process: "Finance", owner: "Priya Raman" });
    actions.addRow({ role: "Z_FI_AP_INVOICE_ENTRY", tcode: "FB60", description: describeTcode("FB60") });
    actions.addRow({ role: "Z_FI_AP_INVOICE_ENTRY", tcode: "FBL1N", description: describeTcode("FBL1N") });
    auths.addRow({ role: "Z_FI_AP_INVOICE_ENTRY", object: "F_BKPF_BUK", field: "ACTVT", low: "01", high: "" });
    auths.addRow({ role: "Z_FI_AP_INVOICE_ENTRY", object: "F_BKPF_KOA", field: "KOART", low: "K", high: "" });
    org.addRow({ role: "Z_FI_AP_INVOICE_ENTRY", field: "BUKRS", low: "1000", high: "" });
    org.addRow({ role: "Z_FI_AP_INVOICE_ENTRY", field: "WERKS", low: "1000", high: "1999" });
    comp.addRow({ composite: "Z_C_AP_TEAM", single: "Z_FI_AP_INVOICE_ENTRY" });
    comp.addRow({ composite: "Z_C_AP_TEAM", single: "Z_FI_DISPLAY" });
  }

  const ref = wb.addWorksheet("SoD_Reference");
  header(ref, [
    { header: "Risk ID", key: "id", width: 14 },
    { header: "Description", key: "description", width: 44 },
    { header: "Level", key: "level", width: 10 },
    { header: "Function A actions", key: "a", width: 30 },
    { header: "Function B actions", key: "b", width: 30 },
  ]);
  for (const r of db.risks.filter((x) => x.active)) {
    const [fa, fb] = r.functionIds.map((id) => db.functions.find((f) => f.id === id) ?? FUNCTIONS.find((f) => f.id === id));
    ref.addRow({
      id: r.id,
      description: r.description,
      level: r.level,
      a: fa?.actions.map((a) => a.tcode).join(", ") ?? "",
      b: fb?.actions.map((a) => a.tcode).join(", ") ?? (r.type !== "SoD" ? "(critical on its own)" : ""),
    });
  }
  await ref.protect("", { selectLockedCells: true, selectUnlockedCells: true });

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    selected.length ? `MySODAI_SoD_role_template_prefilled_${todayStamp()}.xlsx` : "MySODAI_SoD_role_template.xlsx",
  );
}

export interface TemplateRole {
  draft: Role;
  status: SubjectResult["status"];
  hits: number;
  errors: string[];
}

function rowsOf(wb: XLSX.WorkBook, sheet: string) {
  const ws = wb.Sheets[sheet];
  return ws ? XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false }) : [];
}

export async function parseRoleTemplate(file: File): Promise<TemplateRole[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return buildTemplateRoles({
    roles: rowsOf(wb, "Roles"),
    actions: rowsOf(wb, "Role_Actions"),
    auths: rowsOf(wb, "Role_Authorisations"),
    org: rowsOf(wb, "Role_OrgLevels"),
    comp: rowsOf(wb, "Composite_Roles"),
  });
}

/** Demo: a completed template without needing a file */
export function sampleTemplateRoles(): TemplateRole[] {
  return buildTemplateRoles({
    roles: [
      { "Role name": "Z_FI_AP_INVOICE_ENTRY", Description: "Enter vendor invoices", "Role type": "Single", "Business process": "Finance", "Role owner": "Priya Raman" },
      { "Role name": "Z_FI_AP_ALLROUNDER", Description: "AP invoice and payment", "Role type": "Single", "Business process": "Finance", "Role owner": "Priya Raman" },
      { "Role name": "FI_TEMP_ROLE", Description: "Temporary role", "Role type": "Single", "Business process": "Finance", "Role owner": "" },
      { "Role name": "Z_C_AP_TEAM", Description: "AP team (composite)", "Role type": "Composite", "Business process": "Finance", "Role owner": "Priya Raman" },
    ],
    actions: [
      { "Role name": "Z_FI_AP_INVOICE_ENTRY", "Transaction/App ID": "FB60" },
      { "Role name": "Z_FI_AP_INVOICE_ENTRY", "Transaction/App ID": "FBL1N" },
      { "Role name": "Z_FI_AP_ALLROUNDER", "Transaction/App ID": "MIRO" },
      { "Role name": "Z_FI_AP_ALLROUNDER", "Transaction/App ID": "F110" },
      { "Role name": "Z_FI_AP_ALLROUNDER", "Transaction/App ID": "ZFI_PAY99" },
      { "Role name": "FI_TEMP_ROLE", "Transaction/App ID": "FB03" },
    ],
    auths: [],
    org: [
      { "Role name": "Z_FI_AP_INVOICE_ENTRY", "Org-level field": "BUKRS", "Value low": "1000" },
      { "Role name": "Z_FI_AP_ALLROUNDER", "Org-level field": "BUKRS", "Value low": "1000" },
    ],
    comp: [
      { "Composite role": "Z_C_AP_TEAM", "Single role": "Z_FI_AP_INVOICE_ENTRY" },
      { "Composite role": "Z_C_AP_TEAM", "Single role": "Z_FI_AP_PAYMENTS" },
    ],
  });
}

function buildTemplateRoles(s: Record<"roles" | "actions" | "auths" | "org" | "comp", Record<string, string>[]>): TemplateRole[] {
  const names = new Set(s.roles.map((r) => r["Role name"]));
  const drafts: TemplateRole[] = s.roles.map((r, i) => {
    const row = i + 2;
    const name = (r["Role name"] ?? "").trim().toUpperCase();
    const type = (r["Role type"] || "Single") as RoleType;
    const errors: string[] = [];
    const nErr = namingCheck(name);
    if (nErr) errors.push(`Roles row ${row}: ${nErr}`);
    if (!ROLE_TYPES.includes(type)) errors.push(`Roles row ${row}: role type "${type}" must be Single or Composite.`);
    if (!r["Role owner"]) errors.push(`Roles row ${row}: role owner is empty.`);
    const process = (PROCESSES.includes(r["Business process"] as Process) ? r["Business process"] : "Finance") as Process;
    const tcodes = s.actions.filter((a) => a["Role name"] === r["Role name"]).map((a) => String(a["Transaction/App ID"]).trim().toUpperCase());
    tcodes.forEach((t) => !TCODE_MAP[t] && errors.push(`Role_Actions: ${t} for ${name} is not a known transaction in S4P.`));
    if (type === "Single" && !tcodes.length) errors.push(`${name} has no transactions in Role_Actions.`);
    const children = s.comp.filter((c) => c["Composite role"] === r["Role name"]).map((c) => c["Single role"]);
    children.forEach((c) => !names.has(c) && !db.roles.some((x) => x.name === c) && errors.push(`Composite_Roles: child role ${c} does not exist.`));
    const draft: Role = {
      name,
      description: r["Description"] ?? "",
      type: ROLE_TYPES.includes(type) ? type : "Single",
      process,
      owner: r["Role owner"] ?? "",
      tcodes: type === "Composite" ? [] : tcodes.filter((t) => TCODE_MAP[t]),
      auths: [
        ...tcodes.map((t) => ({ object: "S_TCODE", field: "TCD", low: t })),
        ...s.auths.filter((a) => a["Role name"] === r["Role name"]).map((a) => ({ object: a["Auth object"], field: a["Field"], low: a["Value low"], high: a["Value high"] || undefined })),
      ],
      orgLevels: s.org
        .filter((o) => o["Role name"] === r["Role name"])
        .map((o) => ({ field: o["Org-level field"], label: ORG_LEVEL_DEFS[o["Org-level field"]] ?? o["Org-level field"], low: o["Value low"], high: o["Value high"] || undefined })),
      children,
      lastChanged: new Date().toISOString(),
    };
    return { draft, status: "green" as const, hits: 0, errors };
  });
  // Evaluate after all drafts exist so composites can see template singles
  const map = new Map(db.roles.map((r) => [r.name, r]));
  drafts.forEach((d) => map.set(d.draft.name, d.draft));
  return drafts.map((d) => {
    const res = evaluate(d.draft.name, "Role", grantsForRole(d.draft, map), authsForRole(d.draft, map), ctx());
    return { ...d, status: res.status, hits: res.hits.length };
  });
}

export async function createDraftRoles(items: TemplateRole[]) {
  await latency(500);
  for (const it of items) {
    const i = db.builderDrafts.findIndex((d) => d.name === it.draft.name);
    const rec = { ...it.draft, version: 0 };
    if (i >= 0) db.builderDrafts[i] = rec;
    else db.builderDrafts.push(rec);
  }
  audit({ area: "Role export", action: "Created draft roles from template", object: items.map((i) => i.draft.name).join(", "), after: `${items.length} draft(s)` });
  commit();
}

export async function getBuilderDrafts() {
  await latency(150);
  return db.builderDrafts.map((d) => ({ ...d }));
}
