import * as React from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FolderOpen, Search, UploadCloud, XCircle } from "lucide-react";
import { EmptyState } from "@/components/common";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useService, db } from "@/services/db";
import { createDraftRoles, getBuilderDrafts, parseRoleTemplate, sampleTemplateRoles, type TemplateRole } from "@/services/roleBuilderService";
import { useApp } from "@/context/AppContext";
import type { Role } from "@/types";
import { fmtDateTime } from "@/lib/utils";
import { TemplateDialog } from "../roles/RolesPage";

export const TemplateSection = React.memo(function TemplateSection({ onOpenDraft }: { onOpenDraft: (r: Role) => void }) {
  const { can } = useApp();
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<string[]>([]);
  const [prefillOpen, setPrefillOpen] = React.useState(false);
  const [roleQuery, setRoleQuery] = React.useState("");
  const [preview, setPreview] = React.useState<{ file: string; items: TemplateRole[] }>();
  const [include, setInclude] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { data: drafts } = useService(getBuilderDrafts);

  const filteredPrefillRoles = React.useMemo(() => {
    if (!prefillOpen) return [];
    const q = roleQuery.trim().toLowerCase();
    const prefillSet = new Set(prefill);
    const selectedList = db.roles.filter((r) => prefillSet.has(r.name));
    const nonSelectedList = db.roles
      .filter(
        (r) =>
          !prefillSet.has(r.name) &&
          (!q || r.name.toLowerCase().includes(q) || (r.description && r.description.toLowerCase().includes(q)))
      )
      .slice(0, 30);
    return [...selectedList, ...nonSelectedList];
  }, [prefillOpen, roleQuery, prefill]);

  const load = (file: string, items: TemplateRole[]) => {
    setPreview({ file, items });
    setInclude(new Set(items.filter((i) => !i.errors.length).map((i) => i.draft.name)));
  };

  const onFile = async (f: File) => {
    try {
      load(f.name, await parseRoleTemplate(f));
    } catch (e) {
      toast.error("Could not read the template", { description: (e as Error).message });
    }
  };

  const create = async () => {
    if (!preview) return;
    const items = preview.items.filter((i) => include.has(i.draft.name));
    setBusy(true);
    await createDraftRoles(items);
    setBusy(false);
    toast.success(`${items.length} draft role(s) created`, { description: "Open a draft below to refine and export it." });
    setPreview(undefined);
  };

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>SoD role template</CardTitle>
        <CardDescription>Design many roles offline in Excel, then upload them here to check SoD and create drafts in one go.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center gap-2 font-medium">
              <Download className="h-4 w-4 text-primary" aria-hidden /> 1. Download template
            </div>
            <p className="text-sm text-muted-foreground">Blank with examples, or pre-filled with existing roles to use as a starting point.</p>
            <details className="text-sm" onToggle={(e) => setPrefillOpen((e.target as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer text-primary select-none font-medium">
                Pre-fill with roles ({prefill.length} selected)
              </summary>
              {prefillOpen && (
                <div className="mt-2 space-y-2 rounded-lg border p-2 bg-muted/20">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      className="flex h-7 w-full rounded border border-input bg-background pl-7 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      placeholder="Filter roles…"
                      value={roleQuery}
                      onChange={(e) => setRoleQuery(e.target.value)}
                    />
                  </div>
                  <ul className="max-h-40 space-y-1 overflow-auto">
                    {filteredPrefillRoles.length === 0 ? (
                      <li className="text-xs text-muted-foreground py-1 text-center">No matching roles</li>
                    ) : (
                      filteredPrefillRoles.map((r) => (
                        <li key={r.name}>
                          <label className="flex items-center gap-2 font-mono text-xs cursor-pointer hover:bg-muted/50 p-1 rounded">
                            <Checkbox
                              checked={prefill.includes(r.name)}
                              onCheckedChange={(c) => setPrefill((p) => (c ? [...p, r.name] : p.filter((x) => x !== r.name)))}
                            />
                            <span className="truncate">{r.name}</span>
                          </label>
                        </li>
                      ))
                    )}
                  </ul>
                  {prefill.length > 0 && (
                    <div className="pt-1 text-[11px] text-muted-foreground flex justify-between items-center border-t border-border/50">
                      <span>{prefill.length} role(s) selected</span>
                      <button
                        type="button"
                        onClick={() => setPrefill([])}
                        className="text-primary hover:underline cursor-pointer"
                      >
                        Clear selection
                      </button>
                    </div>
                  )}
                </div>
              )}
            </details>
            <Button variant="outline" onClick={() => setTemplateOpen(true)}>
              <FileSpreadsheet /> Download SoD role template
            </Button>
          </div>
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center gap-2 font-medium">
              <UploadCloud className="h-4 w-4 text-primary" aria-hidden /> 2. Upload completed template
            </div>
            <p className="text-sm text-muted-foreground">We validate every role and run the SoD check before anything is created.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => inputRef.current?.click()} disabled={!can("edit")}>
                <UploadCloud /> Upload completed template
              </Button>
              <Button variant="ghost" onClick={() => load("Sample_completed_template.xlsx", sampleTemplateRoles())}>
                Use sample
              </Button>
              <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </div>
          </div>
        </div>

        {preview && (
          <section aria-label="Template validation preview" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                Validation preview · <span className="font-normal text-muted-foreground">{preview.file}</span>
              </h3>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setPreview(undefined)}>
                  Cancel
                </Button>
                <Button onClick={create} disabled={!include.size || busy || !can("edit")}>
                  Create {include.size} draft role(s)
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <span className="sr-only">Include</span>
                    </TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                    <TableHead>SoD status</TableHead>
                    <TableHead>Row errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.items.map((i) => (
                    <TableRow key={i.draft.name || Math.random()}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Include ${i.draft.name}`}
                          disabled={i.errors.length > 0}
                          checked={include.has(i.draft.name)}
                          onCheckedChange={(c) =>
                            setInclude((s) => {
                              const n = new Set(s);
                              c ? n.add(i.draft.name) : n.delete(i.draft.name);
                              return n;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <span className="block font-mono text-sm">{i.draft.name || "(no name)"}</span>
                        <span className="block text-xs text-muted-foreground">{i.draft.description}</span>
                      </TableCell>
                      <TableCell>{i.draft.type}</TableCell>
                      <TableCell className="tabular text-right">{i.draft.type === "Composite" ? `${i.draft.children?.length ?? 0} roles` : i.draft.tcodes.length}</TableCell>
                      <TableCell>
                        <StatusBadge status={i.status} size="sm" />
                        {i.hits > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{i.hits} risk(s)</span>}
                      </TableCell>
                      <TableCell>
                        {i.errors.length ? (
                          <ul className="space-y-0.5 text-xs text-status-red">
                            {i.errors.map((e) => (
                              <li key={e} className="flex items-start gap-1">
                                <XCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {e}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">Roles with errors cannot be created – fix them in the file and upload again. Red roles can be created as drafts but need a justification at export.</p>
          </section>
        )}

        <section>
          <h3 className="mb-2 font-semibold">Draft roles</h3>
          {!drafts || drafts.length === 0 ? (
            <EmptyState icon={FolderOpen} title="No draft roles yet. Save a draft above or upload a completed template." />
          ) : (
            <ul className="divide-y rounded-xl border">
              {drafts.map((d) => (
                <li key={d.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm">{d.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {d.description} · v{d.version} · {fmtDateTime(d.lastChanged)}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => onOpenDraft(JSON.parse(JSON.stringify(d)))}>
                    <FolderOpen /> Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
      <TemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} selected={prefill} />
    </Card>
  );
});
