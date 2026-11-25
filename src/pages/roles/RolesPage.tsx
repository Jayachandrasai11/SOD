import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, Download, ExternalLink, FileSpreadsheet, Filter, Layers, Play, Plus, RefreshCw, RotateCcw, RotateCw, Search, SearchX, ShieldCheck, SlidersHorizontal, Sparkles, Users, X } from "lucide-react";
import { PageHeader, EmptyState, HelpTip } from "@/components/common";
import { CreateSapRoleDialog } from "@/components/SapRoleAdminDialogs";
import { UserDetailDrawer } from "@/components/UserDetailDrawer";
import { StatusBadge, StatusLegend } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox, Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/misc";
import { Label } from "@/components/ui/label";
import { db, useService } from "@/services/db";
import { getLastSyncType, getRoles, getSystems, getUsers, snapshotInfo, syncNow, syncRecentRolesFromSap } from "@/services/sapService";
import { roleStatuses, runAnalysis, userResult } from "@/services/analysisService";
import { downloadRoleTemplate } from "@/services/roleBuilderService";
import { useApp } from "@/context/AppContext";
import { PROCESSES, type Status, type User } from "@/types";
import { cn, fmtDate, fmtDateTime, globMatch, todayStamp } from "@/lib/utils";

const ROW_H = 52;

