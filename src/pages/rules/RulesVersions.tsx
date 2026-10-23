import * as React from "react";
import { GitCompare, Minus, Pencil, Plus } from "lucide-react";
import { LevelChip } from "@/components/common";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/misc";
import { useService } from "@/services/db";
import { diffVersions, getVersions, type DiffRow } from "@/services/rulesService";
import type { Risk, VersionStatus } from "@/types";
import { cn, fmtDateTime } from "@/lib/utils";

const STATUS_CLS: Record<VersionStatus, string> = {
  Draft: "bg-muted text-foreground",
  Submitted: "bg-status-amber-bg text-status-amber",
  Approved: "bg-accent text-accent-foreground",
  Published: "bg-status-green-bg text-status-green",
};

export function RulesVersions({ comparePublished }: { comparePublished: boolean }) {
  const { data: versions, loading } = useService(getVersions);
  const [left, setLeft] = React.useState<string>();
  const [right, setRight] = React.useState<string>();
  const [onlyChanges, setOnlyChanges] = React.useState(true);

  React.useEffect(() => {
    if (!versions || left) return;
    const published = versions.find((v) => v.status === "Published");
    setLeft((comparePublished ? published : versions[1])?.version ?? versions[0].version);
    setRight(versions[0].version);
  }, [versions, comparePublished, left]);

  if (loading || !versions) return <Skeleton className="h-80 rounded-xl" />;

  const a = versions.find((v) => v.version === left);
  const b = versions.find((v) => v.version === right);
  const diff = a && b ? diffVersions(a, b) : [];
  const shown = onlyChanges ? diff.filter((d) => d.kind !== "same") : diff;
  const counts = { added: diff.filter((d) => d.kind === "added").length, changed: diff.filter((d) => d.kind === "changed").length, removed: diff.filter((d) => d.kind === "removed").length };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Version history</CardTitle>
          <CardDescription>Draft → Submitted → Approved → Published. Only the published version is used for scheduled analysis.</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Risks</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.version}>
                <TableCell className="font-semibold">v{v.version}</TableCell>
                <TableCell>
                  <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", STATUS_CLS[v.status])}>{v.status}</span>
                </TableCell>
                <TableCell>{v.author}</TableCell>
                <TableCell>{fmtDateTime(v.date)}</TableCell>
                <TableCell className="tabular">{v.risks.filter((r) => r.active).length}</TableCell>
                <TableCell className="text-muted-foreground">{v.note}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitCompare className="h-4 w-4" aria-hidden /> Compare versions
            </CardTitle>
            <CardDescription>
              <span className="text-status-green">{counts.added} added</span> · <span className="text-status-amber">{counts.changed} changed</span> ·{" "}
              <span className="text-status-red">{counts.removed} removed</span>
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <VersionPick id="v-left" label="From" value={left} onChange={setLeft} versions={versions.map((v) => `${v.version}|${v.status}`)} />
            <VersionPick id="v-right" label="To" value={right} onChange={setRight} versions={versions.map((v) => `${v.version}|${v.status}`)} />
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
              Only changes
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {shown.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">These versions are identical.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <div className="grid grid-cols-2 border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <div className="px-4 py-2">v{left}</div>
                <div className="border-l px-4 py-2">v{right}</div>
              </div>
              {shown.map((d) => (
                <DiffLine key={d.id} d={d} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VersionPick({ id, label, value, onChange, versions }: { id: string; label: string; value?: string; onChange: (v: string) => void; versions: string[] }) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v) => {
            const [ver, st] = v.split("|");
            return (
              <SelectItem key={ver} value={ver}>
                v{ver} · {st}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

const KIND_META = {
  added: { icon: Plus, label: "Added", cls: "bg-status-green-bg/60", text: "text-status-green" },
  removed: { icon: Minus, label: "Removed", cls: "bg-status-red-bg/60", text: "text-status-red" },
  changed: { icon: Pencil, label: "Changed", cls: "bg-status-amber-bg/50", text: "text-status-amber" },
  same: { icon: Minus, label: "Unchanged", cls: "", text: "text-muted-foreground" },
};

function RiskCell({ r, d, side }: { r?: Risk; d: DiffRow; side: "left" | "right" }) {
  if (!r) return <div className="px-4 py-3 text-xs italic text-muted-foreground">—</div>;
  const removed = d.kind === "removed" && side === "left";
  const hl = (f: string) => d.kind === "changed" && d.fields.includes(f) && "rounded bg-status-amber-bg px-1 font-semibold text-status-amber";
  return (
    <div className={cn("space-y-1 px-4 py-3 text-sm", removed && "text-status-red line-through")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{r.id}</span>
        <span className={cn(hl("level") || "")}>
          <LevelChip level={r.level} />
        </span>
        {!r.active && <span className={cn("text-xs", hl("active"))}>inactive</span>}
      </div>
      <div className={cn(hl("description"))}>{r.description}</div>
      <div className="text-xs text-muted-foreground">
        <span className={cn(hl("owner"))}>{r.owner}</span> · <span className={cn(hl("type"))}>{r.type}</span> · <span className={cn(hl("functionIds"))}>{r.functionIds.join(" vs ")}</span>
      </div>
    </div>
  );
}

function DiffLine({ d }: { d: DiffRow }) {
  const m = KIND_META[d.kind];
  return (
    <div className={cn("grid grid-cols-2 border-b last:border-0", m.cls)}>
      <div className="relative">
        <span className={cn("absolute right-2 top-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase", m.text)}>
          <m.icon className="h-3 w-3" aria-hidden /> {m.label}
        </span>
        <RiskCell r={d.left} d={d} side="left" />
      </div>
      <div className="border-l">
        <RiskCell r={d.right} d={d} side="right" />
      </div>
    </div>
  );
}
