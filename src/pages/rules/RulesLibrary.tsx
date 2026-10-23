import * as React from "react";
import { toast } from "sonner";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FolderTree,
  ListFilter,
  Plus,
  SearchX,
  Table2,
  X,
} from "lucide-react";
import { EmptyState, HelpTip, LevelChip } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox, Skeleton, Switch } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { db, useService } from "@/services/db";
import { bulkUpdate, exportRulesExcel, getRisks } from "@/services/rulesService";
import { RISK_OWNERS } from "@/data/rules";
import { SU24 } from "@/data/tcodes";
import { useApp } from "@/context/AppContext";
import { PROCESSES, RISK_LEVELS, RISK_TYPES, type Risk, type RiskLevel, type SodFunction } from "@/types";
import { cn } from "@/lib/utils";
import { RiskDrawer } from "./RiskDrawer";

interface View {
  name: string;
  q: string;
  process: string;
  level: string;
  type: string;
  active: string;
}

const BUILTIN_VIEWS: View[] = [
  { name: "All risks", q: "", process: "all", level: "all", type: "all", active: "all" },
  { name: "Critical & High only", q: "", process: "all", level: "CH", type: "all", active: "active" },
  { name: "Finance", q: "", process: "Finance", level: "all", type: "all", active: "all" },
  { name: "Inactive risks", q: "", process: "all", level: "all", type: "all", active: "inactive" },
];

const loadViews = (): View[] => {
  try {
    return JSON.parse(localStorage.getItem("mysodai-rule-views") ?? "[]");
  } catch {
    return [];
  }
};

