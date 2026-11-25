import * as React from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Eye, EyeOff, FileKey, Info, Loader2, Lock, RefreshCw, Save, ShieldAlert, Users, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox, RadioGroup, RadioGroupItem } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, StepIndicator } from "@/components/common";
import { addSystem, testConnection, type NewSystemInput, type TestStep } from "@/services/sapService";
import type { AuthType, ConnectionMethod, Deployment, SapSystemApiConfig, Tier } from "@/types";
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
  destination: string;
  roleData: boolean;
  userAssignments: boolean;
  writeActions: boolean;
  userAssignmentsEndpoint: string;
  userMasterUrl: string;
  pageSize: number;
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
  destination: "",
  roleData: true,
  userAssignments: true,
  writeActions: false,
  userAssignmentsEndpoint: "RoleUserAssignments",
  userMasterUrl: "",
  pageSize: 200,
};

export function computeAutoSystemName(sid: string, tier: Tier, dep: Deployment) {
  if (!sid) return "";
  const s = sid.trim().toUpperCase();
  if (s === "HMF") {
    return "HMF 2023 – SAP S/4HANA (BTP CAP)";
  }
  const suffix = dep === "Public Cloud" ? "BTP CAP" : tier;
  return `${s} 2023 – SAP S/4HANA (${suffix})`;
}

