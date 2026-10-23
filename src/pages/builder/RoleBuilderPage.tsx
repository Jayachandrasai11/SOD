import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Check, CheckCircle2, Copy, FilePlus2, Lightbulb, Pencil, Plus, Save, ShieldCheck, Trash2, Upload, X, XCircle } from "lucide-react";
import { PageHeader, EmptyState, Field, HelpTip, LevelChip } from "@/components/common";
import { StatusBadge } from "@/components/StatusBadge";
import { TcodeTypeahead } from "@/components/TcodeTypeahead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { db, useDbVersion } from "@/services/db";
import { draftFromRole, emptyDraft, liveCheck, proposedAuths, saveDraft, syncOrgLevels, validateDraft } from "@/services/roleBuilderService";
import { namingCheck } from "@/services/settingsService";
import { roleResult } from "@/services/analysisService";
import { describeTcode, SU24 } from "@/data/tcodes";
import { useApp } from "@/context/AppContext";
import { PROCESSES, type Process, type Role, type RoleAuth } from "@/types";
import { cn } from "@/lib/utils";
import { ExportDialog } from "./ExportDialog";
import { TemplateSection } from "./TemplateSection";

export default function RoleBuilderPage() {
  useDbVersion();
  const [params, setParams] = useSearchParams();
  const { can } = useApp();
  const readOnly = !can("edit");
  const [draft, setDraft] = React.useState<Role>(emptyDraft);
  const [isUpdate, setIsUpdate] = React.useState(false);
  const [suggestRemove, setSuggestRemove] = React.useState<string>();
  const [tab, setTab] = React.useState("tcodes");
  const [exportOpen, setExportOpen] = React.useState(false);
  const [validateOpen, setValidateOpen] = React.useState(false);
  const [editingAuth, setEditingAuth] = React.useState<number>();
  const [flash, setFlash] = React.useState(false);

  // Load from URL: ?from=ROLE[&copy=1][&remove=TCODE]
  const loadedFromUrl = React.useRef(false);
  React.useEffect(() => {
    const from = params.get("from");
    if (!from || loadedFromUrl.current) return;
    loadedFromUrl.current = true;
    const copy = params.get("copy") === "1";
    const d = draftFromRole(from, !copy);
    if (d) {
      setDraft(d);
      setIsUpdate(!copy && db.roles.some((r) => r.name === from));
      setSuggestRemove(params.get("remove") ?? undefined);
      toast.info(copy ? `Copied ${from} into a new draft` : `Editing ${from}`);
    }
    setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { result, remediation } = React.useMemo(() => liveCheck(draft), [draft]);
  const checks = React.useMemo(() => validateDraft(draft, { isUpdate }), [draft, isUpdate]);
  const nameError = draft.name.length > 2 || draft.name !== "Z_" ? namingCheck(draft.name) : undefined;

  // Pulse the status card when status changes, so the live update is noticeable
  const prevStatus = React.useRef(result.status);
  React.useEffect(() => {
    if (prevStatus.current !== result.status) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      prevStatus.current = result.status;
      return () => clearTimeout(t);
    }
  }, [result.status]);

  const update = (patch: Partial<Role>) => setDraft((d) => ({ ...d, ...patch }));

  const addTcode = (tcode: string) =>
    setDraft((d) => {
      if (d.tcodes.includes(tcode)) return d;
      const tcodes = [...d.tcodes, tcode];
      const existing = new Set(d.auths.map((a) => `${a.object}|${a.field}`));
      const proposals = proposedAuths(tcode).filter((p) => !existing.has(`${p.object}|${p.field}`));
      return {
        ...d,
        tcodes,
        auths: [...d.auths, { object: "S_TCODE", field: "TCD", low: tcode }, ...proposals],
        orgLevels: syncOrgLevels(tcodes, d.orgLevels),
      };
    });

  const removeTcode = (tcode: string, announce = true) => {
    setDraft((d) => {
      const tcodes = d.tcodes.filter((t) => t !== tcode);
      const stillNeeded = new Set(tcodes.flatMap((t) => (SU24[t] ?? []).map((p) => `${p.object}|${p.field}`)));
      const auths = d.auths.filter(
        (a) => !(a.object === "S_TCODE" && a.low === tcode) && !(a.proposed && !stillNeeded.has(`${a.object}|${a.field}`) && (SU24[tcode] ?? []).some((p) => p.object === a.object)),
      );
      return { ...d, tcodes, auths, orgLevels: syncOrgLevels(tcodes, d.orgLevels) };
    });
    if (suggestRemove === tcode) setSuggestRemove(undefined);
    if (announce)
      toast.success(`Removed ${tcode}`, {
        action: { label: "Undo", onClick: () => addTcode(tcode) },
      });
  };

  const startFrom = (name: string) => {
    const d = draftFromRole(name, false);
    if (!d) return;
    setDraft(d);
    setIsUpdate(false);
    toast.success(`Started from ${name}`, { description: "Rename the copy before exporting." });
  };

  const pendingProposals = draft.auths.filter((a) => a.proposed).length;
  const missingOrg = draft.orgLevels.filter((o) => o.required && !o.low.trim()).length;
  const availableChildren = db.roles.filter((r) => r.type !== "Composite" && !(draft.children ?? []).includes(r.name));

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: "Role Builder" }]}
        title="Role Builder"
        description="Design a role and see its SoD status update live. Export a file for PFCG or Maintain Business Roles – MySODAI never writes to SAP."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              setDraft(emptyDraft());
              setIsUpdate(false);
              setSuggestRemove(undefined);
            }}
          >
            <FilePlus2 /> New role
          </Button>
        }
      />

      {suggestRemove && draft.tcodes.includes(suggestRemove) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-accent px-4 py-3 text-sm text-accent-foreground" role="status">
          <Lightbulb className="h-4 w-4" aria-hidden />
          <span className="flex-1">
            Suggested fix from analysis: remove <strong>{describeTcode(suggestRemove)} ({suggestRemove})</strong> from <span className="font-mono">{draft.name}</span>.
          </span>
          <Button size="sm" onClick={() => removeTcode(suggestRemove)} disabled={readOnly}>
            <Trash2 /> Remove {suggestRemove}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSuggestRemove(undefined)} aria-label="Dismiss suggestion">
            <X />
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* ------------------------------------------------ Left: header */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">Role header</CardTitle>
            {isUpdate && <CardDescription>Editing an existing role – export creates a new version.</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset disabled={readOnly} className="space-y-4">
              <Field label="Technical name" htmlFor="rb-name" required error={nameError} hint="Must start with Z_ or Y_ · max 30 characters">
                <Input
                  id="rb-name"
                  className="font-mono"
                  value={draft.name}
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? "rb-name-error" : undefined}
                  disabled={isUpdate}
                  onChange={(e) => update({ name: e.target.value.toUpperCase().replace(/\s/g, "_") })}
                />
              </Field>
              <Field label="Description" htmlFor="rb-desc" required>
                <Input id="rb-desc" value={draft.description} onChange={(e) => update({ description: e.target.value })} placeholder="e.g. Accounts payable clerk" />
              </Field>
              <Field label="Role type" htmlFor="rb-type">
                <Select value={draft.type} onValueChange={(v) => update({ type: v as Role["type"], children: v === "Composite" ? draft.children ?? [] : [] })} disabled={readOnly || isUpdate}>
                  <SelectTrigger id="rb-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Single">Single</SelectItem>
                    <SelectItem value="Composite">Composite</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Business process" htmlFor="rb-proc">
                <Select value={draft.process} onValueChange={(v) => update({ process: v as Process })} disabled={readOnly}>
                  <SelectTrigger id="rb-proc">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROCESSES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Role owner" htmlFor="rb-owner" required>
                <Input id="rb-owner" value={draft.owner} onChange={(e) => update({ owner: e.target.value })} placeholder="Business owner who approves access" />
              </Field>
            </fieldset>
            <div className="border-t pt-4">
              <Field label="Start from existing role" htmlFor="rb-from" hint="Copies its content into this draft">
                <Select value="" onValueChange={startFrom} disabled={readOnly}>
                  <SelectTrigger id="rb-from">
                    <Copy className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <SelectValue placeholder="Pick a role to copy…" />
                  </SelectTrigger>
                  <SelectContent>
                    {db.roles.map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* ------------------------------------------------ Middle: content */}
        <Card className="min-w-0">
          <Tabs value={tab} onValueChange={setTab}>
            <div className="border-b p-3">
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="tcodes">Transactions & Apps ({draft.tcodes.length})</TabsTrigger>
                <TabsTrigger value="auths">
                  Authorisations{pendingProposals > 0 && <span className="rounded bg-primary px-1.5 text-[10px] text-primary-foreground">{pendingProposals}</span>}
                </TabsTrigger>
                <TabsTrigger value="org">
                  Org levels{missingOrg > 0 && <span className="rounded bg-status-red px-1.5 text-[10px] text-white dark:text-black">{missingOrg} missing</span>}
                </TabsTrigger>
                {draft.type === "Composite" && <TabsTrigger value="children">Child roles ({draft.children?.length ?? 0})</TabsTrigger>}
              </TabsList>
            </div>
            <div className="p-4">
              <TabsContent value="tcodes" className="mt-0 space-y-3">
                {draft.type === "Composite" ? (
                  <EmptyState icon={ShieldCheck} title="Composite roles get their transactions from child roles." action={<Button onClick={() => setTab("children")}>Manage child roles</Button>} />
                ) : (
                  <>
                    {!readOnly && <TcodeTypeahead exclude={draft.tcodes} onSelect={(t) => addTcode(t.tcode)} />}
                    {draft.tcodes.length === 0 ? (
                      <EmptyState icon={Plus} title="No transactions yet. Search above – try “post vendor invoice” or “ME21N”." />
                    ) : (
                      <ul className="divide-y rounded-xl border">
                        {draft.tcodes.map((t) => {
                          const inConflict = result.hits.some((h) => h.functions.some((f) => f.actions.some((a) => a.tcode === t)));
                          return (
                            <li key={t} className={cn("flex items-center gap-3 px-3 py-2", inConflict && "bg-status-red-bg/40")}>
                              <span className="min-w-0 flex-1 text-sm">
                                {describeTcode(t)} <span className="font-mono text-xs text-muted-foreground">({t})</span>
                              </span>
                              {inConflict && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-status-red">
                                  <XCircle className="h-3.5 w-3.5" aria-hidden /> In conflict
                                </span>
                              )}
                              {!readOnly && (
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove ${t}`} onClick={() => removeTcode(t)}>
                                  <Trash2 />
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="auths" className="mt-0 space-y-3">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  Values tagged <span className="rounded bg-primary/10 px-1.5 font-medium text-primary">Proposed</span> come from SU24 defaults. Accept or edit each one. <HelpTip term="SU24" />
                </p>
                {draft.auths.length === 0 ? (
                  <EmptyState icon={ShieldCheck} title="Add transactions to see proposed authorisations." />
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Auth object</th>
                          <th className="px-3 py-2">Field</th>
                          <th className="px-3 py-2">Value low</th>
                          <th className="px-3 py-2">Value high</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.auths.map((a, i) => (
                          <AuthRow
                            key={`${a.object}-${a.field}-${i}`}
                            a={a}
                            editing={editingAuth === i}
                            readOnly={readOnly}
                            onEdit={() => setEditingAuth(i)}
                            onAccept={(patch) => {
                              update({ auths: draft.auths.map((x, j) => (j === i ? { ...x, ...patch, proposed: false } : x)) });
                              setEditingAuth(undefined);
                            }}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {pendingProposals > 1 && !readOnly && (
                  <Button variant="outline" size="sm" onClick={() => update({ auths: draft.auths.map((a) => ({ ...a, proposed: false })) })}>
                    <Check /> Accept all {pendingProposals} proposals
                  </Button>
                )}
              </TabsContent>

              <TabsContent value="org" className="mt-0 space-y-3">
                {draft.orgLevels.length === 0 ? (
                  <EmptyState icon={ShieldCheck} title="No org levels needed yet. They appear when you add transactions that check company code, plant and similar." />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {draft.orgLevels.map((o, i) => {
                      const missing = o.required && !o.low.trim();
                      return (
                        <div key={o.field} className={cn("rounded-xl border p-3", missing && "border-status-red/50 bg-status-red-bg/40")}>
                          <div className="mb-2 flex items-center justify-between text-sm font-medium">
                            <span>
                              {o.label} <span className="font-mono text-xs text-muted-foreground">{o.field}</span>
                            </span>
                            {o.required && <span className={cn("text-xs", missing ? "font-semibold text-status-red" : "text-muted-foreground")}>{missing ? "Required – empty" : "Required"}</span>}
                          </div>
                          <div className="flex gap-2">
                            <Input
                              aria-label={`${o.label} from`}
                              aria-invalid={missing}
                              placeholder="From"
                              value={o.low}
                              disabled={readOnly}
                              onChange={(e) => update({ orgLevels: draft.orgLevels.map((x, j) => (j === i ? { ...x, low: e.target.value.toUpperCase() } : x)) })}
                            />
                            <Input
                              aria-label={`${o.label} to`}
                              placeholder="To (optional)"
                              value={o.high ?? ""}
                              disabled={readOnly}
                              onChange={(e) => update({ orgLevels: draft.orgLevels.map((x, j) => (j === i ? { ...x, high: e.target.value.toUpperCase() || undefined } : x)) })}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {draft.type === "Composite" && (
                <TabsContent value="children" className="mt-0 space-y-3">
                  {!readOnly && (
                    <Select value="" onValueChange={(v) => update({ children: [...(draft.children ?? []), v] })}>
                      <SelectTrigger aria-label="Add child role">
                        <Plus className="h-4 w-4 text-muted-foreground" aria-hidden />
                        <SelectValue placeholder="Add a single role…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableChildren.map((r) => (
                          <SelectItem key={r.name} value={r.name}>
                            {r.name} – {r.description}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {(draft.children ?? []).length === 0 ? (
                    <EmptyState icon={Plus} title="Add the single roles this composite should bundle." />
                  ) : (
                    <ul className="divide-y rounded-xl border">
                      {(draft.children ?? []).map((c) => {
                        const r = db.roles.find((x) => x.name === c);
                        return (
                          <li key={c} className="flex items-center gap-3 px-3 py-2">
                            <span className="min-w-0 flex-1">
                              <span className="block font-mono text-sm">{c}</span>
                              <span className="block text-xs text-muted-foreground">{r?.description}</span>
                            </span>
                            {r && <StatusBadge status={roleResult(r).status} size="sm" />}
                            {!readOnly && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove ${c}`} onClick={() => update({ children: (draft.children ?? []).filter((x) => x !== c) })}>
                                <Trash2 />
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </TabsContent>
              )}
            </div>
          </Tabs>
        </Card>

        {/* ------------------------------------------------ Right: live SoD check */}
        <aside className="lg:col-span-2 xl:col-span-1" aria-label="Live SoD check">
          <Card className="xl:sticky xl:top-20">
            <CardHeader className="items-center text-center">
              <CardTitle className="flex items-center gap-1 text-sm">
                Live SoD check <HelpTip text="Re-checked against the current ruleset every time you change the role. No SAP call is made." />
              </CardTitle>
              <div className={cn("mt-2 rounded-full transition-transform", flash && "scale-110")} aria-live="polite">
                <StatusBadge status={result.status} size="lg" />
              </div>
              <CardDescription>
                {result.hits.length === 0
                  ? draft.tcodes.length || (draft.children ?? []).length
                    ? "No risks fire for this role."
                    : "Add content to start checking."
                  : `${result.hits.length} risk${result.hits.length > 1 ? "s" : ""} fire for this role`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {remediation && (
                <div className="flex gap-2 rounded-lg bg-accent p-3 text-xs text-accent-foreground">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{remediation.text}</span>
                </div>
              )}
              {result.hits.map((h) => (
                <div key={h.riskId} className="rounded-xl border p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <StatusBadge status={h.status} size="sm" />
                    <LevelChip level={h.level} />
                  </div>
                  <div className="text-sm font-medium">{h.description}</div>
                  <div className="mb-2 font-mono text-[11px] text-muted-foreground">{h.riskId}</div>
                  <ul className="space-y-1">
                    {h.functions.flatMap((f) =>
                      f.actions.map((a) => {
                        const own = a.grantedBy.includes(draft.name);
                        return (
                          <li key={f.functionId + a.tcode} className="flex items-center gap-2 text-xs">
                            <span className="min-w-0 flex-1 truncate">
                              {f.functionName}: <span className="font-mono">{a.tcode}</span>
                              {!own && <span className="text-muted-foreground"> via {a.grantedBy.join(", ")}</span>}
                            </span>
                            {!readOnly && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => (own ? removeTcode(a.tcode) : update({ children: (draft.children ?? []).filter((c) => !a.grantedBy.includes(c)) }))}
                                aria-label={own ? `Remove conflicting action ${a.tcode}` : `Remove child role ${a.grantedBy.join(", ")}`}
                              >
                                <Trash2 className="!size-3" /> {own ? "Remove conflicting action" : "Remove child"}
                              </Button>
                            )}
                          </li>
                        );
                      }),
                    )}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* ------------------------------------------------ Footer actions */}
      <div className="sticky bottom-0 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex items-center gap-2 text-sm">
          <StatusBadge status={result.status} size="sm" />
          <span className="text-muted-foreground">
            {checks.filter((c) => c.ok).length}/{checks.length} checks passed
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setValidateOpen(true)}>
            <CheckCircle2 /> Validate
          </Button>
          <Button
            variant="outline"
            disabled={readOnly || !!namingCheck(draft.name)}
            onClick={async () => {
              await saveDraft(draft);
              toast.success(`Draft ${draft.name} saved`);
            }}
          >
            <Save /> Save draft
          </Button>
          <Button onClick={() => setExportOpen(true)} disabled={readOnly}>
            <Upload /> Export role file
          </Button>
        </div>
      </div>

      <TemplateSection onOpenDraft={(r) => {
        setDraft(r);
        setIsUpdate(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }} />

      <Dialog open={validateOpen} onOpenChange={setValidateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Validation · {draft.name}</DialogTitle>
            <DialogDescription>These checks must pass before you can export.</DialogDescription>
          </DialogHeader>
          <Checklist items={checks} />
          <div className="flex items-center gap-2 text-sm">
            SoD status: <StatusBadge status={result.status} size="sm" />
            {result.status === "red" && <span className="text-xs text-muted-foreground">– export needs a justification and approver</span>}
          </div>
          <DialogFooter>
            <Button onClick={() => setValidateOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} draft={draft} result={result} checks={checks} />
    </>
  );
}

export function Checklist({ items }: { items: { key: string; label: string; ok: boolean; detail?: string }[] }) {
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <li key={c.key} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", c.ok ? "border-status-green/30" : "border-status-red/40 bg-status-red-bg/50")}>
          {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-green" aria-label="Passed" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-status-red" aria-label="Failed" />}
          <span>
            <span className="font-medium">{c.label}</span>
            {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AuthRow({ a, editing, readOnly, onEdit, onAccept }: { a: RoleAuth; editing: boolean; readOnly: boolean; onEdit: () => void; onAccept: (p: Partial<RoleAuth>) => void }) {
  const [low, setLow] = React.useState(a.low);
  const [high, setHigh] = React.useState(a.high ?? "");
  React.useEffect(() => {
    setLow(a.low);
    setHigh(a.high ?? "");
  }, [a.low, a.high, editing]);
  const isVar = a.low.startsWith("$");
  return (
    <tr className={cn("border-t", a.proposed && "bg-primary/5")}>
      <td className="px-3 py-2 font-mono text-xs">{a.object}</td>
      <td className="px-3 py-2 font-mono text-xs">{a.field}</td>
      <td className="px-3 py-2 font-mono text-xs">
        {editing ? (
          <Input className="h-8 font-mono text-xs" value={low} onChange={(e) => setLow(e.target.value.toUpperCase())} aria-label="Value low" autoFocus />
        ) : (
          <span className="flex items-center gap-2">
            {a.low || <span className="text-status-red">empty</span>}
            {isVar && <span className="font-sans text-[11px] text-muted-foreground">(from org level)</span>}
            {a.proposed && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-sans text-[11px] font-medium text-primary">Proposed</span>}
          </span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        {editing ? <Input className="h-8 font-mono text-xs" value={high} onChange={(e) => setHigh(e.target.value.toUpperCase())} aria-label="Value high" /> : a.high ?? "—"}
      </td>
      <td className="px-3 py-2 text-right">
        {!readOnly && a.object !== "S_TCODE" && (
          <div className="inline-flex gap-1">
            {editing ? (
              <Button size="sm" className="h-7" onClick={() => onAccept({ low, high: high || undefined })}>
                <Check /> Save
              </Button>
            ) : (
              <>
                {a.proposed && (
                  <Button size="sm" variant="outline" className="h-7" onClick={() => onAccept({})}>
                    <Check /> Accept
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7" onClick={onEdit}>
                  <Pencil /> Edit
                </Button>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
