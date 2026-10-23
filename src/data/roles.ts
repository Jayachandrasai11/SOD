import type { Mitigation, OrgLevel, Process, Role, RoleAuth, RoleType } from "@/types";
import { ORG_LEVEL_DEFS, SU24 } from "./tcodes";

const ANALYSED = "2026-10-22T02:00:00Z";
const STALE = "2026-10-09T02:00:00Z";

interface Seed {
  name: string;
  description: string;
  type?: RoleType;
  process: Process;
  owner: string;
  tcodes?: string[];
  children?: string[];
  parent?: string;
  org?: Record<string, string>;
  lastChanged: string;
  analysed?: "yes" | "stale" | "no";
}

const OWNERS: Record<Process, string> = {
  Finance: "Priya Raman",
  Procurement: "Martin Keller",
  Sales: "Elena Rossi",
  HR: "Sunita Iyer",
  Basis: "Daniel Okafor",
};

const seeds: Seed[] = [
  // ---- Finance
  { name: "Z_FI_AP_CLERK", description: "Accounts payable clerk", process: "Finance", owner: OWNERS.Finance, tcodes: ["FB60", "MIRO", "FBL1N", "FV50", "FB50", "F110", "FK02"], org: { BUKRS: "1000" }, lastChanged: "2026-10-18T11:20:00Z" },
  { name: "Z_FI_AP_PAYMENTS", description: "AP payment run operator", process: "Finance", owner: OWNERS.Finance, tcodes: ["F110", "F-53", "FBL1N"], org: { BUKRS: "1000" }, lastChanged: "2026-08-04T09:00:00Z" },
  { name: "Z_FI_AP_MASTER", description: "Vendor master data steward", process: "Finance", owner: OWNERS.Finance, tcodes: ["BP", "FK02", "FK03"], org: { BUKRS: "1000" }, lastChanged: "2026-06-12T14:00:00Z" },
  { name: "Z_FI_GL_ACCOUNTANT", description: "General ledger accountant", process: "Finance", owner: OWNERS.Finance, tcodes: ["FS00", "FB50", "FBL3N", "FB03"], org: { BUKRS: "1000" }, lastChanged: "2026-09-21T10:15:00Z" },
  { name: "Z_FI_GL_PARK", description: "Journal preparer (park only)", process: "Finance", owner: OWNERS.Finance, tcodes: ["FV50", "FBV1", "FB03"], org: { BUKRS: "1000" }, lastChanged: "2026-05-30T08:00:00Z" },
  { name: "Z_FI_GL_POSTER", description: "Journal approver (post parked)", process: "Finance", owner: OWNERS.Finance, tcodes: ["FBV0", "FB03"], org: { BUKRS: "1000" }, lastChanged: "2026-05-30T08:05:00Z" },
  { name: "Z_FI_AR_CLERK", description: "Accounts receivable clerk", process: "Finance", owner: OWNERS.Finance, tcodes: ["F-28", "FBL5N", "VF03"], org: { BUKRS: "1000" }, lastChanged: "2026-07-07T13:30:00Z" },
  { name: "Z_FI_AR_BILLING_CASH", description: "AR billing and cash application", process: "Finance", owner: OWNERS.Finance, tcodes: ["VF01", "F-28", "FBL5N"], org: { BUKRS: "2000", VKORG: "2000" }, lastChanged: "2026-10-02T16:45:00Z" },
  { name: "Z_FI_ASSET_ACCT", description: "Fixed asset accountant", process: "Finance", owner: OWNERS.Finance, tcodes: ["AS01", "AS02", "AFAB"], org: { BUKRS: "1000" }, lastChanged: "2026-04-14T09:10:00Z" },
  { name: "Z_FI_CLOSE", description: "Period-end close", process: "Finance", owner: OWNERS.Finance, tcodes: ["FAGLB03", "F.01", "OB52"], org: { BUKRS: "*" }, lastChanged: "2026-09-01T07:00:00Z" },
  { name: "Z_FI_TREASURY", description: "Treasury analyst", process: "Finance", owner: OWNERS.Finance, tcodes: ["FF7A", "FI12"], org: { BUKRS: "1000" }, lastChanged: "2026-10-20T12:00:00Z", analysed: "no" },
  { name: "Z_FI_DISPLAY", description: "Finance display only", process: "Finance", owner: OWNERS.Finance, tcodes: ["FB03", "FBL1N", "FBL3N", "FBL5N"], org: { BUKRS: "*" }, lastChanged: "2026-02-11T10:00:00Z" },
  { name: "Z_FI_VENDOR_PAY_MAINT", description: "Vendor maintenance with payment (shared service centre)", process: "Finance", owner: OWNERS.Finance, tcodes: ["BP", "F110", "FBL1N"], org: { BUKRS: "3000" }, lastChanged: "2026-09-15T15:00:00Z" },
  { name: "Z_FI_CREDIT_MGMT", description: "Customer credit management", process: "Finance", owner: OWNERS.Finance, tcodes: ["FD32", "FBL5N"], org: { BUKRS: "1000" }, lastChanged: "2026-08-19T09:40:00Z", analysed: "stale" },
  // ---- Procurement
  { name: "Z_MM_BUYER", description: "Purchasing buyer", process: "Procurement", owner: OWNERS.Procurement, tcodes: ["ME21N", "ME22N", "ME23N", "ME2M"], org: { EKORG: "1000", WERKS: "1000" }, lastChanged: "2026-09-28T09:00:00Z" },
  { name: "Z_MM_PO_APPROVER", description: "Purchase order approver", process: "Procurement", owner: OWNERS.Procurement, tcodes: ["ME29N", "ME28", "ME23N"], org: { EKORG: "1000" }, lastChanged: "2026-07-22T11:00:00Z" },
  { name: "Z_MM_BUYER_APPROVER", description: "Senior buyer with release", process: "Procurement", owner: OWNERS.Procurement, tcodes: ["ME21N", "ME22N", "ME29N"], org: { EKORG: "2000", WERKS: "2000" }, lastChanged: "2026-10-10T14:20:00Z" },
  { name: "Z_MM_INVOICE_VERIFY", description: "Logistics invoice verification", process: "Procurement", owner: OWNERS.Procurement, tcodes: ["MIRO", "MIR4"], org: { WERKS: "1000" }, lastChanged: "2026-06-30T08:30:00Z" },
  { name: "Z_MM_BUYER_INVOICE", description: "Buyer with invoice posting (plant 2000)", process: "Procurement", owner: OWNERS.Procurement, tcodes: ["ME21N", "MIRO", "ME23N"], org: { EKORG: "2000", WERKS: "2000" }, lastChanged: "2026-10-05T10:10:00Z" },
  { name: "Z_MM_GOODS_RECEIPT", description: "Warehouse goods receipt", process: "Procurement", owner: OWNERS.Procurement, tcodes: ["MIGO", "MB51"], org: { WERKS: "1000" }, lastChanged: "2026-03-18T07:45:00Z" },
  { name: "Z_MM_INVENTORY", description: "Physical inventory", process: "Procurement", owner: OWNERS.Procurement, tcodes: ["MI01", "MI04", "MI07"], org: { WERKS: "1000" }, lastChanged: "2026-05-05T12:00:00Z" },
  { name: "Z_MM_MATERIAL_MASTER", description: "Material master maintenance", process: "Procurement", owner: OWNERS.Procurement, tcodes: ["MM01", "MM02"], org: { WERKS: "*" }, lastChanged: "2026-08-08T08:00:00Z" },
  { name: "Z_MM_CONTRACTS", description: "Contract management", process: "Procurement", owner: OWNERS.Procurement, tcodes: ["ME31K", "ME32K"], org: { EKORG: "1000" }, lastChanged: "2026-10-21T09:00:00Z", analysed: "no" },
  // ---- Sales
  { name: "Z_SD_ORDER_ENTRY", description: "Sales order entry", process: "Sales", owner: OWNERS.Sales, tcodes: ["VA01", "VA02", "VA03"], org: { VKORG: "1000" }, lastChanged: "2026-07-01T10:00:00Z" },
  { name: "Z_SD_BILLING", description: "Billing clerk", process: "Sales", owner: OWNERS.Sales, tcodes: ["VF01", "VF02", "VF04"], org: { VKORG: "1000" }, lastChanged: "2026-09-09T13:00:00Z" },
  { name: "Z_SD_BILLING_SUPER", description: "Billing supervisor with cash receipt", process: "Sales", owner: OWNERS.Sales, tcodes: ["VF01", "VF02", "F-28", "VA03"], org: { VKORG: "1000", BUKRS: "1000" }, lastChanged: "2026-09-25T15:30:00Z" },
  { name: "Z_SD_PRICING", description: "Pricing administrator", process: "Sales", owner: OWNERS.Sales, tcodes: ["VK11", "VK12"], org: { VKORG: "*" }, lastChanged: "2026-04-01T09:00:00Z" },
  { name: "Z_SD_SHIPPING", description: "Shipping and delivery", process: "Sales", owner: OWNERS.Sales, tcodes: ["VL01N", "VL02N"], org: { WERKS: "1000" }, lastChanged: "2026-06-16T11:00:00Z" },
  { name: "Z_SD_CREDIT", description: "Credit release", process: "Sales", owner: OWNERS.Sales, tcodes: ["VKM1", "FD32"], org: { VKORG: "1000" }, lastChanged: "2026-10-19T08:00:00Z", analysed: "stale" },
  // ---- HR
  { name: "Z_HR_PAYROLL_ADMIN", description: "Payroll administrator", process: "HR", owner: OWNERS.HR, tcodes: ["PA30", "PC00_M40_CALC", "PA20"], org: { PERSA: "IN01" }, lastChanged: "2026-10-12T10:00:00Z" },
  { name: "Z_HR_PA_ADMIN", description: "Personnel administrator", process: "HR", owner: OWNERS.HR, tcodes: ["PA30", "PA40", "PA20"], org: { PERSA: "IN01" }, lastChanged: "2026-08-25T09:00:00Z" },
  { name: "Z_HR_PAYROLL_RUN", description: "Payroll run operator", process: "HR", owner: OWNERS.HR, tcodes: ["PC00_M40_CALC", "PC00_M99_CIPE"], org: { PERSA: "IN01" }, lastChanged: "2026-08-25T09:10:00Z" },
  { name: "Z_HR_TIME", description: "Time administrator", process: "HR", owner: OWNERS.HR, tcodes: ["PT60", "CAT2"], org: { PERSA: "*" }, lastChanged: "2026-03-03T09:00:00Z" },
  { name: "Z_HR_DISPLAY", description: "HR display only", process: "HR", owner: OWNERS.HR, tcodes: ["PA20", "PA51"], org: { PERSA: "*" }, lastChanged: "2026-10-22T08:00:00Z", analysed: "no" },
  // ---- Basis
  { name: "Z_BASIS_ADMIN", description: "Basis administrator (full)", process: "Basis", owner: OWNERS.Basis, tcodes: ["PFCG", "SU01", "SU10", "SM37", "ST22"], lastChanged: "2026-10-01T06:00:00Z" },
  { name: "Z_BASIS_USER_ADMIN", description: "User administrator", process: "Basis", owner: OWNERS.Basis, tcodes: ["SU01", "SU10", "SU53"], lastChanged: "2026-07-15T06:00:00Z" },
  { name: "Z_BASIS_ROLE_ADMIN", description: "Role administrator", process: "Basis", owner: OWNERS.Basis, tcodes: ["PFCG", "SUIM"], lastChanged: "2026-07-15T06:10:00Z" },
  { name: "Z_BASIS_MONITOR", description: "System monitoring", process: "Basis", owner: OWNERS.Basis, tcodes: ["SM37", "SM21", "SM50", "ST22"], lastChanged: "2026-02-20T06:00:00Z" },
  { name: "Z_BASIS_TRANSPORT", description: "Transport management", process: "Basis", owner: OWNERS.Basis, tcodes: ["STMS", "SE01"], lastChanged: "2026-01-12T06:00:00Z" },
  // ---- Derived
  { name: "Z_FI_AP_CLERK_1000", description: "AP clerk – company code 1000", type: "Derived", parent: "Z_FI_AP_CLERK", process: "Finance", owner: OWNERS.Finance, org: { BUKRS: "1000" }, lastChanged: "2026-10-18T11:25:00Z" },
  { name: "Z_FI_AP_CLERK_2000", description: "AP clerk – company code 2000", type: "Derived", parent: "Z_FI_AP_CLERK", process: "Finance", owner: OWNERS.Finance, org: { BUKRS: "2000" }, lastChanged: "2026-10-18T11:26:00Z" },
  { name: "Z_MM_BUYER_2000", description: "Buyer – purchasing org 2000", type: "Derived", parent: "Z_MM_BUYER", process: "Procurement", owner: OWNERS.Procurement, org: { EKORG: "2000", WERKS: "2000" }, lastChanged: "2026-09-28T09:05:00Z" },
  // ---- Composite
  { name: "Z_C_FINANCE_MANAGER", description: "Finance manager (composite)", type: "Composite", process: "Finance", owner: OWNERS.Finance, children: ["Z_FI_GL_ACCOUNTANT", "Z_FI_AP_PAYMENTS", "Z_FI_AP_MASTER", "Z_FI_DISPLAY"], lastChanged: "2026-10-14T10:00:00Z" },
  { name: "Z_C_PROCUREMENT_LEAD", description: "Procurement lead (composite)", type: "Composite", process: "Procurement", owner: OWNERS.Procurement, children: ["Z_MM_BUYER", "Z_MM_GOODS_RECEIPT", "Z_MM_INVOICE_VERIFY"], lastChanged: "2026-09-30T10:00:00Z" },
  { name: "Z_C_SALES_OPS", description: "Sales operations (composite)", type: "Composite", process: "Sales", owner: OWNERS.Sales, children: ["Z_SD_ORDER_ENTRY", "Z_SD_SHIPPING", "Z_SD_PRICING"], lastChanged: "2026-06-16T11:30:00Z" },
];

