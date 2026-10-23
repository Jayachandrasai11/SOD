import * as React from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Eye, EyeOff, FileKey, Loader2, Lock, RefreshCw, Save, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, StepIndicator } from "@/components/common";
import { addSystem, testConnection, type NewSystemInput, type TestStep } from "@/services/sapService";
import type { AuthType, ConnectionMethod, Deployment, Tier } from "@/types";
import { cn } from "@/lib/utils";

const STEPS = ["System details", "Connection method", "Credentials", "Test", "Sync schedule"];
const DRAFT_KEY = "mysodai-system-draft";
const CHECKS: { key: TestStep["key"]; label: string }[] = [
  { key: "reachable", label: "Reachable" },
  { key: "auth", label: "Authenticated" },
  { key: "techuser", label: "Technical user authorisations" },
];

export function TestChecklist({ steps, running = true }: { steps: TestStep[]; running?: boolean }) {
  const failedAt = steps.findIndex((s) => !s.ok);
  return (
    <ul className="space-y-2" aria-live="polite">
      {CHECKS.map((c, i) => {
        const s = steps.find((x) => x.key === c.key);
        const inFlight = !s && i === steps.length && failedAt < 0 && running;
        const skipped = !s && failedAt >= 0;
        return (
          <li key={c.key} className={cn("rounded-lg border px-3 py-2.5 transition-colors", s?.ok && "border-status-green/30 bg-status-green-bg/50", s && !s.ok && "border-status-red/30 bg-status-red-bg/60")}>
            <div className="flex items-center gap-2 text-sm font-medium">
              {s ? (
                s.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-status-green" aria-hidden />
                ) : (
                  <XCircle className="h-4 w-4 text-status-red" aria-hidden />
                )
              ) : inFlight ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />
              )}
              {c.label}
              <span className="ml-auto text-xs text-muted-foreground">{s ? (s.ok ? "Passed" : "Failed") : inFlight ? "Checking…" : skipped ? "Skipped" : "Waiting"}</span>
            </div>
            {s?.hint && <p className="mt-1 pl-6 text-xs text-status-red">How to fix: {s.hint}</p>}
          </li>
        );
      })}
    </ul>
  );
}

interface Draft extends NewSystemInput {
  user: string;
  clientId: string;
  tokenUrl: string;
}

const empty: Draft = {
  name: "",
  sid: "",
  client: "",
  tier: "QA",
  deployment: "On-premise",
  method: "OData API",
  authType: "OAuth 2.0 client credentials",
  host: "",
  scheduleFull: "Weekly · Sunday 01:00",
  scheduleDelta: "Daily · 02:00",
  user: "",
  clientId: "",
  tokenUrl: "",
};

