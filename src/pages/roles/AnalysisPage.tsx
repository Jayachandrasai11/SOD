import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ExternalLink, FileSpreadsheet, Layers, Play, SearchX, ShieldCheck, SlidersHorizontal, UserCheck } from "lucide-react";
import { PageHeader, EmptyState, HelpTip, LevelChip, RunMeta } from "@/components/common";
import { UserDetailDrawer } from "@/components/UserDetailDrawer";
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
import { getRun, getRuns, heatmapCell, userResult } from "@/services/analysisService";
import { useApp } from "@/context/AppContext";
import { useThemeColors } from "@/lib/useThemeColors";
import { PROCESSES, RISK_LEVELS, type RiskHit, type Status, type SubjectResult, type User } from "@/types";
import { cn, fmtDate, fmtDateTime, todayStamp } from "@/lib/utils";
import { ResultDrawer } from "./ResultDrawer";
import { STATUS_RANK } from "@/lib/sod";

type HitsSortField = "subject" | "system" | "riskId" | "description" | "level" | "status";
type SubjSortField = "subject" | "system" | "name" | "group" | "type" | "status" | "result";

export default function AnalysisPage() {
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const { jobs, systemId } = useApp();
  const colors = useThemeColors();
  const { data: run, loading } = useService(() => getRun(runId), [runId]);
  const { data: runs } = useService(getRuns);
  const system = db.systems.find((s) => s.id === (run?.systemId || systemId || "HMF-100")) || db.systems[0];

  const kinds = run ? [...new Set(run.results.map((r) => r.subjectKind))] : [];
  const kindParam = params.get("kind") as "Role" | "User" | null;
  const kind: "Role" | "User" = kindParam && kinds.includes(kindParam) ? kindParam : kinds.includes("Role") ? "Role" : "User";
  const statusF = params.get("status") ?? "all";
  const processF = params.get("process") ?? "all";
  const [q, setQ] = React.useState(params.get("subject") ?? "");
  const [sel, setSel] = React.useState<{ hit: RiskHit; result: SubjectResult }>();
  const [tableMode, setTableMode] = React.useState<"hits" | "subjects">("hits");
  const [hitsSortField, setHitsSortField] = React.useState<HitsSortField | null>(null);
  const [hitsSortOrder, setHitsSortOrder] = React.useState<"asc" | "desc">("asc");
  const [subjSortField, setSubjSortField] = React.useState<SubjSortField | null>(null);
  const [subjSortOrder, setSubjSortOrder] = React.useState<"asc" | "desc">("asc");
  const [heatmapSort, setHeatmapSort] = React.useState<"asc" | "desc" | null>(null);
  const [selectedUser, setSelectedUser] = React.useState<User | null>(null);

  const matchedUser = React.useMemo(() => {
    const subj = params.get("subject") || q;
    if (!subj || kind !== "User") return undefined;
    return db.users.find((u) => u.id.toUpperCase() === subj.trim().toUpperCase());
  }, [params, q, kind]);

  const toggleHitsSort = (field: HitsSortField) => {
    if (hitsSortField === field) {
      if (hitsSortOrder === "asc") setHitsSortOrder("desc");
      else {
        setHitsSortField(null);
        setHitsSortOrder("asc");
      }
    } else {
      setHitsSortField(field);
      setHitsSortOrder("asc");
    }
  };

  const toggleSubjSort = (field: SubjSortField) => {
    if (subjSortField === field) {
      if (subjSortOrder === "asc") setSubjSortOrder("desc");
      else {
        setSubjSortField(null);
        setSubjSortOrder("asc");
      }
    } else {
      setSubjSortField(field);
      setSubjSortOrder("asc");
    }
  };

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

  const filteredHits = allHits.filter(({ h, s }) => {
    if (statusF !== "all" && h.status !== statusF) return false;
    if (processF !== "all" && h.process !== processF) return false;
    if (!q) return true;
    const qLower = q.toLowerCase();
    if (s.subject.toLowerCase().includes(qLower) || h.riskId.toLowerCase().includes(qLower)) return true;
    if (h.subjectKind === "User") {
      const u = db.users.find((x) => x.id === h.subject);
      if (
        u &&
        (u.name.toLowerCase().includes(qLower) ||
          u.roles.some((r) => r.toLowerCase().includes(qLower)) ||
          (u.createdRoles && u.createdRoles.some((r) => r.toLowerCase().includes(qLower))))
      )
        return true;
    }
    return false;
  });

  const heatRows = [...subjects]
    .filter((s) => {
      if (!q) return true;
      const qLower = q.toLowerCase();
      if (s.subject.toLowerCase().includes(qLower)) return true;
      if (s.subjectKind === "User") {
        const u = db.users.find((x) => x.id === s.subject);
        if (
          u &&
          (u.name.toLowerCase().includes(qLower) ||
            u.roles.some((r) => r.toLowerCase().includes(qLower)) ||
            (u.createdRoles && u.createdRoles.some((r) => r.toLowerCase().includes(qLower))))
        )
          return true;
      }
      return false;
    })
    .filter((s) => statusF === "all" || s.status === statusF)
    .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || b.hits.length - a.hits.length || a.subject.localeCompare(b.subject));

  const sortedHeatRows = React.useMemo(() => {
    if (!heatmapSort) return heatRows;
    const mult = heatmapSort === "asc" ? 1 : -1;
    return [...heatRows].sort((a, b) => mult * a.subject.localeCompare(b.subject));
  }, [heatRows, heatmapSort]);

  const sortedHits = React.useMemo(() => {
    if (!hitsSortField) return filteredHits;
    const mult = hitsSortOrder === "asc" ? 1 : -1;
    const levelRank: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
    const statusRank: Record<string, number> = { red: 3, amber: 2, green: 1, grey: 0 };

    return [...filteredHits].sort((a, b) => {
      switch (hitsSortField) {
        case "subject":
          return mult * a.h.subject.localeCompare(b.h.subject);
        case "system":
          return mult * (system?.name || "").localeCompare(system?.name || "");
        case "riskId":
          return mult * a.h.riskId.localeCompare(b.h.riskId);
        case "description":
          return mult * a.h.description.localeCompare(b.h.description);
        case "level":
          return mult * ((levelRank[a.h.level] ?? 0) - (levelRank[b.h.level] ?? 0));
        case "status":
          return mult * ((statusRank[a.h.status] ?? 0) - (statusRank[b.h.status] ?? 0));
        default:
          return 0;
      }
    });
  }, [filteredHits, hitsSortField, hitsSortOrder, system?.name]);

  const sortedSubjects = React.useMemo(() => {
    const list = heatRows;
    if (!subjSortField) return list;
    const mult = subjSortOrder === "asc" ? 1 : -1;

    return [...list].sort((a, b) => {
      const uA = kind === "User" ? db.users.find((x) => x.id === a.subject) : undefined;
      const uB = kind === "User" ? db.users.find((x) => x.id === b.subject) : undefined;
      const rA = kind === "Role" ? db.roles.find((x) => x.name === a.subject) : undefined;
      const rB = kind === "Role" ? db.roles.find((x) => x.name === b.subject) : undefined;

      switch (subjSortField) {
        case "subject":
          return mult * a.subject.localeCompare(b.subject);
        case "name": {
          const nameA = uA ? uA.name : rA ? rA.description : a.subject;
          const nameB = uB ? uB.name : rB ? rB.description : b.subject;
          return mult * nameA.localeCompare(nameB);
        }
        case "group": {
          const grpA = uA ? uA.department : rA ? rA.process : "";
          const grpB = uB ? uB.department : rB ? rB.process : "";
          return mult * grpA.localeCompare(grpB);
        }
        case "type": {
          const typeA = uA ? uA.roles.length : rA ? (rA.type || "") : "";
          const typeB = uB ? uB.roles.length : rB ? (rB.type || "") : "";
          if (typeof typeA === "number" && typeof typeB === "number") {
            return mult * (typeA - typeB);
          }
          return mult * String(typeA).localeCompare(String(typeB));
        }
        case "status":
          return mult * (STATUS_RANK[a.status] - STATUS_RANK[b.status]);
        case "result":
          return mult * (a.hits.length - b.hits.length);
        default:
          return 0;
      }
    });
  }, [heatRows, subjSortField, subjSortOrder, kind]);

  const [heatPage, setHeatPage] = React.useState(1);
  const HEAT_PER_PAGE = 100;
  const totalHeatPages = Math.max(1, Math.ceil(sortedHeatRows.length / HEAT_PER_PAGE));
  const pagedHeatRows = React.useMemo(() => {
    const start = (heatPage - 1) * HEAT_PER_PAGE;
    return sortedHeatRows.slice(start, start + HEAT_PER_PAGE);
  }, [sortedHeatRows, heatPage]);

  const [subjPage, setSubjPage] = React.useState(1);
  const SUBJ_PER_PAGE = 50;
  const totalSubjPages = Math.max(1, Math.ceil(sortedSubjects.length / SUBJ_PER_PAGE));
  const pagedSubjects = React.useMemo(() => {
    const start = (subjPage - 1) * SUBJ_PER_PAGE;
    return sortedSubjects.slice(start, start + SUBJ_PER_PAGE);
  }, [sortedSubjects, subjPage]);

  React.useEffect(() => {
    setHeatPage(1);
  }, [q, statusF, kind, heatmapSort]);

  React.useEffect(() => {
    setSubjPage(1);
  }, [q, statusF, kind, subjSortField, subjSortOrder]);

  const job = jobs.find((j) => !j.done);

  const exportResults = () => {
    const ws = XLSX.utils.json_to_sheet(
      filteredHits.map(({ h }) => ({
        [kind]: h.subject,
        System: system?.name || "HMF 2023 – SAP S/4HANA (BTP CAP)",
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
        {run && (
          <RunMeta
            runId={run.runId}
            version={run.rulesetVersion}
            snapshot={fmtDateTime(run.snapshot)}
            system={system?.name || "HMF 2023 – SAP S/4HANA (BTP CAP)"}
          />
        )}
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

          {matchedUser && (
            <Card className="mb-6 border-primary/40 bg-primary/5 shadow-xs">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3.5">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold">
                    <UserCheck className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-bold text-foreground">{matchedUser.id}</span>
                      <span className="text-sm font-semibold text-foreground">({matchedUser.name})</span>
                      <StatusBadge status={userResult(matchedUser).status} size="sm" />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>Department: <strong className="font-medium text-foreground">{matchedUser.department}</strong></span>
                      <span>·</span>
                      <span>Total Assigned Roles: <strong className="font-mono font-bold text-primary">{matchedUser.roles.length} roles</strong></span>
                      <span>·</span>
                      <span>Valid to: <strong className="font-medium text-foreground">{matchedUser.validTo === "9999-12-31" ? "Unlimited" : fmtDate(matchedUser.validTo)}</strong></span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="bg-primary text-primary-foreground text-xs h-8"
                    onClick={() => setSelectedUser(matchedUser)}
                  >
                    <Layers className="h-3.5 w-3.5 mr-1.5" /> View all {matchedUser.roles.length} roles
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8"
                    onClick={() => {
                      setQ("");
                      setParam("subject", "");
                    }}
                  >
                    View all users
                  </Button>
                </div>
              </CardContent>
            </Card>
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

          <Card className="mb-6 overflow-hidden border border-border/80 shadow-xs">
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
                  <table className="w-full min-w-[858px] table-fixed border-separate border-spacing-0 text-xs">
                    <caption className="sr-only">Heat map of worst SoD status by {kind} and process</caption>
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr>
                        <th scope="col" className="border-b px-2 py-2 text-center font-semibold w-12">
                          #
                        </th>
                        <th scope="col" className="border-b px-3 py-2 text-left font-semibold min-w-[260px]">
                          <button
                            type="button"
                            onClick={() =>
                              setHeatmapSort((prev) => (prev === "asc" ? "desc" : prev === "desc" ? null : "asc"))
                            }
                            className="group inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-foreground select-none"
                            title={`Sort heat map by ${kind}`}
                          >
                            <span>{kind}</span>
                            {heatmapSort === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5 text-primary stroke-[2.5]" />
                            ) : heatmapSort === "desc" ? (
                              <ArrowDown className="h-3.5 w-3.5 text-primary stroke-[2.5]" />
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground" />
                            )}
                          </button>
                        </th>
                        {PROCESSES.map((p) => (
                          <th key={p} scope="col" className="border-b px-2 py-2 text-center font-semibold w-[110px]">
                            {p}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedHeatRows.map((s, idx) => (
                        <tr key={s.subject}>
                          <td className="border-b px-2 py-1.5 text-center font-mono text-muted-foreground/80 select-none">
                            {(heatPage - 1) * HEAT_PER_PAGE + idx + 1}
                          </td>
                          <th scope="row" className="border-b px-3 py-1.5 text-left font-mono font-medium truncate" title={s.subject}>
                            {kind === "Role" ? (
                              <Link to={`/roles/${encodeURIComponent(s.subject)}?tab=sod`} className="hover:underline">
                                {s.subject}
                              </Link>
                            ) : (
                              <button
                                type="button"
                                className="text-primary hover:underline font-semibold text-left inline-flex items-center gap-1 max-w-full truncate"
                                onClick={() => {
                                  const uFound = db.users.find((x) => x.id === s.subject);
                                  if (uFound) setSelectedUser(uFound);
                                }}
                                title={`Click to view user profile and all assigned roles for ${s.subject}`}
                              >
                                <span className="truncate">{s.subject}</span>
                                <ExternalLink className="h-3 w-3 opacity-60 shrink-0" />
                              </button>
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
              {totalHeatPages > 1 && (
                <div className="flex items-center justify-between border-t px-3 py-2 bg-muted/20 text-xs text-muted-foreground mt-2 rounded">
                  <div>
                    Showing {(heatPage - 1) * HEAT_PER_PAGE + 1}–{Math.min(heatPage * HEAT_PER_PAGE, sortedHeatRows.length)} of {sortedHeatRows.length.toLocaleString()} {kind.toLowerCase()}s
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={heatPage <= 1}
                      onClick={() => setHeatPage((p) => Math.max(1, p - 1))}
                      className="h-7 text-xs px-2"
                    >
                      <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Prev
                    </Button>
                    <span className="font-mono text-[11px] px-1.5">
                      {heatPage} / {totalHeatPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={heatPage >= totalHeatPages}
                      onClick={() => setHeatPage((p) => Math.min(totalHeatPages, p + 1))}
                      className="h-7 text-xs px-2"
                    >
                      Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border border-border/80 shadow-xs">
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
                    className="w-48"
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
                    <SelectTrigger id="res-proc" className="w-36">
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
                <div>
                  <Label htmlFor="res-sort" className="mb-1 block text-xs text-muted-foreground">
                    Sort by
                  </Label>
                  <div className="flex items-center gap-1">
                    <Select
                      value={
                        tableMode === "hits"
                          ? hitsSortField ?? "default"
                          : subjSortField ?? "default"
                      }
                      onValueChange={(v) => {
                        if (tableMode === "hits") {
                          setHitsSortField(v === "default" ? null : (v as HitsSortField));
                        } else {
                          setSubjSortField(v === "default" ? null : (v as SubjSortField));
                        }
                      }}
                    >
                      <SelectTrigger id="res-sort" className="w-40">
                        <SelectValue placeholder="Default order" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default order</SelectItem>
                        {tableMode === "hits" ? (
                          <>
                            <SelectItem value="subject">{kind} ID</SelectItem>
                            <SelectItem value="system">System</SelectItem>
                            <SelectItem value="riskId">Risk ID</SelectItem>
                            <SelectItem value="description">Description</SelectItem>
                            <SelectItem value="level">Risk Level</SelectItem>
                            <SelectItem value="status">Status</SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="subject">{kind} ID</SelectItem>
                            <SelectItem value="name">{kind === "User" ? "User Name" : "Description"}</SelectItem>
                            <SelectItem value="group">{kind === "User" ? "Department" : "Process"}</SelectItem>
                            <SelectItem value="type">{kind === "User" ? "Assigned Roles" : "Type"}</SelectItem>
                            <SelectItem value="status">Status</SelectItem>
                            <SelectItem value="result">Risk hits count</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    {((tableMode === "hits" && hitsSortField) || (tableMode === "subjects" && subjSortField)) && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        title={
                          (tableMode === "hits" ? hitsSortOrder : subjSortOrder) === "asc"
                            ? "Ascending (click to switch to Descending)"
                            : "Descending (click to switch to Ascending)"
                        }
                        onClick={() => {
                          if (tableMode === "hits") {
                            setHitsSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                          } else {
                            setSubjSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                          }
                        }}
                      >
                        {(tableMode === "hits" ? hitsSortOrder : subjSortOrder) === "asc" ? (
                          <ArrowUp className="h-4 w-4 text-primary" />
                        ) : (
                          <ArrowDown className="h-4 w-4 text-primary" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>
            {tableMode === "hits" && filteredHits.length > 0 ? (
              <Table className="min-w-[1538px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">#</TableHead>
                    <SortableHead
                      title={kind}
                      field="subject"
                      currentField={hitsSortField}
                      order={hitsSortOrder}
                      onSort={toggleHitsSort}
                      className="w-[200px]"
                    />
                    <SortableHead
                      title="System"
                      field="system"
                      currentField={hitsSortField}
                      order={hitsSortOrder}
                      onSort={toggleHitsSort}
                      className="w-[280px]"
                    />
                    <SortableHead
                      title="Risk ID"
                      field="riskId"
                      currentField={hitsSortField}
                      order={hitsSortOrder}
                      onSort={toggleHitsSort}
                      className="w-[140px]"
                    />
                    <SortableHead
                      title="Risk description"
                      field="description"
                      currentField={hitsSortField}
                      order={hitsSortOrder}
                      onSort={toggleHitsSort}
                      className="min-w-[300px]"
                    />
                    <SortableHead
                      title="Level"
                      field="level"
                      currentField={hitsSortField}
                      order={hitsSortOrder}
                      onSort={toggleHitsSort}
                      className="w-[110px]"
                    />
                    <SortableHead
                      title="Status"
                      field="status"
                      currentField={hitsSortField}
                      order={hitsSortOrder}
                      onSort={toggleHitsSort}
                      className="w-[140px]"
                    />
                    <TableHead className="min-w-[320px]">Conflicting functions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedHits.map(({ h, s }, idx) => (
                    <TableRow
                      key={h.subject + h.riskId}
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => setSel({ hit: h, result: s })}
                      onKeyDown={(e) => e.key === "Enter" && setSel({ hit: h, result: s })}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground text-center select-none">{idx + 1}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold truncate" title={h.subject}>{h.subject}</TableCell>
                      <TableCell className="whitespace-nowrap overflow-hidden">
                        <span className="inline-flex items-center gap-1.5 rounded border border-border/80 bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground truncate max-w-full">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span className="truncate">{system?.name || "HMF 2023 – SAP S/4HANA (BTP CAP)"}</span>
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{h.riskId}</TableCell>
                      <TableCell className="truncate max-w-[300px]" title={h.description}>{h.description}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <LevelChip level={h.level} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={h.status} size="sm" />
                        {h.mitigation && <span className="ml-1.5 text-xs text-muted-foreground">Mitigated</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[320px]" title={h.functions.map((f) => f.functionName).join(" vs ")}>
                        {h.functions.map((f) => f.functionName).join(" vs ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : heatRows.length > 0 ? (
              <>
                <Table className="min-w-[1528px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">#</TableHead>
                    <SortableHead
                      title={`${kind} ID`}
                      field="subject"
                      currentField={subjSortField}
                      order={subjSortOrder}
                      onSort={toggleSubjSort}
                      className="w-[180px]"
                    />
                    <TableHead className="w-[280px]">System</TableHead>
                    <SortableHead
                      title={kind === "User" ? "User Name" : "Description"}
                      field="name"
                      currentField={subjSortField}
                      order={subjSortOrder}
                      onSort={toggleSubjSort}
                      className="min-w-[260px]"
                    />
                    <SortableHead
                      title={kind === "User" ? "Department" : "Process"}
                      field="group"
                      currentField={subjSortField}
                      order={subjSortOrder}
                      onSort={toggleSubjSort}
                      className="w-[180px]"
                    />
                    <SortableHead
                      title={kind === "User" ? "Assigned Roles" : "Type"}
                      field="type"
                      currentField={subjSortField}
                      order={subjSortOrder}
                      onSort={toggleSubjSort}
                      className="w-[280px]"
                    />
                    <SortableHead
                      title="Status"
                      field="status"
                      currentField={subjSortField}
                      order={subjSortOrder}
                      onSort={toggleSubjSort}
                      className="w-[140px]"
                    />
                    <SortableHead
                      title="SoD Result"
                      field="result"
                      currentField={subjSortField}
                      order={subjSortOrder}
                      onSort={toggleSubjSort}
                      className="w-[160px]"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedSubjects.map((s, idx) => {
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
                          } else if (u) {
                            setSelectedUser(u);
                          } else {
                            toast.info(`${kind} ${s.subject} is Clean`, {
                              description: `No SoD risks detected. All assigned transactions are risk-free. Status: Clean (Risk OK).`,
                            });
                          }
                        }}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground text-center select-none">
                          {(subjPage - 1) * SUBJ_PER_PAGE + idx + 1}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold truncate" title={s.subject}>
                          {kind === "User" && u ? (
                            <button
                              type="button"
                              className="text-primary hover:underline font-semibold text-left inline-flex items-center gap-1 max-w-full truncate"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedUser(u);
                              }}
                              title={`View all ${u.roles.length} roles for ${u.id}`}
                            >
                              <span className="truncate">{s.subject}</span>
                              <ExternalLink className="h-3 w-3 opacity-60 shrink-0" />
                            </button>
                          ) : (
                            s.subject
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap overflow-hidden">
                          <span className="inline-flex items-center gap-1.5 rounded border border-border/80 bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground truncate max-w-full">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span className="truncate">{system?.name || "HMF 2023 – SAP S/4HANA (BTP CAP)"}</span>
                          </span>
                        </TableCell>
                        <TableCell className="font-medium truncate" title={u ? u.name : r ? r.description : s.subject}>{u ? u.name : r ? r.description : s.subject}</TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate" title={u ? u.department : r ? r.process : "—"}>{u ? u.department : r ? r.process : "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate">
                          {u ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-xs font-mono font-semibold bg-muted hover:bg-primary/10 hover:text-primary transition-colors border-border/70"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedUser(u);
                                }}
                                title={`Click to view all ${u.roles.length} roles assigned to ${u.id}`}
                              >
                                <Layers className="h-3 w-3 mr-1 text-primary" />
                                {u.roles.length} role{u.roles.length === 1 ? "" : "s"}
                              </Button>
                              <span className="truncate max-w-[180px]" title={u.roles.join(", ")}>
                                {u.roles.slice(0, 2).join(", ")}{u.roles.length > 2 ? ` (+${u.roles.length - 2} more)` : ""}
                              </span>
                            </div>
                          ) : r ? r.type : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <StatusBadge status={s.status} size="sm" />
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
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
              {tableMode === "subjects" && totalSubjPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-2.5 bg-muted/20 text-xs text-muted-foreground">
                  <div>
                    Showing {(subjPage - 1) * SUBJ_PER_PAGE + 1}–{Math.min(subjPage * SUBJ_PER_PAGE, sortedSubjects.length)} of {sortedSubjects.length.toLocaleString()} {kind.toLowerCase()}s
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={subjPage <= 1}
                      onClick={() => setSubjPage((p) => Math.max(1, p - 1))}
                      className="h-7 text-xs px-2.5"
                    >
                      <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Previous
                    </Button>
                    <span className="font-mono text-xs px-2">Page {subjPage} of {totalSubjPages}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={subjPage >= totalSubjPages}
                      onClick={() => setSubjPage((p) => Math.min(totalSubjPages, p + 1))}
                      className="h-7 text-xs px-2.5"
                    >
                      Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
              </>
            ) : (
              <CardContent>
                <EmptyState
                  icon={ShieldCheck}
                  title="No results match these filters."
                  action={
                    <Button
                      onClick={() => {
                        setQ("");
                        setHitsSortField(null);
                        setSubjSortField(null);
                        setHeatmapSort(null);
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

          <ResultDrawer
            hit={sel?.hit}
            result={sel?.result}
            run={run}
            onOpenChange={(o) => !o && setSel(undefined)}
            onOpenUser={(u) => setSelectedUser(u)}
          />
          <UserDetailDrawer
            user={selectedUser}
            onOpenChange={(open) => !open && setSelectedUser(null)}
          />
        </>
      )}
    </>
  );
}

function SortableHead<T extends string>({
  title,
  field,
  currentField,
  order,
  onSort,
  className,
}: {
  title: string;
  field: T;
  currentField: T | null;
  order: "asc" | "desc";
  onSort: (field: T) => void;
  className?: string;
}) {
  const isSorted = currentField === field;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "group inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors select-none py-1 hover:text-foreground text-left",
          isSorted ? "text-primary font-bold" : "text-muted-foreground",
        )}
        title={`Sort by ${title}`}
      >
        <span>{title}</span>
        {isSorted ? (
          order === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 text-primary stroke-[2.5]" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 text-primary stroke-[2.5]" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground" />
        )}
      </button>
    </TableHead>
  );
}
