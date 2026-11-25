import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { ChevronRight, Copy, Download, FileSpreadsheet, Hammer, Layers, Play, RefreshCw, SearchX, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { PageHeader, EmptyState, HelpTip, LevelChip, RunMeta } from "@/components/common";
import { AssignUserToRoleDialog, RemoveUserFromRoleDialog } from "@/components/SapRoleAdminDialogs";
import { UserDetailDrawer } from "@/components/UserDetailDrawer";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/misc";
import { commit, db, useService } from "@/services/db";
import { ensureLiveMasterData, getRole, getUsers, syncRoleFromSap } from "@/services/sapService";
import { remediationFor, roleResult, runAnalysis, userResult } from "@/services/analysisService";
import { getBaseRoleMap } from "@/services/roleBuilderService";
import { publishedVersion } from "@/services/rulesService";
import { describeTcode } from "@/data/tcodes";
import { LAST_RUN_ID, SNAPSHOT_DATE } from "@/data/roles";
import { useApp } from "@/context/AppContext";
import { cn, fmtDate, fmtDateTime, todayStamp } from "@/lib/utils";
import { grantsForRole } from "@/lib/sod";
import type { RiskHit, User } from "@/types";
import { ResultDrawer } from "./ResultDrawer";
import { toast } from "sonner";

function formatSapActivity(field: string, low: string): string {
  if (field !== "ACTVT") return low;
  const actMap: Record<string, string> = {
    "01": "01 (Create)",
    "02": "02 (Change)",
    "03": "03 (Display)",
    "06": "06 (Delete)",
    "16": "16 (Execute)",
    "*": "* (Full Access)",
  };
  return actMap[low] || low;
}

function renderModifiedBadge(mod?: string) {
  if (mod === "S" || mod === "Standard") {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">Standard (S)</span>;
  }
  if (mod === "M" || mod === "Modified") {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">Modified (M)</span>;
  }
  if (mod === "U" || mod === "Unmaintained") {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">Unmaintained (U)</span>;
  }
  return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">Standard</span>;
}

export default function RoleDetailPage() {
  const { name = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useApp();
  const { systemId } = useApp();
  const tab = params.get("tab") ?? "tcodes";

  const { data, loading } = useService(async () => {
    const [role, users] = await Promise.all([getRole(name), getUsers(), ensureLiveMasterData()]);
    if (!role) return null;
    return { role, result: roleResult(role), users };
  }, [name]);

  const [hit, setHit] = React.useState<RiskHit>();
  const [running, setRunning] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<User | null>(null);
  const [syncingRole, setSyncingRole] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [removingUser, setRemovingUser] = React.useState<string | null>(null);
  const [tcodeSearch, setTcodeSearch] = React.useState("");
  const [authSearch, setAuthSearch] = React.useState("");
  const [orgSearch, setOrgSearch] = React.useState("");
  const [userSearch, setUserSearch] = React.useState("");

  if (loading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-80" />
      </div>
    );

  if (!data)
    return (
      <EmptyState
        icon={SearchX}
        title={`Role ${name} was not found in the current snapshot.`}
        action={
          <Button asChild>
            <Link to="/roles">Back to roles</Link>
          </Button>
        }
      />
    );

  const { role, result, users: loadedUsers } = data;
  const map = getBaseRoleMap();
  const grants = grantsForRole(role, map);
  const allUsers = loadedUsers ?? db.users;
  const assigned = allUsers.filter(
    (u) => u.roles.includes(role.name) || (u.createdRoles && u.createdRoles.includes(role.name))
  );
  const children = (role.children ?? []).map((c) => map.get(c)).filter(Boolean);
  const derivedFrom = role.parent ? map.get(role.parent) : undefined;
  const lastRun = db.runs.find((r) => r.results.some((x) => x.subject === role.name));
  const runMeta = lastRun
    ? { runId: lastRun.runId, rulesetVersion: lastRun.rulesetVersion, snapshot: lastRun.snapshot }
    : { runId: LAST_RUN_ID, rulesetVersion: publishedVersion(), snapshot: db.systems[0]?.lastDeltaSync || SNAPSHOT_DATE };
  const rem = remediationFor(result);

  const tcodeSourceMap = new Map((role.tcodeDetails ?? []).map((t) => [t.tcode, t.source]));

  const filteredGrants = grants.filter(
    (g) =>
      !tcodeSearch ||
      g.tcode.toLowerCase().includes(tcodeSearch.toLowerCase()) ||
      describeTcode(g.tcode).toLowerCase().includes(tcodeSearch.toLowerCase()),
  );

  const filteredAuths = role.auths.filter(
    (a) =>
      !authSearch ||
      a.object.toLowerCase().includes(authSearch.toLowerCase()) ||
      a.field.toLowerCase().includes(authSearch.toLowerCase()) ||
      a.low.toLowerCase().includes(authSearch.toLowerCase()) ||
      (a.auth && a.auth.toLowerCase().includes(authSearch.toLowerCase())),
  );

  const filteredOrgLevels = role.orgLevels.filter(
    (o) =>
      !orgSearch ||
      o.label.toLowerCase().includes(orgSearch.toLowerCase()) ||
      o.field.toLowerCase().includes(orgSearch.toLowerCase()) ||
      o.low.toLowerCase().includes(orgSearch.toLowerCase()) ||
      (o.varbl && o.varbl.toLowerCase().includes(orgSearch.toLowerCase())),
  );

  const filteredAssigned = assigned.filter(
    (u) =>
      !userSearch ||
      u.id.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.department.toLowerCase().includes(userSearch.toLowerCase()),
  );

  const analyse = async () => {
    setRunning(true);
    const run = await runAnalysis({ roles: [role.name] });
    setRunning(false);
    toast.success(`${role.name} analysed`, { description: run.runId });
    setParams({ tab: "sod" });
  };

  const handleSyncSingleRole = async () => {
    setSyncingRole(true);
    try {
      const res = await syncRoleFromSap(role.name, systemId);
      toast.success(`Synced ${role.name} from SAP CAP`, {
        description: `${res.authsCount} authorizations · ${res.orgDataCount} org levels · ${res.tcodesCount} t-codes loaded`,
      });
    } catch (e) {
      toast.error(`Failed to sync ${role.name}`, { description: (e as Error).message });
    } finally {
      setSyncingRole(false);
    }
  };

  const exportTcodes = () => {
    const ws = XLSX.utils.json_to_sheet(
      filteredGrants.map((g, idx) => ({
        "Line #": idx + 1,
        "Transaction Code": g.tcode,
        Description: describeTcode(g.tcode),
        Source: tcodeSourceMap.get(g.tcode) || (role.type === "Composite" ? `From ${g.grantedBy}` : "Menu / S_TCODE"),
        "Role Name": role.name,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, `SAP_Role_${role.name.replace(/[^a-zA-Z0-9]/g, "_")}_TCodes_${todayStamp()}.xlsx`);
    toast.success(`Exported ${filteredGrants.length} transactions`);
  };

  const exportAuths = () => {
    const defaultProfile = `T_${role.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase()}00`;
    const ws = XLSX.utils.json_to_sheet(
      filteredAuths.map((a, idx) => ({
        "Line #": idx + 1,
        "Auth Object": a.object,
        "Auth Profile / Name": a.auth || defaultProfile,
        Field: a.field,
        "Value Low": a.low,
        "Value High": a.high || "",
        Status: a.modified === "M" ? "Modified" : a.modified === "U" ? "Unmaintained" : "Standard",
        Node: a.node || String(idx + 28).padStart(6, "0"),
        "Role Name": role.name,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Authorizations");
    XLSX.writeFile(wb, `SAP_Role_${role.name.replace(/[^a-zA-Z0-9]/g, "_")}_Auths_${todayStamp()}.xlsx`);
    toast.success(`Exported ${filteredAuths.length} authorizations`);
  };

  const exportOrg = () => {
    const ws = XLSX.utils.json_to_sheet(
      filteredOrgLevels.map((o, idx) => ({
        "Line #": idx + 1,
        "Org Level": o.label,
        "SAP Variable": o.varbl || `$${o.field}`,
        Field: o.field,
        "Value Low": o.low,
        "Value High": o.high || "",
        "Full Scope": o.low === "*" ? "Yes (Wildcard)" : "No",
        "Role Name": role.name,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "OrgLevels");
    XLSX.writeFile(wb, `SAP_Role_${role.name.replace(/[^a-zA-Z0-9]/g, "_")}_OrgLevels_${todayStamp()}.xlsx`);
    toast.success(`Exported ${filteredOrgLevels.length} org levels`);
  };

  const exportUsers = () => {
    const ws = XLSX.utils.json_to_sheet(
      filteredAssigned.map((u) => {
        const uRes = userResult(u);
        return {
          "User ID": u.id,
          Name: u.name,
          Department: u.department,
          "SoD Status": uRes.status === "green" ? "Clean (Risk OK)" : uRes.status === "red" ? "Critical Risk" : "Review",
          "Risk Hits": uRes.hits.length,
          "Other Roles": u.roles.filter((r) => r !== role.name).join(", "),
          "Valid To": u.validTo === "9999-12-31" ? "Unlimited" : u.validTo,
          Locked: u.locked ? "Yes" : "No",
        };
      }),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "AssignedUsers");
    XLSX.writeFile(wb, `SAP_Role_${role.name.replace(/[^a-zA-Z0-9]/g, "_")}_Users_${todayStamp()}.xlsx`);
    toast.success(`Exported ${filteredAssigned.length} users`);
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: "Roles & Analysis", to: "/roles" }, { label: role.name }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{role.name}</span>
            <StatusBadge status={result.status} />
          </span>
        }
        description={`${role.description} · ${role.type} role · ${role.process} · Owner ${role.owner || "SAP"}`}
        actions={
          <>
            <Button variant="outline" onClick={handleSyncSingleRole} disabled={syncingRole || !can("edit")}>
              <RefreshCw className={syncingRole ? "animate-spin" : undefined} /> {syncingRole ? "Syncing SAP…" : "Sync from SAP"}
            </Button>
            <Button variant="outline" onClick={analyse} disabled={running || !can("edit")}>
              <Play /> {running ? "Analysing…" : "Analyse this role"}
            </Button>
            <Button variant="outline" onClick={() => navigate(`/builder?from=${encodeURIComponent(role.name)}&copy=1`)}>
              <Copy /> Copy in Role Builder
            </Button>
            <Button onClick={() => navigate(`/builder?from=${encodeURIComponent(role.name)}`)} disabled={!can("edit")}>
              <Hammer /> Edit in Role Builder
            </Button>
          </>
        }
      >
        {derivedFrom && (
          <p className="text-sm text-muted-foreground">
            Derived from{" "}
            <Link to={`/roles/${derivedFrom.name}`} className="font-mono text-primary hover:underline">
              {derivedFrom.name}
            </Link>{" "}
            – transactions and authorisations are inherited; only org levels differ.
          </p>
        )}

        {/* Governance & Audit Metadata Block */}
        <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-border/60 text-xs">
          <div className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-muted-foreground border border-border/50">
            <span className="font-semibold text-foreground">Created:</span>
            <span>{role.createDat ? fmtDate(role.createDat) : "—"}</span>
            <span className="text-muted-foreground/60">by</span>
            <span className="font-mono text-foreground font-medium">{role.createUsr || "SAP"}</span>
            {role.createTim && <span className="text-[10px] text-muted-foreground">({role.createTim})</span>}
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-muted-foreground border border-border/50">
            <span className="font-semibold text-foreground">Last Changed:</span>
            <span>{role.changeDat ? fmtDate(role.changeDat) : fmtDate(role.lastChanged)}</span>
            <span className="text-muted-foreground/60">by</span>
            <span className="font-mono text-foreground font-medium">{role.changeUsr || role.owner || "SAP"}</span>
            {role.changeTim && <span className="text-[10px] text-muted-foreground">({role.changeTim})</span>}
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-primary border border-primary/20 font-medium">
            <span>Classification:</span>
            <span>{role.type} Role {role.flagType ? `(${role.flagType})` : ""}</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5 text-xs">
            <span className="rounded-md bg-muted px-2 py-0.5 font-medium">{grants.length} T-Codes</span>
            <span className="rounded-md bg-muted px-2 py-0.5 font-medium">{role.auths.length} Auths</span>
            <span className="rounded-md bg-muted px-2 py-0.5 font-medium">{role.orgLevels.length} Org Levels</span>
            <span className="rounded-md bg-muted px-2 py-0.5 font-medium">{assigned.length} Users</span>
          </div>
        </div>
      </PageHeader>

      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="tcodes">Transactions & Apps ({grants.length})</TabsTrigger>
          <TabsTrigger value="auths">Authorisations ({role.auths.length})</TabsTrigger>
          <TabsTrigger value="org">Org levels ({role.orgLevels.length})</TabsTrigger>
          {(role.type === "Composite" || children.length > 0) && children.length > 0 && <TabsTrigger value="children">Child roles ({children.length})</TabsTrigger>}
          <TabsTrigger value="users">Assigned users ({assigned.length})</TabsTrigger>
          <TabsTrigger value="sod">
            SoD results <StatusBadge status={result.status} size="sm" iconOnly />
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Transactions & Apps */}
        <TabsContent value="tcodes">
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input
                placeholder="Search transactions by code or action..."
                value={tcodeSearch}
                onChange={(e) => setTcodeSearch(e.target.value)}
                className="max-w-md h-9 text-xs"
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Showing {filteredGrants.length} of {grants.length} transactions
                </span>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportTcodes} disabled={!filteredGrants.length}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Export
                </Button>
              </div>
            </div>

            {filteredGrants.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>T-Code</TableHead>
                    <TableHead>Action / Description</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Granted Via</TableHead>
                    {role.type === "Composite" && <TableHead>From child role</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGrants.map((g, idx) => {
                    const src = tcodeSourceMap.get(g.tcode);
                    const isReport = g.tcode.startsWith("R_") || g.tcode.startsWith("Z_REP");
                    return (
                      <TableRow key={g.tcode + g.grantedBy}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-mono font-semibold text-primary">{g.tcode}</TableCell>
                        <TableCell>{describeTcode(g.tcode)}</TableCell>
                        <TableCell>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-foreground border border-border/60">
                            {isReport ? "Report" : "Transaction"}
                          </span>
                        </TableCell>
                        <TableCell>
                          {src === "Menu" ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                              Menu
                            </span>
                          ) : src === "Authorization" ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                              Auth (S_TCODE)
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border">
                              {role.type === "Composite" ? "Child Role" : "Standard"}
                            </span>
                          )}
                        </TableCell>
                        {role.type === "Composite" && <TableCell className="font-mono text-xs">{g.grantedBy}</TableCell>}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState className="m-4" icon={Layers} title="No transaction codes found matching your search." />
            )}
          </Card>
        </TabsContent>

        {/* TAB 2: Authorisations */}
        <TabsContent value="auths">
          <Card className="p-4">
            {role.auths.length === 0 && role.type === "Composite" ? (
              <EmptyState
                className="m-4"
                icon={Layers}
                title="Composite roles carry no authorisations of their own – see each child role."
                action={<Button variant="outline" onClick={() => setParams({ tab: "children" })}>Show child roles</Button>}
              />
            ) : role.auths.length === 0 ? (
              <EmptyState
                className="m-4"
                icon={Layers}
                title="No authorisations loaded locally for this role yet."
                action={
                  <Button variant="outline" onClick={handleSyncSingleRole} disabled={syncingRole || !can("edit")}>
                    <RefreshCw className={syncingRole ? "animate-spin" : undefined} /> {syncingRole ? "Syncing from SAP…" : "Fetch authorizations from SAP CAP"}
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Input
                    placeholder="Search authorizations by object, profile, field or value..."
                    value={authSearch}
                    onChange={(e) => setAuthSearch(e.target.value)}
                    className="max-w-md h-9 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Showing {filteredAuths.length} of {role.auths.length} authorizations
                    </span>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportAuths} disabled={!filteredAuths.length}>
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Export
                    </Button>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Line #</TableHead>
                      <TableHead>Auth object</TableHead>
                      <TableHead>Auth Profile / Name</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Value low (From)</TableHead>
                      <TableHead>Value high (To)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Node</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAuths.map((a, i) => {
                      const displayAuth = a.auth || "—";
                      const displayNode = a.node || "—";
                      return (
                        <TableRow key={a.counter || `${a.object}-${a.field}-${i}`}>
                          <TableCell className="font-mono text-xs text-muted-foreground" title={a.counter ? `SAP Line: ${a.counter}` : undefined}>
                            {i + 1}
                          </TableCell>
                          <TableCell className="font-mono font-semibold text-primary">{a.object}</TableCell>
                          <TableCell className="font-mono text-xs">
                            <span className="inline-flex items-center px-2 py-0.5 rounded font-mono font-medium text-[11px] bg-primary/10 text-primary border border-primary/20">
                              {displayAuth}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono font-medium">{a.field}</TableCell>
                          <TableCell className="font-mono">
                            {a.low ? (
                              <span>{formatSapActivity(a.field, a.low)}</span>
                            ) : (
                              <span className="text-status-red font-medium">empty</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {a.high ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded font-mono font-semibold text-[11px] bg-muted text-foreground border border-border/70">
                                {a.high}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </TableCell>
                          <TableCell>{renderModifiedBadge(a.modified)}</TableCell>
                          <TableCell className="font-mono text-xs">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[11px] bg-muted/80 text-foreground/80 border border-border/50">
                              {displayNode}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* TAB 3: Org Levels */}
        <TabsContent value="org">
          <Card className="p-4">
            {role.orgLevels.length ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Input
                    placeholder="Search org levels by label, field or variable..."
                    value={orgSearch}
                    onChange={(e) => setOrgSearch(e.target.value)}
                    className="max-w-md h-9 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Showing {filteredOrgLevels.length} of {role.orgLevels.length} org levels
                    </span>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportOrg} disabled={!filteredOrgLevels.length}>
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Export
                    </Button>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Line #</TableHead>
                      <TableHead>Org level</TableHead>
                      <TableHead>SAP Variable</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Value low (From)</TableHead>
                      <TableHead>Value high (To)</TableHead>
                      <TableHead>Scope Assessment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrgLevels.map((o, idx) => (
                      <TableRow key={o.counter || o.field || idx}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium text-foreground">{o.label}</TableCell>
                        <TableCell className="font-mono text-xs text-primary font-semibold">{o.varbl || `$${o.field}`}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{o.field}</TableCell>
                        <TableCell className="font-mono">
                          {o.low === "*" ? (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono font-medium px-2 py-0.5 text-xs border border-amber-500/20">
                              ⚠️ * (Full Scope)
                            </span>
                          ) : (
                            o.low
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">{o.high || "—"}</TableCell>
                        <TableCell>
                          {o.low === "*" ? (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                              ⚠️ Wildcard (All Entities)
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground font-medium">
                              Restricted Scope
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState className="m-4" icon={Layers} title="No organisational levels are maintained for this role." />
            )}
          </Card>
        </TabsContent>

        {(role.type === "Composite" || children.length > 0) && (
          <TabsContent value="children">
            <Card>
              <ul className="divide-y">
                {children.map((c) => (
                  <li key={c!.name}>
                    <Link to={`/roles/${encodeURIComponent(c!.name)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono font-medium">{c!.name}</span>
                        <span className="block text-xs text-muted-foreground">{c!.description}</span>
                      </span>
                      <StatusBadge status={roleResult(c!).status} size="sm" />
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </TabsContent>
        )}

        {/* TAB 4: Assigned Users */}
        <TabsContent value="users">
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input
                placeholder="Search assigned users by ID, name or department..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="max-w-md h-9 text-xs"
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Showing {filteredAssigned.length} of {assigned.length} assigned users
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={async () => {
                    setSyncingRole(true);
                    try {
                      await syncRoleFromSap(role.name, systemId);
                      toast.success(`Refreshed assignments for ${role.name} from SAP`);
                    } catch (e: any) {
                      toast.error("Failed to sync users", { description: e?.message || String(e) });
                    } finally {
                      setSyncingRole(false);
                    }
                  }}
                  disabled={syncingRole}
                  title="Refresh role assignments directly from live SAP CAP"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-1 text-primary", syncingRole && "animate-spin")} />
                  {syncingRole ? "Syncing..." : "Sync from SAP"}
                </Button>
                {can("edit") && (
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAssignOpen(true)}>
                    <UserPlus className="h-3.5 w-3.5 mr-1 text-primary" /> Assign User
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportUsers} disabled={!filteredAssigned.length}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Export
                </Button>
              </div>
            </div>

            {filteredAssigned.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>SoD Risk Result</TableHead>
                    <TableHead>Other roles</TableHead>
                    <TableHead>Valid to</TableHead>
                    {can("edit") && <TableHead className="w-24 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssigned.map((u) => {
                    const uRes = userResult(u);
                    return (
                      <TableRow key={u.id}>
                        <TableCell
                          className="font-mono text-primary font-semibold cursor-pointer hover:underline"
                          onClick={() => setSelectedUser(u)}
                          title={`Click to view profile and all ${u.roles.length} roles for ${u.id}`}
                        >
                          {u.id}
                          {u.locked && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-sans text-[11px] text-foreground">Locked</span>}
                        </TableCell>
                        <TableCell className="font-medium cursor-pointer hover:underline" onClick={() => setSelectedUser(u)}>{u.name}</TableCell>
                        <TableCell>{u.department}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={uRes.status} size="sm" />
                            <span className="text-xs text-muted-foreground">
                              {uRes.hits.length === 0 ? "Clean · Risk OK" : `${uRes.hits.length} risk hit(s)`}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-xs font-mono font-semibold"
                              onClick={() => setSelectedUser(u)}
                              title={`Click to view all ${u.roles.length} roles assigned to ${u.id}`}
                            >
                              <Layers className="h-3 w-3 mr-1 text-primary" />
                              {u.roles.length} roles
                            </Button>
                            <span className="text-muted-foreground truncate max-w-[180px]" title={u.roles.filter((r) => r !== role.name).join(", ")}>
                              {u.roles.filter((r) => r !== role.name).slice(0, 2).join(", ")}{u.roles.filter((r) => r !== role.name).length > 2 ? ` (+${u.roles.filter((r) => r !== role.name).length - 2} more)` : ""}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{u.validTo === "9999-12-31" ? "Unlimited" : fmtDate(u.validTo)}</TableCell>
                        {can("edit") && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-status-red hover:text-status-red hover:bg-status-red-bg/50"
                              onClick={() => setRemovingUser(u.id)}
                              title={`Remove ${u.id} from ${role.name}`}
                            >
                              <UserMinus className="h-3.5 w-3.5 mr-1" /> Remove
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                className="m-4"
                icon={Users}
                title="No users are assigned this role directly."
                action={
                  can("edit") ? (
                    <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                      <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign User to Role
                    </Button>
                  ) : undefined
                }
              />
            )}
          </Card>
        </TabsContent>

        {/* TAB 5: SoD Results */}
        <TabsContent value="sod" className="space-y-4">
          <RunMeta runId={runMeta.runId} version={runMeta.rulesetVersion} snapshot={fmtDateTime(runMeta.snapshot)} system={db.systems[0]?.name || "SAP S/4HANA"} />
          {result.status === "grey" ? (
            <EmptyState
              icon={Play}
              title="This role has not been analysed recently, so its SoD status is unknown."
              action={
                <Button onClick={analyse} disabled={running || !can("edit")}>
                  <Play /> Analyse now
                </Button>
              }
            />
          ) : result.hits.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No risks fire for this role. It is clean against the current ruleset." />
          ) : (
            <>
              {rem && (
                <Card className="border-primary/30 bg-accent">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-accent-foreground">
                    <span>
                      <strong>Suggested fix:</strong> {rem.text}
                    </span>
                    <Button size="sm" onClick={() => navigate(`/builder?from=${encodeURIComponent(rem.fromRole)}&remove=${rem.tcode}`)} disabled={!can("edit")}>
                      <Hammer /> Fix in Role Builder
                    </Button>
                  </CardContent>
                </Card>
              )}
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Risk ID</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Conflicting functions <HelpTip term="Function" />
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.hits.map((h) => (
                      <TableRow
                        key={h.riskId}
                        tabIndex={0}
                        className="cursor-pointer"
                        onClick={() => setHit(h)}
                        onKeyDown={(e) => e.key === "Enter" && setHit(h)}
                      >
                        <TableCell className="font-mono text-xs">{h.riskId}</TableCell>
                        <TableCell>{h.description}</TableCell>
                        <TableCell>
                          <LevelChip level={h.level} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={h.status} size="sm" />
                          {h.mitigation && <span className="ml-2 text-xs text-muted-foreground">Mitigated</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{h.functions.map((f) => f.functionName).join(" vs ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      <ResultDrawer hit={hit} result={result} run={runMeta} onOpenChange={(o) => !o && setHit(undefined)} />
      <UserDetailDrawer user={selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)} />
      <AssignUserToRoleDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        systemId={systemId}
        roleName={role.name}
        suggestedUsers={allUsers.map((u) => ({ id: u.id, name: u.name }))}
        onSuccess={async () => {
          await Promise.all([getRole(role.name), getUsers()]);
          commit();
        }}
      />
      <RemoveUserFromRoleDialog
        open={Boolean(removingUser)}
        onOpenChange={(o) => !o && setRemovingUser(null)}
        systemId={systemId}
        roleName={role.name}
        userId={removingUser || ""}
        onSuccess={async () => {
          await Promise.all([getRole(role.name), getUsers()]);
          commit();
        }}
      />
    </>
  );
}
