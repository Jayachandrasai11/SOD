import * as React from "react";
import { Download, Lock, ScrollText, X } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useService } from "@/services/db";
import { exportAuditCsv, getAuditLog } from "@/services/auditService";
import type { AuditArea } from "@/types";
import { fmtDateTime } from "@/lib/utils";

const AREAS: AuditArea[] = ["Rules", "Connection", "Analysis", "Role export", "Settings"];

export default function AuditLogPage() {
  const { data, loading } = useService(getAuditLog);
  const [q, setQ] = React.useState("");
  const [area, setArea] = React.useState("all");
  const [user, setUser] = React.useState("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  const users = [...new Set((data ?? []).map((a) => a.user))].sort();
  const rows = (data ?? []).filter((a) => {
    const s = q.toLowerCase();
    const day = a.timestamp.slice(0, 10);
    return (
      (area === "all" || a.area === area) &&
      (user === "all" || a.user === user) &&
      (!from || day >= from) &&
      (!to || day <= to) &&
      (!s || [a.action, a.object, a.before, a.after, a.reason].some((x) => x?.toLowerCase().includes(s)))
    );
  });
  const filtered = q || area !== "all" || user !== "all" || from || to;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: "Audit Log" }]}
        title="Audit Log"
        description="Every change to rules, connections, analyses, role exports and settings. Entries are append-only and cannot be edited or deleted."
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Append-only
            </span>
            <Button variant="outline" onClick={() => exportAuditCsv(rows)} disabled={!rows.length}>
              <Download /> Export to CSV
            </Button>
          </>
        }
      />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Input className="w-64" placeholder="Search action, object, values, reason…" aria-label="Search audit log" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={area} onValueChange={setArea}>
            <SelectTrigger className="w-44" aria-label="Area">
              <span className="text-muted-foreground">Area:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {AREAS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={user} onValueChange={setUser}>
            <SelectTrigger className="w-48" aria-label="User">
              <span className="text-muted-foreground">User:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {users.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            From <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            To <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {filtered && (
            <Button
              variant="ghost"
              onClick={() => {
                setQ("");
                setArea("all");
                setUser("all");
                setFrom("");
                setTo("");
              }}
            >
              <X /> Clear
            </Button>
          )}
        </div>
      </Card>
      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState className="m-4" icon={ScrollText} title="No audit entries match these filters." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Object</TableHead>
                <TableHead>Before → After</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(a.timestamp)}</TableCell>
                  <TableCell className="whitespace-nowrap">{a.user}</TableCell>
                  <TableCell>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{a.area}</span>
                  </TableCell>
                  <TableCell>{a.action}</TableCell>
                  <TableCell className="max-w-[220px] font-mono text-xs">{a.object}</TableCell>
                  <TableCell className="max-w-[320px] text-xs">
                    {a.before || a.after ? (
                      <>
                        {a.before && <span className="text-muted-foreground line-through decoration-muted-foreground/60">{a.before}</span>}
                        {a.before && a.after && <span aria-label="changed to"> → </span>}
                        {a.after && <span>{a.after}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="max-w-[240px] text-xs text-muted-foreground">{a.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          {rows.length} of {data?.length ?? 0} entries
        </div>
      </Card>
    </>
  );
}
