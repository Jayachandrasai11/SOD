import type { AuditEntry } from "@/types";

export const AUDIT: AuditEntry[] = [
  {
    id: "A-1045",
    timestamp: new Date().toISOString(),
    user: "system",
    area: "Connection",
    action: "SAP BTP Ingestion",
    object: "HMF 2023 – SAP S/4HANA (BTP CAP)",
    after: "OData V4 connection established with XSUAA OAuth 2.0. 5,312 live roles retrieved.",
  },
  {
    id: "A-1044",
    timestamp: "2026-11-06T09:15:00Z",
    user: "Anna Schmidt",
    area: "Settings",
    action: "Configured SAP BTP API",
    object: "SAP BTP CAP Role Service",
    after: "Token endpoint verified: https://mygo-bas-4e8bz4sk.authentication.us10.hana.ondemand.com/oauth/token",
  },
  {
    id: "A-1043",
    timestamp: "2026-11-05T14:20:00Z",
    user: "Tomás Herrera",
    area: "Analysis",
    action: "Ran SoD Analysis",
    object: "Live SAP Roles · HMF-100",
    after: "Analysis complete across all active SAP S/4HANA roles",
  },
];
