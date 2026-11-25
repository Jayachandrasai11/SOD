import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FileDown, Hammer, Layers, Lightbulb, ShieldCheck } from "lucide-react";
import type { RiskHit, SubjectResult, User } from "@/types";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { HelpTip, LevelChip, RunMeta } from "@/components/common";
import { db } from "@/services/db";
import { remediationFor } from "@/services/analysisService";
import { exportEvidencePdf } from "@/lib/evidence";
import { cn, fmtDateTime } from "@/lib/utils";

export function ResultDrawer({
  hit,
  result,
  run,
  onOpenChange,
  onOpenUser,
}: {
  hit?: RiskHit;
  result?: SubjectResult;
  run: { runId: string; rulesetVersion: string; snapshot: string };
  onOpenChange: (o: boolean) => void;
  onOpenUser?: (user: User) => void;
}) {
  const navigate = useNavigate();
  const risk = hit ? db.risks.find((r) => r.id === hit.riskId) : undefined;
  const rem = result ? remediationFor(result) : undefined;
  const hitUser = hit?.subjectKind === "User" ? db.users.find((u) => u.id === hit.subject) : undefined;
  // For a user, fix the role that grants the conflicting action
  const fixRole = rem?.fromRole ?? (hit?.subjectKind === "Role" ? hit.subject : hit?.functions[0]?.actions[0]?.grantedBy[0]);
  const editableRole = fixRole && db.roles.find((r) => r.name === fixRole);

  return (
    <Sheet open={!!hit} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="result-drawer-desc">
        {hit && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={hit.status} />
                <LevelChip level={hit.level} />
                <span className="font-mono text-xs text-muted-foreground">{hit.riskId}</span>
              </div>
              <SheetTitle>{hit.description}</SheetTitle>
              <SheetDescription id="result-drawer-desc">
                {hit.subjectKind} <span className="font-mono font-medium text-foreground">{hit.subject}</span> · {hit.process} · {hit.type}
              </SheetDescription>
              <RunMeta runId={run.runId} version={run.rulesetVersion} snapshot={fmtDateTime(run.snapshot)} className="pt-1" />
            </SheetHeader>
            <SheetBody className="space-y-6">
              <section>
                <h3 className="mb-1.5 flex items-center gap-1 text-sm font-semibold">
                  What this means <HelpTip term="Risk" />
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{risk?.explanation || "No explanation has been written for this risk yet."}</p>
              </section>

              {hit.mitigation && (
                <section className="rounded-xl border border-status-amber/30 bg-status-amber-bg p-4 text-sm">
                  <div className="mb-1 flex items-center gap-2 font-semibold text-status-amber">
                    <ShieldCheck className="h-4 w-4" aria-hidden /> Mitigated by {hit.mitigation.controlId}
                    <HelpTip term="Mitigation" />
                  </div>
                  <p>{hit.mitigation.control}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Valid to {hit.mitigation.validTo}</p>
                </section>
              )}

              {hitUser && (
                <section className="rounded-xl border border-border/80 bg-muted/30 p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">User Assigned Roles</span>
                      <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 font-mono text-xs font-bold">
                        {hitUser.roles.length}
                      </span>
                    </div>
                    {onOpenUser && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs bg-background"
                        onClick={() => {
                          onOpenChange(false);
                          onOpenUser(hitUser);
                        }}
                      >
                        View all {hitUser.roles.length} roles
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {hitUser.name} holds {hitUser.roles.length} roles. Highlighted roles contribute to this SoD conflict:
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                    {hitUser.roles.map((rName) => {
                      const isConflictGrantor = hit.functions.some((f) =>
                        f.actions.some((a) => a.grantedBy.includes(rName))
                      );
                      return (
                        <span
                          key={rName}
                          className={cn(
                            "font-mono text-[11px] px-2 py-0.5 rounded border inline-flex items-center gap-1",
                            isConflictGrantor
                              ? "bg-status-red-bg text-status-red border-status-red/50 font-bold"
                              : "bg-background text-foreground/80 border-border/60"
                          )}
                          title={isConflictGrantor ? `Conflict grantor role for ${hit.riskId}` : rName}
                        >
                          {rName}
                          {isConflictGrantor && <span className="text-[10px] text-status-red">⚠️ Conflicting</span>}
                        </span>
                      );
                    })}
                  </div>
                </section>
              )}

              <section>
                <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold">
                  Conflicting functions <HelpTip term="Function" />
                </h3>
                <div className={hit.functions.length > 1 ? "grid gap-3 md:grid-cols-2" : ""}>
                  {hit.functions.map((f, i) => (
                    <div key={f.functionId} className="rounded-xl border p-4">
                      <div className="mb-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Function {String.fromCharCode(65 + i)}</div>
                        <div className="font-semibold">{f.functionName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{f.functionId}</div>
                      </div>
                      <ul className="space-y-3">
                        {f.actions.map((a) => (
                          <li key={a.tcode} className="rounded-lg bg-muted/50 p-3">
                            <div className="text-sm font-medium">
                              {a.description} <span className="font-mono text-xs text-muted-foreground">({a.tcode})</span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Granted by{" "}
                              {a.grantedBy.map((g, gi) => (
                                <span key={g}>
                                  {gi > 0 && ", "}
                                  <span className="font-mono text-foreground">{g}</span>
                                </span>
                              ))}
                            </div>
                            {a.auths.length > 0 && (
                              <table className="mt-2 w-full text-xs">
                                <caption className="sr-only">Authorisation values found for {a.tcode}</caption>
                                <thead>
                                  <tr className="text-left text-muted-foreground">
                                    <th className="py-0.5 font-medium">Object</th>
                                    <th className="py-0.5 font-medium">Field</th>
                                    <th className="py-0.5 font-medium">Value</th>
                                  </tr>
                                </thead>
                                <tbody className="font-mono">
                                  {a.auths.map((p, pi) => (
                                    <tr key={pi}>
                                      <td className="py-0.5">{p.object}</td>
                                      <td className="py-0.5">{p.field}</td>
                                      <td className="py-0.5">
                                        {p.low}
                                        {p.high ? `–${p.high}` : ""}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              {rem && (
                <section className="flex gap-3 rounded-xl border border-primary/30 bg-accent p-4 text-sm text-accent-foreground">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <div>
                    <div className="font-semibold">Suggested fix</div>
                    <p>{rem.text}</p>
                  </div>
                </section>
              )}
            </SheetBody>
            <SheetFooter>
              <Button
                variant="outline"
                onClick={async () => {
                  await exportEvidencePdf(hit, {
                    runId: run.runId,
                    version: run.rulesetVersion,
                    snapshot: fmtDateTime(run.snapshot),
                    explanation: risk?.explanation ?? "",
                    remediation: rem?.text,
                  });
                  toast.success("Evidence PDF downloaded");
                }}
              >
                <FileDown /> Export evidence (PDF)
              </Button>
              <Button
                disabled={!editableRole}
                onClick={() => navigate(`/builder?from=${encodeURIComponent(fixRole!)}${rem ? `&remove=${encodeURIComponent(rem.tcode)}` : ""}`)}
              >
                <Hammer /> Fix in Role Builder
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
