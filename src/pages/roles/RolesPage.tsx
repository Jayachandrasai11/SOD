import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Play, RefreshCw, SearchX, ShieldCheck, Users, X } from "lucide-react";
import { PageHeader, EmptyState, HelpTip } from "@/components/common";
import { StatusBadge, StatusLegend } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox, Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/misc";
import { Label } from "@/components/ui/label";
import { db, useService } from "@/services/db";
import { getRoles, snapshotInfo, syncNow } from "@/services/sapService";
import { roleStatuses, runAnalysis, userResult } from "@/services/analysisService";
import { downloadRoleTemplate } from "@/services/roleBuilderService";
import { useApp } from "@/context/AppContext";
import { PROCESSES, type Status } from "@/types";
import { cn, fmtDate, fmtDateTime, globMatch, todayStamp } from "@/lib/utils";

const ROW_H = 52;

export default function RolesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { startJob, can, systemId } = useApp();
  const [view, setView] = React.useState<"roles" | "users">((params.get("view") as "roles" | "users") ?? "roles");

  const { data, loading } = useService(async () => {
    const roles = await getRoles();
    const statuses = roleStatuses();
    const userCount = Object.fromEntries(roles.map((r) => [r.name, db.users.filter((u) => u.roles.includes(r.name)).length]));
    const users = db.users.map((u) => {
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
  const [process, setProcess] = React.useState(params.get("process") ?? "all");
  const [dept, setDept] = React.useState(params.get("dept") ?? "all");
  const [status, setStatus] = React.useState(params.get("status") ?? "all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [templateOpen, setTemplateOpen] = React.useState(false);

  React.useEffect(() => {
    const p = new URLSearchParams();
    if (view !== "roles") p.set("view", view);
    if (pattern) p.set("q", pattern);
    if (view === "roles") {
      if (type !== "all") p.set("type", type);
      if (process !== "all") p.set("process", process);
    } else {
      if (dept !== "all") p.set("dept", dept);
    }
    if (status !== "all") p.set("status", status);
    setParams(p, { replace: true });
  }, [view, pattern, type, process, dept, status, setParams]);

  const departments = React.useMemo(() => (data ? [...new Set(data.users.map((u) => u.department))] : []), [data]);

  const rows = React.useMemo(() => {
    if (!data) return [];
    return data.roles.filter(
      (r) =>
        (globMatch(pattern, r.name) || (!/[*?]/.test(pattern) && r.description.toLowerCase().includes(pattern.toLowerCase()))) &&
        (type === "all" || r.type === type) &&
        (process === "all" || r.process === process) &&
        (status === "all" || data.statuses[r.name] === status),
    );
  }, [data, pattern, type, process, status]);

  const userRows = React.useMemo(() => {
    if (!data) return [];
    const pat = pattern.trim().toLowerCase();
    return data.users.filter(
      (u) =>
        (!pat || u.id.toLowerCase().includes(pat) || u.name.toLowerCase().includes(pat) || u.department.toLowerCase().includes(pat)) &&
        (dept === "all" || u.department === dept) &&
        (status === "all" || u.status === status),
    );
  }, [data, pattern, dept, status]);

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

  const snap = snapshotInfo();
  const system = db.systems.find((s) => s.id === systemId)!;
  const clearFilters = () => {
    setPattern("");
    setType("all");
    setProcess("all");
    setDept("all");
    setStatus("all");
  };

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

  const refresh = () =>
    startJob(`Delta sync ${system.sid}`, async (p) => {
      const n = await syncNow(systemId, p);
      return { message: `${n.toLocaleString()} records updated`, link: "/settings?tab=connections" };
    });

  const exportExcel = () => {
    if (view === "users") {
      const ws = XLSX.utils.json_to_sheet(
        userRows.map((u) => ({
          "User ID": u.id,
          Name: u.name,
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
        Description: r.description,
        Type: r.type,
        "Parent role": r.parent ?? "",
        Process: r.process,
        "Users assigned": data!.userCount[r.name],
        "Last changed": fmtDate(r.lastChanged),
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
        crumbs={[{ label: "Home", to: "/" }, { label: "Roles & Analysis" }]}
        title="Roles & Analysis"
        description="All roles and users from the latest S/4HANA snapshot with their SoD status. Select roles or analyse users to evaluate compliance against active rules."
        actions={
          <>
            {view === "roles" && (
              <Button variant="outline" onClick={() => setTemplateOpen(true)}>
                <Download /> Download SoD role template
              </Button>
            )}
            <Button variant="outline" onClick={exportExcel} disabled={view === "roles" ? !rows.length : !userRows.length}>
              <FileSpreadsheet /> Export to Excel
            </Button>
          </>
        }
      />

      <div className="mb-4 inline-flex rounded-lg bg-muted p-1" role="group" aria-label="View selection">
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
            view === "roles" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setView("roles")}
        >
          <ShieldCheck className="h-4 w-4" /> Roles ({data?.roles.length ?? 0})
        </button>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
            view === "users" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setView("users")}
        >
          <Users className="h-4 w-4" /> Users ({data?.users.length ?? 0})
        </button>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="search-pattern" className="mb-1.5 block text-xs text-muted-foreground">
              {view === "roles" ? "Role name or pattern" : "User ID, name or department"}
            </Label>
            <Input
              id="search-pattern"
              placeholder={view === "roles" ? "e.g. Z_FI_*" : "e.g. ASHARMA, Sharma, Accounts Payable…"}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
          {view === "roles" ? (
            <>
              <FilterSelect label="Type" value={type} onChange={setType} options={["Single", "Composite", "Derived"]} />
              <FilterSelect label="Process" value={process} onChange={setProcess} options={PROCESSES} />
            </>
          ) : (
            <FilterSelect label="Department" value={dept} onChange={setDept} options={departments} />
          )}
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={["red", "amber", "green", "grey"]}
            render={(s) => <StatusBadge status={s as Status} size="sm" />}
          />
          {(pattern || (view === "roles" && (type !== "all" || process !== "all")) || (view === "users" && dept !== "all") || status !== "all") && (
            <Button variant="ghost" onClick={clearFilters}>
              <X /> Clear
            </Button>
          )}
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {view === "roles" ? (
            <Button onClick={analyseSelected} disabled={!selected.size || !can("edit")}>
              <Play /> Analyse selected{selected.size ? ` (${selected.size})` : ""}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => navigate("/roles/analysis?kind=User")}>
              <ShieldCheck /> View user analysis report
            </Button>
          )}
          <Button variant={view === "users" ? "default" : "secondary"} onClick={analyseAllUsers} disabled={!can("edit")}>
            <Users /> Analyse all users (background job)
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Data as of {fmtDateTime(snap.snapshot)} · {system.sid}
          </span>
          <HelpTip term="Snapshot" />
          <Button variant="link" size="sm" className="h-auto p-0" onClick={refresh}>
            <RefreshCw className="!size-3" /> Refresh
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
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
            <div ref={parentRef} className="max-h-[calc(100vh-380px)] min-h-[320px] overflow-auto" role="region" aria-label="Role list" tabIndex={-1}>
              <table className="w-full text-sm" aria-rowcount={rows.length + 1}>
                <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="w-10 px-3 py-2.5">
                      <Checkbox
                        aria-label="Select all visible roles"
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.name)) : new Set())}
                      />
                    </th>
                    <th className="px-3 py-2.5">Role name</th>
                    <th className="px-3 py-2.5">Description</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="hidden px-3 py-2.5 xl:table-cell">Parent role</th>
                    <th className="px-3 py-2.5 text-right">Users</th>
                    <th className="hidden px-3 py-2.5 md:table-cell">Last changed</th>
                    <th className="px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {padTop > 0 && <tr style={{ height: padTop }} aria-hidden />}
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
                        <td className="px-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={sel} onCheckedChange={() => toggle(r.name)} aria-label={`Select ${r.name}`} />
                        </td>
                        <td className="px-3 font-mono text-[13px] font-medium">{r.name}</td>
                        <td className="max-w-[280px] truncate px-3 text-muted-foreground">{r.description}</td>
                        <td className="px-3">{r.type}</td>
                        <td className="hidden px-3 font-mono text-xs text-muted-foreground xl:table-cell">{r.parent ?? "—"}</td>
                        <td className="tabular px-3 text-right">{data!.userCount[r.name]}</td>
                        <td className="hidden px-3 text-muted-foreground md:table-cell">{fmtDate(r.lastChanged)}</td>
                        <td className="px-3">
                          <StatusBadge status={data!.statuses[r.name]} size="sm" />
                        </td>
                      </tr>
                    );
                  })}
                  {padBottom > 0 && <tr style={{ height: padBottom }} aria-hidden />}
                </tbody>
              </table>
            </div>
          )
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
          <div className="max-h-[calc(100vh-380px)] min-h-[320px] overflow-auto" role="region" aria-label="User list" tabIndex={-1}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5">User ID</th>
                  <th className="px-3 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Department</th>
                  <th className="px-3 py-2.5">Assigned roles</th>
                  <th className="hidden px-3 py-2.5 md:table-cell">Valid to</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">SoD Risk Result</th>
                </tr>
              </thead>
              <tbody>
                {userRows.map((u) => {
                  const open = () => navigate(`/roles/analysis?kind=User&subject=${encodeURIComponent(u.id)}`);
                  return (
                    <tr
                      key={u.id}
                      tabIndex={0}
                      className="cursor-pointer border-b hover:bg-muted/40 focus-visible:bg-accent/50 focus-visible:outline-none"
                      onClick={open}
                      onKeyDown={(e) => e.key === "Enter" && open()}
                    >
                      <td className="px-3 py-3 font-mono text-xs font-semibold">{u.id}</td>
                      <td className="px-3 py-3 font-medium">{u.name}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{u.department}</td>
                      <td className="px-3 py-3 text-xs">
                        <span className="mr-1.5 rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {u.roles.length} role(s)
                        </span>
                        <span className="text-muted-foreground">
                          {u.roles.slice(0, 2).join(", ")}{u.roles.length > 2 ? "…" : ""}
                        </span>
                      </td>
                      <td className="hidden px-3 py-3 text-xs text-muted-foreground md:table-cell">
                        {fmtDate(u.validTo)}
                        {u.locked && <span className="ml-1 rounded bg-status-red-bg px-1.5 py-0.5 text-[10px] font-semibold text-status-red">Locked</span>}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={u.status} size="sm" />
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {u.hits.length === 0 ? (
                          <span className="font-medium text-status-green flex items-center gap-1.5">
                            ✓ Risk OK · Clean
                          </span>
                        ) : (
                          <span className="font-medium text-status-red">
                            {u.hits.length} risk hit(s)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            {view === "roles" ? `${rows.length} of ${data?.roles.length ?? 0} roles` : `${userRows.length} of ${data?.users.length ?? 0} users`}
            {view === "roles" && selected.size ? ` · ${selected.size} selected` : ""} · Click row to drill down
          </span>
          <StatusLegend />
        </div>
      </Card>

      <TemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} selected={[...selected]} />
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  render,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  render?: (v: string) => React.ReactNode;
}) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <div className="w-40">
      <Label htmlFor={id} className="mb-1.5 block text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {render ? render(o) : o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
