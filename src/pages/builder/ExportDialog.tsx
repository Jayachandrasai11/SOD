import * as React from "react";
import { toast } from "sonner";
import { Ban, Download, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common";
import { StatusBadge } from "@/components/StatusBadge";
import { db } from "@/services/db";
import { EXPORT_FORMATS, exportFileName, exportRole, type CheckItem, type ExportFormat } from "@/services/roleBuilderService";
import { useApp } from "@/context/AppContext";
import type { Role, SubjectResult } from "@/types";
import { cn } from "@/lib/utils";
import { Checklist } from "./RoleBuilderPage";

export function ExportDialog({
  open,
  onOpenChange,
  draft,
  result,
  checks,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  draft: Role;
  result: SubjectResult;
  checks: CheckItem[];
}) {
  const { systemId } = useApp();
  const system = db.systems.find((s) => s.id === systemId);
  const [format, setFormat] = React.useState<ExportFormat>("pfcg");
  const [justification, setJustification] = React.useState("");
  const [approver, setApprover] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setFormat(system?.deployment === "Public Cloud" ? "business" : "pfcg");
      setJustification("");
      setApprover("");
    }
  }, [open, system?.deployment]);

  const red = result.status === "red";
  const isSpec = format === "spec-xlsx" || format === "spec-pdf";
  const failing = checks.filter((c) => !c.ok);
  // Specifications are for review, so they can be exported even when checks fail
  const blockedByChecks = !isSpec && failing.length > 0;
  const blockedByRed = red && !isSpec && (justification.trim().length < 20 || !approver);
  const approvers = db.appUsers.filter((u) => u.role === "Risk Owner");
  const fileName = exportFileName(draft, format);

  const doExport = async () => {
    setBusy(true);
    const name = await exportRole(draft, format, { status: result.status, justification: red ? justification : undefined, approver: red ? approver : undefined });
    setBusy(false);
    toast.success("Role file exported", { description: `${name} · recorded in the audit log` });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export role file</DialogTitle>
          <DialogDescription>
            Generates a file you upload in SAP yourself. MySODAI does not write to {system?.sid ?? "SAP"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Target format</legend>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as ExportFormat)} className="grid gap-2 md:grid-cols-2">
              {EXPORT_FORMATS.map((f) => (
                <label key={f.value} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", format === f.value && "border-primary ring-2 ring-primary/15")}>
                  <RadioGroupItem value={f.value} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">{f.label}</span>
                    <span className="text-xs text-muted-foreground">{f.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          <section>
            <h3 className="mb-2 text-sm font-medium">Pre-export validation</h3>
            <Checklist items={checks} />
            {isSpec && failing.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Specifications can be exported with open issues – they are listed in the document.</p>}
          </section>

          <section className={cn("rounded-xl border p-4", red && "border-status-red/40 bg-status-red-bg/50")}>
            <div className="flex items-center gap-2 text-sm font-medium">
              SoD status <StatusBadge status={result.status} size="sm" />
              <span className="text-xs font-normal text-muted-foreground">
                {result.hits.length} risk(s): {result.hits.map((h) => h.riskId).join(", ") || "none"}
              </span>
            </div>
            {red && !isSpec && (
              <div className="mt-3 space-y-3">
                <p className="flex items-start gap-2 text-sm text-status-red">
                  <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  This role has unmitigated Critical/High risks. Export is blocked until you give a business justification and select the risk owner who approves it.
                </p>
                <Field label="Business justification" htmlFor="ex-just" required hint={`${justification.trim().length}/20 characters minimum`}>
                  <Textarea id="ex-just" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Why must this role combine these activities, and which compensating control covers it?" />
                </Field>
                <Field label="Risk-owner approver" htmlFor="ex-appr" required>
                  <Select value={approver} onValueChange={setApprover}>
                    <SelectTrigger id="ex-appr">
                      <SelectValue placeholder="Select approver…" />
                    </SelectTrigger>
                    <SelectContent>
                      {approvers.map((u) => (
                        <SelectItem key={u.id} value={u.name}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
          </section>

          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">File name</span>
            <span className="font-mono">{fileName}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={doExport} disabled={busy || blockedByChecks || blockedByRed}>
            <Download /> {busy ? "Generating…" : red && !isSpec ? "Export with justification" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