function authsFor(tcodes: string[], org: Record<string, string>): RoleAuth[] {
  const rows: RoleAuth[] = tcodes.map((tc) => ({ object: "S_TCODE", field: "TCD", low: tc }));
  const seen = new Set<string>();
  for (const tc of tcodes) {
    for (const p of SU24[tc] ?? []) {
      const low = p.low.startsWith("$") ? org[p.low.slice(1)] ?? "" : p.low;
      const key = `${p.object}|${p.field}|${low}|${p.high ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ object: p.object, field: p.field, low, high: p.high });
    }
  }
  return rows;
}

function orgFor(org: Record<string, string>): OrgLevel[] {
  return Object.entries(org).map(([field, low]) => ({ field, label: ORG_LEVEL_DEFS[field] ?? field, low }));
}

const byName = new Map(seeds.map((s) => [s.name, s]));

export const ROLES: Role[] = seeds.map((s) => {
  const parentSeed = s.parent ? byName.get(s.parent) : undefined;
  const tcodes = s.tcodes ?? parentSeed?.tcodes ?? [];
  const org = s.org ?? {};
  return {
    name: s.name,
    description: s.description,
    type: s.type ?? "Single",
    parent: s.parent,
    children: s.children,
    process: s.process,
    owner: s.owner,
    tcodes: s.type === "Composite" ? [] : tcodes,
    auths: s.type === "Composite" ? [] : authsFor(tcodes, org),
    orgLevels: orgFor(org),
    lastChanged: s.lastChanged,
    lastAnalysed: s.analysed === "no" ? undefined : s.analysed === "stale" ? STALE : ANALYSED,
  };
});

export const MITIGATIONS: Mitigation[] = [
  {
    subject: "Z_FI_VENDOR_PAY_MAINT",
    riskId: "MG-FI-P004",
    controlId: "MC-FI-014",
    control: "Weekly independent review of vendor bank-detail changes (report S_ALR_87010039)",
    validTo: "2027-03-31",
  },
  {
    subject: "Z_SD_BILLING_SUPER",
    riskId: "MG-SD-P002",
    controlId: "MC-SD-003",
    control: "Monthly reconciliation of billing vs. cash receipts by Finance",
    validTo: "2026-12-31",
  },
];

export const SNAPSHOT_DATE = "2026-10-22T02:00:00Z";
export const LAST_RUN_ID = "RUN-20261022-0200";
