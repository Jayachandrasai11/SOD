import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, BookOpen, CheckCircle2, Circle, Clock, Play, Plug, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, KpiTile, EmptyState } from "@/components/common";
import { StatusBadge, STATUS_META } from "@/components/StatusBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress, Skeleton } from "@/components/ui/misc";
import { db, useService } from "@/services/db";
import { getSummary, runAnalysis } from "@/services/analysisService";
import { onboarding } from "@/services/settingsService";
import { useApp } from "@/context/AppContext";
import { useThemeColors } from "@/lib/useThemeColors";
import { fmtDateTime, relativeTime } from "@/lib/utils";
import type { Status } from "@/types";

export default function HomePage() {
  const { data, loading } = useService(getSummary);
  const { systemId, startJob, can, user } = useApp();
  const navigate = useNavigate();
  const colors = useThemeColors();
  const ob = onboarding();
  const system = db.systems.find((s) => s.id === systemId)!;

  const steps = [
    { key: "rules", done: ob.rulesImported, title: "Import rules", body: "Load your SoD ruleset from Excel or start with the MyGo starter library.", cta: "Import rules", icon: BookOpen, to: "/settings?tab=rules&rulesTab=import" },
    { key: "connect", done: ob.systemConnected, title: "Connect S/4HANA", body: "Add a read-only connection so MySODAI can read roles, users and authorisations.", cta: "Add system", icon: Plug, to: "/settings?tab=connections&add=1" },
    { key: "analyse", done: ob.analysisRun, title: "Run first analysis", body: "Check every role against the ruleset and see what needs action.", cta: "Run analysis", icon: Play },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  const runFirst = () =>
    startJob("Role analysis (all roles)", async (p) => {
      const run = await runAnalysis({ roles: db.roles.map((r) => r.name) }, p);
      const red = run.results.filter((r) => r.status === "red").length;
      navigate(`/roles/analysis?run=${run.runId}`);
      return { message: `${run.results.length} roles analysed · ${red} need action`, link: `/roles/analysis?run=${run.runId}` };
    });

  const pie = data ? (["red", "amber", "green", "grey"] as Status[]).map((s) => ({ status: s, name: STATUS_META[s].label, value: data.counts[s] })) : [];
  const analysed = data ? data.counts.red + data.counts.amber + data.counts.green : 0;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Home" }]}
        title={`Good morning, ${user.name.split(" ")[0]}`}
        description={`${system.name}, client ${system.client} · SoD status of roles and users based on the latest snapshot.`}
        actions={
          <Button variant="outline" asChild>
            <Link to="/roles/analysis">
              View latest results <ArrowRight />
            </Link>
          </Button>
        }
      />

      {doneCount < 3 && (
        <Card className="mb-6">
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Getting started</CardTitle>
              <CardDescription>Three steps to your first SoD result – about 10 minutes.</CardDescription>
            </div>
            <div className="w-48 text-right">
              <div className="mb-1 text-xs text-muted-foreground">
                {doneCount} of 3 done
              </div>
              <Progress value={(doneCount / 3) * 100} aria-label="Getting started progress" />
            </div>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-3 md:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.key} className="flex flex-col gap-3 rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    {s.done ? (
                      <CheckCircle2 className="h-5 w-5 text-status-green" aria-hidden />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground" aria-hidden />
                    )}
                    <span className="font-semibold">
                      {i + 1}. {s.title}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{s.done ? "Done" : "Pending"}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{s.body}</p>
                  <div className="mt-auto">
                    {s.to ? (
                      <Button size="sm" variant={s.done ? "outline" : "default"} asChild>
                        <Link to={s.to}>
                          <s.icon /> {s.done ? "Open" : s.cta}
                        </Link>
                      </Button>
                    ) : (
                      <Button size="sm" variant={s.done ? "outline" : "default"} onClick={runFirst} disabled={!can("edit")}>
                        <s.icon /> {s.cta}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <section aria-label="Key figures" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {loading || !data ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)
        ) : (
          <>
            <KpiTile label="Roles analysed" value={`${analysed} / ${db.roles.length}`} icon={ShieldCheck} hint={`${data.counts.grey} not analysed`} to="/roles" />
            <KpiTile label="Red roles" value={data.counts.red} accent={<StatusBadge status="red" size="sm" />} to="/roles?status=red" />
            <KpiTile label="Amber roles" value={data.counts.amber} accent={<StatusBadge status="amber" size="sm" />} to="/roles?status=amber" />
            <KpiTile label="Green roles" value={data.counts.green} accent={<StatusBadge status="green" size="sm" />} to="/roles?status=green" />
            <KpiTile label="Users with Red risks" value={`${data.usersWithRed} / ${db.users.length}`} icon={Users} to="/roles/analysis?kind=User&status=red" />
            <KpiTile
              label="Last sync"
              value={relativeTime(system.lastDeltaSync)}
              icon={Clock}
              hint={
                <span className="flex items-center gap-1">
                  {fmtDateTime(system.lastDeltaSync)}
                  {system.status === "Warning" && <StatusBadge status="amber" size="sm" suffix="– stale" />}
                </span>
              }
              to="/settings?tab=connections"
            />
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Role status</CardTitle>
            <CardDescription>Worst status of each role’s risk hits</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !data ? (
              <Skeleton className="h-56" />
            ) : (
              <div className="flex items-center gap-4">
                <div className="h-48 w-48 shrink-0" role="img" aria-label={pie.map((p) => `${p.name}: ${p.value}`).join(", ")}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={pie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none">
                        {pie.map((p) => (
                          <Cell key={p.status} fill={colors[p.status]} />
                        ))}
                      </Pie>
                      <RTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-2 text-sm">
                  {pie.map((p) => (
                    <li key={p.status} className="flex items-center gap-2">
                      <StatusBadge status={p.status} size="sm" />
                      <span className="tabular font-semibold">{p.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Red risks by business process</CardTitle>
            <CardDescription>Number of unmitigated Critical/High hits across roles</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !data ? (
              <Skeleton className="h-56" />
            ) : (
              <div className="h-56" role="img" aria-label={data.redByProcess.map((p) => `${p.process}: ${p.count}`).join(", ")}>
                <ResponsiveContainer>
                  <BarChart data={data.redByProcess} margin={{ left: -20, right: 8 }}>
                    <CartesianGrid vertical={false} stroke={colors.border} />
                    <XAxis dataKey="process" tick={{ fontSize: 12, fill: colors.muted }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: colors.muted }} axisLine={false} tickLine={false} />
                    <RTooltip cursor={{ fill: "transparent" }} />
                    <Bar dataKey="count" name="Red risks" fill={colors.red} radius={[6, 6, 0, 0]} label={{ position: "top", fontSize: 12, fill: colors.muted }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top 5 riskiest roles</CardTitle>
            <CardDescription>Ranked by number of Red, then Amber hits</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !data ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : data.topRoles.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No role has an active risk. Nice work." />
            ) : (
              <ol className="divide-y">
                {data.topRoles.map((t, i) => (
                  <li key={t.role.name}>
                    <Link to={`/roles/${encodeURIComponent(t.role.name)}?tab=sod`} className="flex items-center gap-3 rounded-lg px-1 py-2.5 hover:bg-muted/50">
                      <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-sm font-medium">{t.role.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t.role.description} · {t.red} red, {t.amber} amber
                        </span>
                      </span>
                      <StatusBadge status={t.result.status} size="sm" />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
      {!loading && data && ob.analysisRun && doneCount === 3 && (
        <p className="mt-6 text-xs text-muted-foreground">
          Setup complete.{" "}
          <button className="underline" onClick={() => toast.info("Tip: press Ctrl K to search roles, risks and users from anywhere.")}>
            Show a tip
          </button>
        </p>
      )}
    </>
  );
}
