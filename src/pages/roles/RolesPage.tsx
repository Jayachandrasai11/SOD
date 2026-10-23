import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Play, RefreshCw, SearchX, Users, X } from "lucide-react";
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
import { roleStatuses, runAnalysis } from "@/services/analysisService";
import { downloadRoleTemplate } from "@/services/roleBuilderService";
import { useApp } from "@/context/AppContext";
import { PROCESSES, type Status } from "@/types";
import { cn, fmtDate, fmtDateTime, globMatch, todayStamp } from "@/lib/utils";

const ROW_H = 52;

export default function RolesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { startJob, can, systemId } = useApp();
  const { data, loading } = useService(async () => {
    const roles = await getRoles();
    const statuses = roleStatuses();
    const userCount = Object.fromEntries(roles.map((r) => [r.name, db.users.filter((u) => u.roles.includes(r.name)).length]));
    return { roles, statuses, userCount };
  });

  const [pattern, setPattern] = React.useState(params.get("q") ?? "");
  const [type, setType] = React.useState(params.get("type") ?? "all");
  const [process, setProcess] = React.useState(params.get("process") ?? "all");
  const [status, setStatus] = React.useState(params.get("status") ?? "all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [templateOpen, setTemplateOpen] = React.useState(false);

  React.useEffect(() => {
    const p = new URLSearchParams();
    if (pattern) p.set("q", pattern);
    if (type !== "all") p.set("type", type);
    if (process !== "all") p.set("process", process);
    if (status !== "all") p.set("status", status);
    setParams(p, { replace: true });
  }, [pattern, type, process, status, setParams]);

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
    toast.info("Background job started", { description: "You can keep working – we’ll notify you when it finishes." });
    startJob("User analysis (all users)", async (p) => {
      const run = await runAnalysis({ allUsers: true }, p);
      const red = run.results.filter((r) => r.status === "red").length;
      return { message: `${run.results.length} users analysed · ${red} with Red risks`, link: `/roles/analysis?run=${run.runId}` };
    });
  };

  const refresh = () =>
    startJob(`Delta sync ${system.sid}`, async (p) => {
      const n = await syncNow(systemId, p);
      return { message: `${n.toLocaleString()} records updated`, link: "/connections" };
    });

  const exportExcel = () => {
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
        description="All roles from the latest S/4HANA snapshot with their SoD status. Select roles to analyse them against the current ruleset."
        actions={
          <>
            <Button variant="outline" onClick={() => setTemplateOpen(true)}>
              <Download /> Download SoD role template
            </Button>
            <Button variant="outline" onClick={exportExcel} disabled={!rows.length}>
              <FileSpreadsheet /> Export to Excel
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="role-pattern" className="mb-1.5 block text-xs text-muted-foreground">
              Role name or pattern
            </Label>
            <Input id="role-pattern" placeholder="e.g. Z_FI_*" value={pattern} onChange={(e) => setPattern(e.target.value)} />
          </div>
          <FilterSelect label="Type" value={type} onChange={setType} options={["Single", "Composite", "Derived"]} />
          <FilterSelect label="Process" value={process} onChange={setProcess} options={PROCESSES} />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={["red", "amber", "green", "grey"]}
            render={(s) => <StatusBadge status={s as Status} size="sm" />}
          />
          {(pattern || type !== "all" || process !== "all" || status !== "all") && (
            <Button variant="ghost" onClick={clearFilters}>
              <X /> Clear
            </Button>
          )}
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={analyseSelected} disabled={!selected.size || !can("edit")}>
            <Play /> Analyse selected{selected.size ? ` (${selected.size})` : ""}
          </Button>
          <Button variant="secondary" onClick={analyseAllUsers} disabled={!can("edit")}>
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
        ) : rows.length === 0 ? (
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
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            {rows.length} of {data?.roles.length ?? 0} roles{selected.size ? ` · ${selected.size} selected` : ""} · Space selects, Enter opens
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