export function RulesLibrary({ initialRisk }: { initialRisk: string | null }) {
  const { can } = useApp();
  const { data: risks, loading } = useService(getRisks);
  const [mode, setMode] = React.useState<"table" | "tree">("table");
  const [view, setView] = React.useState<View>(BUILTIN_VIEWS[0]);
  const [savedViews, setSavedViews] = React.useState<View[]>(loadViews);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editing, setEditing] = React.useState<string | "new" | undefined>(initialRisk ?? undefined);

  React.useEffect(() => {
    if (initialRisk) setEditing(initialRisk);
  }, [initialRisk]);

  const fnMap = new Map(db.functions.map((f) => [f.id, f]));
  const rows = (risks ?? []).filter((r) => {
    const q = view.q.toLowerCase();
    const fnNames = r.functionIds.map((id) => fnMap.get(id)?.name ?? "").join(" ");
    const tcodes = r.functionIds.flatMap((id) => fnMap.get(id)?.actions.map((a) => a.tcode) ?? []).join(" ");
    return (
      (!q || `${r.id} ${r.description} ${r.owner} ${fnNames} ${tcodes}`.toLowerCase().includes(q)) &&
      (view.process === "all" || r.process === view.process) &&
      (view.level === "all" || (view.level === "CH" ? r.level === "Critical" || r.level === "High" : r.level === view.level)) &&
      (view.type === "all" || r.type === view.type) &&
      (view.active === "all" || (view.active === "active" ? r.active : !r.active))
    );
  });

  const set = (patch: Partial<View>) => setView((v) => ({ ...v, ...patch, name: "Custom" }));
  const ids = [...selected];

  const bulk = async (patch: Parameters<typeof bulkUpdate>[1], label: string) => {
    const undo = await bulkUpdate(ids, patch);
    toast.success(`${label} – ${ids.length} risk(s)`, {
      action: { label: "Undo", onClick: () => undo().then(() => toast.info("Change undone")) },
    });
    setSelected(new Set());
  };

  const saveView = () => {
    const name = window.prompt("Name this view", "My view");
    if (!name) return;
    const next = [...savedViews.filter((v) => v.name !== name), { ...view, name }];
    setSavedViews(next);
    setView({ ...view, name });
    try {
      localStorage.setItem("mysodai-rule-views", JSON.stringify(next));
    } catch {
      /* ignore */
    }
    toast.success(`View “${name}” saved`);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Library view">
            <button className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", mode === "table" ? "bg-background shadow-sm" : "text-muted-foreground")} aria-pressed={mode === "table"} onClick={() => setMode("table")}>
              <Table2 className="h-4 w-4" aria-hidden /> Table
            </button>
            <button className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", mode === "tree" ? "bg-background shadow-sm" : "text-muted-foreground")} aria-pressed={mode === "tree"} onClick={() => setMode("tree")}>
              <FolderTree className="h-4 w-4" aria-hidden /> Tree
            </button>
          </div>
          <Input className="w-64" placeholder="Search ID, description, tcode…" aria-label="Search risks" value={view.q} onChange={(e) => set({ q: e.target.value })} />
          <MiniSelect label="Process" value={view.process} onChange={(v) => set({ process: v })} options={PROCESSES.map((p) => [p, p] as [string, string])} />
          <MiniSelect label="Level" value={view.level} onChange={(v) => set({ level: v })} options={[["CH", "Critical & High"] as [string, string], ...RISK_LEVELS.map((l) => [l, l] as [string, string])]} />
          <MiniSelect label="Type" value={view.type} onChange={(v) => set({ type: v })} options={RISK_TYPES.map((t) => [t, t] as [string, string])} />
          <MiniSelect label="State" value={view.active} onChange={(v) => set({ active: v })} options={[["active", "Active"], ["inactive", "Inactive"]] as [string, string][]} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Bookmark /> {view.name}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Saved views</DropdownMenuLabel>
              {[...BUILTIN_VIEWS, ...savedViews].map((v) => (
                <DropdownMenuItem key={v.name} onSelect={() => setView(v)}>
                  {v.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={saveView}>
                <Plus /> Save current view…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => exportRulesExcel(rows)} disabled={!rows.length}>
              <FileSpreadsheet /> Export to Excel
            </Button>
            <Button onClick={() => setEditing("new")} disabled={!can("edit")}>
              <Plus /> New risk
            </Button>
          </div>
        </div>
      </Card>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-2.5" role="region" aria-label="Bulk actions">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => bulk({ active: true }, "Activated")} disabled={!can("edit")}>
            Activate
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulk({ active: false }, "Deactivated")} disabled={!can("edit")}>
            Deactivate
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={!can("edit")}>
                Change level <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {RISK_LEVELS.map((l) => (
                <DropdownMenuItem key={l} onSelect={() => bulk({ level: l as RiskLevel }, `Level set to ${l}`)}>
                  <LevelChip level={l} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={!can("edit")}>
                Change owner <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {RISK_OWNERS.map((o) => (
                <DropdownMenuItem key={o} onSelect={() => bulk({ owner: o }, "Owner changed")}>
                  {o}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            <X /> Clear selection
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={(risks?.length ?? 0) === 0 ? ListFilter : SearchX}
            title={(risks?.length ?? 0) === 0 ? "Your ruleset is empty. Import rules or load the MyGo starter library." : "No risks match this view."}
            action={<Button onClick={() => setView(BUILTIN_VIEWS[0])}>Show all risks</Button>}
          />
        ) : mode === "table" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={rows.every((r) => selected.has(r.id)) ? true : rows.some((r) => selected.has(r.id)) ? "indeterminate" : false}
                    onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </TableHead>
                <TableHead>Risk ID</TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    Description <HelpTip term="Risk" />
                  </span>
                </TableHead>
                <TableHead>Process</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    Functions <HelpTip term="Function" />
                  </span>
                </TableHead>
                <TableHead className="hidden xl:table-cell">Owner</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  tabIndex={0}
                  data-state={selected.has(r.id) ? "selected" : undefined}
                  className={cn("cursor-pointer", !r.active && "text-muted-foreground")}
                  onClick={() => setEditing(r.id)}
                  onKeyDown={(e) => e.key === "Enter" && setEditing(r.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select ${r.id}`}
                      checked={selected.has(r.id)}
                      onCheckedChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          n.has(r.id) ? n.delete(r.id) : n.add(r.id);
                          return n;
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs font-medium">{r.id}</TableCell>
                  <TableCell className="max-w-[280px]">{r.description}</TableCell>
                  <TableCell>{r.process}</TableCell>
                  <TableCell>
                    <LevelChip level={r.level} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{r.type}</TableCell>
                  <TableCell className="text-xs">
                    {r.functionIds.map((id, i) => (
                      <span key={id}>
                        {i > 0 && <span className="text-muted-foreground"> vs </span>}
                        {fnMap.get(id)?.name ?? id}
                      </span>
                    ))}
                  </TableCell>
                  <TableCell className="hidden text-xs xl:table-cell">{r.owner}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={r.active}
                        disabled={!can("edit")}
                        aria-label={`${r.id} active`}
                        onCheckedChange={async (c) => {
                          const undo = await bulkUpdate([r.id], { active: c });
                          toast.success(`${r.id} ${c ? "activated" : "deactivated"}`, { action: { label: "Undo", onClick: () => undo() } });
                        }}
                      />
                      <span className="text-xs">{r.active ? "On" : "Off"}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <RulesTree risks={rows} fnMap={fnMap} onOpen={setEditing} />
        )}
        <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          {rows.length} of {risks?.length ?? 0} risks · Risks are deactivated, never deleted, so audit history stays intact.
        </div>
      </Card>

      <RiskDrawer riskId={editing} onClose={() => setEditing(undefined)} />
    </div>
  );
}

function MiniSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-40" aria-label={label}>
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------- Tree view

function TreeNode({
  label,
  depth,
  children,
  defaultOpen,
  kind,
}: {
  label: React.ReactNode;
  depth: number;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  kind: string;
}) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  const hasChildren = !!children;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-level={depth + 1}>
      <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: depth * 20 }}>
        {hasChildren ? (
          <button className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted" onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse" : "Expand"}>
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{kind}</span>
        <span className="min-w-0 flex-1">{label}</span>
      </div>
      {hasChildren && open && <ul role="group">{children}</ul>}
    </li>
  );
}

function RulesTree({ risks, fnMap, onOpen }: { risks: Risk[]; fnMap: Map<string, SodFunction>; onOpen: (id: string) => void }) {
  const processes = PROCESSES.filter((p) => risks.some((r) => r.process === p));
  return (
    <div className="p-4">
      <p className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
        Process → Risk → Function → Action → Permission <HelpTip term="Action" /> <HelpTip term="Permission" />
      </p>
      <ul role="tree" aria-label="Ruleset tree" className="text-sm">
        {processes.map((p) => (
          <TreeNode key={p} kind="Process" depth={0} defaultOpen label={<span className="font-semibold">{p}</span>}>
            {risks
              .filter((r) => r.process === p)
              .map((r) => (
                <TreeNode
                  key={r.id}
                  kind="Risk"
                  depth={1}
                  label={
                    <span className="flex flex-wrap items-center gap-2">
                      <button className="font-mono text-xs text-primary hover:underline" onClick={() => onOpen(r.id)}>
                        {r.id}
                      </button>
                      {r.description}
                      <LevelChip level={r.level} />
                      {!r.active && <span className="text-xs text-muted-foreground">(inactive)</span>}
                    </span>
                  }
                >
                  {r.functionIds.map((fid) => {
                    const f = fnMap.get(fid);
                    return (
                      <TreeNode key={fid} kind="Function" depth={2} label={<span>{f?.name ?? fid} <span className="font-mono text-xs text-muted-foreground">{fid}</span></span>}>
                        {f?.actions.map((a) => {
                          const perms = f.permissions.filter((p) => (SU24[a.tcode] ?? []).some((s) => s.object === p.object && s.field === p.field));
                          return (
                            <TreeNode key={a.tcode} kind="Action" depth={3} label={<span>{a.description} <span className="font-mono text-xs text-muted-foreground">({a.tcode})</span></span>}>
                              {perms.length
                                ? perms.map((pm, i) => (
                                    <TreeNode
                                      key={i}
                                      kind="Permission"
                                      depth={4}
                                      label={
                                        <span className="font-mono text-xs">
                                          {pm.object} · {pm.field} = {pm.low}
                                          {pm.high ? `–${pm.high}` : ""}
                                        </span>
                                      }
                                    />
                                  ))
                                : undefined}
                            </TreeNode>
                          );
                        })}
                      </TreeNode>
                    );
                  })}
                </TreeNode>
              ))}
          </TreeNode>
        ))}
      </ul>
    </div>
  );
}
