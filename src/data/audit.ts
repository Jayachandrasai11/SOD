import type { AuditEntry } from "@/types";

export const AUDIT: AuditEntry[] = [
  { id: "A-1042", timestamp: "2026-10-23T08:12:00Z", user: "Tomás Herrera", area: "Analysis", action: "Ran analysis", object: "All roles · S4P", after: "RUN-20261022-0200 · 14 Red", reason: "Weekly review" },
  { id: "A-1041", timestamp: "2026-10-22T15:12:00Z", user: "Anna Schmidt", area: "Rules", action: "Changed risk owner", object: "MG-SD-P002", before: "Martin Keller", after: "Elena Rossi", reason: "Ownership moved to Sales Ops" },
  { id: "A-1040", timestamp: "2026-10-22T15:05:00Z", user: "Anna Schmidt", area: "Rules", action: "Changed description", object: "MG-MM-P003", before: "Create purchase order and post invoice receipt", after: "Create PO and post invoice" },
  { id: "A-1039", timestamp: "2026-10-22T14:58:00Z", user: "Anna Schmidt", area: "Rules", action: "Created draft version", object: "Ruleset v1.4", after: "Draft" },
  { id: "A-1038", timestamp: "2026-10-21T09:44:00Z", user: "Daniel Okafor", area: "Connection", action: "Changed sync schedule", object: "S4P – Production", before: "Delta daily 03:00", after: "Delta daily 02:00", reason: "Avoid batch window clash" },
  { id: "A-1037", timestamp: "2026-10-20T17:30:00Z", user: "Tomás Herrera", area: "Role export", action: "Exported role file", object: "Z_MM_PO_APPROVER", after: "Z_MM_PO_APPROVER_v2_2026-10-20.SAP · Green" },
  { id: "A-1036", timestamp: "2026-10-20T11:02:00Z", user: "Tomás Herrera", area: "Role export", action: "Exported with justification", object: "Z_FI_VENDOR_PAY_MAINT", after: "Red · approved by Priya Raman", reason: "Shared service centre – compensating control MC-FI-014" },
  { id: "A-1035", timestamp: "2026-10-19T01:00:00Z", user: "system", area: "Connection", action: "Full sync completed", object: "S4P – Production", after: "319,299 records" },
  { id: "A-1034", timestamp: "2026-10-15T13:20:00Z", user: "Anna Schmidt", area: "Settings", action: "Changed staleness limit", object: "Traffic-light mapping", before: "14 days", after: "7 days", reason: "Audit recommendation AR-2026-07" },
  { id: "A-1033", timestamp: "2026-10-14T10:00:00Z", user: "Tomás Herrera", area: "Analysis", action: "Ran analysis", object: "Z_C_FINANCE_MANAGER", after: "Red · 1 risk" },
  { id: "A-1032", timestamp: "2026-09-30T10:00:00Z", user: "Priya Raman", area: "Rules", action: "Published version", object: "Ruleset v1.3", before: "Approved", after: "Published" },
  { id: "A-1031", timestamp: "2026-09-29T16:10:00Z", user: "Priya Raman", area: "Rules", action: "Approved version", object: "Ruleset v1.3", before: "Submitted", after: "Approved", reason: "Risk committee 29 Sep" },
  { id: "A-1030", timestamp: "2026-09-25T15:40:00Z", user: "Anna Schmidt", area: "Rules", action: "Deactivated risk", object: "MG-FI-P009", before: "Active", after: "Inactive", reason: "Duplicate of MG-FI-P004" },
  { id: "A-1029", timestamp: "2026-09-12T08:00:00Z", user: "Daniel Okafor", area: "Connection", action: "Added system", object: "S4D – Development", after: "RFC agent · Basic" },
];
