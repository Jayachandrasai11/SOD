import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Lock, Pencil, PlugZap, Plus, RefreshCw, Server, ShieldCheck, XCircle } from "lucide-react";
import { PageHeader, EmptyState, Field } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useService } from "@/services/db";
import { getSyncRuns, getSystems, syncNow, testExisting, updateSystem, type TestStep } from "@/services/sapService";
import { useApp } from "@/context/AppContext";
import type { ConnectionStatus, SapSystem, SyncRun } from "@/types";
import { cn, fmtDateTime, fmtNumber, relativeTime } from "@/lib/utils";
import { AddSystemWizard, TestChecklist } from "./AddSystemWizard";

const CONN_META: Record<ConnectionStatus, { icon: typeof CheckCircle2; cls: string }> = {
  Connected: { icon: CheckCircle2, cls: "bg-status-green-bg text-status-green border-status-green/30" },
  Warning: { icon: AlertTriangle, cls: "bg-status-amber-bg text-status-amber border-status-amber/30" },
  Failed: { icon: XCircle, cls: "bg-status-red-bg text-status-red border-status-red/30" },
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const m = CONN_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", m.cls)}>
      <m.icon className="h-3.5 w-3.5" aria-hidden /> {status}
    </span>
  );
}

const RESULT_STATUS: Record<SyncRun["result"], ConnectionStatus> = { Success: "Connected", Warning: "Warning", Failed: "Failed" };