export default function RolesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { startJob, can, systemId } = useApp();
  const [view, setView] = React.useState<"roles" | "users">((params.get("view") as "roles" | "users") ?? "roles");

  const { data, loading } = useService(async () => {
    const [roles, liveUsers] = await Promise.all([getRoles(), getUsers(), getSystems()]);
    const statuses = roleStatuses();
    const userCount: Record<string, number> = {};
    for (const u of liveUsers) {
      if (Array.isArray(u.roles)) {
        for (const r of u.roles) {
          userCount[r] = (userCount[r] || 0) + 1;
        }
      }
      if (Array.isArray(u.createdRoles)) {
        for (const cr of u.createdRoles) {
          if (!u.roles?.includes(cr)) {
            userCount[cr] = (userCount[cr] || 0) + 1;
          }
        }
      }
    }
    const users = liveUsers.map((u) => {
      const res = userResult(u);
      return {
        ...u,
        status: res.status,
        hits: res.hits,
      };
    });
    return { roles, statuses, userCount, users };
  });

  const [pattern, setPattern] = React.useState(params.get("q") ?? "");
  const [type, setType] = React.useState(params.get("type") ?? "all");
  const [classificationFilter, setClassificationFilter] = React.useState(params.get("flag") ?? "all");
  const [process, setProcess] = React.useState(params.get("process") ?? "all");
  const [dept, setDept] = React.useState(params.get("dept") ?? "all");
  const [status, setStatus] = React.useState(params.get("status") ?? "all");
  const [parentRoleFilter, setParentRoleFilter] = React.useState<string>(params.get("parentFilter") ?? "all");
  const [roleUserFilter, setRoleUserFilter] = React.useState(params.get("assignment") ?? "all");
  const [accountFilter, setAccountFilter] = React.useState(params.get("account") ?? "all");
  const [riskFilter, setRiskFilter] = React.useState(params.get("risk") ?? "all");
  const [userRoleFilter, setUserRoleFilter] = React.useState(params.get("roleFilter") ?? "");
  const [systemFilter, setSystemFilter] = React.useState(params.get("sys") ?? "all");
  const [roleSortField, setRoleSortField] = React.useState<string | null>(params.get("sort") ?? null);
  const [roleSortOrder, setRoleSortOrder] = React.useState<"asc" | "desc">((params.get("order") as "asc" | "desc") ?? "asc");
  const [userSortField, setUserSortField] = React.useState<string | null>(params.get("usort") ?? null);
  const [userSortOrder, setUserSortOrder] = React.useState<"asc" | "desc">((params.get("uorder") as "asc" | "desc") ?? "asc");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [createRoleOpen, setCreateRoleOpen] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<User | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const toggleRoleSort = (field: string) => {
    if (roleSortField === field) {
      if (roleSortOrder === "asc") setRoleSortOrder("desc");
      else {
        setRoleSortField(null);
        setRoleSortOrder("asc");
      }
    } else {
      setRoleSortField(field);
      setRoleSortOrder("asc");
    }
  };

  const toggleUserSort = (field: string) => {
    if (userSortField === field) {
      if (userSortOrder === "asc") setUserSortOrder("desc");
      else {
        setUserSortField(null);
        setUserSortOrder("asc");
      }
    } else {
      setUserSortField(field);
      setUserSortOrder("asc");
    }
  };

  React.useEffect(() => {
    const p = new URLSearchParams();
    if (view !== "roles") p.set("view", view);
    if (pattern) p.set("q", pattern);
    if (systemFilter !== "all") p.set("sys", systemFilter);
    if (status !== "all") p.set("status", status);
    if (view === "roles") {
      if (type !== "all") p.set("type", type);
      if (classificationFilter !== "all") p.set("flag", classificationFilter);
      if (process !== "all") p.set("process", process);
      if (parentRoleFilter !== "all") p.set("parentFilter", parentRoleFilter);
      if (roleUserFilter !== "all") p.set("assignment", roleUserFilter);
      if (roleSortField) {
        p.set("sort", roleSortField);
        p.set("order", roleSortOrder);
      }
    } else {
      if (dept !== "all") p.set("dept", dept);
      if (accountFilter !== "all") p.set("account", accountFilter);
      if (riskFilter !== "all") p.set("risk", riskFilter);
      if (userRoleFilter) p.set("roleFilter", userRoleFilter);
      if (userSortField) {
        p.set("usort", userSortField);
        p.set("uorder", userSortOrder);
      }
    }
    setParams(p, { replace: true });
  }, [view, pattern, type, classificationFilter, process, parentRoleFilter, dept, status, roleUserFilter, accountFilter, riskFilter, userRoleFilter, systemFilter, roleSortField, roleSortOrder, userSortField, userSortOrder, setParams]);

  const snap = snapshotInfo();
  const system = db.systems.find((s) => s.id === systemId) || db.systems[0];
  const currentSyncType = React.useMemo(() => getLastSyncType(system.id), [system.id, data]);
  const systemOptions = React.useMemo(() => [system.name], [system.name]);

  // Approach 2: Live Cloud Poller & Auto-Sync Bridge
  // 1. Silent sync when window/tab is focused (e.g. switching back after creating a role in Postman)
  // 2. Periodic background refresh (every 45s) while on Roles page
  React.useEffect(() => {
    let isMounted = true;
    let isSyncing = false;

    const runSilentSync = async () => {
      if (isSyncing || document.visibilityState !== "visible") return;
      isSyncing = true;
      try {
        await syncRecentRolesFromSap(system.id, 50);
      } catch (e) {
        console.debug("[RolesPage] Auto-sync skipped:", e);
      } finally {
        if (isMounted) isSyncing = false;
      }
    };

    const handleFocus = () => {
      runSilentSync();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    // Periodic poller loop (every 45 seconds while user has tab open)
    const pollerInterval = setInterval(runSilentSync, 45000);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
      clearInterval(pollerInterval);
    };
  }, [system.id]);
  const departments = React.useMemo(() => (data ? [...new Set(data.users.map((u) => u.department))] : []), [data]);

  const statusCounts = React.useMemo(() => {
    if (!data) return { red: 0, amber: 0, green: 0, grey: 0, unassigned: 0, total: 0 };
    if (view === "roles") {
      let red = 0;
      let amber = 0;
      let green = 0;
      let grey = 0;
      let unassigned = 0;
      data.roles.forEach((r) => {
        const st = data.statuses[r.name];
        if (st === "red") red++;
        else if (st === "amber") amber++;
        else if (st === "green") green++;
        else grey++;
        if ((data.userCount[r.name] ?? 0) === 0) unassigned++;
      });
      return { red, amber, green, grey, unassigned, total: data.roles.length };
    } else {
      let red = 0;
      let amber = 0;
      let green = 0;
      let grey = 0;
      let locked = 0;
      data.users.forEach((u) => {
        if (u.status === "red") red++;
        else if (u.status === "amber") amber++;
        else if (u.status === "green") green++;
        else grey++;
        if (u.locked) locked++;
      });
      return { red, amber, green, grey, unassigned: locked, total: data.users.length };
    }
  }, [data, view]);

  const rows = React.useMemo(() => {
    if (!data) return [];
    const filtered = data.roles.filter((r) => {
      const matchesPattern =
        !pattern ||
        globMatch(pattern, r.name) ||
        (!/[*?]/.test(pattern) && r.description.toLowerCase().includes(pattern.toLowerCase()));
      if (!matchesPattern) return false;

      if (type !== "all" && r.type !== type) return false;
      if (classificationFilter === "NONE" && Boolean(r.flagType)) return false;
      if (classificationFilter !== "all" && classificationFilter !== "NONE" && (r.flagType || "") !== classificationFilter) return false;
      if (process !== "all" && r.process !== process) return false;
      if (status !== "all" && data.statuses[r.name] !== status) return false;
      if (systemFilter !== "all" && system.name !== systemFilter && system.sid !== systemFilter) return false;
      if (parentRoleFilter === "with_parent" && !r.parent) return false;
      if (parentRoleFilter === "no_parent" && Boolean(r.parent)) return false;

      const uCount = data.userCount[r.name] ?? 0;
      if (roleUserFilter === "assigned" && uCount === 0) return false;
      if (roleUserFilter === "unassigned" && uCount > 0) return false;
      if (roleUserFilter === "high" && uCount <= 5) return false;

      return true;
    });

    if (!roleSortField) return filtered;

    const mult = roleSortOrder === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (roleSortField) {
        case "name":
          return mult * a.name.localeCompare(b.name);
        case "system":
          return mult * system.name.localeCompare(system.name);
        case "description":
          return mult * a.description.localeCompare(b.description);
        case "type":
          return mult * a.type.localeCompare(b.type);
        case "flagType":
          return mult * (a.flagType || "").localeCompare(b.flagType || "");
        case "parent": {
          const pA = a.parent || "";
          const pB = b.parent || "";
          if (!pA && !pB) return a.name.localeCompare(b.name);
          // Always bubble roles with parent templates to the top on parent sort
          if (!pA) return 1;
          if (!pB) return -1;
          return mult * pA.localeCompare(pB);
        }
        case "process":
          return mult * a.process.localeCompare(b.process);
        case "createDat": {
          const tA = a.createDat ? new Date(a.createDat).getTime() : 0;
          const tB = b.createDat ? new Date(b.createDat).getTime() : 0;
          if (tA !== tB) return mult * (tA - tB);
          return a.name.localeCompare(b.name);
        }
        case "lastChanged": {
          const tA = a.lastChanged ? new Date(a.lastChanged).getTime() : 0;
          const tB = b.lastChanged ? new Date(b.lastChanged).getTime() : 0;
          return mult * (tA - tB);
        }
        case "userCount": {
          const cA = data.userCount[a.name] ?? 0;
          const cB = data.userCount[b.name] ?? 0;
          return mult * (cA - cB);
        }
        case "status": {
          const rankMap: Record<Status, number> = { red: 4, amber: 3, green: 2, grey: 1 };
          const sA = rankMap[data.statuses[a.name]] ?? 0;
          const sB = rankMap[data.statuses[b.name]] ?? 0;
          return mult * (sA - sB);
        }
        default:
          return 0;
      }
    });
  }, [data, pattern, type, classificationFilter, process, parentRoleFilter, status, systemFilter, roleUserFilter, system.name, system.sid, roleSortField, roleSortOrder]);

  const userRows = React.useMemo(() => {
    if (!data) return [];
    const pat = pattern.trim().toLowerCase();
    const rolePat = userRoleFilter.trim().toLowerCase();
    const filtered = data.users.filter((u) => {
      const matchesPattern =
        !pat ||
        u.id.toLowerCase().includes(pat) ||
        u.name.toLowerCase().includes(pat) ||
        u.department.toLowerCase().includes(pat) ||
        u.roles.some((r) => r.toLowerCase().includes(pat)) ||
        (u.createdRoles && u.createdRoles.some((r) => r.toLowerCase().includes(pat)));
      if (!matchesPattern) return false;

      if (rolePat) {
        const hasRole =
          u.roles.some((r) => (/[*?]/.test(rolePat) ? globMatch(rolePat, r) : r.toLowerCase().includes(rolePat))) ||
          (u.createdRoles && u.createdRoles.some((r) => (/[*?]/.test(rolePat) ? globMatch(rolePat, r) : r.toLowerCase().includes(rolePat))));
        if (!hasRole) return false;
      }

      if (dept !== "all" && u.department !== dept) return false;
      if (status !== "all" && u.status !== status) return false;
      if (systemFilter !== "all" && system.name !== systemFilter && system.sid !== systemFilter) return false;

      if (accountFilter === "active" && u.locked) return false;
      if (accountFilter === "locked" && !u.locked) return false;

      if (riskFilter === "violating" && u.hits.length === 0) return false;
      if (riskFilter === "clean" && u.hits.length > 0) return false;

      return true;
    });

    if (!userSortField) return filtered;

    const mult = userSortOrder === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (userSortField) {
        case "id":
          return mult * a.id.localeCompare(b.id);
        case "name":
          return mult * a.name.localeCompare(b.name);
        case "system":
          return mult * system.name.localeCompare(system.name);
        case "department":
          return mult * a.department.localeCompare(b.department);
        case "roles":
          return mult * (a.roles.length - b.roles.length);
        case "validTo": {
          const tA = new Date(a.validTo).getTime();
          const tB = new Date(b.validTo).getTime();
          return mult * (tA - tB);
        }
        case "status": {
          const rankMap: Record<Status, number> = { red: 4, amber: 3, green: 2, grey: 1 };
          const sA = rankMap[a.status as Status] ?? 0;
          const sB = rankMap[b.status as Status] ?? 0;
          return mult * (sA - sB);
        }
        default:
          return 0;
      }
    });
  }, [data, pattern, dept, status, systemFilter, accountFilter, riskFilter, userRoleFilter, system.name, system.sid, userSortField, userSortOrder]);

  const parentRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_H, overscan: 12 });
  const items = virtualizer.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.name));
  const someSelected = rows.some((r) => selected.has(r.name));
  const toggle = (name: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });

  const clearFilters = () => {
    setPattern("");
    setType("all");
    setClassificationFilter("all");
    setProcess("all");
    setParentRoleFilter("all");
    setDept("all");
    setStatus("all");
    setRoleUserFilter("all");
    setAccountFilter("all");
    setRiskFilter("all");
    setUserRoleFilter("");
    setSystemFilter("all");
    setRoleSortField(null);
    setRoleSortOrder("asc");
    setUserSortField(null);
    setUserSortOrder("asc");
    setSelected(new Set());
  };

  const clearFilterFacets = () => {
    clearFilters();
  };

  const activeSort = view === "roles" ? roleSortField : userSortField;
  const activeSortOrder = view === "roles" ? roleSortOrder : userSortOrder;

  const activeFacetCount =
    (status !== "all" ? 1 : 0) +
    (systemFilter !== "all" ? 1 : 0) +
    (activeSort ? 1 : 0) +
    (view === "roles"
      ? (type !== "all" ? 1 : 0) + (classificationFilter !== "all" ? 1 : 0) + (process !== "all" ? 1 : 0) + (parentRoleFilter !== "all" ? 1 : 0) + (roleUserFilter !== "all" ? 1 : 0)
      : (dept !== "all" ? 1 : 0) + (accountFilter !== "all" ? 1 : 0) + (riskFilter !== "all" ? 1 : 0) + (userRoleFilter ? 1 : 0));

  const activeFilterCount = (pattern ? 1 : 0) + activeFacetCount;

  const analyseSelected = () => {
    const names = [...selected];
    startJob(`Analysis of ${names.length} role(s)`, async (p) => {
      const run = await runAnalysis({ roles: names }, p);
      const red = run.results.filter((r) => r.status === "red").length;
      navigate(`/roles/analysis?run=${run.runId}`);
      return { message: `${run.runId} · ${red} of ${names.length} need action`, link: `/roles/analysis?run=${run.runId}` };
    });
  };

  const analyseAllUsers = () => {
    toast.info("Background job started", { description: "Analysing all users against active SoD rules…" });
    startJob("User analysis (all users)", async (p) => {
      const run = await runAnalysis({ allUsers: true }, p);
      const red = run.results.filter((r) => r.status === "red").length;
      const green = run.results.filter((r) => r.status === "green").length;
      setView("users");
      toast.success("User analysis completed", {
        description: `${run.results.length} users analysed: ${green} Risk OK (Clean), ${red} with Red risks.`,
        action: {
          label: "View Report",
          onClick: () => navigate(`/roles/analysis?run=${run.runId}&kind=User`),
        },
      });
      return { message: `${run.results.length} users analysed · ${red} with Red risks · ${green} Risk OK`, link: `/roles/analysis?run=${run.runId}&kind=User` };
    });
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    const syncType = getLastSyncType(system.id);
    setIsRefreshing(true);
    toast.loading(`Syncing live roles from SAP ${system.sid}...`, { id: "refresh-sync" });
    try {
      // 1. Fast live delta: pull recently created/modified cloud roles (< 1 sec)
      await syncRecentRolesFromSap(system.id).catch(() => null);

      // 2. Background snapshot synchronization
      startJob(`${syncType} sync ${system.sid}`, async (p) => {
        const n = await syncNow(system.id, syncType, p);
        toast.success(`SAP ${system.sid} (${syncType} sync) synchronized`, {
          id: "refresh-sync",
          description: `${n.toLocaleString()} records updated from live snapshot.`,
        });
        return { message: `${n.toLocaleString()} records updated (${syncType} sync)`, link: "/settings?tab=connections" };
      });
    } catch (e) {
      toast.error(`Failed to ${syncType.toLowerCase()} sync`, { id: "refresh-sync", description: (e as Error).message });
    } finally {
      setTimeout(() => setIsRefreshing(false), 900);
    }
  };

  const exportExcel = () => {
    if (view === "users") {
      const ws = XLSX.utils.json_to_sheet(
        userRows.map((u) => ({
          "User ID": u.id,
          Name: u.name,
          System: system.name,
          Department: u.department,
          Roles: u.roles.join(", "),
          Status: { red: "Red – Act now", amber: "Amber – Review", green: "Green – Clean (Risk OK)", grey: "Grey – Not analysed" }[u.status],
          "Risk hits": u.hits.length,
          "Valid to": u.validTo,
          Locked: u.locked ? "Yes" : "No",
        })),
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Users");
      XLSX.writeFile(wb, `MySODAI_users_${system.sid}_${todayStamp()}.xlsx`);
      toast.success(`Exported ${userRows.length} users`);
      return;
    }
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        "Role name": r.name,
        System: system.name,
        Description: r.description,
        Type: r.type,
        Classification: r.flagType ?? "—",
        "Parent role": r.parent ?? "",
        Process: r.process,
        "Created date": r.createDat ? fmtDate(r.createDat) : "—",
        "Created by": r.createUsr || "SAP",
        "Last changed": fmtDate(r.lastChanged),
        "Changed by": r.changeUsr || r.owner || "SAP",
        "Users assigned": data!.userCount[r.name],
        Status: { red: "Red – Act now", amber: "Amber – Review", green: "Green – Clean", grey: "Grey – Not analysed" }[data!.statuses[r.name]],
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Roles");
    XLSX.writeFile(wb, `MySODAI_roles_${system.sid}_${todayStamp()}.xlsx`);
    toast.success(`Exported ${rows.length} roles`);
  };

  return (
    <>
      <PageHeader
        className="mb-2.5 space-y-1.5"
        crumbs={[{ label: "Home", to: "/" }, { label: "Roles & Analysis" }]}
        title={<span className="text-xl font-bold tracking-tight text-foreground">Roles & Analysis</span>}
        description={
          <span className="text-xs text-muted-foreground">
            S/4HANA snapshot master roles and assigned users with real-time Segregation of Duties (SoD) evaluation.
          </span>
        }
        actions={
          <div
            className="inline-flex items-center rounded-lg border border-border/70 bg-muted/60 p-0.5 text-muted-foreground shadow-2xs"
            role="tablist"
            aria-label="View selection"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "roles"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === "roles"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40",
              )}
              onClick={() => setView("roles")}
            >
              <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
              <span>Roles</span>
              <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 py-0.2 text-[10px] font-mono font-medium text-foreground">
                {(data?.roles.length ?? 0).toLocaleString()}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "users"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === "users"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40",
              )}
              onClick={() => setView("users")}
            >
              <Users className="h-3.5 w-3.5" aria-hidden />
              <span>Users</span>
              <span className="ml-1 rounded-full bg-muted-foreground/15 px-1.5 py-0.2 text-[10px] font-mono font-medium text-foreground">
                {(data?.users.length ?? 0).toLocaleString()}
              </span>
            </button>
          </div>
        }
      />

      <Card className="overflow-hidden border border-border/80 shadow-xs">
        {/* Unified Single-Line Table Header: Analyze Actions -> Active Filters -> Utilities */}
        <div className="border-b bg-muted/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2 flex-nowrap overflow-x-auto">
            {/* Left Flow: Analyze Actions -> Active Filters */}
            <div className="flex items-center gap-2 flex-nowrap shrink-0">
              {/* Analyze Actions */}
              <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
                {view === "roles" ? (
                  <>
                    <Button
                      size="sm"
                      className="h-8 px-2.5 text-xs font-medium whitespace-nowrap shrink-0 shadow-2xs"
                      onClick={analyseSelected}
                      disabled={!selected.size || !can("edit")}
                      title="Run SoD compliance analysis on selected roles"
                    >
                      <Play className="h-3.5 w-3.5 mr-1" />
                      Analyse selected{selected.size ? ` (${selected.size})` : ""}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 px-2.5 text-xs font-normal whitespace-nowrap shrink-0"
                      onClick={analyseAllUsers}
                      disabled={!can("edit")}
                      title="Trigger background job to evaluate all users against active SoD rules"
                    >
                      <Users className="h-3.5 w-3.5 mr-1" />
                      Analyse all users
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      className="h-8 px-2.5 text-xs font-medium whitespace-nowrap shrink-0 shadow-2xs"
                      onClick={analyseAllUsers}
                      disabled={!can("edit")}
                    >
                      <Users className="h-3.5 w-3.5 mr-1" />
                      Analyse all users
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 text-xs bg-background whitespace-nowrap shrink-0"
                      onClick={() => navigate("/roles/analysis?kind=User")}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                      View report
                    </Button>
                  </>
                )}
              </div>

              {/* Active Filter Chips (Rendered when column filters or searches are active) */}
              {activeFilterCount > 0 && (
                <>
                  <div className="h-4 w-px bg-border/80 shrink-0 mx-0.5" aria-hidden />
                  <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
                    {pattern && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 border border-border/60 px-2 py-0.5 text-[11px] text-foreground shrink-0 max-w-[140px] truncate animate-in fade-in-50">
                        <span className="text-muted-foreground font-normal">Search:</span> <span className="truncate font-mono">{pattern}</span>
                        <button type="button" onClick={() => setPattern("")} className="text-muted-foreground hover:text-foreground ml-0.5" title="Clear search filter">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {systemFilter !== "all" && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 border border-border/60 px-2 py-0.5 text-[11px] text-foreground shrink-0 animate-in fade-in-50">
                        <span className="text-muted-foreground font-normal">Sys:</span> {systemFilter}
                        <button type="button" onClick={() => setSystemFilter("all")} className="text-muted-foreground hover:text-foreground ml-0.5" title="Remove system filter">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {view === "roles" && type !== "all" && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 border border-border/60 px-2 py-0.5 text-[11px] text-foreground shrink-0 animate-in fade-in-50">
                        <span className="text-muted-foreground font-normal">Type:</span> {type}
                        <button type="button" onClick={() => setType("all")} className="text-muted-foreground hover:text-foreground ml-0.5" title="Remove type filter">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {view === "roles" && classificationFilter !== "all" && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 border border-border/60 px-2 py-0.5 text-[11px] text-foreground shrink-0 animate-in fade-in-50">
                        <span className="text-muted-foreground font-normal">Class:</span> {classificationFilter}
                        <button type="button" onClick={() => setClassificationFilter("all")} className="text-muted-foreground hover:text-foreground ml-0.5" title="Remove classification filter">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {view === "roles" && process !== "all" && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 border border-border/60 px-2 py-0.5 text-[11px] text-foreground shrink-0 max-w-[140px] truncate animate-in fade-in-50">
                        <span className="text-muted-foreground font-normal">Proc:</span> <span className="truncate">{process}</span>
                        <button type="button" onClick={() => setProcess("all")} className="text-muted-foreground hover:text-foreground ml-0.5" title="Remove process filter">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {view === "roles" && parentRoleFilter !== "all" && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 border border-border/60 px-2 py-0.5 text-[11px] text-foreground shrink-0 animate-in fade-in-50">
                        <span className="text-muted-foreground font-normal">Parent:</span> {parentRoleFilter === "with_parent" ? "Derived (Has Parent)" : "No Parent"}
                        <button type="button" onClick={() => setParentRoleFilter("all")} className="text-muted-foreground hover:text-foreground ml-0.5" title="Remove parent role filter">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {status !== "all" && (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/80 border border-border/60 px-2 py-0.5 text-[11px] text-foreground shrink-0 animate-in fade-in-50">
                        <span className="text-muted-foreground font-normal">Status:</span>
                        <StatusBadge status={status as Status} size="sm" />
                        <button type="button" onClick={() => setStatus("all")} className="text-muted-foreground hover:text-foreground ml-0.5" title="Remove status filter">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {view === "users" && dept !== "all" && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 border border-border/60 px-2 py-0.5 text-[11px] text-foreground shrink-0 animate-in fade-in-50">
                        <span className="text-muted-foreground font-normal">Dept:</span> {dept}
                        <button type="button" onClick={() => setDept("all")} className="text-muted-foreground hover:text-foreground ml-0.5" title="Remove department filter">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {view === "users" && userRoleFilter && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 border border-border/60 px-2 py-0.5 text-[11px] text-foreground shrink-0 max-w-[180px] truncate animate-in fade-in-50">
                        <span className="text-muted-foreground font-normal">Role:</span>
                        <span className="truncate font-mono">{userRoleFilter}</span>
                        <button type="button" onClick={() => setUserRoleFilter("")} className="text-muted-foreground hover:text-foreground ml-0.5" title="Remove role filter">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {activeSort && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/30 px-2 py-0.5 text-[11px] text-primary font-medium shrink-0 animate-in fade-in-50">
                        <span>Sort: {activeSort}</span>
                        {activeSortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                        <button
                          type="button"
                          onClick={() => {
                            if (view === "roles") setRoleSortField(null);
                            else setUserSortField(null);
                          }}
                          className="hover:text-foreground ml-0.5"
                          title="Clear sort"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-[11px] text-muted-foreground hover:text-foreground font-medium underline-offset-2 hover:underline shrink-0 ml-0.5"
                      title="Reset all active filters"
                    >
                      Clear all
                    </button>
                    {view === "roles" && (
                      <button
                        type="button"
                        onClick={() => {
                          setRoleSortField("createDat");
                          setRoleSortOrder("desc");
                        }}
                        className={cn(
                          "text-[11px] font-medium px-2 py-0.5 rounded border transition-colors shrink-0 ml-1.5 flex items-center gap-1",
                          roleSortField === "createDat" && roleSortOrder === "desc"
                            ? "bg-primary/10 border-primary/30 text-primary font-semibold"
                            : "border-border/70 hover:bg-muted text-muted-foreground hover:text-foreground"
                        )}
                        title="Sort by newly created roles from SAP BTP Cloud"
                      >
                        <Sparkles className="h-3 w-3 text-amber-500" />
                        Newest First
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Right Flow: Utilities (Template, Export) & Interactive Refresh */}
            <div className="flex items-center gap-1.5 flex-nowrap shrink-0 text-xs text-muted-foreground">
              {view === "roles" && (
                <>
                  {can("edit") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 text-xs bg-background hover:bg-muted font-medium whitespace-nowrap shrink-0"
                      onClick={() => setCreateRoleOpen(true)}
                      title="Create a new SAP role via CAP write action (createRole)"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5 text-primary" />
                      Create SAP Role
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs bg-background hover:bg-muted font-normal text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0"
                    onClick={() => setTemplateOpen(true)}
                    title="Download SoD role template"
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Template
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs bg-background hover:bg-muted font-normal text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0"
                onClick={exportExcel}
                disabled={view === "roles" ? !rows.length : !userRows.length}
                title="Export table records to Excel"
              >
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Export
              </Button>

              {/* Interactive Animated Refresh Pill (Runs previous connection sync type: Delta or Full, without dialog) */}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={cn(
                  "group inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-2xs transition-all duration-200 shrink-0 whitespace-nowrap",
                  "hover:border-primary/50 hover:bg-accent/60 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-60",
                  isRefreshing && "border-primary/40 bg-primary/5 text-primary",
                )}
                title={`Click to refresh snapshot via ${currentSyncType} sync (previous connection sync: ${currentSyncType})`}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-500 text-muted-foreground group-hover:text-foreground group-hover:rotate-180",
                    isRefreshing && "animate-spin text-primary",
                  )}
                />
                <span className="font-medium">{isRefreshing ? `Syncing (${currentSyncType})…` : `Refresh (${currentSyncType})`}</span>
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : view === "roles" ? (
          rows.length === 0 ? (
            <EmptyState
              className="m-4"
              icon={SearchX}
              title="No roles match these filters."
              action={
                <Button onClick={clearFilters}>
                  <X /> Clear filters
                </Button>
              }
            />
          ) : (
            <div ref={parentRef} className="max-h-[calc(100vh-190px)] min-h-[460px] overflow-auto" role="region" aria-label="Role list" tabIndex={-1}>
              <table className="w-full min-w-[1773px] table-fixed text-sm border-separate border-spacing-0" aria-rowcount={rows.length + 1}>
                <thead className="sticky top-0 z-20 bg-muted">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th
                      className="sticky top-0 z-20 w-12 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted border-b border-border cursor-pointer hover:text-foreground select-none"
                      onClick={() => { setRoleSortField(null); setRoleSortOrder("asc"); }}
                      title="Click to reset to default order"
                    >
                      #
                    </th>
                    <th className="sticky top-0 z-20 w-10 px-3 py-2 bg-muted border-b border-border text-center">
                      <Checkbox
                        aria-label="Select all visible roles"
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.name)) : new Set())}
                      />
                    </th>
                    <th className="sticky top-0 z-20 w-[240px] px-3 py-2 bg-muted border-b border-border">
                      <ColumnHeaderFilter
                        title="Role name"
                        isActive={!!pattern}
                        onReset={() => setPattern("")}
                        sortField="name"
                        currentSortField={roleSortField}
                        sortOrder={roleSortOrder}
                        onSort={toggleRoleSort}
                      >
                        <div className="space-y-2">
                          <Input
                            placeholder="Search (e.g. Z_FI_*)..."
                            value={pattern}
                            onChange={(e) => setPattern(e.target.value)}
                            className="h-7 text-xs bg-background"
                            autoFocus
                          />
                          <div className="pt-1 border-t border-border/50">
                            <div className="text-[10px] text-muted-foreground font-medium mb-1">Quick presets:</div>
                            <div className="flex flex-wrap gap-1">
                              {["Z_*", "SAP_*", "Z_FI_*", "Z_MM_*", "Z_SD_*"].map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => setPattern(p)}
                                  className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors",
                                    pattern === p ? "bg-primary text-primary-foreground font-semibold" : "bg-muted hover:bg-accent text-foreground",
                                  )}
                                >
                                  {p}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </ColumnHeaderFilter>
                    </th>
                    <th className="sticky top-0 z-20 w-[280px] px-3 py-2 bg-muted border-b border-border shadow-2xs">
                      <ColumnHeaderFilter
                        title="System"
                        isActive={systemFilter !== "all"}
                        onReset={() => setSystemFilter("all")}
                        sortField="system"
                        currentSortField={roleSortField}
                        sortOrder={roleSortOrder}
                        onSort={toggleRoleSort}
                      >
                        <div className="space-y-1">
                          <button
                            type="button"
                            onClick={() => setSystemFilter("all")}
                            className={cn(
                              "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                              systemFilter === "all" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                            )}
                          >
                            <span>All Systems</span>
                            {systemFilter === "all" && <Check className="h-3 w-3 text-primary" />}
                          </button>
                          {systemOptions.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setSystemFilter(s)}
                              className={cn(
                                "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                                systemFilter === s ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                              )}
                            >
                              <span>{s}</span>
                              {systemFilter === s && <Check className="h-3 w-3 text-primary" />}
                            </button>
                          ))}
                        </div>
                      </ColumnHeaderFilter>
                    </th>
                    <th className="sticky top-0 z-20 min-w-[280px] px-3 py-2 bg-muted border-b border-border">
                      <ColumnHeaderFilter
                        title="Description"
                        isActive={!!pattern && !pattern.startsWith("Z_") && !pattern.startsWith("SAP_")}
                        onReset={() => setPattern("")}
                        sortField="description"
                        currentSortField={roleSortField}
                        sortOrder={roleSortOrder}
                        onSort={toggleRoleSort}
                      >
                        <Input
                          placeholder="Search description..."
                          value={pattern}
                          onChange={(e) => setPattern(e.target.value)}
                          className="h-7 text-xs bg-background"
                          autoFocus
                        />
                      </ColumnHeaderFilter>
                    </th>
                    <th className="sticky top-0 z-20 w-[110px] px-3 py-2 bg-muted border-b border-border">
                      <ColumnHeaderFilter
                        title="Type"
                        isActive={type !== "all"}
                        onReset={() => setType("all")}
                        sortField="type"
                        currentSortField={roleSortField}
                        sortOrder={roleSortOrder}
                        onSort={toggleRoleSort}
                      >
                        <div className="space-y-1">
                          {["all", "Single", "Composite", "Derived"].map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setType(t)}
                              className={cn(
                                "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                                type === t ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                              )}
                            >
                              <span>{t === "all" ? "All Types" : t}</span>
                              {type === t && <Check className="h-3 w-3 text-primary" />}
                            </button>
                          ))}
                        </div>
                      </ColumnHeaderFilter>
                    </th>
                    <th className="sticky top-0 z-20 w-[120px] px-3 py-2 bg-muted border-b border-border">
                      <ColumnHeaderFilter
                        title="Classification"
                        isActive={classificationFilter !== "all"}
                        onReset={() => setClassificationFilter("all")}
                        sortField="flagType"
                        currentSortField={roleSortField}
                        sortOrder={roleSortOrder}
                        onSort={toggleRoleSort}
                      >
                        <div className="space-y-1">
                          {["all", "COLL_AGR", "NONE"].map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setClassificationFilter(f)}
                              className={cn(
                                "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                                classificationFilter === f ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                              )}
                            >
                              <span>{f === "all" ? "All Classifications" : f === "NONE" ? "None (Empty)" : f}</span>
                              {classificationFilter === f && <Check className="h-3 w-3 text-primary" />}
                            </button>
                          ))}
                        </div>
                      </ColumnHeaderFilter>
                    </th>
                    <th className="sticky top-0 z-20 w-[140px] px-3 py-2 bg-muted border-b border-border">
                      <ColumnHeaderFilter
                        title="Process"
                        isActive={process !== "all"}
                        onReset={() => setProcess("all")}
                        sortField="process"
                        currentSortField={roleSortField}
                        sortOrder={roleSortOrder}
                        onSort={toggleRoleSort}
                      >
                        <div className="space-y-1 max-h-56 overflow-y-auto">
                          <button
                            type="button"
                            onClick={() => setProcess("all")}
                            className={cn(
                              "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                              process === "all" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                            )}
                          >
                            <span>All Processes</span>
                            {process === "all" && <Check className="h-3 w-3 text-primary" />}
                          </button>
                          {PROCESSES.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setProcess(p)}
                              className={cn(
                                "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                process === p ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                              )}
                            >
                              <span className="truncate">{p}</span>
                              {process === p && <Check className="h-3 w-3 text-primary shrink-0 ml-1" />}
                            </button>
                          ))}
                        </div>
                      </ColumnHeaderFilter>
                    </th>
                    <th className="sticky top-0 z-20 w-[140px] px-3 py-2 bg-muted border-b border-border">
                      <ColumnHeaderFilter
                        title="Parent role"
                        sortField="parent"
                        currentSortField={roleSortField}
                        sortOrder={roleSortOrder}
                        onSort={toggleRoleSort}
                        isActive={parentRoleFilter !== "all"}
                        onReset={() => setParentRoleFilter("all")}
                      >
                        <div className="p-1 space-y-1 min-w-[210px]">
                          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Role Inheritance
                          </div>
                          <button
                            type="button"
                            onClick={() => setParentRoleFilter("all")}
                            className={cn(
                              "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                              parentRoleFilter === "all" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                            )}
                          >
                            <span>All Roles ({data?.roles.length.toLocaleString() ?? 0})</span>
                            {parentRoleFilter === "all" && <Check className="h-3 w-3 text-primary" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setParentRoleFilter("with_parent")}
                            className={cn(
                              "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                              parentRoleFilter === "with_parent" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                            )}
                          >
                            <span>Derived Roles ({data ? data.roles.filter((r) => Boolean(r.parent)).length : 0})</span>
                            {parentRoleFilter === "with_parent" && <Check className="h-3 w-3 text-primary" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setParentRoleFilter("no_parent")}
                            className={cn(
                              "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                              parentRoleFilter === "no_parent" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                            )}
                          >
                            <span>Standalone / Composite ({data ? data.roles.filter((r) => !r.parent).length.toLocaleString() : 0})</span>
                            {parentRoleFilter === "no_parent" && <Check className="h-3 w-3 text-primary" />}
                          </button>
                          <div className="mt-1.5 pt-1.5 border-t border-border px-2 py-1 text-[10px] text-muted-foreground leading-snug">
                            In SAP PFCG, only derived roles inherit authorization templates from a parent role. Single &amp; composite roles have no parent template.
                          </div>
                        </div>
                      </ColumnHeaderFilter>
                    </th>
                    <th className="sticky top-0 z-20 w-[125px] px-3 py-2 bg-muted border-b border-border">
                      <ColumnHeaderFilter
                        title="Created"
                        sortField="createDat"
                        currentSortField={roleSortField}
                        sortOrder={roleSortOrder}
                        onSort={toggleRoleSort}
                      />
                    </th>
                    <th className="sticky top-0 z-20 w-[125px] px-3 py-2 bg-muted border-b border-border">
                      <ColumnHeaderFilter
                        title="Last changed"
                        sortField="lastChanged"
                        currentSortField={roleSortField}
                        sortOrder={roleSortOrder}
                        onSort={toggleRoleSort}
                      />
                    </th>
                    <th className="sticky top-0 z-20 w-[85px] px-3 py-2 text-right bg-muted border-b border-border">
                      <div className="flex justify-end">
                        <ColumnHeaderFilter
                          title="Users"
                          isActive={roleUserFilter !== "all"}
                          align="end"
                          onReset={() => setRoleUserFilter("all")}
                          sortField="userCount"
                          currentSortField={roleSortField}
                          sortOrder={roleSortOrder}
                          onSort={toggleRoleSort}
                        >
                          <div className="space-y-1">
                            {[
                              { val: "all", label: "All Roles" },
                              { val: "assigned", label: "Assigned (> 0 users)" },
                              { val: "unassigned", label: "Unassigned (0 users)" },
                              { val: "high", label: "High usage (> 5 users)" },
                            ].map((item) => (
                              <button
                                key={item.val}
                                type="button"
                                onClick={() => setRoleUserFilter(item.val)}
                                className={cn(
                                  "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                                  roleUserFilter === item.val ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                                )}
                              >
                                <span>{item.label}</span>
                                {roleUserFilter === item.val && <Check className="h-3 w-3 text-primary" />}
                              </button>
                            ))}
                          </div>
                        </ColumnHeaderFilter>
                      </div>
                    </th>
                    <th className="sticky top-0 z-20 w-[130px] px-3 py-2 bg-muted border-b border-border">
                      <ColumnHeaderFilter
                        title="Status"
                        isActive={status !== "all"}
                        align="end"
                        onReset={() => setStatus("all")}
                        sortField="status"
                        currentSortField={roleSortField}
                        sortOrder={roleSortOrder}
                        onSort={toggleRoleSort}
                      >
                        <div className="space-y-1">
                          {[
                            { val: "all", label: "All Statuses", dot: "bg-muted-foreground" },
                            { val: "red", label: "Critical (Red)", dot: "bg-red-500" },
                            { val: "amber", label: "Review (Amber)", dot: "bg-amber-500" },
                            { val: "green", label: "Clean (Green)", dot: "bg-emerald-500" },
                            { val: "grey", label: "Unanalysed (Grey)", dot: "bg-slate-400" },
                          ].map((item) => (
                            <button
                              key={item.val}
                              type="button"
                              onClick={() => setStatus(item.val)}
                              className={cn(
                                "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                                status === item.val ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                              )}
                            >
                              <span className="flex items-center gap-1.5">
                                <span className={cn("h-2 w-2 rounded-full", item.dot)} />
                                <span>{item.label}</span>
                              </span>
                              {status === item.val && <Check className="h-3 w-3 text-primary" />}
                            </button>
                          ))}
                        </div>
                      </ColumnHeaderFilter>
                    </th>
                  </tr>
                </thead>
                <tbody className="[&>tr>td]:border-b [&>tr>td]:border-border/60">
                  {padTop > 0 && (
                    <tr aria-hidden style={{ height: padTop }}>
                      <td colSpan={13} style={{ height: padTop, padding: 0, border: 0 }} />
                    </tr>
                  )}
                  {items.map((vi) => {
                    const r = rows[vi.index];
                    const sel = selected.has(r.name);
                    const open = () => navigate(`/roles/${encodeURIComponent(r.name)}`);
                    return (
                      <tr
                        key={r.name}
                        aria-rowindex={vi.index + 2}
                        data-state={sel ? "selected" : undefined}
                        tabIndex={0}
                        style={{ height: ROW_H }}
                        className={cn("cursor-pointer border-b hover:bg-muted/40 focus-visible:bg-accent/50 focus-visible:outline-none data-[state=selected]:bg-accent/50")}
                        onClick={open}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") open();
                          if (e.key === " ") {
                            e.preventDefault();
                            toggle(r.name);
                          }
                        }}
                      >
                        <td className="px-2 text-center font-mono text-xs text-muted-foreground/80 select-none">
                          {vi.index + 1}
                        </td>
                        <td className="px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={sel} onCheckedChange={() => toggle(r.name)} aria-label={`Select ${r.name}`} />
                        </td>
                        <td className="px-3 overflow-hidden">
                          <div className="font-mono text-[13px] font-semibold text-foreground flex items-center gap-2 truncate">
                            <span className="truncate" title={r.name}>{r.name}</span>
                            {((r.authCount ?? 0) > 0 || (r.tcodeCount ?? 0) > 0 || (r.orgCount ?? 0) > 0) && (
                              <span className="hidden sm:inline-flex shrink-0 text-[10px] text-muted-foreground font-mono bg-muted/80 px-1.5 py-0.5 rounded border border-border/50">
                                {r.tcodeCount ?? 0} tc · {r.authCount ?? 0} auth{r.orgCount ? ` · ${r.orgCount} org` : ""}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 whitespace-nowrap overflow-hidden">
                          <span className="inline-flex items-center gap-1.5 rounded border border-border/80 bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-foreground truncate max-w-full">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                            <span className="truncate">{system.name}</span>
                          </span>
                        </td>
                        <td className="truncate px-3 text-muted-foreground" title={r.description}>{r.description}</td>
                        <td className="px-3 whitespace-nowrap">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[11px] font-medium border",
                            r.type === "Composite" ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" :
                            r.type === "Derived" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" :
                            "bg-muted text-foreground border-border/60"
                          )}>
                            {r.type}
                          </span>
                        </td>
                        <td className="px-3 whitespace-nowrap">
                          <span className="font-mono text-[11px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded border border-border/50">
                            {r.flagType || "—"}
                          </span>
                        </td>
                        <td className="px-3 text-xs text-muted-foreground truncate" title={r.process}>{r.process}</td>
                        <td className="px-3 font-mono text-xs truncate">
                          {r.parent ? (
                            <Link
                              to={`/roles/${encodeURIComponent(r.parent)}`}
                              className="text-primary hover:underline font-medium inline-flex items-center gap-1 max-w-full truncate"
                              title={`Parent template role: ${r.parent} (Derived inheritance)`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="truncate">{r.parent}</span>
                              <ExternalLink className="h-3 w-3 opacity-60 shrink-0" />
                            </Link>
                          ) : (
                            <span className="text-muted-foreground/50 select-none" title="Standalone or composite role (no parent role template)">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 whitespace-nowrap">
                          <div className="text-xs text-muted-foreground leading-tight">{r.createDat ? fmtDate(r.createDat) : "—"}</div>
                          <div className="text-[10px] text-muted-foreground/70 font-mono">{r.createUsr ? `by ${r.createUsr}` : "—"}</div>
                        </td>
                        <td className="px-3 whitespace-nowrap">
                          <div className="text-xs text-muted-foreground leading-tight">{fmtDate(r.lastChanged)}</div>
                          <div className="text-[10px] text-muted-foreground/70 font-mono">by {r.changeUsr || r.owner || "SAP"}</div>
                        </td>
                        <td className="tabular px-3 text-right whitespace-nowrap">{data!.userCount[r.name]}</td>
                        <td className="px-3 whitespace-nowrap">
                          <StatusBadge status={data!.statuses[r.name]} size="sm" />
                        </td>
                      </tr>
                    );
                  })}
                  {padBottom > 0 && (
                    <tr aria-hidden style={{ height: padBottom }}>
                      <td colSpan={13} style={{ height: padBottom, padding: 0, border: 0 }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        ) : (data?.users.length ?? 0) === 0 ? (
          <EmptyState
            className="m-4"
            icon={Users}
            title="No SAP user-role assignments synced yet."
            action={
              <div className="flex flex-col items-center gap-3">
                <p className="max-w-md text-xs text-muted-foreground">
                  Enable User-to-Role Assignments (<span className="font-mono">RoleUserAssignments</span> / <span className="font-mono">ManagementRoles</span>) in Connections and run Sync now to import SAP user mappings.
                </p>
                <Button onClick={() => navigate("/settings?tab=connections")}>
                  Configure System API in Connections
                </Button>
              </div>
            }
          />
        ) : userRows.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={SearchX}
            title="No users match these filters."
            action={
              <Button onClick={clearFilters}>
                <X /> Clear filters
              </Button>
            }
          />
        ) : (
          <div className="max-h-[calc(100vh-190px)] min-h-[460px] overflow-auto" role="region" aria-label="User list" tabIndex={-1}>
            <table className="w-full min-w-[1608px] table-fixed text-sm border-separate border-spacing-0">
              <thead className="sticky top-0 z-20 bg-muted">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th
                    className="sticky top-0 z-20 w-12 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted border-b border-border cursor-pointer hover:text-foreground select-none"
                    onClick={() => { setUserSortField(null); setUserSortOrder("asc"); }}
                    title="Click to reset to default order"
                  >
                    #
                  </th>
                  <th className="sticky top-0 z-20 w-[150px] px-3 py-2 bg-muted border-b border-border">
                    <ColumnHeaderFilter
                      title="User ID"
                      isActive={!!pattern}
                      onReset={() => setPattern("")}
                      sortField="id"
                      currentSortField={userSortField}
                      sortOrder={userSortOrder}
                      onSort={toggleUserSort}
                    >
                      <Input
                        placeholder="Search User ID..."
                        value={pattern}
                        onChange={(e) => setPattern(e.target.value)}
                        className="h-7 text-xs bg-background"
                        autoFocus
                      />
                    </ColumnHeaderFilter>
                  </th>
                  <th className="sticky top-0 z-20 w-[200px] px-3 py-2 bg-muted border-b border-border shadow-2xs">
                    <ColumnHeaderFilter
                      title="Name"
                      isActive={!!pattern}
                      onReset={() => setPattern("")}
                      sortField="name"
                      currentSortField={userSortField}
                      sortOrder={userSortOrder}
                      onSort={toggleUserSort}
                    >
                      <Input
                        placeholder="Search Name..."
                        value={pattern}
                        onChange={(e) => setPattern(e.target.value)}
                        className="h-7 text-xs bg-background"
                        autoFocus
                      />
                    </ColumnHeaderFilter>
                  </th>
                  <th className="sticky top-0 z-20 w-[280px] px-3 py-2 bg-muted border-b border-border shadow-2xs">
                    <ColumnHeaderFilter
                      title="System"
                      isActive={systemFilter !== "all"}
                      onReset={() => setSystemFilter("all")}
                      sortField="system"
                      currentSortField={userSortField}
                      sortOrder={userSortOrder}
                      onSort={toggleUserSort}
                    >
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => setSystemFilter("all")}
                          className={cn(
                            "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                            systemFilter === "all" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                          )}
                        >
                          <span>All Systems</span>
                          {systemFilter === "all" && <Check className="h-3 w-3 text-primary" />}
                        </button>
                        {systemOptions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setSystemFilter(s)}
                            className={cn(
                              "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                              systemFilter === s ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                            )}
                          >
                            <span>{s}</span>
                            {systemFilter === s && <Check className="h-3 w-3 text-primary" />}
                          </button>
                        ))}
                      </div>
                    </ColumnHeaderFilter>
                  </th>
                  <th className="sticky top-0 z-20 w-[180px] px-3 py-2 bg-muted border-b border-border shadow-2xs">
                    <ColumnHeaderFilter
                      title="Department"
                      isActive={dept !== "all"}
                      onReset={() => setDept("all")}
                      sortField="department"
                      currentSortField={userSortField}
                      sortOrder={userSortOrder}
                      onSort={toggleUserSort}
                    >
                      <div className="space-y-1 max-h-56 overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => setDept("all")}
                          className={cn(
                            "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                            dept === "all" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                          )}
                        >
                          <span>All Departments</span>
                          {dept === "all" && <Check className="h-3 w-3 text-primary" />}
                        </button>
                        {departments.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDept(d)}
                            className={cn(
                              "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                              dept === d ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                            )}
                          >
                            <span className="truncate">{d}</span>
                            {dept === d && <Check className="h-3 w-3 text-primary shrink-0 ml-1" />}
                          </button>
                        ))}
                      </div>
                    </ColumnHeaderFilter>
                  </th>
                  <th className="sticky top-0 z-20 min-w-[300px] px-3 py-2 bg-muted border-b border-border">
                    <ColumnHeaderFilter
                      title="Assigned roles"
                      isActive={!!userRoleFilter}
                      onReset={() => setUserRoleFilter("")}
                      sortField="roles"
                      currentSortField={userSortField}
                      sortOrder={userSortOrder}
                      onSort={toggleUserSort}
                    >
                      <div className="space-y-2 p-0.5 min-w-[240px]">
                        <div className="relative">
                          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Search role name (e.g. /NEPTUNE/, SAP_BR)..."
                            value={userRoleFilter}
                            onChange={(e) => setUserRoleFilter(e.target.value)}
                            className="h-7 pl-8 text-xs bg-background"
                            autoFocus
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-normal">
                          Filter users who have at least one assigned role matching this text (supports wildcards e.g. <span className="font-mono">/SCWM/*</span>).
                        </p>
                        {userRoleFilter && (
                          <div className="flex items-center justify-between pt-1 border-t border-border/60 text-[11px]">
                            <span className="text-muted-foreground truncate max-w-[170px]">
                              Filter: <strong className="font-mono text-foreground">{userRoleFilter}</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => setUserRoleFilter("")}
                              className="text-primary hover:underline font-medium"
                            >
                              Clear filter
                            </button>
                          </div>
                        )}
                      </div>
                    </ColumnHeaderFilter>
                  </th>
                  <th className="sticky top-0 z-20 w-[130px] px-3 py-2 bg-muted border-b border-border">
                    <ColumnHeaderFilter
                      title="Valid to"
                      sortField="validTo"
                      currentSortField={userSortField}
                      sortOrder={userSortOrder}
                      onSort={toggleUserSort}
                    />
                  </th>
                  <th className="sticky top-0 z-20 w-[140px] px-3 py-2 bg-muted border-b border-border">
                    <ColumnHeaderFilter
                      title="Status"
                      isActive={status !== "all"}
                      align="end"
                      onReset={() => setStatus("all")}
                      sortField="status"
                      currentSortField={userSortField}
                      sortOrder={userSortOrder}
                      onSort={toggleUserSort}
                    >
                      <div className="space-y-1">
                        {[
                          { val: "all", label: "All Statuses", dot: "bg-muted-foreground" },
                          { val: "red", label: "Critical (Red)", dot: "bg-red-500" },
                          { val: "amber", label: "Review (Amber)", dot: "bg-amber-500" },
                          { val: "green", label: "Clean (Green)", dot: "bg-emerald-500" },
                          { val: "grey", label: "Unanalysed (Grey)", dot: "bg-slate-400" },
                        ].map((item) => (
                          <button
                            key={item.val}
                            type="button"
                            onClick={() => setStatus(item.val)}
                            className={cn(
                              "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                              status === item.val ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                            )}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className={cn("h-2 w-2 rounded-full", item.dot)} />
                              <span>{item.label}</span>
                            </span>
                            {status === item.val && <Check className="h-3 w-3 text-primary" />}
                          </button>
                        ))}
                      </div>
                    </ColumnHeaderFilter>
                  </th>
                  <th className="sticky top-0 z-20 w-[180px] px-3 py-2 bg-muted border-b border-border shadow-2xs">
                    <ColumnHeaderFilter title="SoD Risk Result" isActive={riskFilter !== "all"} align="end" onReset={() => setRiskFilter("all")}>
                      <div className="space-y-1">
                        {[
                          { val: "all", label: "All Users" },
                          { val: "violating", label: "With Violations" },
                          { val: "clean", label: "Clean (0 Risks)" },
                        ].map((item) => (
                          <button
                            key={item.val}
                            type="button"
                            onClick={() => setRiskFilter(item.val)}
                            className={cn(
                              "w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between",
                              riskFilter === item.val ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground",
                            )}
                          >
                            <span>{item.label}</span>
                            {riskFilter === item.val && <Check className="h-3 w-3 text-primary" />}
                          </button>
                        ))}
                      </div>
                    </ColumnHeaderFilter>
                  </th>
                </tr>
              </thead>
              <tbody className="[&>tr>td]:border-b [&>tr>td]:border-border/60">
                {userRows.map((u, idx) => {
                  const openAnalysis = () => navigate(`/roles/analysis?kind=User&subject=${encodeURIComponent(u.id)}`);
                  return (
                    <tr
                      key={u.id}
                      tabIndex={0}
                      className="cursor-pointer border-b hover:bg-muted/40 focus-visible:bg-accent/50 focus-visible:outline-none"
                      onClick={() => setSelectedUser(u)}
                      onKeyDown={(e) => e.key === "Enter" && setSelectedUser(u)}
                    >
                      <td className="px-2 py-3 text-center font-mono text-xs text-muted-foreground/80 select-none">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs font-semibold truncate text-primary hover:underline">
                        {u.id}
                      </td>
                      <td className="px-3 py-3 font-medium truncate" title={u.name}>{u.name}</td>
                      <td className="px-3 py-3 whitespace-nowrap overflow-hidden">
                        <span className="inline-flex items-center gap-1.5 rounded border border-border/80 bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-foreground truncate max-w-full">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                          <span className="truncate">{system.name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground truncate" title={u.department}>{u.department}</td>
                      <td className="px-3 py-3 text-xs" onClick={(e) => { e.stopPropagation(); setSelectedUser(u); }}>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs font-mono font-semibold bg-muted/80 hover:bg-primary/10 hover:text-primary transition-colors border-border/70 shrink-0"
                            title={`Click to view all ${u.roles.length} roles assigned to ${u.id}`}
                          >
                            <Layers className="h-3 w-3 mr-1 text-primary" />
                            {u.roles.length} role{u.roles.length === 1 ? "" : "s"}
                          </Button>
                          <span className="text-muted-foreground truncate max-w-[200px]" title={u.roles.join(", ")}>
                            {u.roles.slice(0, 2).join(", ")}{u.roles.length > 2 ? ` (+${u.roles.length - 2} more)` : ""}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(u.validTo)}
                        {u.locked && <span className="ml-1 rounded bg-status-red-bg px-1.5 py-0.5 text-[10px] font-semibold text-status-red">Locked</span>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <StatusBadge status={u.status} size="sm" />
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        <div className="flex items-center justify-between gap-2">
                          {u.hits.length === 0 ? (
                            <span className="font-medium text-status-green flex items-center gap-1.5">
                              ✓ Risk OK · Clean
                            </span>
                          ) : (
                            <span className="font-medium text-status-red">
                              {u.hits.length} risk hit(s)
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAnalysis();
                            }}
                            title={`Open SoD analysis page for ${u.id}`}
                          >
                            <Play className="h-3 w-3 mr-1" />
                            Analyze
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground bg-muted/20">
          <div className="flex items-center gap-2.5">
            <span>
              {view === "roles" ? `${rows.length} of ${data?.roles.length ?? 0} roles` : `${userRows.length} of ${data?.users.length ?? 0} users`}
              {view === "roles" && selected.size ? ` · ${selected.size} selected` : ""} · Click row to drill down
            </span>
            <span className="hidden sm:inline text-border">·</span>
            <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px]">
              Snapshot: <strong className="font-normal text-foreground">{fmtDateTime(snap.snapshot)}</strong>
            </span>
            <span className="hidden md:inline-flex items-center gap-1.5 rounded border border-border/70 bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {system.name} (Client {system.client})
            </span>
          </div>
          <StatusLegend />
        </div>
      </Card>

      <TemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} selected={[...selected]} />
      <CreateSapRoleDialog
        open={createRoleOpen}
        onOpenChange={setCreateRoleOpen}
        systemId={system.id}
        onSuccess={(newRole) => {
          setPattern(newRole);
          toast.success(`Role ${newRole} is now active in Roles & Analysis`);
        }}
      />
      <UserDetailDrawer user={selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)} />
    </>
  );
}

const roleUserMap: Record<string, string> = {
  all: "All Roles",
  assigned: "Assigned (>0)",
  unassigned: "Unassigned (0)",
  high: "High (>5)",
};

const accountMap: Record<string, string> = {
  all: "All Accounts",
  active: "Active only",
  locked: "Locked only",
};

const riskMap: Record<string, string> = {
  all: "All Users",
  violating: "With Violations",
  clean: "Clean (0 Risks)",
};

function ColumnHeaderFilter({
  title,
  isActive,
  align = "start",
  children,
  onReset,
  sortField,
  currentSortField,
  sortOrder,
  onSort,
}: {
  title: string;
  isActive?: boolean;
  align?: "start" | "end";
  children?: React.ReactNode;
  onReset?: () => void;
  sortField?: string;
  currentSortField?: string | null;
  sortOrder?: "asc" | "desc";
  onSort?: (field: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const isSorted = !!sortField && currentSortField === sortField;

  return (
    <div className="inline-flex items-center gap-1 group">
      {sortField && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortField)}
          className={cn(
            "flex items-center gap-1 font-semibold tracking-wide uppercase text-xs transition-colors select-none text-left rounded hover:bg-muted/60 py-0.5 px-1 -ml-1",
            isSorted ? "text-primary font-bold" : "text-muted-foreground group-hover:text-foreground",
          )}
          title={`Click to sort by ${title} (${isSorted ? (sortOrder === "asc" ? "Ascending → Click for Descending" : "Descending → Click to clear") : "Sort Ascending"})`}
        >
          <span className="whitespace-nowrap">{title}</span>
          {isSorted ? (
            sortOrder === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5 text-primary stroke-[2.5]" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5 text-primary stroke-[2.5]" />
            )
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground" />
          )}
        </button>
      ) : (
        <span className="font-semibold tracking-wide uppercase text-xs text-muted-foreground group-hover:text-foreground transition-colors whitespace-nowrap">
          {title}
        </span>
      )}

      {children && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded transition-all",
                "hover:bg-accent hover:text-foreground text-muted-foreground/60",
                isActive && "bg-primary/15 text-primary font-medium hover:bg-primary/25 shadow-2xs",
              )}
              title={`Filter & sort ${title}`}
              aria-label={`Filter & sort ${title}`}
            >
              <Filter className={cn("h-3 w-3", isActive && "fill-primary text-primary")} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align={align}
            className="w-64 p-2.5 shadow-lg border rounded-lg bg-popover text-popover-foreground z-30 font-normal normal-case"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/70">
              <div className="flex items-center gap-1.5">
                <Filter className="h-3 w-3 text-primary" />
                <span className="text-xs font-semibold text-foreground">Filter & Sort</span>
              </div>
              {isActive && onReset && (
                <button
                  type="button"
                  onClick={() => {
                    onReset();
                    setOpen(false);
                  }}
                  className="text-[10px] text-muted-foreground hover:text-foreground font-medium underline"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Quick Sort Section inside Popover */}
            {sortField && onSort && (
              <div className="mb-2 pb-2 border-b border-border/60">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>Sort Order</span>
                  {isSorted && (
                    <button
                      type="button"
                      onClick={() => onSort(sortField)}
                      className="text-primary hover:underline lowercase font-normal"
                    >
                      toggle
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSorted || sortOrder !== "asc") onSort(sortField);
                    }}
                    className={cn(
                      "flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs transition-colors border",
                      isSorted && sortOrder === "asc"
                        ? "bg-primary/15 text-primary font-semibold border-primary/30"
                        : "hover:bg-muted text-foreground border-border/50"
                    )}
                  >
                    <ArrowUp className="h-3 w-3" />
                    <span>Ascending</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSorted || sortOrder !== "desc") onSort(sortField);
                    }}
                    className={cn(
                      "flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs transition-colors border",
                      isSorted && sortOrder === "desc"
                        ? "bg-primary/15 text-primary font-semibold border-primary/30"
                        : "hover:bg-muted text-foreground border-border/50"
                    )}
                  >
                    <ArrowDown className="h-3 w-3" />
                    <span>Descending</span>
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">{children}</div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function TemplateDialog({ open, onOpenChange, selected }: { open: boolean; onOpenChange: (o: boolean) => void; selected: string[] }) {
  const [mode, setMode] = React.useState<"blank" | "prefilled">(selected.length ? "prefilled" : "blank");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setMode(selected.length ? "prefilled" : "blank"), [selected.length, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download SoD role template</DialogTitle>
          <DialogDescription>
            An Excel workbook with sheets for roles, actions, authorisations, org levels, composite roles and a read-only SoD reference. Dropdowns guide valid
            values.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as "blank" | "prefilled")}>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary">
            <RadioGroupItem value="blank" className="mt-0.5" />
            <span>
              <span className="block font-medium">Blank</span>
              <span className="text-xs text-muted-foreground">Includes 2 example rows to show the format.</span>
            </span>
          </label>
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary", !selected.length && "opacity-50")}>
            <RadioGroupItem value="prefilled" className="mt-0.5" disabled={!selected.length} />
            <span>
              <span className="block font-medium">Pre-filled with selected roles</span>
              <span className="text-xs text-muted-foreground">
                {selected.length ? `${selected.length} role(s): ${selected.slice(0, 4).join(", ")}${selected.length > 4 ? "…" : ""}` : "Select roles in the list first."}
              </span>
            </span>
          </label>
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await downloadRoleTemplate(mode === "prefilled" ? selected : []);
                toast.success("Template downloaded");
                onOpenChange(false);
              } catch (e) {
                toast.error("Could not create the template", { description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download /> Download .xlsx
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
