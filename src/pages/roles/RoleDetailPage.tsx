import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronRight, Copy, Hammer, Layers, Play, SearchX, ShieldCheck, Users } from "lucide-react";
import { PageHeader, EmptyState, HelpTip, LevelChip, RunMeta } from "@/components/common";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/misc";
import { db, useService } from "@/services/db";
import { getRole } from "@/services/sapService";
import { remediationFor, roleResult, runAnalysis } from "@/services/analysisService";
import { publishedVersion } from "@/services/rulesService";
import { describeTcode } from "@/data/tcodes";
import { LAST_RUN_ID, SNAPSHOT_DATE } from "@/data/roles";
import { useApp } from "@/context/AppContext";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { grantsForRole } from "@/lib/sod";
import type { RiskHit } from "@/types";
import { ResultDrawer } from "./ResultDrawer";
import { toast } from "sonner";

export default function RoleDetailPage() {
  const { name = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useApp();
  const tab = params.get("tab") ?? "tcodes";
  const { data, loading } = useService(async () => {
    const role = await getRole(name);
    if (!role) return null;
    return { role, result: roleResult(role) };
  }, [name]);
  const [hit, setHit] = React.useState<RiskHit>();
  const [running, setRunning] = React.useState(false);

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

  const { role, result } = data;
  const map = new Map(db.roles.map((r) => [r.name, r]));
  const grants = grantsForRole(role, map);
  const assigned = db.users.filter((u) => u.roles.includes(role.name));
  const children = (role.children ?? []).map((c) => map.get(c)).filter(Boolean);
  const derivedFrom = role.parent ? map.get(role.parent) : undefined;
  const lastRun = db.runs.find((r) => r.results.some((x) => x.subject === role.name));
  const runMeta = lastRun
    ? { runId: lastRun.runId, rulesetVersion: lastRun.rulesetVersion, snapshot: lastRun.snapshot }
    : { runId: LAST_RUN_ID, rulesetVersion: publishedVersion(), snapshot: SNAPSHOT_DATE };
  const rem = remediationFor(result);

  const analyse = async () => {
    setRunning(true);
    const run = await runAnalysis({ roles: [role.name] });
    setRunning(false);
    toast.success(`${role.name} analysed`, { description: run.runId });
    setParams({ tab: "sod" });
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
        description={`${role.description} · ${role.type} role · ${role.process} · Owner ${role.owner} · Last changed ${fmtDate(role.lastChanged)}`}
        actions={
          <>
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
      </PageHeader>

      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="tcodes">Transactions & Apps ({grants.length})</TabsTrigger>
          <TabsTrigger value="auths">Authorisations</TabsTrigger>
          <TabsTrigger value="org">Org levels</TabsTrigger>
          {role.type === "Composite" && <TabsTrigger value="children">Child roles ({children.length})</TabsTrigger>}
          <TabsTrigger value="users">Assigned users ({assigned.length})</TabsTrigger>
          <TabsTrigger value="sod">
            SoD results <StatusBadge status={result.status} size="sm" iconOnly />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tcodes">
          <Card>
            {grants.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Code</TableHead>
                    {role.type === "Composite" && <TableHead>From child role</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grants.map((g) => (
                    <TableRow key={g.tcode + g.grantedBy}>
                      <TableCell>{describeTcode(g.tcode)}</TableCell>
                      <TableCell className="font-mono">{g.tcode}</TableCell>
                      {role.type === "Composite" && <TableCell className="font-mono text-xs">{g.grantedBy}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState className="m-4" icon={Layers} title="This role grants no transactions." />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="auths">
          <Card>
            {role.type === "Composite" ? (
              <EmptyState className="m-4" icon={Layers} title="Composite roles carry no authorisations of their own – see each child role." action={<Button variant="outline" onClick={() => setParams({ tab: "children" })}>Show child roles</Button>} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Auth object</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Value low</TableHead>
                    <TableHead>Value high</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {role.auths.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono">{a.object}</TableCell>
                      <TableCell className="font-mono">{a.field}</TableCell>
                      <TableCell className="font-mono">{a.low || <span className="text-status-red">empty</span>}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{a.high ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="org">
          <Card>
            {role.orgLevels.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Org level</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Value low</TableHead>
                    <TableHead>Value high</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {role.orgLevels.map((o) => (
                    <TableRow key={o.field}>
                      <TableCell>{o.label}</TableCell>
                      <TableCell className="font-mono">{o.field}</TableCell>
                      <TableCell className="font-mono">{o.low}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{o.high ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState className="m-4" icon={Layers} title="No organisational levels are maintained for this role." />
            )}
          </Card>
        </TabsContent>

        {role.type === "Composite" && (
          <TabsContent value="children">
            <Card>
              <ul className="divide-y">
                {children.map((c) => (
                  <li key={c!.name}>
                    <Link to={`/roles/${c!.name}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
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

        <TabsContent value="users">
          <Card>
            {assigned.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Other roles</TableHead>
                    <TableHead>Valid to</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assigned.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono">
                        {u.id}
                        {u.locked && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-sans text-[11px]">Locked</span>}
                      </TableCell>
                      <TableCell>{u.name}</TableCell>
                      <TableCell>{u.department}</TableCell>
                      <TableCell className="font-mono text-xs">{u.roles.filter((r) => r !== role.name).join(", ") || "—"}</TableCell>
                      <TableCell>{u.validTo === "9999-12-31" ? "Unlimited" : fmtDate(u.validTo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState className="m-4" icon={Users} title="No users are assigned this role directly." />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="sod" className="space-y-4">
          <RunMeta runId={runMeta.runId} version={runMeta.rulesetVersion} snapshot={fmtDateTime(runMeta.snapshot)} />
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
    </>
  );
}
