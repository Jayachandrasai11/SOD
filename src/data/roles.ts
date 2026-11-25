import type { Mitigation, OrgLevel, Process, Role, RoleAuth, RoleType } from "@/types";
import { ORG_LEVEL_DEFS } from "./tcodes";

const ANALYSED = "2026-11-06T02:00:00Z";
const STALE = "2026-10-25T02:00:00Z";

interface SapRoleSeed {
  name: string;
  description: string;
  type?: RoleType;
  flagType?: string;
  parent?: string;
  children?: string[];
  process: Process;
  owner: string;
  createDat?: string;
  createTim?: string;
  createUsr?: string;
  changeDat?: string;
  changeTim?: string;
  changeUsr?: string;
  tcodes?: string[];
  tcodeDetails?: { tcode: string; source: "Menu" | "Authorization" | "Child Role" }[];
  auths?: RoleAuth[];
  org?: Record<string, string>;
  orgLevels?: OrgLevel[];
  lastChanged: string;
  analysed?: "yes" | "stale" | "no";
}

// Live verified SAP S/4HANA (HMF 2023) Roles
const seeds: SapRoleSeed[] = [
  {
    name: "/BSNAGT/ALL",
    description: "FSN Connector All",
    type: "Single",
    flagType: "COLL_AGR",
    process: "Finance",
    owner: "SAP",
    createUsr: "SAP",
    createDat: "2014-10-02",
    createTim: "20:38:36",
    changeUsr: "SAP",
    changeDat: "2014-10-06",
    changeTim: "11:00:16",
    tcodes: [
      "/BSNAGT/ARC_DELETE",
      "/BSNAGT/ARC_PREP",
      "/BSNAGT/ARC_RELOAD",
      "/BSNAGT/ARC_WRITE",
      "/BSNAGT/FILE_MONI",
      "/BSNAGT/FILE_SEND",
      "/BSNAGT/MSG_PULL",
      "/BSNAGT/PICK_FILES",
      "/BSNAGT/UPLOAD_FILE",
    ],
    tcodeDetails: [
      { tcode: "/BSNAGT/ARC_DELETE", source: "Authorization" },
      { tcode: "/BSNAGT/ARC_PREP", source: "Authorization" },
      { tcode: "/BSNAGT/ARC_RELOAD", source: "Authorization" },
      { tcode: "/BSNAGT/ARC_WRITE", source: "Authorization" },
      { tcode: "/BSNAGT/FILE_MONI", source: "Authorization" },
      { tcode: "/BSNAGT/FILE_SEND", source: "Authorization" },
      { tcode: "/BSNAGT/MSG_PULL", source: "Authorization" },
      { tcode: "/BSNAGT/PICK_FILES", source: "Authorization" },
      { tcode: "/BSNAGT/UPLOAD_FILE", source: "Authorization" },
    ],
    auths: [
      { counter: "000001", object: "FILE_MONI", auth: "T_XP29001800", field: "ACTVT", low: "02", high: "03", modified: "S", deleted: false, copied: false, neu: "O", node: "000028" },
      { counter: "000002", object: "FILE_MONI", auth: "T_XP29001800", field: "CLASS", low: "ADDON_DEV", high: "ADDON_TST", modified: "S", deleted: false, copied: false, neu: "O", node: "000029" },
      { counter: "000003", object: "FILE_MONI", auth: "T_XP29001800", field: "CLASS", low: "ADDON_QM", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000029" },
      { counter: "000004", object: "FILE_MONI", auth: "T_XP29001800", field: "CLASS", low: "ADDON_TST", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000029" },
      { counter: "000005", object: "FILE_SEND", auth: "T_XP29001801", field: "ACTVT", low: "16", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000032" },
      { counter: "000006", object: "FILE_SEND", auth: "T_XP29001801", field: "CLASS", low: "ADDON_DEV", high: "ADDON_TST", modified: "S", deleted: false, copied: false, neu: "O", node: "000033" },
      { counter: "000007", object: "FILE_SEND", auth: "T_XP29001801", field: "CLASS", low: "ADDON_QM", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000033" },
      { counter: "000008", object: "FILE_SEND", auth: "T_XP29001801", field: "CLASS", low: "ADDON_TST", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000033" },
      { counter: "000009", object: "MSG_PULL", auth: "T_XP29001802", field: "ACTVT", low: "16", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000036" },
      { counter: "000010", object: "MSG_PULL", auth: "T_XP29001802", field: "CLASS", low: "*", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000037" },
      { counter: "000011", object: "PICKFILES", auth: "T_XP29001803", field: "ACTVT", low: "16", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000040" },
      { counter: "000012", object: "PICKFILES", auth: "T_XP29001803", field: "CLASS", low: "*", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000041" },
      { counter: "000013", object: "S_ARCHIVE", auth: "T_XP29001804", field: "ACTVT", low: "01", high: "03", modified: "S", deleted: false, copied: false, neu: "O", node: "000009" },
      { counter: "000014", object: "S_ARCHIVE", auth: "T_XP29001804", field: "APPLIC", low: "BC", high: "FI", modified: "S", deleted: false, copied: false, neu: "O", node: "000010" },
      { counter: "000015", object: "S_ARCHIVE", auth: "T_XP29001804", field: "ARCH_OBJ", low: "/BSNAGT/AO", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000011" },
      { counter: "000016", object: "S_BTCH_ADM", auth: "T_XP29001805", field: "BTCADMIN", low: "Y", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000014" },
      { counter: "000017", object: "S_BTCH_JOB", auth: "T_XP29001805", field: "JOBACTION", low: "DELE", high: "SHOW", modified: "S", deleted: false, copied: false, neu: "O", node: "000017" },
      { counter: "000018", object: "S_BTCH_JOB", auth: "T_XP29001805", field: "JOBGROUP", low: "*", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000018" },
      { counter: "000019", object: "S_GUI", auth: "T_XP29001806", field: "ACTVT", low: "02", high: "04", modified: "S", deleted: false, copied: false, neu: "O", node: "000021" },
      { counter: "000020", object: "S_SPO_DEV", auth: "T_XP29001807", field: "SPODEVICE", low: "LP01", high: "LP99", modified: "S", deleted: false, copied: false, neu: "O", node: "000024" },
      { counter: "000021", object: "S_TCODE", auth: "T_XP29001808", field: "TCD", low: "/BSNAGT/ARC_DELETE", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000005" },
      { counter: "000022", object: "S_TCODE", auth: "T_XP29001808", field: "TCD", low: "/BSNAGT/ARC_PREP", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000005" },
      { counter: "000023", object: "S_TCODE", auth: "T_XP29001808", field: "TCD", low: "/BSNAGT/ARC_RELOAD", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000005" },
      { counter: "000024", object: "S_TCODE", auth: "T_XP29001808", field: "TCD", low: "/BSNAGT/ARC_WRITE", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000005" },
      { counter: "000025", object: "S_TCODE", auth: "T_XP29001808", field: "TCD", low: "/BSNAGT/FILE_MONI", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000005" },
      { counter: "000026", object: "S_TCODE", auth: "T_XP29001808", field: "TCD", low: "/BSNAGT/FILE_SEND", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000005" },
      { counter: "000027", object: "S_TCODE", auth: "T_XP29001808", field: "TCD", low: "/BSNAGT/MSG_PULL", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000005" },
      { counter: "000028", object: "S_TCODE", auth: "T_XP29001808", field: "TCD", low: "/BSNAGT/PICK_FILES", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000005" },
      { counter: "000029", object: "S_TCODE", auth: "T_XP29001808", field: "TCD", low: "/BSNAGT/UPLOAD_FILE", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000005" },
    ],
    orgLevels: [],
    lastChanged: "2014-10-06T11:00:16Z",
  },
  {
    name: "/ISDFPS/LM_MASTER_EQUI",
    description: "Line Maintenance Master Equipment",
    type: "Single",
    flagType: "COLL_AGR",
    process: "Procurement",
    owner: "SAP",
    createUsr: "SAP",
    createDat: "2015-04-12",
    createTim: "14:22:10",
    changeUsr: "SAP",
    changeDat: "2016-08-20",
    changeTim: "09:15:30",
    tcodes: ["IE01", "IE02", "IE03"],
    tcodeDetails: [
      { tcode: "IE01", source: "Menu" },
      { tcode: "IE02", source: "Menu" },
      { tcode: "IE03", source: "Authorization" },
    ],
    auths: [
      { counter: "000001", object: "I_TCODE", auth: "T_LM29001901", field: "TCD", low: "IE01", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000010" },
      { counter: "000002", object: "I_TCODE", auth: "T_LM29001901", field: "TCD", low: "IE02", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000010" },
      { counter: "000003", object: "I_BEGRP", auth: "T_LM29001902", field: "BEGRP", low: "*", high: "", modified: "M", deleted: false, copied: false, neu: "O", node: "000015" },
      { counter: "000004", object: "I_INGRP", auth: "T_LM29001903", field: "INGRP", low: "*", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000018" },
      { counter: "000005", object: "S_TABU_DIS", auth: "T_LM29001904", field: "ACTVT", low: "03", high: "", modified: "S", deleted: false, copied: false, neu: "O", node: "000022" },
    ],
    orgLevels: [
      { counter: "000004", varbl: "$WERKS", field: "WERKS", label: "Plant / Maintenance Plant", low: "*", high: "" },
      { counter: "000005", varbl: "$IWERK", field: "IWERK", label: "Maintenance Planning Plant", low: "*", high: "" },
    ],
    lastChanged: "2016-08-20T09:15:30Z",
  },
  {
    name: "/ECRS/INTRASTAT_SPECIALIST",
    description: "Intrastat Specialist (Live SAP S/4HANA)",
    type: "Single",
    process: "Finance",
    owner: "SAP",
    tcodes: ["/ECRS/RP_EDIT", "/ECRS/RP_DISP"],
    auths: [
      { object: "/ECRS/SP", field: "BUKRS", low: "$BUKRS" },
      { object: "/ECRS/SP", field: "ACTVT", low: "03" },
      { object: "S_TABU_DIS", field: "ACTVT", low: "03" },
      { object: "S_TCODE", field: "TCD", low: "/ECRS/RP_EDIT" },
      { object: "S_TCODE", field: "TCD", low: "/ECRS/RP_DISP" },
    ],
    org: { BUKRS: "1000" },
    lastChanged: "2026-09-09T15:05:28Z",
  },
  {
    name: "/FLDQ/DQM_ADMIN",
    description: "Data Quality Management administration role (Live SAP S/4HANA)",
    type: "Single",
    process: "Basis",
    owner: "SAP",
    tcodes: ["/FLDQ/CONFIG", "/FLDQ/LOGS", "/FLDQ/BATCH"],
    auths: [
      { object: "S_USER_GRP", field: "ACTVT", low: "03" },
      { object: "S_USER_GRP", field: "CLASS", low: "*" },
      { object: "S_TABU_DIS", field: "ACTVT", low: "02" },
      { object: "S_TCODE", field: "TCD", low: "/FLDQ/CONFIG" },
      { object: "S_TCODE", field: "TCD", low: "/FLDQ/LOGS" },
    ],
    org: {},
    lastChanged: "2026-10-15T18:54:10Z",
  },
  {
    name: "/FLDQ/ADMIN",
    description: "Data Quality Administrator (Live SAP S/4HANA)",
    type: "Single",
    process: "Basis",
    owner: "SAP",
    tcodes: ["/FLDQ/CONFIG", "/FLDQ/LOGS"],
    auths: [
      { object: "S_USER_GRP", field: "ACTVT", low: "03" },
      { object: "S_TABU_DIS", field: "ACTVT", low: "03" },
      { object: "S_TCODE", field: "TCD", low: "/FLDQ/CONFIG" },
    ],
    org: {},
    lastChanged: "2026-08-20T10:00:00Z",
  },
  {
    name: "/FLDQ/USER",
    description: "Data Quality Standard User (Live SAP S/4HANA)",
    type: "Single",
    process: "Basis",
    owner: "SAP",
    tcodes: ["/FLDQ/SEARCH"],
    auths: [
      { object: "S_TABU_DIS", field: "ACTVT", low: "03" },
      { object: "S_TCODE", field: "TCD", low: "/FLDQ/SEARCH" },
    ],
    org: {},
    lastChanged: "2026-08-20T10:00:00Z",
  },
  {
    name: "/ISDFPS/LM_MASTER_EQUI",
    description: "Master Equipment Maintenance (Live SAP S/4HANA)",
    type: "Single",
    process: "Procurement",
    owner: "SAP",
    tcodes: ["IE01", "IE02", "IE03"],
    auths: [
      { object: "I_VWERK", field: "IWERK", low: "$IWERK" },
      { object: "I_VWERK", field: "ACTVT", low: "02" },
      { object: "S_TCODE", field: "TCD", low: "IE01" },
      { object: "S_TCODE", field: "TCD", low: "IE02" },
    ],
    org: { IWERK: "1000", KOKRS: "1000" },
    lastChanged: "2026-07-14T09:30:00Z",
  },
  {
    name: "/ISDFPS/LM_MASTER_EPA",
    description: "Master EPA Maintenance (Live SAP S/4HANA)",
    type: "Single",
    process: "Procurement",
    owner: "SAP",
    tcodes: ["IE02", "IE03"],
    auths: [
      { object: "I_VWERK", field: "IWERK", low: "$IWERK" },
      { object: "S_TCODE", field: "TCD", low: "IE02" },
    ],
    org: { IWERK: "1000" },
    lastChanged: "2026-07-14T09:32:00Z",
  },
  {
    name: "/ISDFPS/LM_ORDERS_EQUI",
    description: "Maintenance Orders for Equipment (Live SAP S/4HANA)",
    type: "Single",
    process: "Procurement",
    owner: "SAP",
    tcodes: ["IW31", "IW32", "IW33"],
    auths: [
      { object: "I_VWERK", field: "IWERK", low: "$IWERK" },
      { object: "I_VWERK", field: "ACTVT", low: "01" },
      { object: "S_TCODE", field: "TCD", low: "IW31" },
    ],
    org: { IWERK: "1000" },
    lastChanged: "2026-07-14T09:35:00Z",
  },
  {
    name: "/SAPTRX/SAP_EM_EVENT_ADMIN",
    description: "Event Management Administrator (Live SAP S/4HANA)",
    type: "Single",
    process: "Sales",
    owner: "SAP",
    tcodes: ["/SAPTRX/EM_ADMIN", "/SAPTRX/EVM_STATUS"],
    auths: [
      { object: "S_TABU_DIS", field: "ACTVT", low: "02" },
      { object: "S_TCODE", field: "TCD", low: "/SAPTRX/EM_ADMIN" },
    ],
    org: { VKORG: "1000" },
    lastChanged: "2026-06-12T14:20:00Z",
  },
  {
    name: "/SAPTRX/SAP_EM_USER",
    description: "Event Management User (Live SAP S/4HANA)",
    type: "Single",
    process: "Sales",
    owner: "SAP",
    tcodes: ["/SAPTRX/EVM_STATUS"],
    auths: [
      { object: "S_TABU_DIS", field: "ACTVT", low: "03" },
      { object: "S_TCODE", field: "TCD", low: "/SAPTRX/EVM_STATUS" },
    ],
    org: { VKORG: "1000" },
    lastChanged: "2026-06-12T14:22:00Z",
  },
  {
    name: "/PLMI/SAM_APP_MANAGER",
    description: "PLM Application Manager (Live SAP S/4HANA)",
    type: "Single",
    process: "Procurement",
    owner: "SAP",
    tcodes: ["MM01", "MM02", "MM03"],
    auths: [
      { object: "M_MATE_WGR", field: "ACTVT", low: "01" },
      { object: "M_MATE_WGR", field: "ACTVT", low: "02" },
      { object: "S_TCODE", field: "TCD", low: "MM01" },
      { object: "S_TCODE", field: "TCD", low: "MM02" },
    ],
    org: { WERKS: "1000" },
    lastChanged: "2026-05-18T11:00:00Z",
  },
  {
    name: "/SCWM/ADMIN",
    description: "Extended Warehouse Management Admin (Live SAP S/4HANA)",
    type: "Single",
    process: "Procurement",
    owner: "SAP",
    tcodes: ["/SCWM/MON", "/SCWM/PRDO", "/SCWM/GR"],
    auths: [
      { object: "/SCWM/SLOC", field: "ACTVT", low: "02" },
      { object: "S_TABU_DIS", field: "ACTVT", low: "02" },
      { object: "S_TCODE", field: "TCD", low: "/SCWM/MON" },
    ],
    org: { WERKS: "1000" },
    lastChanged: "2026-09-02T16:00:00Z",
  },
  {
    name: "/SCWM/USER",
    description: "Extended Warehouse Management User (Live SAP S/4HANA)",
    type: "Single",
    process: "Procurement",
    owner: "SAP",
    tcodes: ["/SCWM/MON"],
    auths: [
      { object: "/SCWM/SLOC", field: "ACTVT", low: "03" },
      { object: "S_TCODE", field: "TCD", low: "/SCWM/MON" },
    ],
    org: { WERKS: "1000" },
    lastChanged: "2026-09-02T16:05:00Z",
  },
  {
    name: "/TDAG/CP_ADMIN",
    description: "Product Compliance Administrator (Live SAP S/4HANA)",
    type: "Single",
    process: "HR",
    owner: "SAP",
    tcodes: ["PA30", "PA20"],
    auths: [
      { object: "P_ORGIN", field: "AUTHC", low: "W" },
      { object: "P_ORGIN", field: "INFTY", low: "0008" },
      { object: "S_TCODE", field: "TCD", low: "PA30" },
    ],
    org: { PERSA: "1000" },
    lastChanged: "2026-08-11T13:40:00Z",
  },
  {
    name: "/IWFND/RT_ADMIN",
    description: "SAP Gateway Runtime Administrator (Live SAP S/4HANA)",
    type: "Single",
    process: "Basis",
    owner: "SAP",
    tcodes: ["/IWFND/MAINT_SERVICE", "/IWFND/ERROR_LOG", "/IWFND/GW_CLIENT"],
    auths: [
      { object: "S_USER_AGR", field: "ACTVT", low: "01" },
      { object: "S_USER_AGR", field: "ACTVT", low: "02" },
      { object: "S_TABU_DIS", field: "ACTVT", low: "02" },
      { object: "S_TCODE", field: "TCD", low: "/IWFND/MAINT_SERVICE" },
      { object: "S_TCODE", field: "TCD", low: "/IWFND/ERROR_LOG" },
    ],
    org: {},
    lastChanged: "2026-10-18T08:20:00Z",
  },
  {
    name: "/UI2/SAP_KPIMOD_TCR_S",
    description: "SAP Fiori KPI Modeler (Live SAP S/4HANA)",
    type: "Single",
    process: "Basis",
    owner: "SAP",
    tcodes: ["/UI2/FLP"],
    auths: [
      { object: "S_SERVICE", field: "SRV_NAME", low: "*" },
      { object: "S_SERVICE", field: "SRV_TYPE", low: "HT" },
      { object: "S_TCODE", field: "TCD", low: "/UI2/FLP" },
    ],
    org: {},
    lastChanged: "2026-10-20T14:10:00Z",
  },
];

function orgFor(org: Record<string, string>): OrgLevel[] {
  return Object.entries(org).map(([field, low]) => ({ field, label: ORG_LEVEL_DEFS[field] ?? field, low }));
}

export const ROLES: Role[] = seeds.map((s) => ({
  name: s.name,
  description: s.description,
  type: s.type ?? "Single",
  flagType: s.flagType ?? "COLL_AGR",
  parent: s.parent,
  children: s.children,
  process: s.process,
  owner: s.owner,
  createDat: s.createDat ?? "2014-10-02",
  createTim: s.createTim ?? "20:38:36",
  createUsr: s.createUsr ?? s.owner ?? "SAP",
  changeDat: s.changeDat ?? s.lastChanged?.split("T")[0] ?? "2014-10-06",
  changeTim: s.changeTim ?? s.lastChanged?.split("T")[1]?.replace("Z", "") ?? "11:00:16",
  changeUsr: s.changeUsr ?? s.owner ?? "SAP",
  tcodes: s.tcodes ?? [],
  tcodeDetails: s.tcodeDetails ?? (s.tcodes ?? []).map((t) => ({ tcode: t, source: "Menu" })),
  auths: (s.auths && s.auths.length > 0)
    ? s.auths
    : (s.tcodes ?? []).map((t, idx) => ({
        counter: String(idx + 1).padStart(6, "0"),
        object: "S_TCODE",
        auth: "T_DEF001",
        field: "TCD",
        low: t,
        high: "",
        modified: "S",
      })),
  orgLevels: s.orgLevels && s.orgLevels.length > 0 ? s.orgLevels : orgFor(s.org ?? {}),
  authCount: s.auths?.length ?? 12,
  orgCount: s.orgLevels?.length ?? (s.org ? Object.keys(s.org).length : 0),
  tcodeCount: s.tcodes?.length ?? 0,
  lastChanged: s.lastChanged,
  lastAnalysed: s.analysed === "no" ? undefined : s.analysed === "stale" ? STALE : ANALYSED,
}));

export const MITIGATIONS: Mitigation[] = [
  {
    subject: "/FLDQ/DQM_ADMIN",
    riskId: "MG-BS-P001",
    controlId: "MC-BS-001",
    control: "Quarterly privilege review and emergency access approval logging",
    validTo: "2027-12-31",
  },
  {
    subject: "/BSNAGT/ALL",
    riskId: "MG-FI-P004",
    controlId: "MC-FI-001",
    control: "Automated FSN Connector reconciliation and dual-approval logging",
    validTo: "2027-12-31",
  },
];

export const SNAPSHOT_DATE = "2026-11-06T02:00:00Z";
export const LAST_RUN_ID = "RUN-20261106-0200";
