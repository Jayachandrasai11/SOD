import type { Action, Permission, Process, Risk, RulesetVersion, SodFunction } from "@/types";
import { describeTcode, SU24 } from "./tcodes";

const acts = (...codes: string[]): Action[] => codes.map((tcode) => ({ tcode, description: describeTcode(tcode) }));
const perms = (...codes: string[]): Permission[] =>
  codes.flatMap((c) => (SU24[c] ?? []).map((p) => ({ ...p, low: p.low.startsWith("$") ? "*" : p.low })));

const fn = (id: string, name: string, process: Process, codes: string[]): SodFunction => ({
  id,
  name,
  process,
  actions: acts(...codes),
  permissions: dedupe(perms(...codes)),
});

function dedupe(p: Permission[]) {
  const seen = new Set<string>();
  return p.filter((x) => {
    const k = `${x.object}|${x.field}|${x.low}|${x.high ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const FUNCTIONS: SodFunction[] = [
  fn("MG-F-FI01", "Park accounting documents", "Finance", ["FV50", "FBV1", "F-65"]),
  fn("MG-F-FI02", "Post accounting documents", "Finance", ["FBV0", "FB50", "F-02"]),
  fn("MG-F-FI03", "Maintain G/L account master", "Finance", ["FS00"]),
  fn("MG-F-FI04", "Maintain vendor master", "Finance", ["BP", "FK02"]),
  fn("MG-F-FI05", "Pay vendors", "Finance", ["F110", "F-53"]),
  fn("MG-F-FI06", "Post vendor invoices", "Finance", ["FB60", "MIRO"]),
  fn("MG-F-FI07", "Post incoming payments", "Finance", ["F-28"]),
  fn("MG-F-FI08", "Post G/L journal entries", "Finance", ["FB50"]),
  fn("MG-F-MM01", "Create purchase orders", "Procurement", ["ME21N"]),
  fn("MG-F-MM02", "Release purchase orders", "Procurement", ["ME29N"]),
  fn("MG-F-MM03", "Post invoice receipt", "Procurement", ["MIRO"]),
  fn("MG-F-SD01", "Create billing documents", "Sales", ["VF01"]),
  fn("MG-F-HR01", "Maintain employee master", "HR", ["PA30"]),
  fn("MG-F-HR02", "Run payroll", "HR", ["PC00_M40_CALC"]),
  fn("MG-F-BS01", "Maintain roles", "Basis", ["PFCG"]),
  fn("MG-F-BS02", "Maintain user master", "Basis", ["SU01", "SU10"]),
];

export const RISKS: Risk[] = [
  {
    id: "MG-FI-P001",
    description: "Park and post the same accounting document",
    explanation:
      "One person can prepare (park) a journal entry and then approve (post) it themselves. The four-eyes check on manual journals is bypassed, so fictitious or erroneous entries can reach the ledger unreviewed.",
    process: "Finance",
    level: "High",
    type: "SoD",
    functionIds: ["MG-F-FI01", "MG-F-FI02"],
    owner: "Priya Raman (Financial Controller)",
    active: true,
  },
  {
    id: "MG-FI-P002",
    description: "Maintain G/L accounts and post journals",
    explanation:
      "A user who can create or change G/L accounts and also post to them could open an unusual account and hide postings in it.",
    process: "Finance",
    level: "Medium",
    type: "SoD",
    functionIds: ["MG-F-FI03", "MG-F-FI08"],
    owner: "Priya Raman (Financial Controller)",
    active: true,
  },
  {
    id: "MG-FI-P004",
    description: "Maintain vendor master and pay vendors",
    explanation:
      "One person can change a vendor's bank details and then release payments to that vendor. This is the classic route for redirecting payments to a fraudulent account.",
    process: "Finance",
    level: "Critical",
    type: "SoD",
    functionIds: ["MG-F-FI04", "MG-F-FI05"],
    owner: "Priya Raman (Financial Controller)",
    active: true,
  },
  {
    id: "MG-FI-P007",
    description: "Post vendor invoice and run payments",
    explanation:
      "A user can enter a vendor invoice and then pay it. Fake or duplicate invoices can be paid without anyone else seeing them.",
    process: "Finance",
    level: "High",
    type: "SoD",
    functionIds: ["MG-F-FI06", "MG-F-FI05"],
    owner: "Priya Raman (Financial Controller)",
    active: true,
  },
  {
    id: "MG-MM-P001",
    description: "Create and release purchase order",
    explanation:
      "The buyer who creates a purchase order can also approve it, removing the spend-approval control.",
    process: "Procurement",
    level: "High",
    type: "SoD",
    functionIds: ["MG-F-MM01", "MG-F-MM02"],
    owner: "Martin Keller (Head of Procurement)",
    active: true,
  },
  {
    id: "MG-MM-P003",
    description: "Create PO and post invoice",
    explanation:
      "A user who raises purchase orders can also post the supplier invoice against them, so the three-way match can be manipulated.",
    process: "Procurement",
    level: "High",
    type: "SoD",
    functionIds: ["MG-F-MM01", "MG-F-MM03"],
    owner: "Martin Keller (Head of Procurement)",
    active: true,
  },
  {
    id: "MG-SD-P002",
    description: "Create billing and post incoming payments",
    explanation:
      "The same person can raise customer invoices and record customer payments, which allows receipts to be misappropriated and hidden with credit notes.",
    process: "Sales",
    level: "High",
    type: "SoD",
    functionIds: ["MG-F-SD01", "MG-F-FI07"],
    owner: "Elena Rossi (Sales Operations Director)",
    active: true,
  },
  {
    id: "MG-HR-P001",
    description: "Maintain employee master and run payroll",
    explanation:
      "One person can change salary or bank data for an employee and run the payroll that pays it. Ghost employees or inflated pay can go undetected.",
    process: "HR",
    level: "Critical",
    type: "SoD",
    functionIds: ["MG-F-HR01", "MG-F-HR02"],
    owner: "Sunita Iyer (HR Director)",
    active: true,
  },
  {
    id: "MG-BS-P001",
    description: "Maintain roles and assign to users",
    explanation:
      "A user who can both build roles and assign them can grant themselves or anyone else any access in the system.",
    process: "Basis",
    level: "Critical",
    type: "SoD",
    functionIds: ["MG-F-BS01", "MG-F-BS02"],
    owner: "Daniel Okafor (IT Security Lead)",
    active: true,
  },
  {
    id: "MG-BS-C001",
    description: "Maintain user master",
    explanation:
      "Creating, changing or unlocking users is a critical action on its own – it should be limited to the user-administration team.",
    process: "Basis",
    level: "Critical",
    type: "Critical action",
    functionIds: ["MG-F-BS02"],
    owner: "Daniel Okafor (IT Security Lead)",
    active: true,
  },
];

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Historic versions for the Versions tab / diff */
const v12Risks = clone(RISKS)
  .filter((r) => r.id !== "MG-SD-P002" && r.id !== "MG-BS-C001")
  .map((r) => (r.id === "MG-FI-P002" ? { ...r, level: "High" as const } : r));
const v13Risks = clone(RISKS).map((r) =>
  r.id === "MG-MM-P003" ? { ...r, description: "Create purchase order and post invoice receipt" } : r,
);

export const VERSIONS: RulesetVersion[] = [
  {
    version: "1.4",
    status: "Draft",
    author: "Anna Schmidt",
    date: "2026-10-22T15:12:00Z",
    note: "Q4 review – owner updates, SD billing risk wording",
    risks: clone(RISKS),
    functions: clone(FUNCTIONS),
  },
  {
    version: "1.3",
    status: "Published",
    author: "Anna Schmidt",
    date: "2026-09-30T10:00:00Z",
    note: "Added SD billing risk and Basis critical action",
    risks: v13Risks,
    functions: clone(FUNCTIONS),
  },
  {
    version: "1.2",
    status: "Approved",
    author: "Tomás Herrera",
    date: "2026-07-14T08:40:00Z",
    note: "Approved by Risk Committee",
    risks: v12Risks,
    functions: clone(FUNCTIONS),
  },
  {
    version: "1.1",
    status: "Published",
    author: "Tomás Herrera",
    date: "2026-03-02T09:00:00Z",
    note: "Initial MyGo starter library",
    risks: v12Risks.filter((r) => r.process !== "HR"),
    functions: clone(FUNCTIONS),
  },
];

export const PUBLISHED_VERSION = "1.3";

export const RISK_OWNERS = [
  "Priya Raman (Financial Controller)",
  "Martin Keller (Head of Procurement)",
  "Elena Rossi (Sales Operations Director)",
  "Sunita Iyer (HR Director)",
  "Daniel Okafor (IT Security Lead)",
];
