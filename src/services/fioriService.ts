/**
 * Frontend Service for SAP Fiori Apps & AI Vector Knowledge Catalog.
 * All requests route strictly through dedicated backend APIs (never directly to LLM).
 */

export interface FioriAppItem {
  AppId: string;
  TCode: string;
  AppName: string | null;
  OneLineDescription: string | null;
  ActionCategory: "CREATE" | "UPDATE" | "DELETE" | "READ_ONLY" | "PENDING";
  FioriLibraryUrl: string | null;
  RoleCount: number;
  SampleRoles: string[];
  Status: "Extracted" | "Enriched" | "Failed";
  hasVector?: boolean;
  similarity?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface FioriCatalogResponse {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  data: FioriAppItem[];
}

export interface FioriStats {
  totalApps: number;
  enrichedCount: number;
  pendingCount: number;
  createCount: number;
  updateCount: number;
  deleteCount: number;
  readOnlyCount: number;
  vectorCount: number;
}

export interface ExtractResult {
  success: boolean;
  message: string;
  totalExtracted: number;
  newInserted: number;
  existingUpdated: number;
  totalCatalogApps: number;
}

export interface EnrichResult {
  success: boolean;
  processed: number;
  successCount: number;
  errorCount: number;
  results: Array<{
    appId: string;
    tcode?: string;
    appName?: string;
    oneLineDescription?: string;
    actionCategory?: string;
    status: string;
    hasVector?: boolean;
    error?: string;
  }>;
}

const API_BASE = "";

export async function getFioriStats(): Promise<FioriStats> {
  const res = await fetch(`${API_BASE}/api/fiori/stats`);
  if (!res.ok) {
    throw new Error(`Failed to fetch Fiori stats (${res.status})`);
  }
  return res.json();
}

export async function getFioriApps(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  status?: string;
  sortBy?: string;
  sortDir?: "ASC" | "DESC";
}): Promise<FioriCatalogResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.search) query.set("search", params.search);
  if (params.category && params.category !== "ALL") query.set("category", params.category);
  if (params.status && params.status !== "ALL") query.set("status", params.status);
  if (params.sortBy) query.set("sortBy", params.sortBy);
  if (params.sortDir) query.set("sortDir", params.sortDir);

  const res = await fetch(`${API_BASE}/api/fiori/apps?${query.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch Fiori apps (${res.status})`);
  }
  return res.json();
}

export async function extractAuthApps(): Promise<ExtractResult> {
  const res = await fetch(`${API_BASE}/api/fiori/extract-auth-apps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to extract apps (${res.status})`);
  }
  return res.json();
}

export async function enrichAppsWithLlm(options: {
  limit?: number;
  appIds?: string[];
  forceReenrich?: boolean;
} = {}): Promise<EnrichResult> {
  const res = await fetch(`${API_BASE}/api/fiori/enrich-with-llm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to enrich apps with LLM (${res.status})`);
  }
  return res.json();
}

export async function performSemanticSearch(query: string, limit = 0): Promise<{
  success: boolean;
  query: string;
  count: number;
  results: FioriAppItem[];
}> {
  const res = await fetch(`${API_BASE}/api/fiori/semantic-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Semantic vector search failed (${res.status})`);
  }
  return res.json();
}

export interface FioriJobStatus {
  jobId: string | null;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  phase: "idle" | "copying" | "enriching" | "done";
  totalToProcess: number;
  processedCount: number;
  successCount: number;
  errorCount: number;
  currentChunk: number;
  totalChunks: number;
  chunkSize: number;
  copiedStats?: ExtractResult | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  recentErrors: string[];
}

export async function startChunkedEnrichJob(options: {
  chunkSize?: number;
  maxApps?: number | null;
  forceReenrich?: boolean;
  copyFirst?: boolean;
} = {}): Promise<{ success: boolean; message: string; job: FioriJobStatus }> {
  const res = await fetch(`${API_BASE}/api/fiori/enrich-all-chunked`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) {
    throw new Error(data.error || data.message || `Failed to start chunked job (${res.status})`);
  }
  return data;
}

export async function getFioriJobStatus(): Promise<FioriJobStatus> {
  const res = await fetch(`${API_BASE}/api/fiori/job-status`);
  if (!res.ok) {
    throw new Error(`Failed to fetch job status (${res.status})`);
  }
  return res.json();
}

export async function cancelFioriJob(): Promise<{ cancelled: boolean; message: string; state: FioriJobStatus }> {
  const res = await fetch(`${API_BASE}/api/fiori/job-cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to cancel job (${res.status})`);
  }
  return res.json();
}

export interface FioriAppDetailResponse {
  app: FioriAppItem;
  roles: Array<{
    AgrName: string;
    RoleDesc: string;
    RoleType: string;
    ParentAgr: string;
  }>;
  users: Array<{
    Uname: string;
    FullName: string;
    Department: string;
    Locked: boolean;
    AgrName: string;
  }>;
  authObjects: Array<{
    Object: string;
    Field: string;
    Low: string;
    High: string;
    RoleCount: number;
  }>;
  relatedApps: Array<{
    AppId: string;
    TCode: string;
    AppName: string | null;
    OneLineDescription: string | null;
    ActionCategory: string;
    RoleCount: number;
    similarity: number;
  }>;
}

export async function getFioriAppDetail(appId: string): Promise<FioriAppDetailResponse> {
  const res = await fetch(`${API_BASE}/api/fiori/app-detail?appId=${encodeURIComponent(appId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to load app details (${res.status})`);
  }
  return res.json();
}