export function AddSystemWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = React.useState(0);
  const [d, setD] = React.useState<Draft>(empty);
  // Secrets live only in component memory; never persisted to drafts or shown again
  const [secret, setSecret] = React.useState("");
  const [cert, setCert] = React.useState<string>();
  const [showSecret, setShowSecret] = React.useState(false);
  const [tests, setTests] = React.useState<TestStep[]>([]);
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
      if (saved) {
        setD({ ...empty, ...saved.d });
        setStep(Math.min(saved.step, 2));
        toast.info("Restored your saved system draft", { description: "Re-enter the credentials – secrets are never saved." });
      }
    } catch {
      /* ignore */
    }
  }, [open]);

  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const errors: Record<string, string | undefined> = {
    name: !d.name.trim() ? "Give the system a name people recognise, e.g. “S4Q – Quality”." : undefined,
    sid: !/^[A-Z][A-Z0-9]{2}$/.test(d.sid) ? "SID is 3 characters, starting with a letter (e.g. S4Q)." : undefined,
    client: !/^\d{3}$/.test(d.client) ? "Client is a 3-digit number (e.g. 100)." : undefined,
    host: d.method !== "File upload" && d.host.trim().length < 4 ? "Enter the host name or API endpoint." : undefined,
  };
  const credsOk =
    d.method === "File upload" ||
    (d.authType === "Basic" && d.user && secret) ||
    (d.authType === "OAuth 2.0 client credentials" && d.clientId && secret && d.tokenUrl) ||
    (d.authType === "X.509" && cert);
  const testsOk = tests.length === 3 && tests.every((t) => t.ok);

  const canNext = [
    !errors.name && !errors.sid && !errors.client,
    !errors.host,
    !!credsOk,
    testsOk || d.method === "File upload",
    true,
  ][step];

  const runTest = async () => {
    setTests([]);
    setTesting(true);
    await testConnection({ host: d.host, method: d.method, authType: d.authType, tier: d.tier }, (s) => setTests((x) => [...x, s]));
    setTesting(false);
  };

  // Any change to connection settings invalidates earlier test results
  React.useEffect(() => setTests([]), [d.host, d.method, d.authType, d.tier, secret, cert]);

  React.useEffect(() => {
    if (step === 3 && d.method !== "File upload" && !tests.length && !testing) runTest();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setStep(0);
    setD(empty);
    setSecret("");
    setCert(undefined);
    setTests([]);
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ d, step }));
      toast.success("Saved as draft", { description: "Secrets were not saved." });
      onOpenChange(false);
    } catch {
      toast.error("Could not save draft");
    }
  };

  const finish = async () => {
    setSaving(true);
    const s = await addSystem(d);
    setSaving(false);
    setSecret("");
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    toast.success(`${s.name} connected`, { description: "First full sync is scheduled. Credentials were sent to the vault." });
    reset();
    onOpenChange(false);
  };

  const methodOptions: { v: ConnectionMethod; t: string; d: string; disabled?: boolean }[] = [
    { v: "OData API", t: "OData API", d: "Recommended. Uses released SAP APIs over HTTPS. Works for every deployment." },
    { v: "RFC agent", t: "RFC agent", d: "Small agent inside your network reads tables via RFC. On-premise / Private Cloud only.", disabled: d.deployment === "Public Cloud" },
    { v: "File upload", t: "File upload", d: "Upload SUIM/table extracts manually. No live connection – data gets stale quickly." },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSecret("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add S/4HANA system</DialogTitle>
          <DialogDescription>Read-only connection. MySODAI never writes to SAP.</DialogDescription>
        </DialogHeader>
        <StepIndicator steps={STEPS} current={step} />

        <div className="min-h-[300px] py-2">
          {step === 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Display name" htmlFor="w-name" required error={d.name ? errors.name : undefined} className="md:col-span-2">
                <Input id="w-name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="S4Q – Quality" />
              </Field>
              <Field label="System ID (SID)" htmlFor="w-sid" required error={d.sid ? errors.sid : undefined}>
                <Input id="w-sid" value={d.sid} maxLength={3} onChange={(e) => set({ sid: e.target.value.toUpperCase() })} placeholder="S4Q" />
              </Field>
              <Field label="Client" htmlFor="w-client" required error={d.client ? errors.client : undefined}>
                <Input id="w-client" value={d.client} maxLength={3} inputMode="numeric" onChange={(e) => set({ client: e.target.value.replace(/\D/g, "") })} placeholder="100" />
              </Field>
              <Field label="Tier" htmlFor="w-tier">
                <Select value={d.tier} onValueChange={(v) => set({ tier: v as Tier })}>
                  <SelectTrigger id="w-tier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["Dev", "QA", "Prod"] as Tier[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Deployment" htmlFor="w-dep">
                <Select
                  value={d.deployment}
                  onValueChange={(v) => set({ deployment: v as Deployment, method: v === "Public Cloud" ? "OData API" : d.method })}
                >
                  <SelectTrigger id="w-dep">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["On-premise", "Private Cloud", "Public Cloud"] as Deployment[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <RadioGroup value={d.method} onValueChange={(v) => set({ method: v as ConnectionMethod })} aria-label="Connection method">
                {methodOptions.map((o) => (
                  <label key={o.v} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4", d.method === o.v && "border-primary ring-2 ring-primary/15", o.disabled && "cursor-not-allowed opacity-50")}>
                    <RadioGroupItem value={o.v} disabled={o.disabled} className="mt-0.5" />
                    <span>
                      <span className="block font-medium">{o.t}</span>
                      <span className="text-sm text-muted-foreground">{o.d}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              {d.method !== "File upload" && (
                <Field label={d.method === "OData API" ? "API endpoint / host" : "RFC agent host"} htmlFor="w-host" required error={d.host ? errors.host : undefined} hint="Tip: a host containing “fail” simulates an unreachable system.">
                  <Input id="w-host" value={d.host} onChange={(e) => set({ host: e.target.value })} placeholder={d.method === "OData API" ? "https://s4q.example.com" : "rfc-agent.example.internal:3300"} />
                </Field>
              )}
            </div>
          )}

          {step === 2 &&
            (d.method === "File upload" ? (
              <p className="rounded-xl border bg-muted/40 p-6 text-sm text-muted-foreground">No credentials are needed for file upload. You’ll upload extracts after the system is created.</p>
            ) : (
              <div className="space-y-4">
                <RadioGroup value={d.authType} onValueChange={(v) => set({ authType: v as AuthType })} className="grid gap-2 md:grid-cols-3" aria-label="Authentication">
                  {(["Basic", "OAuth 2.0 client credentials", "X.509"] as AuthType[]).map((a) => (
                    <label key={a} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm", d.authType === a && "border-primary ring-2 ring-primary/15")}>
                      <RadioGroupItem value={a} /> {a}
                    </label>
                  ))}
                </RadioGroup>
                {d.authType === "Basic" && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Technical user" htmlFor="w-user" required>
                      <Input id="w-user" value={d.user} onChange={(e) => set({ user: e.target.value.toUpperCase() })} placeholder="MYSODAI_RFC" autoComplete="off" />
                    </Field>
                    <SecretField label="Password" value={secret} onChange={setSecret} show={showSecret} setShow={setShowSecret} />
                  </div>
                )}
                {d.authType === "OAuth 2.0 client credentials" && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Token URL" htmlFor="w-token" required className="md:col-span-2">
                      <Input id="w-token" value={d.tokenUrl} onChange={(e) => set({ tokenUrl: e.target.value })} placeholder="https://s4q.example.com/sap/bc/sec/oauth2/token" />
                    </Field>
                    <Field label="Client ID" htmlFor="w-cid" required>
                      <Input id="w-cid" value={d.clientId} onChange={(e) => set({ clientId: e.target.value })} autoComplete="off" />
                    </Field>
                    <SecretField label="Client secret" value={secret} onChange={setSecret} show={showSecret} setShow={setShowSecret} />
                  </div>
                )}
                {d.authType === "X.509" && (
                  <Field label="Client certificate (.pem / .p12)" htmlFor="w-cert" required>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 text-sm hover:bg-accent/40">
                      <FileKey className="h-5 w-5 text-primary" aria-hidden />
                      {cert ? <span className="font-medium">{cert} · loaded</span> : <span className="text-muted-foreground">Choose certificate file…</span>}
                      <input id="w-cert" type="file" accept=".pem,.p12,.pfx,.crt" className="sr-only" onChange={(e) => setCert(e.target.files?.[0]?.name)} />
                    </label>
                  </Field>
                )}
                <p className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" aria-hidden /> Secrets are encrypted and sent to the vault on save. They are never stored in drafts and never shown again.
                </p>
              </div>
            ))}

          {step === 3 &&
            (d.method === "File upload" ? (
              <p className="rounded-xl border bg-muted/40 p-6 text-sm text-muted-foreground">Nothing to test for file upload.</p>
            ) : (
              <div className="space-y-4">
                <TestChecklist steps={tests} running={testing} />
                {!testing && tests.length > 0 && !testsOk && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setStep(tests.some((t) => t.key === "reachable" && !t.ok) ? 1 : 2)}>
                      <ArrowLeft /> Fix settings
                    </Button>
                    <Button onClick={runTest}>
                      <RefreshCw /> Test again
                    </Button>
                  </div>
                )}
              </div>
            ))}

          {step === 4 && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Full sync" htmlFor="w-full" hint="Reloads all roles, users and authorisations.">
                <Select value={d.scheduleFull} onValueChange={(v) => set({ scheduleFull: v })}>
                  <SelectTrigger id="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Weekly · Sunday 01:00", "Weekly · Saturday 22:00", "Monthly · 1st 01:00"].map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Delta sync" htmlFor="w-delta" hint="Picks up changes since the last run.">
                <Select value={d.scheduleDelta} onValueChange={(v) => set({ scheduleDelta: v })}>
                  <SelectTrigger id="w-delta">
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
              <div className="rounded-xl border bg-muted/30 p-4 text-sm md:col-span-2">
                <div className="mb-1 font-medium">Summary</div>
                <p className="text-muted-foreground">
                  {d.name || "—"} · {d.sid}/{d.client} · {d.tier} · {d.deployment} · {d.method}
                  {d.method !== "File upload" && ` · ${d.authType}`}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button variant="ghost" onClick={saveDraft}>
            <Save /> Save as draft
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              <ArrowLeft /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext || testing}>
                Next <ArrowRight />
              </Button>
            ) : (
              <Button onClick={finish} disabled={saving}>
                {saving ? "Saving…" : "Add system"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SecretField({ label, value, onChange, show, setShow }: { label: string; value: string; onChange: (v: string) => void; show: boolean; setShow: (b: boolean) => void }) {
  return (
    <Field label={label} htmlFor="w-secret" required>
      <div className="relative">
        <Input id="w-secret" type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" className="pr-10" />
        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" onClick={() => setShow(!show)} aria-label={show ? "Hide secret" : "Show secret"}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  );
}
