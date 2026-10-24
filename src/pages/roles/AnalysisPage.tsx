import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Play, SearchX, ShieldCheck } from "lucide-react";
import { PageHeader, EmptyState, HelpTip, LevelChip, RunMeta } from "@/components/common";
import { StatusBadge, STATUS_META, StatusLegend } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress, Skeleton } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useService, db } from "@/services/db";
import { toast } from "sonner";
import { getRun, getRuns, heatmapCell } from "@/services/analysisService";
import { useApp } from "@/context/AppContext";
import { useThemeColors } from "@/lib/useThemeColors";
import { PROCESSES, RISK_LEVELS, type RiskHit, type Status, type SubjectResult } from "@/types";
import { cn, fmtDateTime, todayStamp } from "@/lib/utils";
import { ResultDrawer } from "./ResultDrawer";
import { STATUS_RANK } from "@/lib/sod";

export default function AnalysisPage() {
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const { jobs } = useApp();
  const colors = useThemeColors();
  const { data: run, loading } = useService(() => getRun(runId), [runId]);
  const { data: runs } = useService(getRuns);

  const kinds = run ? [...new Set(run.results.map((r) => r.subjectKind))] : [];
  const kindParam = params.get("kind") as "Role" | "User" | null;
  const kind: "Role" | "User" = kindParam && kinds.includes(kindParam) ? kindParam : kinds.includes("Role") ? "Role" : "User";
  const statusF = params.get("status") ?? "all";
  const processF = params.get("process") ?? "all";
  const [q, setQ] = React.useState(params.get("subject") ?? "");
  const [sel, setSel] = React.useState<{ hit: RiskHit; result: SubjectResult }>();
  const [tableMode, setTableMode] = React.useState<"hits" | "subjects">("hits");

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    v === "all" || !v ? p.delete(k) : p.set(k, v);
    setParams(p, { replace: true });
  };

  const subjects = React.useMemo(() => (run ? run.results.filter((r) => r.subjectKind === kind) : []), [run, kind]);
  const counts = React.useMemo(() => {
    const c: Record<Status, number> = { red: 0, amber: 0, green: 0, grey: 0 };
    subjects.forEach((s) => c[s.status]++);
    return c;
  }, [subjects]);
  const allHits = subjects.flatMap((s) => s.hits.map((h) => ({ h, s })));
  const byProcess = PROCESSES.map((p) => ({
    name: p,
    Red: allHits.filter((x) => x.h.process === p && x.h.status === "red").length,
    Amber: allHits.filter((x) => x.h.process === p && x.h.status === "amber").length,
  }));
  const byLevel = RISK_LEVELS.map((l) => ({
    name: l,
    Red: allHits.filter((x) => x.h.level === l && x.h.status === "red").length,
    Amber: allHits.filter((x) => x.h.level === l && x.h.status === "amber").length,
  }));

  const filteredHits = allHits.filter(
    ({ h, s }) =>
      (statusF === "all" || h.status === statusF) &&
      (processF === "all" || h.process === processF) &&
      (!q || s.subject.toLowerCase().includes(q.toLowerCase()) || h.riskId.toLowerCase().includes(q.toLowerCase())),
  );
  const heatRows = [...subjects]
    .filter((s) => !q || s.subject.toLowerCase().includes(q.toLowerCase()))
    .filter((s) => statusF === "all" || s.status === statusF)
    .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || b.hits.length - a.hits.length || a.subject.localeCompare(b.subject));

  const job = jobs.find((j) => !j.done);

  const exportResults = () => {
    const ws = XLSX.utils.json_to_sheet(
      filteredHits.map(({ h }) => ({
        [kind]: h.subject,
        "Risk ID": h.riskId,
        "Risk description": h.description,
        Process: h.process,
        Level: h.level,
        Status: STATUS_META[h.status].label,
        Mitigation: h.mitigation?.controlId ?? "",
        "Conflicting functions": h.functions.map((f) => f.functionName).join(" vs "),
        "Run ID": run!.runId,
        "Ruleset version": run!.rulesetVersion,
        Snapshot: run!.snapshot,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, `MySODAI_results_${run!.runId}_${todayStamp()}.xlsx`);
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: "Roles & Analysis", to: "/roles" }, { label: "Analysis results" }]}
        title="Analysis results"
        description={run ? run.scope : "Loading…"}
        actions={
          <>
            {runs && runs.length > 1 && (
              <Select value={run?.runId} onValueChange={(v) => setParam("run", v)}>
                <SelectTrigger className="w-64" aria-label="Analysis run">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((r) => (
                    <SelectItem key={r.runId} value={r.runId}>
                      {r.runId} · {r.scope}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={exportResults} disabled={!run || !filteredHits.length}>
              <FileSpreadsheet /> Export to Excel
            </Button>
          </>
        }
      >
        {run && <RunMeta runId={run.runId} version={run.rulesetVersion} snapshot={fmtDateTime(run.snapshot)} />}
      </PageHeader>

      {job && (
        <Card className="mb-4">
          <CardContent className="flex items-center gap-4 p-4" role="status" aria-live="polite">
            <Play className="h-4 w-4 text-primary" aria-hidden />
            <div className="flex-1">
              <div className="mb-1 text-sm">
                {job.label} running in the background · {job.progress}%
              </div>
              <Progress value={job.progress} aria-label={`${job.label} progress`} />
            </div>
          </CardContent>
        </Card>
      )}

      {loading || !run ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <>
          {kinds.length > 1 && (
            <div className="mb-4 inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Show results for">
              {(["Role", "User"] as const).map((k) => (
                <button
                  key={k}
                  className={cn("rounded-md px-3 py-1.5 text-sm font-medium", kind === k ? "bg-background shadow-sm" : "text-muted-foreground")}
                  aria-pressed={kind === k}
                  onClick={() => setParam("kind", k)}
                >
                  {k}s
                </button>
              ))}
            </div>
          )}

          <section aria-label="Summary" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {(["red", "amber", "green", "grey"] as Status[]).map((s) => (
              <button
                key={s}
                onClick={() => setParam("status", statusF === s ? "all" : s)}
                aria-pressed={statusF === s}
                className={cn("flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40", statusF === s && "border-primary ring-2 ring-primary/20")}
              >
                <StatusBadge status={s} size="sm" />
                <span className="tabular text-2xl font-semibold">{counts[s]}</span>
                <span className="text-xs text-muted-foreground">
                  {kind.toLowerCase()}s · {STATUS_META[s].long}
                </span>
              </button>
            ))}
          </section>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            {[
              { title: "By business process", data: byProcess },
              { title: "By risk level", data: byLevel },
            ].map((c) => (
              <Card key={c.title}>
                <CardHeader>
                  <CardTitle>{c.title}</CardTitle>
                  <CardDescription>Number of risk hits – Red (Act now) and Amber (Review)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-56" role="img" aria-label={c.data.map((d) => `${d.name}: ${d.Red} red, ${d.Amber} amber`).join("; ")}>
                    <ResponsiveContainer>
                      <BarChart data={c.data} margin={{ left: -20, right: 8 }}>
                        <CartesianGrid vertical={false} stroke={colors.border} />
                        <XAxis dataKey="name" tick={{ fontSize: 12, fill: colors.muted }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: colors.muted }} axisLine={false} tickLine={false} />
                        <RTooltip cursor={{ fill: "transparent" }} />
                        <Legend formatter={(v: string) => (v === "Red" ? "Red · Act now" : "Amber · Review")} wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="Red" stackId="a" fill={colors.red} />
                        <Bar dataKey="Amber" stackId="a" fill={colors.amber} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="mb-6">
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Heat map</CardTitle>
                <CardDescription>Worst status per {kind.toLowerCase()} and business process</CardDescription>
              </div>
              <StatusLegend />
            </CardHeader>
            <CardContent>
              {heatRows.length === 0 ? (
                <EmptyState icon={SearchX} title="Nothing to show for these filters." />
              ) : (
                <div className="max-h-[420px] overflow-auto rounded-lg border">
                  <table className="w-full border-separate border-spacing-0 text-xs">
                    <caption className="sr-only">Heat map of worst SoD status by {kind} and process</caption>
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr>
                        <th scope="col" className="border-b px-3 py-2 text-left font-semibold">
                          {kind}
                        </th>
                        {PROCESSES.map((p) => (
                          <th key={p} scope="col" className="border-b px-2 py-2 text-center font-semibold">
                            {p}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatRows.map((s) => (
                        <tr key={s.subject}>
                          <th scope="row" className="border-b px-3 py-1.5 text-left font-mono font-medium">
                            {kind === "Role" ? (
                              <Link to={`/roles/${encodeURIComponent(s.subject)}?tab=sod`} className="hover:underline">
                                {s.subject}
                              </Link>
                            ) : (
                              s.subject
                            )}
                          </th>
                          {PROCESSES.map((p) => {
                            const st = heatmapCell(s, p);
                            return (
                              <td key={p} className="border-b px-1 py-1 text-center">
                                <StatusBadge status={st} size="sm" className="w-full justify-center" />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
              <div>
                <div className="flex items-center gap-3">
                  <CardTitle>Results</CardTitle>
                  <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                    <button
                      type="button"
                      className={cn(
                        "rounded px-2.5 py-1 font-medium transition-colors",
                        tableMode === "hits" && filteredHits.length > 0 ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setTableMode("hits")}
                      disabled={filteredHits.length === 0}
                    >
                      Risk hits ({filteredHits.length})
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded px-2.5 py-1 font-medium transition-colors",
                        tableMode === "subjects" || filteredHits.length === 0 ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setTableMode("subjects")}
                    >
                      {kind}s ({heatRows.length})
                    </button>
                  </div>
                </div>
                <CardDescription>
                  {filteredHits.length === 0 && heatRows.length > 0
                    ? `${heatRows.length} ${kind.toLowerCase()}(s) matching filter · all risk-free & compliant`
                    : tableMode === "hits"
                    ? `${filteredHits.length} risk hit(s) · click a row for the drill-down`
                    : `${heatRows.length} ${kind.toLowerCase()}(s) listed · click to inspect`}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor="res-q" className="mb-1 block text-xs text-muted-foreground">
                    {kind} or risk ID
                  </Label>
                  <Input
                    id="res-q"
                    className="w-52"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                    }}
                    placeholder={kind === "Role" ? "Z_FI_…" : "User ID or name"}
                  />
                </div>
                <div>
                  <Label htmlFor="res-proc" className="mb-1 block text-xs text-muted-foreground">
                    Process
                  </Label>
                  <Select value={processF} onValueChange={(v) => setParam("process", v)}>
                    <SelectTrigger id="res-proc" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All processes</SelectItem>
                      {PROCESSES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            {tableMode === "hits" && filteredHits.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{kind}</TableHead>
                    <TableHead>Risk ID</TableHead>
                    <TableHead>Risk description</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Conflicting functions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHits.map(({ h, s }) => (
                    <TableRow
                      key={h.subject + h.riskId}
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => setSel({ hit: h, result: s })}
                      onKeyDown={(e) => e.key === "Enter" && setSel({ hit: h, result: s })}
                    >
                      <TableCell className="font-mono text-xs font-medium">{h.subject}</TableCell>
                      <TableCell className="font-mono text-xs">{h.riskId}</TableCell>
                      <TableCell>{h.description}</TableCell>
                      <TableCell>
                        <LevelChip level={h.level} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={h.status} size="sm" />
                        {h.mitigation && <span className="ml-1.5 text-xs text-muted-foreground">Mitigated</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{h.functions.map((f) => f.functionName).join(" vs ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : heatRows.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{kind} ID</TableHead>
                    <TableHead>{kind === "User" ? "User Name" : "Description"}</TableHead>
                    <TableHead>{kind === "User" ? "Department" : "Process"}</TableHead>
                    <TableHead>{kind === "User" ? "Assigned Roles" : "Type"}</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>SoD Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {heatRows.map((s) => {
                    const u = kind === "User" ? db.users.find((x) => x.id === s.subject) : undefined;
                    const r = kind === "Role" ? db.roles.find((x) => x.name === s.subject) : undefined;
                    return (
                      <TableRow
                        key={s.subject}
                        tabIndex={0}
                        className="cursor-pointer"
                        onClick={() => {
                          if (s.hits.length > 0) {
                            setSel({ hit: s.hits[0], result: s });
                          } else {
                            toast.info(`${kind} ${s.subject} is Clean`, {
                              description: `No SoD risks detected. All assigned transactions are risk-free. Status: Clean (Risk OK).`,
                            });
                          }
                        }}
                      >
                        <TableCell className="font-mono text-xs font-semibold">{s.subject}</TableCell>
                        <TableCell className="font-medium">{u ? u.name : r ? r.description : s.subject}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{u ? u.department : r ? r.process : "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {u ? `${u.roles.length} role(s): ${u.roles.slice(0, 2).join(", ")}${u.roles.length > 2 ? "…" : ""}` : r ? r.type : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={s.status} size="sm" />
                        </TableCell>
                        <TableCell className="text-xs">
                          {s.hits.length === 0 ? (
                            <span className="font-medium text-status-green flex items-center gap-1.5">
                              ✓ Risk OK · Clean
                            </span>
                          ) : (
                            <span className="font-medium text-status-red">
                              {s.hits.length} risk hit(s)
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <CardContent>
                <EmptyState
                  icon={ShieldCheck}
                  title="No results match these filters."
                  action={
                    <Button
                      onClick={() => {
                        setQ("");
                        setParams(runId ? { run: runId } : {}, { replace: true });
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              </CardContent>
            )}
          </Card>

          <ResultDrawer hit={sel?.hit} result={sel?.result} run={run} onOpenChange={(o) => !o && setSel(undefined)} />
        </>
      )}
    </>
  );
}
