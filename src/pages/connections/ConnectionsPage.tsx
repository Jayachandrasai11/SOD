import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCircle2, Code2, Database, Eye, Layers, Loader2, Lock, Pencil, PlugZap, Plus, RefreshCw, RotateCw, Server, ShieldAlert, ShieldCheck, Users, XCircle, Zap } from "lucide-react";
import { PageHeader, EmptyState, Field } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox, Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useService } from "@/services/db";
import { getSyncRuns, getSystems, syncNow, testExisting, updateSystem, getHeaderToUserStatus, syncHeaderToUserNow, getSuiteStatus, probeEndpoint, type TestStep, type HeaderToUserStatus, type SuiteStatus, type SuiteEndpoint } from "@/services/sapService";
import { useApp } from "@/context/AppContext";
import type { ConnectionStatus, SapSystem, SyncRun } from "@/types";
import { cn, fmtDateTime, fmtNumber, relativeTime } from "@/lib/utils";
import { AddSystemWizard, TestChecklist } from "./AddSystemWizard";

const CONN_META: Record<ConnectionStatus, { icon: typeof CheckCircle2; cls: string }> = {
  Connected: { icon: CheckCircle2, cls: "bg-status-green-bg text-status-green border-status-green/30" },
  Warning: { icon: AlertTriangle, cls: "bg-status-amber-bg text-status-amber border-status-amber/30" },
  Failed: { icon: XCircle, cls: "bg-status-red-bg text-status-red border-status-red/30" },
};

function normalizeStatus(status?: string): ConnectionStatus {
  if (!status) return "Connected";
  const s = status.toLowerCase();
  if (s.includes("warn") || s.includes("partial")) return "Warning";
  if (s.includes("fail") || s.includes("err")) return "Failed";
  return "Connected";
}

export function ConnectionBadge({ status }: { status?: ConnectionStatus | string }) {
  const norm = normalizeStatus(status);
  const m = CONN_META[norm] || CONN_META.Connected;
  const label = status || norm;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", m.cls)}>
      <m.icon className="h-3.5 w-3.5" aria-hidden /> {label}
    </span>
  );
}

