import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Library, Save, Sparkles, UploadCloud, XCircle } from "lucide-react";
import { ConfirmDialog, Field, StepIndicator } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox, RadioGroup, RadioGroupItem } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  IMPORT_FIELDS,
  autoMap,
  commitImport,
  downloadRulesTemplate,
  loadStarterLibrary,
  parseFile,
  sampleFile,
  saveMappingProfile,
  validateImport,
  type ColumnMapping,
  type ImportMode,
  type ParsedFile,
} from "@/services/rulesService";
import { useApp } from "@/context/AppContext";
import { cn, downloadText, toCsv } from "@/lib/utils";

const STEPS = ["Upload", "Map columns", "Validate & preview", "Import mode"];
const DRAFT_KEY = "mysodai-import-draft";

export function RulesImport({ onDone }: { onDone: () => void }) {
  const { can } = useApp();
  const [step, setStep] = React.useState(0);
  const [file, setFile] = React.useState<ParsedFile>();
  const [map, setMap] = React.useState<ColumnMapping>();
  const [mode, setMode] = React.useState<ImportMode>("upsert");
  const [skipErrors, setSkipErrors] = React.useState(true);
  const [reason, setReason] = React.useState("");
  const [typed, setTyped] = React.useState("");
  const [dragOver, setDragOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [confirmStarter, setConfirmStarter] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Restore a saved wizard draft
  React.useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
      if (d?.file) {
        setFile(d.file);
        setMap(d.map);
        setStep(d.step);
        setMode(d.mode);
        toast.info("Restored your saved import draft");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const preview = React.useMemo(() => (file && map ? validateImport(file, map) : undefined), [file, map]);
  const missingRequired = map ? IMPORT_FIELDS.filter((f) => f.required && !map[f.key]) : [];

  const accept = async (f: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) {
      toast.error("Unsupported file", { description: "Upload an .xlsx or .csv file." });
      return;
    }
    try {
      const parsed = await parseFile(f);
      if (!parsed.rows.length) throw new Error("The file has no data rows.");
      setFile(parsed);
      setMap(autoMap(parsed.columns));
      toast.success(`${parsed.fileName} loaded`, { description: `${parsed.rows.length} rows, ${parsed.columns.length} columns` });
    } catch (e) {
      toast.error("Could not read the file", { description: (e as Error).message });
    }
  };

  const useSample = () => {
    const s = sampleFile();
    setFile(s);
    setMap(autoMap(s.columns));
    toast.success(`${s.fileName} loaded`, { description: `${s.rows.length} rows` });
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ file, map, step, mode }));
      toast.success("Import saved as draft", { description: "Come back any time to continue." });
    } catch {
      toast.error("Could not save draft in this browser");
    }
  };

  const downloadErrors = () => {
    if (!file || !preview) return;
    const rows = preview.errors.map((e) => ({ Row: e.row, Problem: e.message.replace(/^Row \d+: /, ""), ...file.rows[e.row - 2] }));
    downloadText(toCsv(rows), `${file.fileName.replace(/\.\w+$/, "")}_errors.csv`, "text/csv");
  };

  const canNext =
    (step === 0 && !!file) || (step === 1 && missingRequired.length === 0) || (step === 2 && !!preview && (preview.toAdd.length + preview.toUpdate.length > 0));

  const finishBlocked =
    !preview ||
    (preview.errors.length > 0 && !skipErrors) ||
    (mode === "replace" && (typed !== "REPLACE" || reason.trim().length < 5));

  const finish = async () => {
    if (!preview) return;
    setBusy(true);
    const v = await commitImport(preview, mode, mode === "replace" ? reason : undefined);
    setBusy(false);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    toast.success(`Draft v${v} created`, { description: `${preview.toAdd.length} added, ${preview.toUpdate.length} updated. Review it in the Library, then submit for approval.` });
    setStep(0);
    setFile(undefined);
    setMap(undefined);
    onDone();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Import risks, functions and actions from a spreadsheet. Nothing goes live until the new draft is approved and published.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadRulesTemplate}>
            <Download /> Download rules template
          </Button>
          <Button variant="secondary" onClick={() => setConfirmStarter(true)} disabled={!can("edit")}>
            <Library /> Load MyGo starter library
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <StepIndicator steps={STEPS} current={step} />
        </CardHeader>
        <CardContent className="min-h-[320px]">
          {step === 0 && (
            <div className="space-y-4">
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload a rules file. Drag and drop or press Enter to browse."
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f) accept(f);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors hover:border-primary/60 hover:bg-accent/40",
                  dragOver && "border-primary bg-accent",
                )}
              >
                <UploadCloud className="h-8 w-8 text-primary" aria-hidden />
                <div>
                  <p className="font-medium">Drag and drop your rules file here, or click to browse</p>
                  <p className="text-sm text-muted-foreground">.xlsx or .csv · one row per Risk × Function × Action</p>
                </div>
                <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && accept(e.target.files[0])} />
              </div>
              {file ? (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
                  <FileSpreadsheet className="h-5 w-5 text-primary" aria-hidden />
                  <span className="font-medium">{file.fileName}</span>
                  <span className="text-muted-foreground">
                    {file.rows.length} rows · {file.columns.length} columns
                  </span>
                  <CheckCircle2 className="ml-auto h-4 w-4 text-status-green" aria-label="Loaded" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No file handy?{" "}
                  <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={useSample}>
                    Use a sample file
                  </button>{" "}
                  to try the wizard.
                </p>
              )}
            </div>
          )}

          {step === 1 && file && map && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                We matched your columns automatically. Check each field and adjust where needed. Fields marked <span className="text-status-red">*</span> are required.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MySODAI field</TableHead>
                    <TableHead>Column in your file</TableHead>
                    <TableHead>Sample value (row 2)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {IMPORT_FIELDS.map((f) => (
                    <TableRow key={f.key}>
                      <TableCell className="font-medium">
                        {f.label}
                        {f.required && <span className="text-status-red"> *</span>}
                      </TableCell>
                      <TableCell>
                        <Select value={map[f.key] || "__none"} onValueChange={(v) => setMap({ ...map, [f.key]: v === "__none" ? "" : v })}>
                          <SelectTrigger className="w-56" aria-label={`Column for ${f.label}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— Not in file —</SelectItem>
                            {file.columns.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{map[f.key] ? file.rows[0]?.[map[f.key]] || "—" : "—"}</TableCell>
                      <TableCell className="text-xs">
                        {map[f.key] ? (
                          <span className="inline-flex items-center gap-1 text-status-green">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Mapped
                          </span>
                        ) : f.required ? (
                          <span className="inline-flex items-center gap-1 text-status-red">
                            <XCircle className="h-3.5 w-3.5" aria-hidden /> Required
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Optional</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const name = window.prompt("Name this mapping profile", file.fileName.replace(/\.\w+$/, ""));
                  if (name) {
                    saveMappingProfile(name, map);
                    toast.success(`Mapping profile “${name}” saved`);
                  }
                }}
              >
                <Save /> Save mapping profile
              </Button>
            </div>
          )}

          {step === 2 && preview && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <SummaryCard icon={Sparkles} label="Rows to add" value={preview.toAdd.length} sub={`${preview.toAdd.length} new risk(s)`} tone="green" />
                <SummaryCard icon={CheckCircle2} label="Rows to update" value={preview.toUpdate.length} sub="existing risks will be updated" tone="primary" />
                <SummaryCard icon={XCircle} label="Rows with errors" value={preview.errors.length} sub={preview.errors.length ? "fix in the file or skip them" : "nothing to fix"} tone={preview.errors.length ? "red" : "muted"} />
              </div>
              {preview.errors.length > 0 && (
                <Card>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle className="text-sm">Errors</CardTitle>
                      <CardDescription>These rows will not be imported until fixed.</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={downloadErrors}>
                      <Download /> Download error file
                    </Button>
                  </CardHeader>
                  <ul className="divide-y border-t text-sm">
                    {preview.errors.map((e) => (
                      <li key={e.row + e.message} className="flex items-start gap-2 px-5 py-2.5">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-status-red" aria-label="Error" />
                        {e.message}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {preview.warnings.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Warnings</CardTitle>
                  </CardHeader>
                  <ul className="divide-y border-t text-sm">
                    {preview.warnings.map((w) => (
                      <li key={w.row} className="flex items-start gap-2 px-5 py-2.5">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-amber" aria-label="Warning" />
                        {w.message}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <details className="rounded-xl border">
                <summary className="cursor-pointer px-5 py-3 text-sm font-medium">Preview risks to import ({preview.risks.length})</summary>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Risk ID</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Functions</TableHead>
                      <TableHead>Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.risks.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.id}</TableCell>
                        <TableCell>{r.description}</TableCell>
                        <TableCell>{r.level}</TableCell>
                        <TableCell className="font-mono text-xs">{r.functionIds.join(", ")}</TableCell>
                        <TableCell className="text-xs">{preview.toAdd.includes(r.id) ? "Add" : "Update"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            </div>
          )}

          {step === 3 && preview && (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <div className="space-y-4">
                <RadioGroup value={mode} onValueChange={(v) => setMode(v as ImportMode)} aria-label="Import mode">
                  {[
                    { v: "add", t: "Add new only", d: `Adds ${preview.toAdd.length} new risk(s). Existing risks stay exactly as they are.` },
                    { v: "upsert", t: "Add and update", d: `Adds ${preview.toAdd.length} and updates ${preview.toUpdate.length} existing risk(s) from the file.` },
                    { v: "replace", t: "Replace entire ruleset", d: "Every risk not in the file is deactivated (never deleted). Use for a full reload." },
                  ].map((o) => (
                    <label key={o.v} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4", mode === o.v && "border-primary ring-2 ring-primary/15", o.v === "replace" && mode === o.v && "border-status-red ring-status-red/15")}>
                      <RadioGroupItem value={o.v} className="mt-0.5" />
                      <span>
                        <span className="block font-medium">{o.t}</span>
                        <span className="text-sm text-muted-foreground">{o.d}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
                {mode === "replace" && (
                  <div className="space-y-3 rounded-xl border border-status-red/40 bg-status-red-bg p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-status-red">
                      <AlertTriangle className="h-4 w-4" aria-hidden /> This replaces the whole ruleset in the new draft.
                    </p>
                    <Field label="Reason (recorded in the audit log)" htmlFor="replace-reason" required>
                      <Textarea id="replace-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Annual ruleset refresh approved by Risk Committee" />
                    </Field>
                    <Field label='Type "REPLACE" to confirm' htmlFor="replace-typed" required>
                      <Input id="replace-typed" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
                    </Field>
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={skipErrors} onCheckedChange={(c) => setSkipErrors(!!c)} />
                  Skip error rows ({preview.errors.length})
                </label>
                {preview.errors.length > 0 && !skipErrors && (
                  <p className="text-xs font-medium text-status-red" role="alert">
                    Fix the {preview.errors.length} error row(s) in the file, or tick “Skip error rows” to continue.
                  </p>
                )}
              </div>
              <Card className="h-fit bg-muted/30">
                <CardHeader>
                  <CardTitle className="text-sm">What happens next</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>1. A new <strong className="text-foreground">Draft</strong> version is created.</p>
                  <p>2. Review it in the Library and compare with the published version.</p>
                  <p>3. Submit for approval → a risk owner approves → an administrator publishes.</p>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-4">
          <Button variant="ghost" onClick={saveDraft} disabled={!file}>
            <Save /> Save as draft
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              <ArrowLeft /> Back
            </Button>
            {step < 3 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
                Next <ArrowRight />
              </Button>
            ) : (
              <Button onClick={finish} disabled={finishBlocked || busy || !can("edit")}>
                {busy ? "Importing…" : "Finish – create draft"}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmStarter}
        onOpenChange={setConfirmStarter}
        title="Load the MyGo starter library?"
        description="Adds 10 proven SoD risks for Finance, Procurement, Sales, HR and Basis to your draft. Existing risks with the same ID are not changed."
        confirmLabel="Load library"
        onConfirm={async () => {
          await loadStarterLibrary();
          toast.success("Starter library loaded into the draft");
          onDone();
        }}
      />
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, tone }: { icon: typeof Sparkles; label: string; value: number; sub: string; tone: "green" | "primary" | "red" | "muted" }) {
  const cls = { green: "text-status-green", primary: "text-primary", red: "text-status-red", muted: "text-muted-foreground" }[tone];
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        {label}
        <Icon className={cn("h-4 w-4", cls)} aria-hidden />
      </div>
      <div className="tabular mt-1 text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
