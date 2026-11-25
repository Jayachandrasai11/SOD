import type { AppUser, User } from "@/types";

const FIRST = [
  "Aarav", "Sophie", "Lukas", "Mei", "Carlos", "Fatima", "Jonas", "Isabel", "Kenji", "Olga",
  "Rahul", "Emma", "Mateo", "Hannah", "Yusuf", "Chloe", "Arjun", "Lena", "Diego", "Nora",
  "Vikram", "Clara", "Felix", "Ana", "Omar", "Julia", "Sven", "Leila", "Marco", "Ines",
];
const LAST = [
  "Sharma", "Müller", "Chen", "García", "Khan", "Weber", "Rossi", "Tanaka", "Novak", "Patel",
  "Fischer", "Silva", "Becker", "Haddad", "Dubois", "Nair", "Hoffmann", "Lopez", "Berg", "Kowalski",
];

/** Role assignments mapped to live SAP S/4HANA (HMF 2023) roles */
const BUNDLES: { dept: string; roles: string[] }[] = [
  { dept: "Financial Systems", roles: ["/BSNAGT/ALL"] },
  { dept: "Data Management", roles: ["/FLDQ/ADMIN", "/FLDQ/USER"] },
  { dept: "Data Governance", roles: ["/FLDQ/DQM_ADMIN"] },
  { dept: "Foreign Trade", roles: ["/ECRS/INTRASTAT_SPECIALIST"] },
  { dept: "Plant Maintenance", roles: ["/ISDFPS/LM_MASTER_EQUI", "/ISDFPS/LM_MASTER_EPA"] },
  { dept: "Maintenance Ops", roles: ["/ISDFPS/LM_ORDERS_EQUI"] },
  { dept: "Logistics Tracking", roles: ["/SAPTRX/SAP_EM_EVENT_ADMIN"] },
  { dept: "Logistics Ops", roles: ["/SAPTRX/SAP_EM_USER"] },
  { dept: "Product Lifecycle", roles: ["/PLMI/SAM_APP_MANAGER"] },
  { dept: "Warehouse Operations", roles: ["/SCWM/ADMIN", "/SCWM/USER"] },
  { dept: "Warehouse Staff", roles: ["/SCWM/USER"] },
  { dept: "Compliance", roles: ["/TDAG/CP_ADMIN"] },
  { dept: "Integration & API", roles: ["/IWFND/RT_ADMIN"] },
  { dept: "Fiori Portal", roles: ["/UI2/SAP_KPIMOD_TCR_S"] },
];

export const USERS: User[] = [
  ...Array.from({ length: 42 }, (_, i) => {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    const bundle = BUNDLES[i % BUNDLES.length];
    const id = (first.slice(0, 1) + last.replace(/[^A-Za-z]/g, "")).toUpperCase().slice(0, 10) + String(i + 1).padStart(2, "0");
    return {
      id,
      name: `${first} ${last}`,
      department: bundle.dept,
      roles: bundle.roles,
      validTo: i % 11 === 0 ? "2026-12-31" : "9999-12-31",
      locked: i === 17 || i === 33,
    };
  }),
  {
    id: "HALURI",
    name: "Hari Kumar Aluri",
    department: "SAP S/4HANA",
    roles: [
      "ZMCP_ROLE",
      "ZROLE_SAMPLE1",
      "ZROLE1",
      "ZROLE2",
      "ZROLE3",
      "ZROLE4",
      "ZROLE5",
      "ZROLE6",
    ],
    createdRoles: [
      "ZROLE_SAMPLE1",
      "ZROLE1",
      "ZROLE2",
      "ZROLE3",
      "ZROLE4",
      "ZROLE5",
      "ZROLE6",
    ],
    validTo: "9999-12-31",
    locked: false,
  },
];

export const APP_USERS: AppUser[] = [
  { id: "u1", name: "Anna Schmidt", email: "anna.schmidt@example.com", role: "Administrator" },
  { id: "u2", name: "Tomás Herrera", email: "tomas.herrera@example.com", role: "Security Analyst" },
  { id: "u3", name: "Priya Raman", email: "priya.raman@example.com", role: "Risk Owner" },
  { id: "u4", name: "Martin Keller", email: "martin.keller@example.com", role: "Risk Owner" },
  { id: "u5", name: "Grace Liu", email: "grace.liu@example.com", role: "Auditor" },
  { id: "u6", name: "Daniel Okafor", email: "daniel.okafor@example.com", role: "Risk Owner" },
];
