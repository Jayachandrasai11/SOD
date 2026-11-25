import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Layers,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import type { Process, Role, RoleType, User } from "@/types";
import { PROCESSES } from "@/types";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { db } from "@/services/db";
import { roleResult, userResult } from "@/services/analysisService";
import { cn, fmtDate, fmtDateTime, todayStamp } from "@/lib/utils";

export interface UserDetailDrawerProps {
  user?: User | null;
  onOpenChange: (open: boolean) => void;
  onAnalyze?: (userId: string) => void;
}

export function UserDetailDrawer({ user, onOpenChange, onAnalyze }: UserDetailDrawerProps) {
  const navigate = useNavigate();
  const [q, setQ] = React.useState("");
  const [procFilter, setProcFilter] = React.useState<string>("all");
  const [typeFilter, setTypeFilter] = React.useState<string>("all");
  const [copied, setCopied] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const PER_PAGE = 25;

  React.useEffect(() => {
    setQ("");
    setProcFilter("all");
    setTypeFilter("all");
    setPage(1);
    setCopied(false);
  }, [user?.id]);

  if (!user) {
    return (
      <Sheet open={false} onOpenChange={onOpenChange}>
        <SheetContent />
      </Sheet>
    );
  }

  const uRes = userResult(user);
  const system = db.systems[0];
  const roleMap = new Map(db.roles.map((r) => [r.name.toUpperCase(), r]));

  // Build structured roles list (assigned roles + created/managed roles)
  const allRoleNames = Array.from(new Set([...(user.roles || []), ...(user.createdRoles || [])]));
  const userRolesList = allRoleNames.map((rName) => {
    const isAssigned = (user.roles || []).includes(rName);
    const isCreated = (user.createdRoles || []).includes(rName);
    const found = roleMap.get(rName.toUpperCase());
    if (found) {
      return {
        name: found.name,
        description: found.description || found.name,
        type: found.type || "Single",
        process: found.process || "Basis",
        tcodeCount: found.tcodeCount ?? found.tcodes?.length ?? 0,
        authCount: found.authCount ?? found.auths?.length ?? 0,
        orgCount: found.orgCount ?? found.orgLevels?.length ?? 0,
        status: roleResult(found).status,
        existsInHeaders: true,
        isAssigned,
        isCreated,
      };
    }
    return {
      name: rName,
      description: isCreated ? "SAP S/4HANA Created Role" : "SAP S/4HANA Assigned Role",
      type: "Single" as RoleType,
      process: "Basis" as Process,
      tcodeCount: 0,
      authCount: 0,
      orgCount: 0,
      status: "grey" as const,
      existsInHeaders: false,
      isAssigned,
      isCreated,
    };
  });

  const singleCount = userRolesList.filter((r) => r.type === "Single").length;
  const compositeCount = userRolesList.filter((r) => r.type === "Composite").length;
  const derivedCount = userRolesList.filter((r) => r.type === "Derived").length;

  const filteredRoles = userRolesList.filter((r) => {
    if (q) {
      const match =
        r.name.toLowerCase().includes(q.toLowerCase()) ||
        r.description.toLowerCase().includes(q.toLowerCase()) ||
        r.process.toLowerCase().includes(q.toLowerCase());
      if (!match) return false;
    }
    if (procFilter !== "all" && r.process !== procFilter) return false;
    if (typeFilter !== "all" && r.type !== typeFilter) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredRoles.length / PER_PAGE));
  const pagedRoles = filteredRoles.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const copyId = () => {
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    toast.success(`Copied user ID: ${user.id}`);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportRoles = () => {
    const wsData = filteredRoles.map((r, idx) => ({
      "#": idx + 1,
      "User ID": user.id,
      "User Name": user.name,
      Department: user.department,
      "Role Name": r.name,
      Description: r.description,
      Type: r.type,
      Process: r.process,
      "T-Codes Count": r.tcodeCount,
      "Authorizations Count": r.authCount,
      "Org Levels Count": r.orgCount,
      "Role SoD Status": r.status,
      System: system?.name || "HMF 2023 – SAP S/4HANA (BTP CAP)",
      "Valid To": user.validTo === "9999-12-31" ? "Unlimited" : fmtDate(user.validTo),
    }));

    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Assigned Roles");
    XLSX.writeFile(wb, `MySODAI_user_${user.id}_roles_${todayStamp()}.xlsx`);
    toast.success(`Exported ${filteredRoles.length} roles for user ${user.id}`);
  };

  const handleOpenAnalysis = () => {
    onOpenChange(false);
    if (onAnalyze) {
      onAnalyze(user.id);
    } else {
      navigate(`/roles/analysis?kind=User&subject=${encodeURIComponent(user.id)}`);
    }
  };

  return (
    <Sheet open={Boolean(user)} onOpenChange={onOpenChange}>
      <SheetContent
        className="sm:max-w-3xl flex flex-col h-full p-0 gap-0"
        aria-describedby="user-drawer-desc"
      >
        {/* Header */}
        <SheetHeader className="border-b px-6 py-5 bg-card/60 backdrop-blur-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/60 px-2.5 py-0.5 font-mono text-xs font-semibold text-foreground">
                <UserCheck className="h-3.5 w-3.5 text-primary" />
                {user.id}
              </span>
              <button
                type="button"
                onClick={copyId}
                title="Copy User ID"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-status-green" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              {user.locked && (
                <span className="rounded bg-status-red-bg px-2 py-0.5 text-xs font-medium text-status-red border border-status-red/30">
                  Locked
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={uRes.status} size="sm" />
              <span className="text-xs font-medium text-muted-foreground">
                {uRes.hits.length === 0 ? "Clean (Risk OK)" : `${uRes.hits.length} SoD Risk Hit(s)`}
              </span>
            </div>
          </div>

          <SheetTitle className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span>{user.name}</span>
          </SheetTitle>

          <SheetDescription id="user-drawer-desc" className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Department: <strong className="font-medium text-foreground">{user.department}</strong></span>
            <span>·</span>
            <span>Valid to: <strong className="font-medium text-foreground">{user.validTo === "9999-12-31" ? "Unlimited" : fmtDate(user.validTo)}</strong></span>
            <span>·</span>
            <span>System: <strong className="font-medium text-foreground">{system?.name || "HMF 2023 – SAP S/4HANA"}</strong></span>
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
        <SheetBody className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total Roles</div>
              <div className="mt-1 font-mono text-2xl font-bold text-primary">{user.roles.length}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Assigned in SAP S/4HANA</div>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-3.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Single Roles</div>
              <div className="mt-1 font-mono text-2xl font-bold text-foreground">{singleCount}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Direct authorization containers</div>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-3.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Composite / Derived</div>
              <div className="mt-1 font-mono text-2xl font-bold text-foreground">{compositeCount + derivedCount}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{compositeCount} composite · {derivedCount} derived</div>
            </div>
            <div className={cn(
              "rounded-xl border p-3.5",
              uRes.hits.length > 0 ? "border-status-red/30 bg-status-red-bg/30 text-status-red" : "border-status-green/30 bg-status-green-bg/30 text-status-green"
            )}>
              <div className="text-[11px] font-medium uppercase tracking-wider">SoD Violations</div>
              <div className="mt-1 font-mono text-2xl font-bold">{uRes.hits.length}</div>
              <div className="text-[10px] opacity-80 mt-0.5">
                {uRes.hits.length === 0 ? "✓ 0 unmitigated risks" : "Active SoD conflicts"}
              </div>
            </div>
          </div>

          {/* SoD Status Banner */}
          {uRes.hits.length > 0 ? (
            <div className="rounded-xl border border-status-red/40 bg-status-red-bg/40 p-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="h-5 w-5 text-status-red shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-status-red">
                    {uRes.hits.length} SoD conflict{uRes.hits.length > 1 ? "s" : ""} detected for {user.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    User possesses conflicting transactions across their {user.roles.length} assigned roles.
                  </div>
                </div>
              </div>
              <Button size="sm" variant="default" className="shrink-0 text-xs h-8" onClick={handleOpenAnalysis}>
                <Play className="h-3.5 w-3.5 mr-1" /> View in SoD Analysis
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-status-green/40 bg-status-green-bg/30 p-3.5 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-status-green font-medium">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>All {user.roles.length} assigned roles are risk-free. No unmitigated SoD conflicts.</span>
              </div>
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={handleOpenAnalysis}>
                Inspect Analysis Run <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </div>
          )}

          {/* Assigned Roles Section */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  <span>Related Roles</span>
                  <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 font-mono text-xs font-bold">
                    {userRolesList.length}
                  </span>
                  {user.createdRoles && user.createdRoles.length > 0 && (
                    <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[11px] font-medium border border-emerald-500/20">
                      {user.roles.length} assigned · {user.createdRoles.length} created
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Showing {filteredRoles.length} of {userRolesList.length} roles related to {user.id}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportRoles}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 text-emerald-600" /> Export Excel
                </Button>
              </div>
            </div>

            {/* Filter controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-muted/40 p-2.5 rounded-lg border border-border/60">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Filter roles by name or text..."
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  className="h-8 pl-8 text-xs bg-background"
                />
              </div>

              <Select
                value={procFilter}
                onValueChange={(v) => {
                  setProcFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue placeholder="All processes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Processes</SelectItem>
                  {PROCESSES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={typeFilter}
                onValueChange={(v) => {
                  setTypeFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Single">Single Roles</SelectItem>
                  <SelectItem value="Composite">Composite Roles</SelectItem>
                  <SelectItem value="Derived">Derived Roles</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Roles Table */}
            <div className="rounded-lg border border-border/80 overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-10 text-center text-xs">#</TableHead>
                    <TableHead className="min-w-[180px] text-xs font-semibold">Role Name</TableHead>
                    <TableHead className="min-w-[200px] text-xs font-semibold">Description</TableHead>
                    <TableHead className="w-[100px] text-xs font-semibold">Type</TableHead>
                    <TableHead className="w-[110px] text-xs font-semibold">Process</TableHead>
                    <TableHead className="w-[100px] text-xs font-semibold">Content</TableHead>
                    <TableHead className="w-[90px] text-xs font-semibold">SoD Status</TableHead>
                    <TableHead className="w-16 text-right text-xs">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedRoles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-xs">
                        No roles match your search or filter criteria.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedRoles.map((r, idx) => {
                      const rowNum = (page - 1) * PER_PAGE + idx + 1;
                      return (
                        <TableRow key={r.name} className="hover:bg-muted/40">
                          <TableCell className="text-center font-mono text-xs text-muted-foreground select-none">
                            {rowNum}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-semibold text-foreground">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Link
                                to={`/roles/${encodeURIComponent(r.name)}`}
                                className="text-primary hover:underline inline-flex items-center gap-1 group"
                                title={`View role details for ${r.name}`}
                                onClick={() => onOpenChange(false)}
                              >
                                <span className="truncate max-w-[170px]">{r.name}</span>
                                <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                              </Link>
                              {r.isCreated && (
                                <span
                                  className="px-1.5 py-0.2 rounded text-[10px] font-sans font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0"
                                  title="User is creator/owner of this role in SAP RoleHeaders"
                                >
                                  Creator
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground truncate max-w-[240px]" title={r.description}>
                            {r.description}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-medium border",
                                r.type === "Composite"
                                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                                  : r.type === "Derived"
                                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                    : "bg-muted text-foreground border-border/60"
                              )}
                            >
                              {r.type}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {r.process}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                            {r.tcodeCount > 0 || r.authCount > 0 ? (
                              <span>{r.tcodeCount} tc · {r.authCount} au</span>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <StatusBadge status={r.status} size="sm" />
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              asChild
                              title={`Inspect ${r.name}`}
                            >
                              <Link to={`/roles/${encodeURIComponent(r.name)}`} onClick={() => onOpenChange(false)}>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t px-2 py-2 text-xs text-muted-foreground">
                <div>
                  Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, filteredRoles.length)} of {filteredRoles.length} roles
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-7 text-xs px-2.5"
                  >
                    <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Previous
                  </Button>
                  <span className="font-mono text-xs px-2">Page {page} of {totalPages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="h-7 text-xs px-2.5"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetBody>

        {/* Footer */}
        <SheetFooter className="border-t px-6 py-4 bg-muted/20 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground font-mono">
            {user.id} · {user.roles.length} total roles assigned
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button size="sm" onClick={handleOpenAnalysis}>
              <Play className="h-3.5 w-3.5 mr-1.5" /> Open in SoD Analysis
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