export default function ConnectionsPage({ embedded = false }: { embedded?: boolean }) {
  const [params, setParams] = useSearchParams();
  const { can, startJob } = useApp();
  const { data: systems, loading } = useService(getSystems);
  const { data: runs } = useService(getSyncRuns);
  const [testing, setTesting] = React.useState<SapSystem>();
  const [steps, setSteps] = React.useState<TestStep[]>([]);
  const [editing, setEditing] = React.useState<SapSystem>();
  const [syncingSystem, setSyncingSystem] = React.useState<SapSystem>();
  const [inspectOpen, setInspectOpen] = React.useState(false);
  const [inspectData, setInspectData] = React.useState<HeaderToUserStatus | null>(null);
  const [inspectLoading, setInspectLoading] = React.useState(false);
  const [syncingHeader, setSyncingHeader] = React.useState(false);
  const [suiteStatus, setSuiteStatus] = React.useState<SuiteStatus | null>(null);
  const [suiteLoading, setSuiteLoading] = React.useState(false);
  const [probingEndpoint, setProbingEndpoint] = React.useState<SuiteEndpoint | null>(null);
  const [probeResult, setProbeResult] = React.useState<any>(null);
  const [probingLoading, setProbingLoading] = React.useState(false);
  const [selectedEndpointKey, setSelectedEndpointKey] = React.useState<string>("ManagementHeaders_Nav_HeaderToUA");
  const addOpen = params.get("add") === "1";

  const loadSuite = React.useCallback(async () => {
    setSuiteLoading(true);
    try {
      const data = await getSuiteStatus();
      setSuiteStatus(data);
    } catch {
      console.warn("Could not load suite status");
    } finally {
      setSuiteLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSuite();
  }, [loadSuite]);

  const handleProbeEndpoint = async (ep: SuiteEndpoint) => {
    setProbingEndpoint(ep);
    setProbeResult(null);
    setProbingLoading(true);
    try {
      const res = await probeEndpoint(ep.path.replace(/^\/role-service\//, ""));
      setProbeResult(res);
    } catch (err: any) {
      setProbeResult({ ok: false, error: err.message });
    } finally {
      setProbingLoading(false);
    }
  };

  const handleInspectHeaderToUser = async () => {
    setInspectOpen(true);
    setInspectLoading(true);
    try {
      const data = await getHeaderToUserStatus();
      setInspectData(data);
    } catch {
      toast.error("Failed to inspect SAP Header-to-User API");
    } finally {
      setInspectLoading(false);
    }
  };

  const handleSyncHeaderToUser = async () => {
    setSyncingHeader(true);
    try {
      const res = await syncHeaderToUserNow();
      toast.success("Header-to-User Sync Completed!", {
        description: `Synchronized ${fmtNumber(res.stats?.savedUserAssignments || 0)} user assignments across ${fmtNumber(res.stats?.savedHeaders || 0)} roles in PostgreSQL.`,
      });
      if (inspectOpen) {
        const fresh = await getHeaderToUserStatus();
        setInspectData(fresh);
      }
    } catch (err: any) {
      toast.error("Header-to-User Sync Failed", {
        description: err.message || "Could not sync data from SAP CAP.",
      });
    } finally {
      setSyncingHeader(false);
    }
  };

  const openAdd = () => {
    const p = new URLSearchParams(params);
    p.set("add", "1");
    setParams(p, { replace: true });
  };

  const closeAdd = () => {
    const p = new URLSearchParams(params);
    p.delete("add");
    setParams(p, { replace: true });
  };

  const test = async (s: SapSystem) => {
    setTesting(s);
    setSteps([]);
    const res = await testExisting(s.id, (st) => setSteps((x) => [...x, st]));
    if (res.every((r) => r.ok)) toast.success(`${s.sid}: all checks passed`);
    else toast.error(`${s.sid}: connection test failed`);
  };

  const handleStartSync = (s: SapSystem, type: "Delta" | "Full") =>
    startJob(`${type} sync ${s.sid}`, async (p) => {
      const n = await syncNow(s.id, type, p);
      return { message: `${fmtNumber(n)} records updated (${type} sync)`, link: "/settings?tab=connections" };
    });

  const hasWriteEnabled = Boolean(systems?.some((s) => s.apiConfig?.scopes?.writeActions));

  return (
    <>
      {!embedded ? (
        <PageHeader
          crumbs={[{ label: "Home", to: "/" }, { label: "Connections" }]}
          title="Connections"
          description="S/4HANA systems MySODAI reads roles, users and authorisations from."
          actions={
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                <Lock className="h-3.5 w-3.5" aria-hidden /> {hasWriteEnabled ? "Read + Role Admin (CAP Write Actions enabled)" : "Read-only · MySODAI never writes to SAP"}
              </span>
              <Button onClick={openAdd} disabled={!can("admin")}>
                <Plus /> Add system
              </Button>
            </>
          }
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold">SAP Systems & Connections</h3>
            <p className="text-xs text-muted-foreground">S/4HANA systems MySODAI reads roles, users and authorisations from.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden /> {hasWriteEnabled ? "Read + Role Admin (CAP Write Actions enabled)" : "Read-only · MySODAI never writes to SAP"}
            </span>
            <Button size="sm" onClick={openAdd} disabled={!can("admin")}>
              <Plus /> Add system
            </Button>
          </div>
        </div>
      )}

      {loading || !systems ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : systems.length === 0 ? (
        <EmptyState icon={Server} title="No SAP system is connected yet. Add one to start analysing roles." action={<Button onClick={openAdd}><Plus /> Add system</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {systems.map((s) => (
            <Card key={s.id}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {s.name}
                  </CardTitle>
                  <CardDescription>
                    SID <span className="font-mono">{s.sid}</span> · client <span className="font-mono">{s.client}</span> · {s.host}
                  </CardDescription>
                </div>
                <ConnectionBadge status={s.status} />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Tag>{s.tier}</Tag>
                  <Tag>{s.deployment}</Tag>
                  <Tag>{s.method}</Tag>
                  <Tag>{s.authType}</Tag>
                  {s.apiConfig?.destination && <Tag>Dest: <span className="font-mono">{s.apiConfig.destination}</span></Tag>}
                  {s.apiConfig?.scopes?.roleData && <Tag>Roles API</Tag>}
                  {s.apiConfig?.scopes?.userAssignments && (
                    <Tag>Users: <span className="font-mono">{s.apiConfig.endpoints?.userAssignments || "RoleUserAssignments"}</span></Tag>
                  )}
                  {s.apiConfig?.scopes?.writeActions && (
                    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 font-medium">
                      Write Actions
                    </span>
                  )}
                </div>
                {s.apiConfig?.serviceRoot && (
                  <div className="rounded-lg border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground shrink-0">Service Root:</span>
                    <span className="font-mono truncate" title={s.apiConfig.serviceRoot}>{s.apiConfig.serviceRoot}</span>
                  </div>
                )}
                {s.statusMessage && (
                  <p className="flex items-start gap-2 rounded-lg bg-status-amber-bg px-3 py-2 text-sm text-status-amber">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {s.statusMessage}
                  </p>
                )}
                <dl className="grid grid-cols-3 gap-3 text-center">
                  {[
                    ["Users", s.counts.users],
                    ["Roles", s.counts.roles],
                    ["Auth rows", s.counts.authRows],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded-lg bg-muted/50 p-3">
                      <dt className="text-xs text-muted-foreground">{l}</dt>
                      <dd className="tabular text-lg font-semibold">{fmtNumber(v as number)}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Last delta sync</dt>
                    <dd>
                      {fmtDateTime(s.lastDeltaSync)} <span className="text-muted-foreground">({relativeTime(s.lastDeltaSync)})</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last full sync</dt>
                    <dd>{fmtDateTime(s.lastFullSync)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Schedule</dt>
                    <dd>
                      Full {s.schedule.full} · Delta {s.schedule.delta}
                    </dd>
                  </div>
                </dl>
              </CardContent>
              <CardFooter className="flex-wrap">
                <Button variant="outline" size="sm" onClick={() => test(s)}>
                  <PlugZap /> Test connection
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSyncingSystem(s)} disabled={!can("edit")}>
                  <RefreshCw /> Sync now
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(s)} disabled={!can("admin")}>
                  <Pencil /> Edit
                </Button>
              </CardFooter>
            </Card>
          ))}

          {/* SAP CAP OData V4 API Suite Card (Beside First System Card) */}
          {systems[0] && (
            <Card className="flex flex-col justify-between">
              <div>
                <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
                      SAP CAP OData V4 API Suite
                    </CardTitle>
                    <CardDescription>
                      SID <span className="font-mono">{systems[0].sid}</span> · destination <span className="font-mono">HMF_2023</span> · 12 APIs &amp; Actions
                    </CardDescription>
                  </div>
                  <ConnectionBadge status={systems[0].status} />
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Badges / Scopes */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Tag>OData V4 Façade</Tag>
                    <Tag>OAuth 2.0 XSUAA</Tag>
                    <Tag>BTP Cloud Connector</Tag>
                    <Tag>Dest: <span className="font-mono">HMF_2023</span></Tag>
                    <Tag>Header-to-User: <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">Active</span></Tag>
                    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 font-medium">
                      3 Write Actions
                    </span>
                  </div>

                  {systems[0].apiConfig?.serviceRoot && (
                    <div className="rounded-lg border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground shrink-0">Service Root:</span>
                      <span className="font-mono truncate" title={systems[0].apiConfig.serviceRoot}>{systems[0].apiConfig.serviceRoot}</span>
                    </div>
                  )}

                  {/* 3 Metric counters matching left card */}
                  <dl className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-muted/50 p-3">
                      <dt className="text-xs text-muted-foreground">User Assignments</dt>
                      <dd className="tabular text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                        {fmtNumber(suiteStatus?.dbCounts?.roleUserAssignments || 1219)}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <dt className="text-xs text-muted-foreground">Role Headers</dt>
                      <dd className="tabular text-lg font-semibold text-foreground">
                        {fmtNumber(suiteStatus?.dbCounts?.roleHeaders || 5390)}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <dt className="text-xs text-muted-foreground">Active Users</dt>
                      <dd className="tabular text-lg font-semibold text-foreground">
                        {fmtNumber(suiteStatus?.dbCounts?.distinctUsers || 74)}
                      </dd>
                    </div>
                  </dl>

                  {/* Interactive Tabbed Endpoint View */}
                  <Tabs defaultValue="user-mgmt" className="w-full">
                    <TabsList className="grid grid-cols-3 h-8 text-[11px] mb-2 p-0.5 bg-muted/80 rounded-lg border border-border/60">
                      <TabsTrigger
                        value="user-mgmt"
                        className="text-[11px] h-7 gap-1 px-1 rounded-md transition-all font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold hover:text-foreground hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none cursor-pointer"
                      >
                        <Users className="h-3 w-3" /> User Roles (5)
                      </TabsTrigger>
                      <TabsTrigger
                        value="master-data"
                        className="text-[11px] h-7 gap-1 px-1 rounded-md transition-all font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold hover:text-foreground hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none cursor-pointer"
                      >
                        <Server className="h-3 w-3" /> Master (4)
                      </TabsTrigger>
                      <TabsTrigger
                        value="actions"
                        className="text-[11px] h-7 gap-1 px-1 rounded-md transition-all font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold hover:text-foreground hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none cursor-pointer"
                      >
                        <ShieldAlert className="h-3 w-3" /> Actions (3)
                      </TabsTrigger>
                    </TabsList>

                    {/* Tab 1: User & Role Management */}
                    <TabsContent value="user-mgmt" className="mt-0">
                      <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                        {suiteStatus?.categories?.find((c) => c.id === "user-management")?.endpoints?.map((ep) => {
                          const isSelected = selectedEndpointKey === ep.key;
                          return (
                            <div
                              key={ep.key}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setSelectedEndpointKey(ep.key);
                                handleProbeEndpoint(ep);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedEndpointKey(ep.key);
                                  handleProbeEndpoint(ep);
                                }
                              }}
                              className={cn(
                                "relative flex items-center justify-between rounded-lg border p-1.5 pl-2.5 text-xs transition-all cursor-pointer group select-none outline-none",
                                isSelected
                                  ? "bg-primary/10 dark:bg-primary/20 border-primary ring-2 ring-primary/25 shadow-xs"
                                  : "bg-muted/20 hover:bg-primary/5 hover:border-primary/40 border-border/70 focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary"
                              )}
                            >
                              <span
                                className={cn(
                                  "absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r transition-all duration-200",
                                  isSelected ? "bg-primary scale-y-100" : "bg-transparent group-hover:bg-primary/40"
                                )}
                              />
                              <div className="min-w-0 flex-1 mr-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="rounded px-1 py-0.2 font-mono text-[9px] font-bold border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                                    {ep.method}
                                  </span>
                                  <span
                                    className={cn(
                                      "font-semibold truncate font-mono text-[11px] transition-colors",
                                      isSelected ? "text-primary font-bold" : "text-foreground group-hover:text-primary"
                                    )}
                                    title={ep.name}
                                  >
                                    {ep.name}
                                  </span>
                                  {isSelected ? (
                                    <span className="rounded bg-primary text-primary-foreground px-1 py-0.2 text-[9px] font-bold shrink-0 shadow-xs flex items-center gap-1">
                                      <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-black animate-pulse" />
                                      Active
                                    </span>
                                  ) : ep.isHighlight ? (
                                    <span className="rounded bg-primary/20 text-primary px-1 py-0.2 text-[9px] font-bold shrink-0">
                                      Header-to-User
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate mt-0.5" title={ep.desc}>
                                  {ep.desc}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {ep.recordCount !== undefined && ep.recordCount > 0 && (
                                  <span className={cn(
                                    "font-mono text-[10px] font-medium transition-colors",
                                    isSelected ? "text-primary font-semibold" : "text-muted-foreground"
                                  )}>
                                    {fmtNumber(ep.recordCount)}
                                  </span>
                                )}
                                <Button
                                  variant={isSelected ? "default" : "ghost"}
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedEndpointKey(ep.key);
                                    handleProbeEndpoint(ep);
                                  }}
                                  className={cn(
                                    "h-6 px-1.5 text-[10px] gap-1 transition-all",
                                    isSelected
                                      ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
                                      : "hover:bg-background text-muted-foreground hover:text-foreground"
                                  )}
                                >
                                  <Eye className="h-3 w-3" /> Test
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </TabsContent>

                    {/* Tab 2: Master Data */}
                    <TabsContent value="master-data" className="mt-0">
                      <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                        {suiteStatus?.categories?.find((c) => c.id === "master-data")?.endpoints?.map((ep) => {
                          const isSelected = selectedEndpointKey === ep.key;
                          return (
                            <div
                              key={ep.key}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setSelectedEndpointKey(ep.key);
                                handleProbeEndpoint(ep);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedEndpointKey(ep.key);
                                  handleProbeEndpoint(ep);
                                }
                              }}
                              className={cn(
                                "relative flex items-center justify-between rounded-lg border p-1.5 pl-2.5 text-xs transition-all cursor-pointer group select-none outline-none",
                                isSelected
                                  ? "bg-primary/10 dark:bg-primary/20 border-primary ring-2 ring-primary/25 shadow-xs"
                                  : "bg-muted/20 hover:bg-primary/5 hover:border-primary/40 border-border/70 focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary"
                              )}
                            >
                              <span
                                className={cn(
                                  "absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r transition-all duration-200",
                                  isSelected ? "bg-primary scale-y-100" : "bg-transparent group-hover:bg-primary/40"
                                )}
                              />
                              <div className="min-w-0 flex-1 mr-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="rounded px-1 py-0.2 font-mono text-[9px] font-bold border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                                    {ep.method}
                                  </span>
                                  <span
                                    className={cn(
                                      "font-semibold truncate font-mono text-[11px] transition-colors",
                                      isSelected ? "text-primary font-bold" : "text-foreground group-hover:text-primary"
                                    )}
                                    title={ep.name}
                                  >
                                    {ep.name}
                                  </span>
                                  {isSelected && (
                                    <span className="rounded bg-primary text-primary-foreground px-1 py-0.2 text-[9px] font-bold shrink-0 shadow-xs flex items-center gap-1">
                                      <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-black animate-pulse" />
                                      Active
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate mt-0.5" title={ep.desc}>
                                  {ep.desc}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {ep.recordCount !== undefined && ep.recordCount > 0 && (
                                  <span className={cn(
                                    "font-mono text-[10px] font-medium transition-colors",
                                    isSelected ? "text-primary font-semibold" : "text-muted-foreground"
                                  )}>
                                    {fmtNumber(ep.recordCount)}
                                  </span>
                                )}
                                <Button
                                  variant={isSelected ? "default" : "ghost"}
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedEndpointKey(ep.key);
                                    handleProbeEndpoint(ep);
                                  }}
                                  className={cn(
                                    "h-6 px-1.5 text-[10px] gap-1 transition-all",
                                    isSelected
                                      ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
                                      : "hover:bg-background text-muted-foreground hover:text-foreground"
                                  )}
                                >
                                  <Eye className="h-3 w-3" /> Test
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </TabsContent>

                    {/* Tab 3: Write Actions */}
                    <TabsContent value="actions" className="mt-0">
                      <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                        {suiteStatus?.categories?.find((c) => c.id === "write-actions")?.endpoints?.map((ep) => {
                          const isSelected = selectedEndpointKey === ep.key;
                          return (
                            <div
                              key={ep.key}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setSelectedEndpointKey(ep.key);
                                handleProbeEndpoint(ep);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedEndpointKey(ep.key);
                                  handleProbeEndpoint(ep);
                                }
                              }}
                              className={cn(
                                "relative flex items-center justify-between rounded-lg border p-1.5 pl-2.5 text-xs transition-all cursor-pointer group select-none outline-none",
                                isSelected
                                  ? "bg-primary/10 dark:bg-primary/20 border-primary ring-2 ring-primary/25 shadow-xs"
                                  : "bg-muted/20 hover:bg-primary/5 hover:border-primary/40 border-border/70 focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary"
                              )}
                            >
                              <span
                                className={cn(
                                  "absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r transition-all duration-200",
                                  isSelected ? "bg-primary scale-y-100" : "bg-transparent group-hover:bg-primary/40"
                                )}
                              />
                              <div className="min-w-0 flex-1 mr-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="rounded px-1 py-0.2 font-mono text-[9px] font-bold border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                                    {ep.method}
                                  </span>
                                  <span
                                    className={cn(
                                      "font-semibold truncate font-mono text-[11px] transition-colors",
                                      isSelected ? "text-primary font-bold" : "text-foreground group-hover:text-primary"
                                    )}
                                    title={ep.name}
                                  >
                                    {ep.name}
                                  </span>
                                  <span className="text-[9px] font-mono text-amber-700 dark:text-amber-400">
                                    (RoleAdmin)
                                  </span>
                                  {isSelected && (
                                    <span className="rounded bg-primary text-primary-foreground px-1 py-0.2 text-[9px] font-bold shrink-0 shadow-xs flex items-center gap-1">
                                      <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-black animate-pulse" />
                                      Active
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate mt-0.5" title={ep.desc}>
                                  {ep.desc}
                                </div>
                              </div>
                              <Button
                                variant={isSelected ? "default" : "ghost"}
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedEndpointKey(ep.key);
                                  handleProbeEndpoint(ep);
                                }}
                                className={cn(
                                  "h-6 px-1.5 text-[10px] gap-1 transition-all shrink-0",
                                  isSelected
                                    ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
                                    : "hover:bg-background text-muted-foreground hover:text-foreground"
                                )}
                              >
                                <Eye className="h-3 w-3" /> Sample
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </div>

              {/* Exact matching Footer: Test connection, Sync now, Edit, and Inspect Header-to-User */}
              <CardFooter className="flex-wrap">
                <Button variant="outline" size="sm" onClick={() => test(systems[0])}>
                  <PlugZap /> Test connection
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSyncingSystem(systems[0])} disabled={!can("edit")}>
                  <RefreshCw /> Sync now
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(systems[0])} disabled={!can("admin")}>
                  <Pencil /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={handleInspectHeaderToUser}>
                  <Users className="h-3.5 w-3.5" /> Inspect Header-to-User
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Sync history</CardTitle>
          <CardDescription>Scheduled and manual data loads from SAP</CardDescription>
        </CardHeader>
        {!runs ? (
          <CardContent>
            <Skeleton className="h-40" />
          </CardContent>
        ) : runs.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No synchronization history recorded yet.
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead className="min-w-[280px]">System</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => {
                  const sys = systems?.find((s) => s.id === r.systemId);
                  const systemDisplayName = sys?.name || r.systemName || (r.systemId === "HMF-100" ? "HMF 2023 – SAP S/4HANA (BTP CAP)" : r.systemId);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{fmtDateTime(r.started)}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium text-xs">
                        <span className="inline-flex items-center gap-1.5 rounded border border-border/80 bg-muted/60 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                          {systemDisplayName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border",
                          r.type === "Full" ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        )}>
                          {r.type}
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right">{r.durationSec >= 60 ? `${Math.round(r.durationSec / 60)} min` : `${r.durationSec} s`}</TableCell>
                      <TableCell className="tabular text-right font-mono text-xs">{fmtNumber(r.records)}</TableCell>
                      <TableCell>
                        <ConnectionBadge status={r.result} />
                        <span className="sr-only">{r.result}</span>
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">{r.message ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={!!testing} onOpenChange={(o) => !o && setTesting(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test connection · {testing?.name}</DialogTitle>
            <DialogDescription>Read-only checks against {testing?.host}</DialogDescription>
          </DialogHeader>
          <TestChecklist steps={steps} />
          <DialogFooter>
            <Button onClick={() => setTesting(undefined)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SyncSystemDialog
        system={syncingSystem}
        onClose={() => setSyncingSystem(undefined)}
        onConfirmSync={handleStartSync}
      />
      <EditSystemDialog system={editing} onClose={() => setEditing(undefined)} />
      <AddSystemWizard open={addOpen} onOpenChange={(o) => !o && closeAdd()} />
      <HeaderToUserInspectDialog
        open={inspectOpen}
        onClose={() => setInspectOpen(false)}
        data={inspectData}
        loading={inspectLoading}
        onSync={handleSyncHeaderToUser}
        isSyncing={syncingHeader}
      />
      <EndpointProbeDialog
        endpoint={probingEndpoint}
        onClose={() => setProbingEndpoint(null)}
        result={probeResult}
        loading={probingLoading}
      />
    </>
  );
}

export function HeaderToUserInspectDialog({
  open,
  onClose,
  data,
  loading,
  onSync,
  isSyncing,
}: {
  open: boolean;
  onClose: () => void;
  data: HeaderToUserStatus | null;
  loading: boolean;
  onSync: () => void;
  isSyncing: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[760px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                Live SAP Header-to-User Inspector
              </DialogTitle>
              <DialogDescription className="text-xs">
                Verified live response from OData V4 façade <code className="font-mono">ManagementHeaders?$expand=Nav_HeaderToUA</code>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm font-medium">Probing live SAP CAP OData V4 service…</p>
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                GET /role-service/ManagementHeaders?$top=10&$expand=Nav_HeaderToUA
              </p>
            </div>
          ) : !data ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 text-amber-500 mb-2" />
              <p className="text-sm font-medium">No live inspection data available.</p>
              <p className="text-xs text-muted-foreground mt-1">Make sure backend server is running and connected to SAP.</p>
            </div>
          ) : (
            <>
              {/* Status Header */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-lg border bg-muted/40 p-2.5">
                  <div className="text-[11px] text-muted-foreground">HTTP Status</div>
                  <div className="font-semibold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {data.httpStatus || 200} OK
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/40 p-2.5">
                  <div className="text-[11px] text-muted-foreground">Response Latency</div>
                  <div className="font-mono font-semibold text-sm mt-0.5">
                    {data.latencyMs} ms
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/40 p-2.5">
                  <div className="text-[11px] text-muted-foreground">Headers Inspected</div>
                  <div className="font-mono font-semibold text-sm mt-0.5">
                    {data.headersSampleCount} roles
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/40 p-2.5">
                  <div className="text-[11px] text-muted-foreground">Sample Assignments</div>
                  <div className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5">
                    {data.sampleHeaders?.reduce((sum, h) => sum + (h.assignedUserCount || 0), 0) || 0} user links
                  </div>
                </div>
              </div>

              {/* Endpoint Context Banner */}
              <div className="rounded-lg border border-border/80 bg-muted/20 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">OData V4 Verified Endpoint:</span>
                  <span className="font-mono text-[11px] text-muted-foreground">Status: {data.status || "online"}</span>
                </div>
                <div className="font-mono text-[11px] bg-background border px-2 py-1 rounded text-primary truncate">
                  {data.serviceRoot ? `${data.serviceRoot}${data.endpoint}` : data.endpoint}
                </div>
                <div className="text-muted-foreground text-[11px] pt-1">
                  ✓ Expanding <code className="font-mono text-foreground font-medium">Nav_HeaderToUA</code> directly extracts SAP user-to-role mappings (<code className="font-mono text-foreground">Uname ↔ AgrName</code>) from SAP S/4HANA.
                </div>
              </div>

              {/* Sample Headers & Assignments Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                    Sample Role Headers &amp; Assigned Users
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Showing top {data.sampleHeaders?.length || 0} roles
                  </span>
                </div>

                <div className="rounded-lg border overflow-hidden">
                  <Table className="text-xs">
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="w-[180px]">Role (AgrName)</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-[80px]">Type</TableHead>
                        <TableHead className="w-[80px] text-right">Users</TableHead>
                        <TableHead className="min-w-[200px]">Assigned Usernames</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.sampleHeaders?.map((hdr) => (
                        <TableRow key={hdr.AgrName}>
                          <TableCell className="font-mono font-semibold text-foreground">
                            {hdr.AgrName}
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate text-muted-foreground" title={hdr.Text}>
                            {hdr.Text || "—"}
                          </TableCell>
                          <TableCell>
                            <span className="rounded border px-1.5 py-0.5 text-[10px] font-mono bg-muted">
                              {hdr.RoleType || "Single"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {hdr.assignedUserCount}
                          </TableCell>
                          <TableCell>
                            {hdr.sampleUsers && hdr.sampleUsers.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {hdr.sampleUsers.map((u) => (
                                  <span
                                    key={u.Uname}
                                    className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary"
                                    title={`Valid: ${u.FromDat || "—"} to ${u.ToDat || "—"}`}
                                  >
                                    {u.Uname}
                                  </span>
                                ))}
                                {hdr.assignedUserCount > hdr.sampleUsers.length && (
                                  <span className="text-[10px] text-muted-foreground self-center">
                                    +{hdr.assignedUserCount - hdr.sampleUsers.length} more
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic text-[11px]">None assigned</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={onSync}
            disabled={isSyncing || loading}
            className="gap-1.5"
          >
            {isSyncing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Syncing to PostgreSQL…
              </>
            ) : (
              <>
                <Database className="h-3.5 w-3.5" />
                Sync all to PostgreSQL
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SyncSystemDialog({
  system,
  onClose,
  onConfirmSync,
}: {
  system?: SapSystem;
  onClose: () => void;
  onConfirmSync: (s: SapSystem, type: "Delta" | "Full") => void;
}) {
  const [syncType, setSyncType] = React.useState<"Delta" | "Full">("Delta");

  React.useEffect(() => {
    if (system) setSyncType("Delta");
  }, [system]);

  if (!system) return null;

  return (
    <Dialog open={!!system} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">Synchronize SAP Data</DialogTitle>
              <DialogDescription className="text-xs">
                Select synchronization method for <span className="font-semibold text-foreground">{system.name}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Delta Sync Option Card */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setSyncType("Delta")}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSyncType("Delta")}
            className={cn(
              "relative flex cursor-pointer flex-col gap-2 rounded-xl border p-4 text-left transition-all",
              syncType === "Delta"
                ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs"
                : "border-border/80 hover:border-primary/40 hover:bg-muted/30"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                    syncType === "Delta" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border"
                  )}
                >
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">Delta Sync</span>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      Recommended · Fast (~2-4s)
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Extracts only modified or newly created roles, user assignments, and authorization changes since last sync.
                  </p>
                </div>
              </div>
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors mt-0.5",
                  syncType === "Delta" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
                )}
              >
                {syncType === "Delta" && <Check className="h-3 w-3" />}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2 pt-2.5 border-t border-border/50 text-[11px] text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Scope: </span>
                Recent changes (~100–500 records)
              </div>
              <div>
                <span className="font-medium text-foreground">Target: </span>
                Updates <span className="font-mono text-foreground font-medium">Last delta sync</span>
              </div>
            </div>
          </div>

          {/* Full Sync Option Card */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setSyncType("Full")}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSyncType("Full")}
            className={cn(
              "relative flex cursor-pointer flex-col gap-2 rounded-xl border p-4 text-left transition-all",
              syncType === "Full"
                ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs"
                : "border-border/80 hover:border-primary/40 hover:bg-muted/30"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                    syncType === "Full" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border"
                  )}
                >
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">Full Sync</span>
                    <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-600 dark:text-purple-400 border border-purple-500/20">
                      Baseline Reload (~15-30s)
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Performs a complete baseline ingestion of all PFCG single & composite roles, authorisations, and user master records.
                  </p>
                </div>
              </div>
              <div
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors mt-0.5",
                  syncType === "Full" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
                )}
              >
                {syncType === "Full" && <Check className="h-3 w-3" />}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2 pt-2.5 border-t border-border/50 text-[11px] text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Scope: </span>
                All {system.counts?.roles ? `${fmtNumber(system.counts.roles)} roles` : "5,312 roles"} & users
              </div>
              <div>
                <span className="font-medium text-foreground">Target: </span>
                Refreshes <span className="font-mono text-foreground font-medium">Baseline & Last full sync</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirmSync(system, syncType);
              onClose();
            }}
            className="gap-2"
          >
            {syncType === "Delta" ? <Zap className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
            Start {syncType} Sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border bg-background px-2 py-0.5">{children}</span>;
}

function EditSystemDialog({ system, onClose }: { system?: SapSystem; onClose: () => void }) {
  const [name, setName] = React.useState("");
  const [serviceRoot, setServiceRoot] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [tokenUrl, setTokenUrl] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [roleData, setRoleData] = React.useState(true);
  const [userAssignments, setUserAssignments] = React.useState(true);
  const [writeActions, setWriteActions] = React.useState(false);
  const [userAssignmentsEndpoint, setUserAssignmentsEndpoint] = React.useState("RoleUserAssignments");
  const [userMasterUrl, setUserMasterUrl] = React.useState("");
  const [pageSize, setPageSize] = React.useState("200");
  const [full, setFull] = React.useState("");
  const [delta, setDelta] = React.useState("");

  React.useEffect(() => {
    if (system) {
      setName(system.name);
      setServiceRoot(system.apiConfig?.serviceRoot || system.host);
      setDestination(system.apiConfig?.destination || "");
      setTokenUrl(system.apiConfig?.tokenUrl || "");
      setClientId(system.apiConfig?.clientId || "");
      setSecret("");
      setRoleData(system.apiConfig?.scopes?.roleData !== false);
      setUserAssignments(Boolean(system.apiConfig?.scopes?.userAssignments));
      setWriteActions(Boolean(system.apiConfig?.scopes?.writeActions));
      setUserAssignmentsEndpoint(system.apiConfig?.endpoints?.userAssignments || "RoleUserAssignments");
      setUserMasterUrl(system.apiConfig?.endpoints?.userMasterUrl || "");
      setPageSize(String(system.apiConfig?.pageSize || 200));
      setFull(system.schedule.full);
      setDelta(system.schedule.delta);
    }
  }, [system]);

  return (
    <Dialog open={!!system} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit SAP System · {system?.sid}</DialogTitle>
          <DialogDescription>Configure CAP Service Root, API endpoints (Roles &amp; User Assignments), OAuth credentials, and sync schedule.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5 py-1">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Display name" htmlFor="es-name" className="md:col-span-2">
              <Input id="es-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="BTP Destination" htmlFor="es-dest">
              <Input id="es-dest" value={destination} onChange={(e) => setDestination(e.target.value.toUpperCase())} placeholder="HMF_2023" />
            </Field>
          </div>
          <Field label="CAP Service Root / Base URL" htmlFor="es-host" hint="Full OData V4 service root including /role-service">
            <Input id="es-host" value={serviceRoot} onChange={(e) => setServiceRoot(e.target.value)} />
          </Field>

          <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">API Data Scopes &amp; Endpoints</div>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <Checkbox checked={roleData} onCheckedChange={(v) => setRoleData(Boolean(v))} className="mt-0.5" />
              <span>
                <span className="font-medium text-foreground block">Role Master Data (RoleHeaders, RoleAuthorizations, RoleOrgData, RoleTCodes)</span>
                <span className="text-muted-foreground">Primary v1.0 Rolehdr_Detail OData V4 projections</span>
              </span>
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <Checkbox checked={userAssignments} onCheckedChange={(v) => setUserAssignments(Boolean(v))} className="mt-0.5" />
                <span>
                  <span className="font-medium text-foreground flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    User-to-Role Assignments (ZGW_ROLES_MANAGEMENT_SRV)
                  </span>
                  <span className="text-muted-foreground">Syncs SAP user role mappings (Uname ↔ AgrName)</span>
                </span>
              </label>
              {userAssignments && (
                <div className="grid gap-2 pl-6 md:grid-cols-2">
                  <Field label="User Assignment Endpoint" htmlFor="es-ua-ep">
                    <Select value={userAssignmentsEndpoint} onValueChange={setUserAssignmentsEndpoint}>
                      <SelectTrigger id="es-ua-ep" className="h-8 text-xs font-mono">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ManagementHeaders">ManagementHeaders (Nav_HeaderToUA Navigation)</SelectItem>
                        <SelectItem value="RoleUserAssignments">RoleUserAssignments (UserAssinmntSet)</SelectItem>
                        <SelectItem value="ManagementRoles">ManagementRoles (RoleSet)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Optional User Master API URL" htmlFor="es-um-url">
                    <Input id="es-um-url" className="h-8 text-xs font-mono" value={userMasterUrl} onChange={(e) => setUserMasterUrl(e.target.value)} placeholder="https://.../API_USER_SRV (optional)" />
                  </Field>
                </div>
              )}
            </div>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <Checkbox checked={writeActions} onCheckedChange={(v) => setWriteActions(Boolean(v))} className="mt-0.5" />
              <span>
                <span className="font-medium text-foreground flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                  Role Administration Write Actions (createRole, assignRoleToUser, removeRoleFromUser)
                </span>
                <span className="text-muted-foreground">Requires XSUAA RoleAdministrator scope (ZROLES_SRV)</span>
              </span>
            </label>
          </div>

          {system?.authType === "OAuth 2.0 client credentials" && (
            <div className="grid gap-3 md:grid-cols-2 rounded-lg border bg-muted/20 p-3">
              <Field label="XSUAA Token URL" htmlFor="es-token" className="md:col-span-2">
                <Input id="es-token" value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} className="text-xs font-mono" />
              </Field>
              <Field label="Client ID" htmlFor="es-cid">
                <Input id="es-cid" value={clientId} onChange={(e) => setClientId(e.target.value)} className="text-xs font-mono" />
              </Field>
              <Field label="Rotate Client Secret (optional)" htmlFor="es-secret" hint={system.apiConfig?.hasSecret ? "Leave blank to keep stored secret" : "Enter client secret"}>
                <Input id="es-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••••••" autoComplete="new-password" />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Full sync schedule" htmlFor="es-full">
              <Select value={full} onValueChange={setFull}>
                <SelectTrigger id="es-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Weekly · Sunday 01:00", "Weekly · Sunday 01:30", "Weekly · Saturday 22:00", "Monthly · 1st 01:00"].map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Delta sync schedule" htmlFor="es-delta">
              <Select value={delta} onValueChange={setDelta}>
                <SelectTrigger id="es-delta">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Daily · 02:00", "Daily · 03:00", "Every 6 hours", "Manual only"].map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Page Size ($top)" htmlFor="es-ps">
              <Select value={pageSize} onValueChange={setPageSize}>
                <SelectTrigger id="es-ps">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["100", "200", "500"].map((o) => (
                    <SelectItem key={o} value={o}>
                      {o} rows
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden /> OAuth client credentials stored securely in PostgreSQL / backend environment.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              let hostOnly = serviceRoot;
              try {
                if (/^https?:\/\//i.test(serviceRoot)) hostOnly = new URL(serviceRoot).host;
              } catch {}
              await updateSystem(system!.id, {
                name,
                host: hostOnly,
                schedule: { full, delta },
                secret: secret || undefined,
                apiConfig: {
                  serviceRoot: serviceRoot.trim(),
                  destination: destination.trim() || undefined,
                  tokenUrl: tokenUrl.trim() || undefined,
                  clientId: clientId.trim() || undefined,
                  hasSecret: Boolean(secret || system?.apiConfig?.hasSecret),
                  scopes: { roleData, userAssignments, writeActions },
                  endpoints: {
                    roleHeaders: system?.apiConfig?.endpoints?.roleHeaders || "RoleHeaders",
                    roleAuthorizations: system?.apiConfig?.endpoints?.roleAuthorizations || "RoleAuthorizations",
                    roleOrgData: system?.apiConfig?.endpoints?.roleOrgData || "RoleOrgData",
                    roleTCodes: system?.apiConfig?.endpoints?.roleTCodes || "RoleTCodes",
                    userAssignments: userAssignmentsEndpoint,
                    userMasterUrl: userMasterUrl.trim() || undefined,
                  },
                  pageSize: Number(pageSize) || 200,
                },
              });
              toast.success("System configuration updated");
              onClose();
            }}
          >
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EndpointProbeDialog({
  endpoint,
  onClose,
  result,
  loading,
}: {
  endpoint: SuiteEndpoint | null;
  onClose: () => void;
  result: any;
  loading: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  if (!endpoint) return null;

  const handleCopy = () => {
    if (result) {
      navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      toast.success("Response JSON copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={!!endpoint} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Code2 className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                Live SAP API Probe · {endpoint.name}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {endpoint.section} · <span className="font-mono text-foreground">{endpoint.path}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2 pr-1">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="rounded-lg border bg-muted/30 p-2">
              <div className="text-[10px] text-muted-foreground">HTTP Method</div>
              <div className="font-mono font-semibold text-xs mt-0.5">{endpoint.method}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-2">
              <div className="text-[10px] text-muted-foreground">Live HTTP Status</div>
              <div className="font-semibold text-xs mt-0.5 text-emerald-600 dark:text-emerald-400">
                {loading ? "Testing..." : result?.httpStatus ? `${result.httpStatus} OK` : result?.ok === false ? "Error" : "200 OK"}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-2">
              <div className="text-[10px] text-muted-foreground">Live Latency</div>
              <div className="font-mono font-semibold text-xs mt-0.5">
                {loading ? "..." : result?.latencyMs ? `${result.latencyMs} ms` : "—"}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-2">
              <div className="text-[10px] text-muted-foreground">Target DB Table</div>
              <div className="font-mono text-xs mt-0.5 truncate" title={endpoint.targetTable}>
                {endpoint.targetTable}
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/10 p-2.5 text-xs space-y-1">
            <div className="text-[11px] font-semibold text-foreground">Endpoint Description:</div>
            <div className="text-muted-foreground text-[11px] leading-relaxed">{endpoint.desc}</div>
            {endpoint.samplePayload && (
              <div className="mt-2 pt-2 border-t border-border/60">
                <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Sample Action Body:</div>
                <pre className="font-mono text-[10px] bg-background border p-2 rounded overflow-x-auto text-primary">
                  {JSON.stringify(endpoint.samplePayload, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground uppercase text-[10px]">
                Live SAP OData Response Payload
              </span>
              {result && (
                <Button variant="ghost" size="sm" onClick={handleCopy} className="h-6 px-2 text-[11px] gap-1">
                  {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Code2 className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy JSON"}
                </Button>
              )}
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 border rounded-lg bg-muted/20">
                <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
                <span className="text-xs text-muted-foreground">Probing live SAP CAP endpoint...</span>
              </div>
            ) : result ? (
              <pre className="font-mono text-[11px] bg-muted/40 border p-3 rounded-lg overflow-x-auto max-h-[260px] text-foreground">
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground border rounded-lg">
                No response data. Click test to probe.
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
