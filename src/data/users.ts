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

/** Role bundles per department – some intentionally toxic for demo purposes */
const BUNDLES: { dept: string; roles: string[] }[] = [
  { dept: "Accounts Payable", roles: ["Z_FI_AP_CLERK_1000", "Z_FI_DISPLAY"] },
  { dept: "Accounts Payable", roles: ["Z_FI_AP_PAYMENTS", "Z_FI_DISPLAY"] },
  { dept: "Accounts Payable", roles: ["Z_FI_AP_MASTER", "Z_FI_AP_PAYMENTS"] }, // cross-role P004
  { dept: "General Ledger", roles: ["Z_FI_GL_ACCOUNTANT"] },
  { dept: "General Ledger", roles: ["Z_FI_GL_PARK", "Z_FI_GL_POSTER"] }, // cross-role P001
  { dept: "General Ledger", roles: ["Z_FI_GL_PARK", "Z_FI_DISPLAY"] },
  { dept: "Accounts Receivable", roles: ["Z_FI_AR_CLERK"] },
  { dept: "Accounts Receivable", roles: ["Z_FI_AR_CLERK", "Z_SD_BILLING"] }, // cross-role SD-P002
  { dept: "Finance Management", roles: ["Z_C_FINANCE_MANAGER"] },
  { dept: "Finance", roles: ["Z_FI_ASSET_ACCT", "Z_FI_CLOSE"] },
  { dept: "Treasury", roles: ["Z_FI_TREASURY", "Z_FI_DISPLAY"] },
  { dept: "Procurement", roles: ["Z_MM_BUYER"] },
  { dept: "Procurement", roles: ["Z_MM_BUYER", "Z_MM_PO_APPROVER"] }, // cross-role MM-P001
  { dept: "Procurement", roles: ["Z_MM_PO_APPROVER"] },
  { dept: "Procurement", roles: ["Z_C_PROCUREMENT_LEAD"] },
  { dept: "Warehouse", roles: ["Z_MM_GOODS_RECEIPT", "Z_MM_INVENTORY"] },
  { dept: "Sales", roles: ["Z_SD_ORDER_ENTRY"] },
  { dept: "Sales", roles: ["Z_C_SALES_OPS"] },
  { dept: "Sales", roles: ["Z_SD_BILLING"] },
  { dept: "HR", roles: ["Z_HR_PA_ADMIN"] },
  { dept: "HR", roles: ["Z_HR_PAYROLL_RUN"] },
  { dept: "HR", roles: ["Z_HR_PAYROLL_ADMIN"] },
  { dept: "HR", roles: ["Z_HR_TIME", "Z_HR_DISPLAY"] },
  { dept: "IT Operations", roles: ["Z_BASIS_MONITOR", "Z_BASIS_TRANSPORT"] },
  { dept: "IT Security", roles: ["Z_BASIS_USER_ADMIN"] },
  { dept: "IT Security", roles: ["Z_BASIS_ROLE_ADMIN"] },
  { dept: "IT Operations", roles: ["Z_BASIS_ADMIN"] },
  { dept: "Shared Services", roles: ["Z_FI_VENDOR_PAY_MAINT"] },
  { dept: "Procurement", roles: ["Z_MM_BUYER_2000", "Z_MM_INVOICE_VERIFY"] }, // cross-role MM-P003
  { dept: "Master Data", roles: ["Z_MM_MATERIAL_MASTER"] },
];

export const USERS: User[] = Array.from({ length: 60 }, (_, i) => {
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
    locked: i === 17 || i === 43,
  };
});

export const APP_USERS: AppUser[] = [
  { id: "u1", name: "Anna Schmidt", email: "anna.schmidt@example.com", role: "Administrator" },
  { id: "u2", name: "Tomás Herrera", email: "tomas.herrera@example.com", role: "Security Analyst" },
  { id: "u3", name: "Priya Raman", email: "priya.raman@example.com", role: "Risk Owner" },
  { id: "u4", name: "Martin Keller", email: "martin.keller@example.com", role: "Risk Owner" },
  { id: "u5", name: "Grace Liu", email: "grace.liu@example.com", role: "Auditor" },
  { id: "u6", name: "Daniel Okafor", email: "daniel.okafor@example.com", role: "Risk Owner" },
];
