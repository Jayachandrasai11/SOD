import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  Database,
  ExternalLink,
  Search,
  Filter,
  RefreshCw,
  Cpu,
  Layers,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  ShieldAlert,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Zap,
  Square,
  Check,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/common";
import { ColumnHeaderFilter } from "@/components/ColumnHeaderFilter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/misc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getFioriApps,
  getFioriStats,
  extractAuthApps,
  enrichAppsWithLlm,
  performSemanticSearch,
  startChunkedEnrichJob,
  getFioriJobStatus,
  cancelFioriJob,
  type FioriAppItem,
  type FioriStats,
  type FioriJobStatus,
} from "@/services/fioriService";

export default function FioriCatalogPage() {
  const navigate = useNavigate();
  const [stats, setStats] = React.useState<FioriStats | null>(null);
  const [apps, setApps] = React.useState<FioriAppItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = React.useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Filters & Pagination
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState("ALL");
  const [status, setStatus] = React.useState("ALL");
  const [sortBy, setSortBy] = React.useState<"RoleCount" | "AppId" | "AppName" | "ActionCategory">("RoleCount");
  const [sortDir, setSortDir] = React.useState<"ASC" | "DESC">("DESC");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(15);
  const [totalPages, setTotalPages] = React.useState(1);
  const [totalCount, setTotalCount] = React.useState(0);

  // Collapsible Summary & AI Smart Search (both collapsed by default for cleaner table focus)
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [smartSearchOpen, setSmartSearchOpen] = React.useState(false);
  const [semanticMode, setSemanticMode] = React.useState(false);
  const [semanticQuery, setSemanticQuery] = React.useState("");
  const [semanticResults, setSemanticResults] = React.useState<FioriAppItem[]>([]);
  const [semanticSearching, setSemanticSearching] = React.useState(false);

  // Background Chunked Pipeline Job State
  const [jobStatus, setJobStatus] = React.useState<FioriJobStatus | null>(null);

  // Load Data
  const loadStats = React.useCallback(async () => {
    try {
      const data = await getFioriStats();
      setStats(data);
    } catch (e: any) {
      console.error("Failed to load stats:", e);
    }
  }, []);

  const loadApps = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await getFioriApps({
        page,
        pageSize,
        search,
        category,
        status,
        sortBy,
        sortDir,
      });
      setApps(res.data);
      setTotalPages(res.totalPages);
      setTotalCount(res.total);
    } catch (e: any) {
      console.error("Failed to load apps:", e);
      setFeedbackMsg({ type: "error", text: e.message || "Failed to load apps" });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, category, status, sortBy, sortDir]);

  const toggleSort = (col: string) => {
    const valid = col as "RoleCount" | "AppId" | "AppName" | "ActionCategory";
    if (sortBy === valid) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortBy(valid);
      setSortDir(valid === "RoleCount" ? "DESC" : "ASC");
    }
    setPage(1);
  };

  React.useEffect(() => {
    loadStats();
  }, [loadStats]);

  React.useEffect(() => {
    if (!semanticMode) {
      loadApps();
    }
  }, [loadApps, semanticMode]);

  // Check initial background job status on mount (only show card if actively running)
  React.useEffect(() => {
    getFioriJobStatus()
      .then((s) => {
        if (s.status === "running") setJobStatus(s);
      })
      .catch(() => {});
  }, []);

  // Auto-hide progress card 5 seconds after job finishes (completed, cancelled, or failed)
  React.useEffect(() => {
    if (!jobStatus || jobStatus.status === "idle" || jobStatus.status === "running") return;
    const hideTimer = setTimeout(() => {
      setJobStatus(null);
    }, 5000);
    return () => clearTimeout(hideTimer);
  }, [jobStatus?.status]);

  // Poll job status every 2 seconds while running and refresh stats/table per chunk
  React.useEffect(() => {
    if (jobStatus?.status !== "running") return;
    const timer = setInterval(async () => {
      try {
        const next = await getFioriJobStatus();
        setJobStatus((prev) => {
          if (prev && next.successCount !== prev.successCount) {
            loadStats();
            if (!semanticMode) loadApps();
          }
          return next;
        });
        if (next.status !== "running") {
          loadStats();
          if (!semanticMode) loadApps();
          if (next.status === "completed") {
            setFeedbackMsg({
              type: "success",
              text: `Chunked AI Pipeline complete! Enriched & vectorized ${next.successCount} apps into pgvector.`,
            });
          } else if (next.status === "cancelled") {
            setFeedbackMsg({
              type: "info",
              text: `Pipeline stopped. Saved ${next.successCount} enriched apps to pgvector.`,
            });
          } else if (next.status === "failed") {
            setFeedbackMsg({
              type: "error",
              text: `Pipeline failed: ${next.lastError || "Unknown error"}`,
            });
          }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [jobStatus?.status, loadStats, loadApps, semanticMode]);

  // Handler: 1-Click Copy from RoleAuthorizations -> Safe Rate-Limited Chunked Gemini -> pgvector
  const handleStartChunkedPipeline = async (limit: number) => {
    setActionLoading("chunked");
    try {
      const res = await startChunkedEnrichJob({ chunkSize: 25, maxApps: limit, copyFirst: true });
      setJobStatus(res.job);
      setFeedbackMsg({
        type: "info",
        text: `Started safe chunked pipeline: processing up to ${limit} pending apps in chunks of 25 (4.5s RPM pacing)...`,
      });
    } catch (e: any) {
      setFeedbackMsg({ type: "error", text: e.message || "Failed to start chunked pipeline" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelJob = async () => {
    try {
      const res = await cancelFioriJob();
      setJobStatus(res.state);
      setFeedbackMsg({ type: "info", text: res.message });
    } catch (e: any) {
      setFeedbackMsg({ type: "error", text: e.message || "Failed to cancel job" });
    }
  };

  // Handler: Extract Live Data from RoleAuthorizations
  const handleExtractAuthApps = async () => {
    setActionLoading("extract");
    setFeedbackMsg({ type: "info", text: "Scanning RoleAuthorizations for distinct T-Codes & Fiori IDs..." });
    try {
      const result = await extractAuthApps();
      setFeedbackMsg({
        type: "success",
        text: `Extraction Complete! Processed ${result.totalExtracted} distinct apps (${result.newInserted} new, ${result.existingUpdated} updated).`,
      });
      await loadStats();
      await loadApps();
    } catch (e: any) {
      setFeedbackMsg({ type: "error", text: e.message || "Extraction failed" });
    } finally {
      setActionLoading(null);
    }
  };

  // Handler: Enrich Batch with Gemini LLM & Vector Embeddings
  const handleEnrichBatch = async (limit = 5) => {
    setActionLoading("enrich");
    setFeedbackMsg({
      type: "info",
      text: `Connecting to Gemini 2.5 Flash & computing 768-dim vector embeddings for ${limit} applications...`,
    });
    try {
      const result = await enrichAppsWithLlm({ limit });
      setFeedbackMsg({
        type: "success",
        text: `AI Enrichment Complete! Enriched ${result.successCount} apps with descriptions, CRUD classifications, and pgvector embeddings.`,
      });
      await loadStats();
      await loadApps();
    } catch (e: any) {
      setFeedbackMsg({ type: "error", text: e.message || "Enrichment failed" });
    } finally {
      setActionLoading(null);
    }
  };

  // Handler: Single App Enrichment
  const handleEnrichSingle = async (appId: string) => {
    setActionLoading(`single-${appId}`);
    try {
      const result = await enrichAppsWithLlm({ appIds: [appId], forceReenrich: true });
      if (result.successCount > 0) {
        setFeedbackMsg({ type: "success", text: `App ${appId} successfully enriched and vectorized!` });
        await loadStats();
        if (semanticMode) {
          handleExecuteSemanticSearch();
        } else {
          await loadApps();
        }
      } else {
        setFeedbackMsg({ type: "error", text: `Enrichment failed for ${appId}` });
      }
    } catch (e: any) {
      setFeedbackMsg({ type: "error", text: e.message || "Single enrichment failed" });
    } finally {
      setActionLoading(null);
    }
  };

  // Handler: Execute Natural Language Vector Search (returns all matching vectors)
  const handleExecuteSemanticSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!semanticQuery.trim()) return;

    setSemanticSearching(true);
    try {
      const res = await performSemanticSearch(semanticQuery.trim(), 0);
      setSemanticResults(res.results);
      setSemanticMode(true);
      setPage(1);
    } catch (e: any) {
      setFeedbackMsg({ type: "error", text: e.message || "Semantic search failed" });
    } finally {
      setSemanticSearching(false);
    }
  };

  const handleClearSemanticSearch = () => {
    setSemanticMode(false);
    setSemanticQuery("");
    setSemanticResults([]);
    setPage(1);
    loadApps();
  };

  // Apply column header filters onto AI Smart Search results as well
  const filteredSemanticResults = React.useMemo(() => {
    if (!semanticMode) return [];
    const q = search.trim().toLowerCase();
    return semanticResults.filter((item) => {
      if (category !== "ALL" && item.ActionCategory !== category) return false;
      if (status !== "ALL" && item.Status !== status) return false;
      if (q) {
        const hay = `${item.AppId} ${item.TCode} ${item.AppName || ""} ${item.OneLineDescription || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [semanticMode, semanticResults, search, category, status]);

  const activeRows = React.useMemo(() => {
    if (!semanticMode) return apps;
    const start = (page - 1) * pageSize;
    return filteredSemanticResults.slice(start, start + pageSize);
  }, [semanticMode, apps, filteredSemanticResults, page, pageSize]);

  const effectiveTotal = semanticMode ? filteredSemanticResults.length : totalCount;
  const effectiveTotalPages = semanticMode ? Math.max(1, Math.ceil(filteredSemanticResults.length / pageSize)) : totalPages;

  // Helper Badge Renderers (Refined Enterprise Tinted Palette)
  const renderActionBadge = (cat: string) => {
    switch (cat) {
      case "CREATE":
        return (
          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 font-medium tracking-wide">
            CREATE
          </Badge>
        );
      case "UPDATE":
        return (
          <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800 font-medium tracking-wide">
            UPDATE
          </Badge>
        );
      case "DELETE":
        return (
          <Badge className="bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800 font-medium tracking-wide">
            DELETE
          </Badge>
        );
      case "READ_ONLY":
        return (
          <Badge className="bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800 font-medium tracking-wide">
            READ_ONLY
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground border-dashed">
            PENDING
          </Badge>
        );
    }
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: "SAP Fiori & T-Code AI Catalog" }]}
        title="SAP Fiori & T-Code AI Catalog"
        actions={
          <div className="flex items-center gap-2">
            {jobStatus?.status === "running" ? (
              <Button
                variant="destructive"
                onClick={handleCancelJob}
                className="gap-2 shadow-sm"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Stop
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    disabled={actionLoading !== null}
                    className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
                    title="Choose how many apps to send to AI"
                  >
                    {actionLoading === "chunked" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {stats && stats.pendingCount > 0
                      ? `Send to AI (${stats.pendingCount} left)`
                      : "Send to AI"}
                    <ChevronDown className="h-3.5 w-3.5 opacity-80" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    How many apps to send?
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleStartChunkedPipeline(50)}>
                    Send 50 apps
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleStartChunkedPipeline(100)} className="font-medium">
                    Send 100 apps (Recommended)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleStartChunkedPipeline(200)}>
                    Send 200 apps
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              variant="outline"
              onClick={() => {
                loadStats();
                if (semanticMode) handleExecuteSemanticSearch();
                else loadApps();
              }}
              className="gap-1.5"
              title="Refresh table"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Live Chunked Background Pipeline Progress Card */}
      {jobStatus && jobStatus.status !== "idle" && (
        <Card className="mb-4 p-4 border-indigo-500/30 bg-indigo-500/[0.04]">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              {jobStatus.status === "running" ? (
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              ) : jobStatus.status === "completed" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-amber-600" />
              )}
              <span className="text-sm font-semibold">
                {jobStatus.status === "running"
                  ? jobStatus.phase === "copying"
                    ? "Step 1/2: Copying distinct apps from RoleAuthorizations..."
                    : `Step 2/2: Chunked Gemini + pgvector (${jobStatus.currentChunk} / ${jobStatus.totalChunks} chunks)`
                  : `Chunked AI Pipeline ${jobStatus.status.toUpperCase()}`}
              </span>
              <Badge variant="outline" className="font-mono text-[11px]">
                {jobStatus.processedCount} / {jobStatus.totalToProcess} apps
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {jobStatus.successCount} saved to pgvector
              </span>
              {jobStatus.errorCount > 0 && (
                <span className="text-rose-600 dark:text-rose-400 font-medium">
                  {jobStatus.errorCount} errors
                </span>
              )}
              {jobStatus.status !== "running" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setJobStatus(null)}
                  title="Dismiss"
                >
                  ×
                </Button>
              )}
            </div>
          </div>
          <Progress
            value={
              jobStatus.totalToProcess > 0
                ? Math.round((jobStatus.processedCount / jobStatus.totalToProcess) * 100)
                : jobStatus.status === "completed"
                ? 100
                : 5
            }
            className="h-2"
          />
        </Card>
      )}

      {/* Status Feedback Toast/Banner */}
      {feedbackMsg && (
        <div
          className={`mb-4 flex items-center justify-between rounded-lg border p-3 text-sm transition-all ${
            feedbackMsg.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
              : feedbackMsg.type === "error"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300"
              : "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMsg.type === "success" && <CheckCircle2 className="h-4 w-4" />}
            {feedbackMsg.type === "error" && <AlertCircle className="h-4 w-4" />}
            {feedbackMsg.type === "info" && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{feedbackMsg.text}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-transparent"
            onClick={() => setFeedbackMsg(null)}
          >
            ×
          </Button>
        </div>
      )}

      {/* Compact Side-by-Side Row: Total Apps + AI Smart Search */}
      <div className="mb-4 flex flex-wrap items-start gap-3">
        {/* Left: Compact Total Apps + Rich Collapsible Breakdown */}
        <Card className={cn("shadow-xs border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 transition-all", summaryOpen ? "w-full lg:w-[540px]" : "w-full sm:w-auto")}>
          <div className="flex items-center justify-between gap-4 px-3.5 py-2">
            <button
              type="button"
              onClick={() => setSummaryOpen((o) => !o)}
              className="flex items-center gap-2 text-left"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600/10 text-blue-700 dark:text-blue-300 shrink-0">
                <Database className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-semibold whitespace-nowrap">Total Apps</span>
              <Badge className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800 font-mono text-xs px-2">
                {stats?.totalApps ?? "—"}
              </Badge>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSummaryOpen((o) => !o)}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              {summaryOpen ? (
                <>
                  Close <ChevronUp className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  Open <ChevronDown className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>

          {summaryOpen && (
            <div className="px-3.5 pb-3.5 pt-2.5 border-t space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">Catalog Breakdown (click any card to filter)</span>
                {category !== "ALL" && (
                  <button
                    type="button"
                    onClick={() => {
                      setCategory("ALL");
                      setPage(1);
                    }}
                    className="text-primary hover:underline font-medium"
                  >
                    Show all
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="rounded-lg border border-indigo-500/25 bg-indigo-50/50 dark:bg-indigo-950/30 p-2.5">
                  <div className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                    AI Completed
                  </div>
                  <div className="mt-0.5 text-base font-bold text-indigo-950 dark:text-indigo-200">
                    {stats?.vectorCount ?? 0}
                    <span className="text-xs font-normal text-muted-foreground"> / {stats?.totalApps ?? 0}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">Ready for AI search</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSemanticMode(false);
                    setCategory("CREATE");
                    setPage(1);
                  }}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors hover:bg-emerald-500/10",
                    category === "CREATE" && "border-emerald-500 bg-emerald-500/10",
                  )}
                >
                  <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                    Create
                  </div>
                  <div className="mt-0.5 text-base font-bold text-emerald-600 dark:text-emerald-400">
                    {stats?.createCount ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">New records</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSemanticMode(false);
                    setCategory("UPDATE");
                    setPage(1);
                  }}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors hover:bg-amber-500/10",
                    category === "UPDATE" && "border-amber-500 bg-amber-500/10",
                  )}
                >
                  <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                    Update / Change
                  </div>
                  <div className="mt-0.5 text-base font-bold text-amber-600 dark:text-amber-400">
                    {stats?.updateCount ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Modify or post</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSemanticMode(false);
                    setCategory("DELETE");
                    setPage(1);
                  }}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors hover:bg-rose-500/10",
                    category === "DELETE" && "border-rose-500 bg-rose-500/10",
                  )}
                >
                  <div className="text-[10px] font-semibold text-rose-700 dark:text-rose-400 uppercase tracking-wider">
                    Delete
                  </div>
                  <div className="mt-0.5 text-base font-bold text-rose-600 dark:text-rose-400">
                    {stats?.deleteCount ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Cancel or remove</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSemanticMode(false);
                    setCategory("READ_ONLY");
                    setPage(1);
                  }}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors hover:bg-sky-500/10",
                    category === "READ_ONLY" && "border-sky-500 bg-sky-500/10",
                  )}
                >
                  <div className="text-[10px] font-semibold text-sky-700 dark:text-sky-400 uppercase tracking-wider">
                    Read Only
                  </div>
                  <div className="mt-0.5 text-base font-bold text-sky-600 dark:text-sky-400">
                    {stats?.readOnlyCount ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Display & reports</div>
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Right: Compact AI Smart Search + Rich Collapsible Panel */}
        <Card
          className={cn(
            "border-indigo-200/80 dark:border-indigo-800/60 bg-indigo-50/40 dark:bg-indigo-950/25 shadow-xs transition-all",
            smartSearchOpen || semanticMode ? "w-full lg:w-[540px]" : "w-full sm:w-auto",
          )}
        >
          <div className="flex items-center justify-between gap-4 px-3.5 py-2">
            <button
              type="button"
              onClick={() => setSmartSearchOpen((o) => !o)}
              className="flex items-center gap-2 text-left"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600/10 text-indigo-700 dark:text-indigo-300 shrink-0">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-semibold whitespace-nowrap">AI Smart Search</span>
            </button>
            <div className="flex items-center gap-1.5 shrink-0">
              {semanticMode && (
                <Button type="button" variant="ghost" size="sm" onClick={handleClearSemanticSearch} className="h-7 px-2 text-xs">
                  Clear
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSmartSearchOpen((o) => !o)}
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {smartSearchOpen ? (
                  <>
                    Close <ChevronUp className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    Open <ChevronDown className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {(smartSearchOpen || semanticMode) && (
            <div className="px-3.5 pb-3.5 pt-2.5 flex flex-col gap-2.5 border-t border-indigo-500/10">
              <div className="text-xs text-muted-foreground">
                Describe what you want to do in plain English to find matching SAP apps:
              </div>
              <form onSubmit={handleExecuteSemanticSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={semanticQuery}
                    onChange={(e) => setSemanticQuery(e.target.value)}
                    placeholder="e.g. 'Create purchase order', 'approve vendor payments'..."
                    className="pl-9 pr-3 h-9 border-indigo-500/20 focus-visible:ring-indigo-500"
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={semanticSearching || !semanticQuery.trim()}
                  className="gap-1.5 h-9 px-3 bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {semanticSearching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Search
                </Button>
              </form>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Try:</span>
                {["Create purchase order", "Approve vendor payments", "Manage warehouse stock"].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setSemanticQuery(sample)}
                    className="rounded-full border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-indigo-400 transition-colors"
                  >
                    {sample}
                  </button>
                ))}
              </div>

              {semanticMode && (
                <div className="flex items-center justify-between gap-2 text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1.5 rounded-md border border-indigo-200 dark:border-indigo-900">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                    <span>
                      Showing <strong>{semanticResults.length}</strong> best matches for:{" "}
                      <em>"{semanticQuery}"</em>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearSemanticSearch}
                    className="font-medium underline hover:no-underline shrink-0"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Applications Catalog Table */}
      <Card className="overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-100/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-14 text-center">
                  <ColumnHeaderFilter
                    title="#"
                    isActive={pageSize !== 15}
                    hoverClassName="hover:bg-slate-200/80 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                    onReset={() => {
                      setPageSize(15);
                      setPage(1);
                    }}
                  >
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                        Rows per page
                      </div>
                      {[15, 30, 50, 100].map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => {
                            setPageSize(sz);
                            setPage(1);
                          }}
                          className={cn(
                            "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                            pageSize === sz
                              ? "bg-primary/10 text-primary font-medium"
                              : "hover:bg-muted text-foreground",
                          )}
                        >
                          <span>{sz} rows</span>
                          {pageSize === sz && <Check className="h-3 w-3 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </ColumnHeaderFilter>
                </TableHead>
                <TableHead className="w-36">
                  <ColumnHeaderFilter
                    title="App / T-Code"
                    isActive={!!search || sortBy === "AppId"}
                    hoverClassName="hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-300"
                    onReset={() => {
                      setSearch("");
                      if (sortBy === "AppId") {
                        setSortBy("RoleCount");
                        setSortDir("DESC");
                      }
                      setPage(1);
                    }}
                    sortField="AppId"
                    currentSortField={sortBy}
                    sortOrder={sortDir === "ASC" ? "asc" : "desc"}
                    onSort={toggleSort}
                  >
                    <div className="space-y-2">
                      <Input
                        placeholder="Search T-Code (e.g. ME21N)..."
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                        className="h-7 text-xs bg-background"
                        autoFocus
                      />
                      <div className="pt-1 border-t border-border/50">
                        <div className="text-[10px] text-muted-foreground font-medium mb-1">Quick prefixes:</div>
                        <div className="flex flex-wrap gap-1">
                          {["ME", "VA", "FB", "S_", "/SCWM/", "Z"].map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                setSearch(p);
                                setPage(1);
                              }}
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors",
                                search === p
                                  ? "bg-primary text-primary-foreground font-semibold"
                                  : "bg-muted hover:bg-accent text-foreground",
                              )}
                            >
                              {p}*
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </ColumnHeaderFilter>
                </TableHead>
                <TableHead className="w-56">
                  <ColumnHeaderFilter
                    title="SAP Application Name"
                    isActive={!!search || sortBy === "AppName"}
                    hoverClassName="hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-950/60 dark:hover:text-sky-300"
                    onReset={() => {
                      setSearch("");
                      if (sortBy === "AppName") {
                        setSortBy("RoleCount");
                        setSortDir("DESC");
                      }
                      setPage(1);
                    }}
                    sortField="AppName"
                    currentSortField={sortBy}
                    sortOrder={sortDir === "ASC" ? "asc" : "desc"}
                    onSort={toggleSort}
                  >
                    <Input
                      placeholder="Search app name..."
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      className="h-7 text-xs bg-background"
                      autoFocus
                    />
                  </ColumnHeaderFilter>
                </TableHead>
                <TableHead className="min-w-[280px]">
                  <ColumnHeaderFilter
                    title="AI Description"
                    isActive={!!search}
                    hoverClassName="hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-950/60 dark:hover:text-teal-300"
                    onReset={() => {
                      setSearch("");
                      setPage(1);
                    }}
                  >
                    <Input
                      placeholder="Search description keyword..."
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      className="h-7 text-xs bg-background"
                      autoFocus
                    />
                  </ColumnHeaderFilter>
                </TableHead>
                <TableHead className="w-36 text-center">
                  <ColumnHeaderFilter
                    title="Access Type"
                    isActive={category !== "ALL" || sortBy === "ActionCategory"}
                    hoverClassName="hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300"
                    onReset={() => {
                      setCategory("ALL");
                      if (sortBy === "ActionCategory") {
                        setSortBy("RoleCount");
                        setSortDir("DESC");
                      }
                      setPage(1);
                    }}
                    sortField="ActionCategory"
                    currentSortField={sortBy}
                    sortOrder={sortDir === "ASC" ? "asc" : "desc"}
                    onSort={toggleSort}
                  >
                    <div className="space-y-1">
                      {[
                        { value: "ALL", label: "All Access Types" },
                        { value: "CREATE", label: "Create" },
                        { value: "UPDATE", label: "Update / Change" },
                        { value: "DELETE", label: "Delete" },
                        { value: "READ_ONLY", label: "Read Only" },
                        { value: "PENDING", label: "Not Analyzed" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setCategory(opt.value);
                            setPage(1);
                          }}
                          className={cn(
                            "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                            category === opt.value
                              ? "bg-primary/10 text-primary font-medium"
                              : "hover:bg-muted text-foreground",
                          )}
                        >
                          <span>{opt.label}</span>
                          {category === opt.value && <Check className="h-3 w-3 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </ColumnHeaderFilter>
                </TableHead>
                <TableHead className="w-36 text-center">
                  <ColumnHeaderFilter
                    title="Vector Status"
                    isActive={status !== "ALL"}
                    hoverClassName="hover:bg-violet-50 hover:text-violet-700 dark:hover:bg-violet-950/60 dark:hover:text-violet-300"
                    onReset={() => {
                      setStatus("ALL");
                      setPage(1);
                    }}
                  >
                    <div className="space-y-1">
                      {[
                        { value: "ALL", label: "All Status" },
                        { value: "Enriched", label: "AI Completed" },
                        { value: "Extracted", label: "Pending AI" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setStatus(opt.value);
                            setPage(1);
                          }}
                          className={cn(
                            "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                            status === opt.value
                              ? "bg-primary/10 text-primary font-medium"
                              : "hover:bg-muted text-foreground",
                          )}
                        >
                          <span>{opt.label}</span>
                          {status === opt.value && <Check className="h-3 w-3 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </ColumnHeaderFilter>
                </TableHead>
                <TableHead className="w-28 text-center">
                  <ColumnHeaderFilter
                    title="Role Usage"
                    isActive={sortBy === "RoleCount" && sortDir === "ASC"}
                    sortField="RoleCount"
                    currentSortField={sortBy}
                    sortOrder={sortDir === "ASC" ? "asc" : "desc"}
                    onSort={toggleSort}
                    align="end"
                    hoverClassName="hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/60 dark:hover:text-amber-300"
                    onReset={() => {
                      setSortBy("RoleCount");
                      setSortDir("DESC");
                      setPage(1);
                    }}
                  >
                    <div className="text-[11px] text-muted-foreground">
                      Default order shows the most-used SAP apps first.
                    </div>
                  </ColumnHeaderFilter>
                </TableHead>
                <TableHead className="w-28 text-right">
                  <span className="inline-block rounded-md px-2 py-0.5 -mr-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-all duration-150 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/60 dark:hover:text-rose-300">
                    Actions
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !semanticMode ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary mb-2" />
                    Loading applications catalog...
                  </TableCell>
                </TableRow>
              ) : activeRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center">
                    <EmptyState
                      icon={Database}
                      title={
                        semanticMode
                          ? "No semantic matches found. Try rephrasing your search query or adjusting column filters."
                          : "No applications found. Adjust your search filters or click Send to AI."
                      }
                      action={
                        !semanticMode ? (
                          <Button onClick={handleExtractAuthApps} variant="outline" size="sm">
                            Extract Auth Apps
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                activeRows.map((item, idx) => (
                  <TableRow
                    key={item.AppId}
                    onClick={() => navigate(`/fiori/detail?appId=${encodeURIComponent(item.AppId)}`)}
                    className="hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    {/* Column 0: Row Number */}
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">
                      {(page - 1) * pageSize + idx + 1}
                    </TableCell>

                    {/* Column 1: TCode & App ID */}
                    <TableCell className="font-mono font-medium">
                      <div className="flex flex-col">
                        <span className="text-foreground">{item.TCode}</span>
                        {item.AppId !== item.TCode && (
                          <span className="text-[10px] text-muted-foreground">{item.AppId}</span>
                        )}
                      </div>
                    </TableCell>

                    {/* Column 2: SAP App Name & Fiori Reference Link */}
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-sm text-foreground">
                          {item.AppName || item.TCode}
                        </span>
                        <a
                          href={item.FioriLibraryUrl || "https://fioriappslibrary.hana.ondemand.com"}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline w-fit"
                        >
                          SAP Fiori Apps Library
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </TableCell>

                    {/* Column 3: One Line Description */}
                    <TableCell>
                      {item.OneLineDescription ? (
                        <div className="text-xs text-muted-foreground leading-relaxed">
                          {item.OneLineDescription}
                          {item.similarity !== undefined && (
                            <div className="mt-1">
                              <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-indigo-200">
                                Match: {(item.similarity * 100).toFixed(1)}% Cosine
                              </Badge>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">
                          Pending AI description — click Send to AI
                        </span>
                      )}
                    </TableCell>

                    {/* Column 4: CRUD Action Category */}
                    <TableCell className="text-center">
                      {renderActionBadge(item.ActionCategory)}
                    </TableCell>

                    {/* Column 5: Vector Status */}
                    <TableCell className="text-center">
                      {item.hasVector || item.Status === "Enriched" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                          <Sparkles className="h-3 w-3" />
                          vector(768)
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {/* Column 6: Role Usage */}
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {item.RoleCount} {item.RoleCount === 1 ? "role" : "roles"}
                        </Badge>
                        {item.SampleRoles && item.SampleRoles.length > 0 && (
                          <span
                            className="text-[10px] text-muted-foreground truncate max-w-[100px] mt-0.5"
                            title={item.SampleRoles.join(", ")}
                          >
                            {item.SampleRoles[0]}
                            {item.SampleRoles.length > 1 ? ` +${item.SampleRoles.length - 1}` : ""}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Column 7: Actions */}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={actionLoading !== null}
                        onClick={() => handleEnrichSingle(item.AppId)}
                        className="h-8 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10"
                        title="Send this app to AI & update pgvector"
                      >
                        {actionLoading === `single-${item.AppId}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 mr-1" />
                            {item.Status === "Enriched" ? "Resend to AI" : "Send to AI"}
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Bar (Works for both catalog & AI Smart Search) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-xs text-muted-foreground bg-muted/20">
          <div className="flex items-center gap-3">
            <span>
              Showing {activeRows.length} of {effectiveTotal} applications · Page {page} of {effectiveTotalPages}
            </span>
            {(search || category !== "ALL" || status !== "ALL") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setCategory("ALL");
                  setStatus("ALL");
                  setPage(1);
                }}
                className="h-6 px-2 text-xs text-primary hover:text-primary"
              >
                Clear filters
              </Button>
            )}
          </div>
          {effectiveTotalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="h-7 w-7 p-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 font-medium text-foreground">{page}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(effectiveTotalPages, p + 1))}
                disabled={page >= effectiveTotalPages}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
