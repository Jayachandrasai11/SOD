import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, Power, Save, Trash2, X } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Checkbox, Separator } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog, Field, HelpTip, LevelChip } from "@/components/common";
import { TcodeTypeahead } from "@/components/TcodeTypeahead";
import { db } from "@/services/db";
import { functionUsage, saveRisk } from "@/services/rulesService";
import { RISK_OWNERS } from "@/data/rules";
import { useApp } from "@/context/AppContext";
import { PROCESSES, RISK_LEVELS, RISK_TYPES, type Permission, type Process, type Risk, type RiskLevel, type RiskType, type SodFunction } from "@/types";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function blankRisk(): Risk {
  const n = db.risks.length + 1;
  return {
    id: `MG-FI-P${String(100 + n).padStart(3, "0")}`,
    description: "",
    explanation: "",
    process: "Finance",
    level: "High",
    type: "SoD",
    functionIds: [],
    owner: RISK_OWNERS[0],
    active: true,
  };
}

export function RiskDrawer({ riskId, onClose }: { riskId?: string; onClose: () => void }) {
  const { can } = useApp();
  const readOnly = !can("edit");
  const [risk, setRisk] = React.useState<Risk>();
  const [fns, setFns] = React.useState<SodFunction[]>([]);
  const [original, setOriginal] = React.useState<string>("");
  const [ack, setAck] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [confirmDeact, setConfirmDeact] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);

  React.useEffect(() => {
    if (!riskId) return;
    const r = riskId === "new" ? blankRisk() : db.risks.find((x) => x.id === riskId);
    if (!r) return;
    const f = r.functionIds.map((id) => db.functions.find((x) => x.id === id)).filter(Boolean) as SodFunction[];
    setRisk(clone(r));
    setFns(clone(f));
    setOriginal(JSON.stringify({ r, f }));
    setAck(false);
  }, [riskId]);

  if (!riskId || !risk) return null;

  const dirty = JSON.stringify({ r: risk, f: fns }) !== original;
  const origFns: SodFunction[] = original ? JSON.parse(original).f : [];
  const changedShared = fns
    .filter((f) => {
      const o = origFns.find((x) => x.id === f.id);
      return o && JSON.stringify(o) !== JSON.stringify(f);
    })
    .map((f) => ({ fn: f, others: functionUsage(f.id, risk.id) }))
    .filter((x) => x.others.length > 0);

  const errors: Record<string, string> = {};
  if (!risk.description.trim()) errors.description = "Describe the risk in business terms.";
  if (risk.type === "SoD" && fns.length < 2) errors.functions = "An SoD risk needs at least two conflicting functions.";
  if (risk.type !== "SoD" && fns.length < 1) errors.functions = "Link at least one function.";
  fns.forEach((f) => {
    if (!f.actions.length) errors[`fn-${f.id}`] = `Function ${f.id} has no actions – it can never fire.`;
  });
  const valid = Object.keys(errors).length === 0;

  const patchFn = (id: string, patch: (f: SodFunction) => SodFunction) => setFns((all) => all.map((f) => (f.id === id ? patch(clone(f)) : f)));
  const availableFns = db.functions.filter((f) => !fns.some((x) => x.id === f.id));

  const close = () => (dirty ? setConfirmDiscard(true) : onClose());

  const save = async () => {
    setSaving(true);
    await saveRisk({ ...risk, functionIds: fns.map((f) => f.id) }, fns);
    setSaving(false);
    toast.success(`${risk.id} saved to draft`, { description: "Submit the draft for approval to make it live." });
    onClose();
  };

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && close()}>
        <SheetContent className="sm:max-w-3xl">
          <SheetHeader>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{risk.id}</span>
              <LevelChip level={risk.level} />
              {!risk.active && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Inactive</span>}
              {readOnly && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Read-only</span>}
            </div>
            <SheetTitle>{riskId === "new" ? "New risk" : risk.description || "Untitled risk"}</SheetTitle>
            <SheetDescription>Changes are saved to the draft ruleset and only apply to analysis once published.</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-6">
            <fieldset disabled={readOnly} className="grid gap-4 md:grid-cols-2">
              {riskId === "new" && (
                <Field label="Risk ID" htmlFor="r-id" required>
                  <Input id="r-id" value={risk.id} onChange={(e) => setRisk({ ...risk, id: e.target.value.toUpperCase() })} />
                </Field>
              )}
              <Field label="Description" htmlFor="r-desc" required error={errors.description} className="md:col-span-2" help="Risk">
                <Input id="r-desc" value={risk.description} aria-invalid={!!errors.description} onChange={(e) => setRisk({ ...risk, description: e.target.value })} />
              </Field>
              <Field label="Plain-English explanation" htmlFor="r-exp" hint="Shown to analysts and auditors in the drill-down." className="md:col-span-2">
                <Textarea id="r-exp" value={risk.explanation} onChange={(e) => setRisk({ ...risk, explanation: e.target.value })} />
              </Field>
              <Field label="Business process" htmlFor="r-proc">
                <Select value={risk.process} onValueChange={(v) => setRisk({ ...risk, process: v as Process })} disabled={readOnly}>
                  <SelectTrigger id="r-proc">
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
              <Field label="Risk level" htmlFor="r-level">
                <Select value={risk.level} onValueChange={(v) => setRisk({ ...risk, level: v as RiskLevel })} disabled={readOnly}>
                  <SelectTrigger id="r-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Risk type" htmlFor="r-type">
                <Select value={risk.type} onValueChange={(v) => setRisk({ ...risk, type: v as RiskType })} disabled={readOnly}>
                  <SelectTrigger id="r-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Risk owner" htmlFor="r-owner">
                <Select value={risk.owner} onValueChange={(v) => setRisk({ ...risk, owner: v })} disabled={readOnly}>
                  <SelectTrigger id="r-owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_OWNERS.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </fieldset>

            <Separator />

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-1 font-semibold">
                  Linked functions <HelpTip term="Function" />
                </h3>
                {!readOnly && (
                  <div className="flex gap-2">
                    <Select
                      value=""
                      onValueChange={(id) => {
                        const f = db.functions.find((x) => x.id === id);
                        if (f) setFns((a) => [...a, clone(f)]);
                      }}
                    >
                      <SelectTrigger className="w-64" aria-label="Link existing function">
                        <SelectValue placeholder="Link existing function…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableFns.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name} ({f.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => {
                        const id = `MG-F-${risk.process.slice(0, 2).toUpperCase()}${String(db.functions.length + fns.length + 1).padStart(2, "0")}`;
                        setFns((a) => [...a, { id, name: "New function", process: risk.process, actions: [], permissions: [] }]);
                      }}
                    >
                      <Plus /> New function
                    </Button>
                  </div>
                )}
              </div>
              {errors.functions && (
                <p className="text-xs font-medium text-status-red" role="alert">
                  {errors.functions}
                </p>
              )}

              {fns.map((f, idx) => {
                const others = functionUsage(f.id, risk.id);
                return (
                  <div key={f.id} className="rounded-xl border">
                    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">Function {String.fromCharCode(65 + idx)}</span>
                      <Input
                        className="h-8 max-w-xs"
                        aria-label="Function name"
                        value={f.name}
                        disabled={readOnly}
                        onChange={(e) => patchFn(f.id, (x) => ({ ...x, name: e.target.value }))}
                      />
                      <span className="font-mono text-xs text-muted-foreground">{f.id}</span>
                      {others.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-status-amber-bg px-2 py-0.5 text-xs font-medium text-status-amber">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Shared by {others.length} other risk{others.length > 1 ? "s" : ""}
                        </span>
                      )}
                      {!readOnly && (
                        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setFns((a) => a.filter((x) => x.id !== f.id))} aria-label={`Unlink ${f.name}`}>
                          <X /> Unlink
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-4 p-4 lg:grid-cols-2">
                      <div>
                        <h4 className="mb-2 flex items-center gap-1 text-sm font-semibold">
                          Actions <HelpTip term="Action" />
                        </h4>
                        <ul className="mb-2 space-y-1">
                          {f.actions.map((a) => (
                            <li key={a.tcode} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5 text-sm">
                              <span className="flex-1">
                                {a.description} <span className="font-mono text-xs text-muted-foreground">({a.tcode})</span>
                              </span>
                              {!readOnly && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  aria-label={`Remove ${a.tcode}`}
                                  onClick={() => patchFn(f.id, (x) => ({ ...x, actions: x.actions.filter((y) => y.tcode !== a.tcode) }))}
                                >
                                  <Trash2 />
                                </Button>
                              )}
                            </li>
                          ))}
                        </ul>
                        {errors[`fn-${f.id}`] && (
                          <p className="mb-2 text-xs font-medium text-status-red" role="alert">
                            {errors[`fn-${f.id}`]}
                          </p>
                        )}
                        {!readOnly && (
                          <TcodeTypeahead
                            exclude={f.actions.map((a) => a.tcode)}
                            onSelect={(t) => patchFn(f.id, (x) => ({ ...x, actions: [...x.actions, { tcode: t.tcode, description: t.description }] }))}
                          />
                        )}
                      </div>
                      <div>
                        <h4 className="mb-2 flex items-center gap-1 text-sm font-semibold">
                          Permissions <HelpTip term="Permission" />
                        </h4>
                        <PermissionRows
                          rows={f.permissions}
                          readOnly={readOnly}
                          onChange={(rows) => patchFn(f.id, (x) => ({ ...x, permissions: rows }))}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>

            {changedShared.length > 0 && (
              <section className="rounded-xl border border-status-amber/40 bg-status-amber-bg p-4 text-sm" role="alert">
                <div className="mb-2 flex items-center gap-2 font-semibold text-status-amber">
                  <AlertTriangle className="h-4 w-4" aria-hidden /> You changed shared functions
                </div>
                {changedShared.map(({ fn, others }) => (
                  <p key={fn.id} className="mb-1">
                    <strong>{fn.name}</strong> is used by {others.length} other risk{others.length > 1 ? "s" : ""}:{" "}
                    {others.map((o) => `${o.id} (${o.description})`).join(", ")}. Saving changes them too.
                  </p>
                ))}
                <label className="mt-2 flex items-center gap-2">
                  <Checkbox checked={ack} onCheckedChange={(c) => setAck(!!c)} /> I understand these risks will change as well
                </label>
              </section>
            )}
          </SheetBody>
          <SheetFooter className="justify-between">
            {riskId !== "new" && !readOnly ? (
              <Button variant="ghost" onClick={() => setConfirmDeact(true)}>
                <Power /> {risk.active ? "Deactivate risk" : "Reactivate risk"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={close}>
                {readOnly ? "Close" : "Cancel"}
              </Button>
              {!readOnly && (
                <Button onClick={save} disabled={!dirty || !valid || saving || (changedShared.length > 0 && !ack)}>
                  <Save /> {saving ? "Saving…" : "Save to draft"}
                </Button>
              )}
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmDeact}
        onOpenChange={setConfirmDeact}
        title={risk.active ? `Deactivate ${risk.id}?` : `Reactivate ${risk.id}?`}
        description={
          risk.active
            ? "The risk stays in the ruleset and audit history but will no longer fire in analysis once the draft is published. You can reactivate it any time."
            : "The risk will fire again in analysis once the draft is published."
        }
        confirmLabel={risk.active ? "Deactivate" : "Reactivate"}
        destructive={risk.active}
        requireReason
        onConfirm={async (reason) => {
          const next = { ...risk, active: !risk.active };
          await saveRisk({ ...next, functionIds: fns.map((f) => f.id) }, fns, reason);
          toast.success(`${risk.id} ${next.active ? "reactivated" : "deactivated"}`);
          onClose();
        }}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard unsaved changes?"
        description="Your edits to this risk will be lost."
        confirmLabel="Discard"
        destructive
        onConfirm={onClose}
      />
    </>
  );
}

function PermissionRows({ rows, onChange, readOnly }: { rows: Permission[]; onChange: (r: Permission[]) => void; readOnly: boolean }) {
  const set = (i: number, patch: Partial<Permission>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div>
      {rows.length > 0 && (
        <table className="mb-2 w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pb-1 font-medium">Auth object</th>
              <th className="pb-1 font-medium">Field</th>
              <th className="pb-1 font-medium">Value low</th>
              <th className="pb-1 font-medium">Value high</th>
              <th className="sr-only">Remove</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {(["object", "field", "low", "high"] as const).map((k) => (
                  <td key={k} className="pr-1 pb-1">
                    <Input
                      className="h-8 font-mono text-xs"
                      aria-label={`${k} row ${i + 1}`}
                      value={r[k] ?? ""}
                      disabled={readOnly}
                      onChange={(e) => set(i, { [k]: e.target.value.toUpperCase() } as Partial<Permission>)}
                    />
                  </td>
                ))}
                <td className="pb-1">
                  {!readOnly && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove permission row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length === 0 && <p className="mb-2 text-xs text-muted-foreground">No permission checks – the risk fires on the transaction alone.</p>}
      {!readOnly && (
        <Button variant="outline" size="sm" onClick={() => onChange([...rows, { object: "", field: "", low: "" }])}>
          <Plus /> Add permission row
        </Button>
      )}
    </div>
  );
}