export default function ConnectionsPage() {
  const [params, setParams] = useSearchParams();
  const { can, startJob } = useApp();
  const { data: systems, loading } = useService(getSystems);
  const { data: runs } = useService(getSyncRuns);
  const [testing, setTesting] = React.useState<SapSystem>();
  const [steps, setSteps] = React.useState<TestStep[]>([]);
  const [editing, setEditing] = React.useState<SapSystem>();
  const addOpen = params.get("add") === "1";

  const test = async (s: SapSystem) => {
    setTesting(s);
    setSteps([]);
    const res = await testExisting(s.id, (st) => setSteps((x) => [...x, st]));
    if (res.every((r) => r.ok)) toast.success(`${s.sid}: all checks passed`);
    else toast.error(`${s.sid}: connection test failed`);
  };

  const sync = (s: SapSystem) =>
    startJob(`Delta sync ${s.sid}`, async (p) => {
      const n = await syncNow(s.id, p);
      return { message: `${fmtNumber(n)} records updated`, link: "/connections" };
    });

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: "Connections" }]}
        title="Connections"
        description="S/4HANA systems MySODAI reads roles, users and authorisations from."
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Read-only · MySODAI never writes to SAP
            </span>
            <Button onClick={() => setParams({ add: "1" })} disabled={!can("admin")}>
              <Plus /> Add system
            </Button>
          </>
        }
      />

      {loading || !systems ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : systems.length === 0 ? (
        <EmptyState icon={Server} title="No SAP system is connected yet. Add one to start analysing roles." action={<Button onClick={() => setParams({ add: "1" })}><Plus /> Add system</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {systems.map((s) => (
            <Card key={s.id}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {s.name}
                  </CardTitle>
                  <CardDescription>
                    SID <span className="font-mono">{s.sid}</span> · client <span className="font-mono">{s.client}</span> · {s.host}
                  </CardDescription>
                </div>
                <ConnectionBadge status={s.status} />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Tag>{s.tier}</Tag>
                  <Tag>{s.deployment}</Tag>
                  <Tag>{s.method}</Tag>
                  <Tag>{s.authType}</Tag>
                </div>
                {s.statusMessage && (
                  <p className="flex items-start gap-2 rounded-lg bg-status-amber-bg px-3 py-2 text-sm text-status-amber">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {s.statusMessage}
                  </p>
                )}
                <dl className="grid grid-cols-3 gap-3 text-center">
                  {[
                    ["Users", s.counts.users],
                    ["Roles", s.counts.roles],
                    ["Auth rows", s.counts.authRows],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded-lg bg-muted/50 p-3">
                      <dt className="text-xs text-muted-foreground">{l}</dt>
                      <dd className="tabular text-lg font-semibold">{fmtNumber(v as number)}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Last delta sync</dt>
                    <dd>
                      {fmtDateTime(s.lastDeltaSync)} <span className="text-muted-foreground">({relativeTime(s.lastDeltaSync)})</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last full sync</dt>
                    <dd>{fmtDateTime(s.lastFullSync)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Schedule</dt>
                    <dd>
                      Full {s.schedule.full} · Delta {s.schedule.delta}
                    </dd>
                  </div>
                </dl>
              </CardContent>
              <CardFooter className="flex-wrap">
                <Button variant="outline" size="sm" onClick={() => test(s)}>
                  <PlugZap /> Test connection
                </Button>
                <Button variant="outline" size="sm" onClick={() => sync(s)} disabled={!can("edit")}>
                  <RefreshCw /> Sync now
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(s)} disabled={!can("admin")}>
                  <Pencil /> Edit
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Sync history</CardTitle>
          <CardDescription>Scheduled and manual data loads from SAP</CardDescription>
        </CardHeader>
        {!runs ? (
          <CardContent>
            <Skeleton className="h-40" />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>System</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDateTime(r.started)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.systemId}</TableCell>
                  <TableCell>{r.type}</TableCell>
                  <TableCell className="tabular text-right">{r.durationSec >= 60 ? `${Math.round(r.durationSec / 60)} min` : `${r.durationSec} s`}</TableCell>
                  <TableCell className="tabular text-right">{fmtNumber(r.records)}</TableCell>
                  <TableCell>
                    <ConnectionBadge status={RESULT_STATUS[r.result]} />
                    <span className="sr-only">{r.result}</span>
                  </TableCell>
                  <TableCell className="max-w-xs text-xs text-muted-foreground">{r.message ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!testing} onOpenChange={(o) => !o && setTesting(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test connection · {testing?.name}</DialogTitle>
            <DialogDescription>Read-only checks against {testing?.host}</DialogDescription>
          </DialogHeader>
          <TestChecklist steps={steps} />
          <DialogFooter>
            <Button onClick={() => setTesting(undefined)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditSystemDialog system={editing} onClose={() => setEditing(undefined)} />
      <AddSystemWizard open={addOpen} onOpenChange={(o) => !o && setParams({})} />
    </>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border bg-background px-2 py-0.5">{children}</span>;
}

function EditSystemDialog({ system, onClose }: { system?: SapSystem; onClose: () => void }) {
  const [name, setName] = React.useState("");
  const [full, setFull] = React.useState("");
  const [delta, setDelta] = React.useState("");
  React.useEffect(() => {
    if (system) {
      setName(system.name);
      setFull(system.schedule.full);
      setDelta(system.schedule.delta);
    }
  }, [system]);
  return (
    <Dialog open={!!system} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {system?.sid}</DialogTitle>
          <DialogDescription>Credentials cannot be viewed. To rotate them, run the Add system wizard again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Display name" htmlFor="es-name">
            <Input id="es-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Full sync" htmlFor="es-full">
            <Select value={full} onValueChange={setFull}>
              <SelectTrigger id="es-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Weekly · Sunday 01:00", "Weekly · Sunday 01:30", "Weekly · Saturday 22:00", "Monthly · 1st 01:00"].map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Delta sync" htmlFor="es-delta">
            <Select value={delta} onValueChange={setDelta}>
              <SelectTrigger id="es-delta">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Daily · 02:00", "Daily · 03:00", "Every 6 hours", "Manual only"].map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Secret stored in vault · last rotated 14 Sep 2026
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              await updateSystem(system!.id, { name, schedule: { full, delta } });
              toast.success("System updated");
              onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