export function AddSystemWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = React.useState(0);
  const [d, setD] = React.useState<Draft>(empty);
  const [manuallyNamed, setManuallyNamed] = React.useState(false);
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

  const handleSidChange = (val: string) => {
    const sidUpper = val.toUpperCase();
    if (!manuallyNamed || !d.name.trim()) {
      const autoName = computeAutoSystemName(sidUpper, d.tier, d.deployment);
      setD((prev) => ({ ...prev, sid: sidUpper, name: autoName }));
    } else {
      setD((prev) => ({ ...prev, sid: sidUpper }));
    }
  };

  const handleTierChange = (tier: Tier) => {
    if (!manuallyNamed || !d.name.trim()) {
      const autoName = computeAutoSystemName(d.sid, tier, d.deployment);
      setD((prev) => ({ ...prev, tier, name: autoName }));
    } else {
      setD((prev) => ({ ...prev, tier }));
    }
  };

  const handleDeploymentChange = (dep: Deployment) => {
    const method = dep === "Public Cloud" ? "OData API" : d.method;
    if (!manuallyNamed || !d.name.trim()) {
      const autoName = computeAutoSystemName(d.sid, d.tier, dep);
      setD((prev) => ({ ...prev, deployment: dep, method, name: autoName }));
    } else {
      setD((prev) => ({ ...prev, deployment: dep, method }));
    }
  };

  const errors: Record<string, string | undefined> = {
    name: !d.name.trim() ? "Give the system a name people recognise, e.g. “HMF 2023 – SAP S/4HANA (BTP CAP)”." : undefined,
    sid: !/^[A-Z][A-Z0-9]{2}$/.test(d.sid) ? "SID is 3 characters, starting with a letter (e.g. S4Q or HMF)." : undefined,
    client: !/^\d{3}$/.test(d.client) ? "Client is a 3-digit number (e.g. 100)." : undefined,
    host: d.method !== "File upload" && d.host.trim().length < 4 ? "Enter the host name or API endpoint." : undefined,
  };
  const credsOk =
    d.method === "File upload" ||
    (d.authType === "Basic" && d.user && secret) ||
    (d.authType === "OAuth 2.0 client credentials" && d.clientId && secret && d.tokenUrl) ||
    (d.authType === "X.509" && cert);
  const testsOk = tests.length === 3 && tests.every((t) => t.ok);

  const buildApiConfig = (): SapSystemApiConfig => ({
    serviceRoot: d.host.trim(),
    destination: d.destination.trim() || undefined,
    tokenUrl: d.tokenUrl.trim() || undefined,
    clientId: d.clientId.trim() || undefined,
    technicalUser: d.user.trim() || undefined,
    scopes: {
      roleData: d.roleData,
      userAssignments: d.userAssignments,
      writeActions: d.writeActions,
    },
    endpoints: {
      roleHeaders: "RoleHeaders",
      roleAuthorizations: "RoleAuthorizations",
      roleOrgData: "RoleOrgData",
      roleTCodes: "RoleTCodes",
      userAssignments: d.userAssignmentsEndpoint.trim() || "RoleUserAssignments",
      userMasterUrl: d.userMasterUrl.trim() || undefined,
    },
    pageSize: d.pageSize || 200,
  });

  const canNext = [
    !errors.name && !errors.sid && !errors.client,
    !errors.host && (d.method === "File upload" || d.roleData || d.userAssignments),
    !!credsOk,
    testsOk || d.method === "File upload",
    true,
  ][step];

  const runTest = async () => {
    setTests([]);
    setTesting(true);
    await testConnection(
      {
        host: d.host,
        method: d.method,
        authType: d.authType,
        tier: d.tier,
        apiConfig: buildApiConfig(),
        tokenUrl: d.tokenUrl,
        clientId: d.clientId,
        secret,
        user: d.user,
      },
      (s) => setTests((x) => [...x, s]),
    );
    setTesting(false);
  };

  // Any change to connection settings invalidates earlier test results
  React.useEffect(
    () => setTests([]),
    [d.host, d.method, d.authType, d.tier, d.roleData, d.userAssignments, d.writeActions, d.userAssignmentsEndpoint, d.tokenUrl, d.clientId, d.user, secret, cert],
  );

  React.useEffect(() => {
    if (step === 3 && d.method !== "File upload" && !tests.length && !testing) runTest();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setStep(0);
    setD(empty);
    setManuallyNamed(false);
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
    const s = await addSystem({
      ...d,
      apiConfig: buildApiConfig(),
      secret,
    });
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
              <Field label="System ID (SID)" htmlFor="w-sid" required error={d.sid ? errors.sid : undefined}>
                <Input
                  id="w-sid"
                  value={d.sid}
                  maxLength={3}
                  onChange={(e) => handleSidChange(e.target.value)}
                  placeholder="HMF"
                />
              </Field>
              <Field label="Client" htmlFor="w-client" required error={d.client ? errors.client : undefined}>
                <Input
                  id="w-client"
                  value={d.client}
                  maxLength={3}
                  inputMode="numeric"
                  onChange={(e) => set({ client: e.target.value.replace(/\D/g, "") })}
                  placeholder="100"
                />
              </Field>
              <Field label="Tier" htmlFor="w-tier">
                <Select value={d.tier} onValueChange={(v) => handleTierChange(v as Tier)}>
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
                  onValueChange={(v) => handleDeploymentChange(v as Deployment)}
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
              <Field label="Display name" htmlFor="w-name" required error={d.name ? errors.name : undefined} className="md:col-span-2">
                <div className="space-y-1">
                  <Input
                    id="w-name"
                    value={d.name}
                    onChange={(e) => {
                      setManuallyNamed(true);
                      set({ name: e.target.value });
                    }}
                    placeholder="HMF 2023 – SAP S/4HANA (BTP CAP)"
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                    <span>
                      {manuallyNamed ? "Custom display name applied" : "Automatically generated based on SID & deployment"}
                    </span>
                    {manuallyNamed && (
                      <button
                        type="button"
                        onClick={() => {
                          setManuallyNamed(false);
                          const auto = computeAutoSystemName(d.sid || "HMF", d.tier, d.deployment);
                          set({ name: auto });
                        }}
                        className="text-primary hover:underline font-medium"
                      >
                        Reset to auto name
                      </button>
                    )}
                  </div>
                </div>
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <RadioGroup value={d.method} onValueChange={(v) => set({ method: v as ConnectionMethod })} aria-label="Connection method">
                {methodOptions.map((o) => (
                  <label key={o.v} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3.5", d.method === o.v && "border-primary ring-2 ring-primary/15", o.disabled && "cursor-not-allowed opacity-50")}>
                    <RadioGroupItem value={o.v} disabled={o.disabled} className="mt-0.5" />
                    <span>
                      <span className="block font-medium text-sm">{o.t}</span>
                      <span className="text-xs text-muted-foreground">{o.d}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              {d.method !== "File upload" && (
                <div className="space-y-3">
                  <div className={cn("grid gap-3", d.method === "OData API" ? "md:grid-cols-3" : "")}>
                    <Field
                      label={d.method === "OData API" ? "CAP Service Root / Base URL" : "RFC agent host"}
                      htmlFor="w-host"
                      required
                      error={d.host ? errors.host : undefined}
                      className={d.method === "OData API" ? "md:col-span-2" : ""}
                      hint={d.method === "OData API" ? "Include the service path (e.g. https://.../role-service)." : "Tip: a host containing “fail” simulates an unreachable system."}
                    >
                      <Input
                        id="w-host"
                        value={d.host}
                        onChange={(e) => set({ host: e.target.value })}
                        placeholder={d.method === "OData API" ? "https://mygo-...cfapps.us10-001.hana.ondemand.com/role-service" : "rfc-agent.example.internal:3300"}
                      />
                    </Field>
                    {d.method === "OData API" && (
                      <Field label="BTP Destination (optional)" htmlFor="w-dest" hint="e.g. HMF_2023">
                        <Input
                          id="w-dest"
                          value={d.destination}
                          onChange={(e) => set({ destination: e.target.value.toUpperCase() })}
                          placeholder="HMF_2023"
                        />
                      </Field>
                    )}
                  </div>

                  {d.method === "OData API" && (
                    <div className="rounded-xl border bg-muted/25 p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          API Data Scopes &amp; Endpoints
                        </span>
                        {!d.roleData && !d.userAssignments && (
                          <span className="text-[11px] font-medium text-status-red">Select at least one data scope</span>
                        )}
                      </div>

                      <label className="flex items-start gap-2.5 rounded-lg border bg-background p-2.5 cursor-pointer">
                        <Checkbox
                          checked={d.roleData}
                          onCheckedChange={(v) => set({ roleData: Boolean(v) })}
                          className="mt-0.5"
                        />
                        <div className="text-xs">
                          <div className="font-medium text-foreground">Role Master Data (v1.0 Rolehdr_Detail)</div>
                          <div className="text-muted-foreground">Syncs <span className="font-mono">RoleHeaders</span>, <span className="font-mono">RoleAuthorizations</span>, <span className="font-mono">RoleOrgData</span>, <span className="font-mono">RoleTCodes</span></div>
                        </div>
                      </label>

                      <div className="rounded-lg border bg-background p-2.5 space-y-2">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <Checkbox
                            checked={d.userAssignments}
                            onCheckedChange={(v) => set({ userAssignments: Boolean(v) })}
                            className="mt-0.5"
                          />
                          <div className="text-xs">
                            <div className="font-medium text-foreground flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-primary" />
                              User-to-Role Assignments (v1.2 ZGW_ROLES_MANAGEMENT_SRV)
                            </div>
                            <div className="text-muted-foreground">Extracts <span className="font-mono">Uname ↔ AgrName</span> mappings for User SoD analysis</div>
                          </div>
                        </label>
                        {d.userAssignments && (
                          <div className="grid gap-2 pl-6 pt-1 md:grid-cols-2">
                            <Field label="User Assignment Endpoint" htmlFor="w-user-ep">
                              <Select value={d.userAssignmentsEndpoint} onValueChange={(v) => set({ userAssignmentsEndpoint: v })}>
                                <SelectTrigger id="w-user-ep" className="h-8 text-xs font-mono">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ManagementHeaders">ManagementHeaders (Nav_HeaderToUA Navigation)</SelectItem>
                                  <SelectItem value="RoleUserAssignments">RoleUserAssignments (UserAssinmntSet)</SelectItem>
                                  <SelectItem value="ManagementRoles">ManagementRoles (RoleSet)</SelectItem>
                                </SelectContent>
                              </Select>
                            </Field>
                            <Field label="Optional User Master API URL" htmlFor="w-usermaster" hint="For USR02 lock/name/department if separate">
                              <Input
                                id="w-usermaster"
                                className="h-8 text-xs font-mono"
                                value={d.userMasterUrl}
                                onChange={(e) => set({ userMasterUrl: e.target.value })}
                                placeholder="https://.../API_USER_SRV (optional)"
                              />
                            </Field>
                          </div>
                        )}
                      </div>

                      <label className="flex items-start gap-2.5 rounded-lg border bg-background p-2.5 cursor-pointer">
                        <Checkbox
                          checked={d.writeActions}
                          onCheckedChange={(v) => set({ writeActions: Boolean(v) })}
                          className="mt-0.5"
                        />
                        <div className="text-xs">
                          <div className="font-medium text-foreground flex items-center gap-1.5">
                            <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                            Enable Role Administration Write Actions (v1.2 ZROLES_SRV)
                          </div>
                          <div className="text-muted-foreground">
                            Enables <span className="font-mono">createRole</span>, <span className="font-mono">assignRoleToUser</span>, <span className="font-mono">removeRoleFromUser</span> · Requires XSUAA <span className="font-mono">RoleAdministrator</span> scope
                          </div>
                        </div>
                      </label>
                    </div>
                  )}
                </div>
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
                    <Field label="XSUAA Token URL" htmlFor="w-token" required className="md:col-span-2" hint="Use the XSUAA service-binding URL ending with /oauth/token (grant_type=client_credentials).">
                      <Input id="w-token" value={d.tokenUrl} onChange={(e) => set({ tokenUrl: e.target.value })} placeholder="https://mygo-bas-4e8bz4sk.authentication.us10.hana.ondemand.com/oauth/token" />
                    </Field>
                    <Field label="Client ID" htmlFor="w-cid" required>
                      <Input id="w-cid" value={d.clientId} onChange={(e) => set({ clientId: e.target.value })} placeholder="sb-zrole-header-cap-..." autoComplete="off" />
                    </Field>
                    <SecretField label="Client secret" value={secret} onChange={setSecret} show={showSecret} setShow={setShowSecret} />
                    <div className="md:col-span-2 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" aria-hidden />
                      <span>
                        OAuth token requires <span className="font-mono text-foreground">uaa.resource</span> for read sync
                        {d.writeActions ? (
                          <> and <span className="font-mono text-foreground font-semibold">RoleAdministrator</span> scope for write actions</>
                        ) : null}.
                      </span>
                    </div>
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
            <div className="grid gap-4 md:grid-cols-3">
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
              <Field label="Batch Page Size ($top)" htmlFor="w-pagesize" hint="OData pagination batch size">
                <Select value={String(d.pageSize)} onValueChange={(v) => set({ pageSize: Number(v) })}>
                  <SelectTrigger id="w-pagesize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["100", "200", "500"].map((o) => (
                      <SelectItem key={o} value={o}>
                        {o} rows / page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="rounded-xl border bg-muted/30 p-4 text-sm md:col-span-3 space-y-1.5">
                <div className="font-medium">Connection Summary</div>
                <p className="text-muted-foreground text-xs">
                  {d.name || "—"} · {d.sid}/{d.client} · {d.tier} · {d.deployment} · {d.method}
                  {d.method !== "File upload" && ` · ${d.authType}`}
                </p>
                {d.method === "OData API" && (
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-1.5 pt-1">
                    {d.roleData && <span className="rounded bg-background border px-2 py-0.5 font-mono">Roles: RoleHeaders, Auths, OrgData, TCodes</span>}
                    {d.userAssignments && <span className="rounded bg-background border px-2 py-0.5 font-mono">Users: {d.userAssignmentsEndpoint}</span>}
                    {d.writeActions && <span className="rounded bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 font-mono">Write Actions Enabled</span>}
                    {d.destination && <span className="rounded bg-background border px-2 py-0.5 font-mono">Dest: {d.destination}</span>}
                  </div>
                )}
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
