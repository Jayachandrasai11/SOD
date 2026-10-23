// Domain model for MySODAI. Keep these shapes stable – the service layer
// maps real SAP / GRC API payloads onto them later.

export type Status = "red" | "amber" | "green" | "grey";
export type RiskLevel = "Critical" | "High" | "Medium" | "Low";
export type RiskType = "SoD" | "Critical action" | "Critical permission";
export type Process = "Finance" | "Procurement" | "Sales" | "HR" | "Basis";
export const PROCESSES: Process[] = ["Finance", "Procurement", "Sales", "HR", "Basis"];
export const RISK_LEVELS: RiskLevel[] = ["Critical", "High", "Medium", "Low"];
export const RISK_TYPES: RiskType[] = ["SoD", "Critical action", "Critical permission"];

/** An action = a transaction code or Fiori app ID */
export interface Action {
  tcode: string;
  description: string;
}

/** A permission = authorisation object / field / value range */
export interface Permission {
  object: string;
  field: string;
  low: string;
  high?: string;
}

export interface SodFunction {
  id: string;
  name: string;
  process: Process;
  actions: Action[];
  permissions: Permission[];
}

export interface Risk {
  id: string;
  description: string;
  explanation: string;
  process: Process;
  level: RiskLevel;
  type: RiskType;
  functionIds: string[];
  owner: string;
  active: boolean;
}

export type VersionStatus = "Draft" | "Submitted" | "Approved" | "Published";

export interface RulesetVersion {
  version: string;
  status: VersionStatus;
  author: string;
  date: string;
  note: string;
  risks: Risk[];
  functions: SodFunction[];
}

export type Tier = "Dev" | "QA" | "Prod";
export type Deployment = "On-premise" | "Private Cloud" | "Public Cloud";
export type ConnectionMethod = "OData API" | "RFC agent" | "File upload";
export type ConnectionStatus = "Connected" | "Warning" | "Failed";
export type AuthType = "Basic" | "OAuth 2.0 client credentials" | "X.509";

export interface SapSystem {
  id: string;
  name: string;
  sid: string;
  client: string;
  tier: Tier;
  deployment: Deployment;
  method: ConnectionMethod;
  authType: AuthType;
  host: string;
  status: ConnectionStatus;
  statusMessage?: string;
  lastFullSync: string;
  lastDeltaSync: string;
  counts: { users: number; roles: number; authRows: number };
  schedule: { full: string; delta: string };
}

export interface SyncRun {
  id: string;
  systemId: string;
  type: "Full" | "Delta";
  started: string;
  durationSec: number;
  records: number;
  result: "Success" | "Warning" | "Failed";
  message?: string;
}

export type RoleType = "Single" | "Composite" | "Derived";

export interface RoleAuth {
  object: string;
  field: string;
  low: string;
  high?: string;
  proposed?: boolean;
}

export interface OrgLevel {
  field: string;
  label: string;
  low: string;
  high?: string;
  required?: boolean;
}

export interface Role {
  name: string;
  description: string;
  type: RoleType;
  parent?: string;
  children?: string[];
  process: Process;
  owner: string;
  tcodes: string[];
  auths: RoleAuth[];
  orgLevels: OrgLevel[];
  lastChanged: string;
  lastAnalysed?: string;
}

export interface User {
  id: string;
  name: string;
  department: string;
  roles: string[];
  validTo: string;
  locked?: boolean;
}

export interface Mitigation {
  subject: string; // role name or user id
  riskId: string;
  controlId: string;
  control: string;
  validTo: string;
}

/** Where a conflicting action was found and which role grants it */
export interface ActionEvidence {
  tcode: string;
  description: string;
  grantedBy: string[];
  auths: Permission[];
}

export interface FunctionEvidence {
  functionId: string;
  functionName: string;
  actions: ActionEvidence[];
}

export interface RiskHit {
  subject: string;
  subjectKind: "Role" | "User";
  riskId: string;
  description: string;
  process: Process;
  level: RiskLevel;
  type: RiskType;
  status: Status;
  mitigation?: Mitigation;
  functions: FunctionEvidence[];
}

export interface SubjectResult {
  subject: string;
  subjectKind: "Role" | "User";
  status: Status;
  hits: RiskHit[];
}

export interface AnalysisRun {
  runId: string;
  startedAt: string;
  rulesetVersion: string;
  snapshot: string;
  systemId: string;
  scope: string;
  results: SubjectResult[];
}

export type AuditArea = "Rules" | "Connection" | "Analysis" | "Role export" | "Settings";

export interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  area: AuditArea;
  action: string;
  object: string;
  before?: string;
  after?: string;
  reason?: string;
}

export type AppRole = "Administrator" | "Security Analyst" | "Risk Owner" | "Auditor";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
}

export interface Settings {
  levelToStatus: Record<RiskLevel, Exclude<Status, "grey">>;
  mitigatedStatus: "amber" | "green";
  stalenessDays: number;
  namingPrefixes: string[];
  namingPattern: string;
  maxRoleNameLength: number;
}

export interface Tcode {
  tcode: string;
  description: string;
  process: Process;
}
