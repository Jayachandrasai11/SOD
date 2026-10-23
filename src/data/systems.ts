import type { SapSystem, SyncRun } from "@/types";

export const SYSTEMS: SapSystem[] = [
  {
    id: "S4P-100",
    name: "S4P – Production",
    sid: "S4P",
    client: "100",
    tier: "Prod",
    deployment: "Private Cloud",
    method: "OData API",
    authType: "OAuth 2.0 client credentials",
    host: "s4p.erp.example.internal",
    status: "Warning",
    statusMessage: "Delta sync is 2 days old – last two scheduled runs timed out.",
    lastFullSync: "2026-10-19T01:00:00Z",
    lastDeltaSync: "2026-10-21T02:00:00Z",
    counts: { users: 4_812, roles: 1_947, authRows: 312_540 },
    schedule: { full: "Weekly · Sunday 01:00", delta: "Daily · 02:00" },
  },
  {
    id: "S4D-200",
    name: "S4D – Development",
    sid: "S4D",
    client: "200",
    tier: "Dev",
    deployment: "On-premise",
    method: "RFC agent",
    authType: "Basic",
    host: "s4d.erp.example.internal",
    status: "Connected",
    lastFullSync: "2026-10-19T01:30:00Z",
    lastDeltaSync: "2026-10-23T02:00:00Z",
    counts: { users: 612, roles: 2_204, authRows: 341_118 },
    schedule: { full: "Weekly · Sunday 01:30", delta: "Daily · 02:00" },
  },
];

export const SYNC_RUNS: SyncRun[] = [
  { id: "SY-2210", systemId: "S4P-100", type: "Delta", started: "2026-10-23T02:00:00Z", durationSec: 1800, records: 0, result: "Failed", message: "Timeout after 30 min – OData service /IWFND/ slow" },
  { id: "SY-2209", systemId: "S4D-200", type: "Delta", started: "2026-10-23T02:00:00Z", durationSec: 142, records: 1_284, result: "Success" },
  { id: "SY-2207", systemId: "S4P-100", type: "Delta", started: "2026-10-22T02:00:00Z", durationSec: 1800, records: 0, result: "Failed", message: "Timeout after 30 min" },
  { id: "SY-2206", systemId: "S4D-200", type: "Delta", started: "2026-10-22T02:00:00Z", durationSec: 131, records: 977, result: "Success" },
  { id: "SY-2204", systemId: "S4P-100", type: "Delta", started: "2026-10-21T02:00:00Z", durationSec: 388, records: 4_120, result: "Success" },
  { id: "SY-2203", systemId: "S4D-200", type: "Delta", started: "2026-10-21T02:00:00Z", durationSec: 128, records: 802, result: "Success" },
  { id: "SY-2201", systemId: "S4P-100", type: "Delta", started: "2026-10-20T02:00:00Z", durationSec: 402, records: 3_877, result: "Warning", message: "12 roles skipped – missing S_RFC for function group SUSR" },
  { id: "SY-2199", systemId: "S4D-200", type: "Full", started: "2026-10-19T01:30:00Z", durationSec: 1_540, records: 343_934, result: "Success" },
  { id: "SY-2198", systemId: "S4P-100", type: "Full", started: "2026-10-19T01:00:00Z", durationSec: 2_210, records: 319_299, result: "Success" },
];
