import * as React from "react";
import { toast } from "sonner";
import { KeyRound, Palette, Save, Tag, Users } from "lucide-react";
import { PageHeader, Field, LevelChip, HelpTip } from "@/components/common";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton, Switch } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useService } from "@/services/db";
import { getAppUsers, getSettings, namingCheck, saveSettings, setAppUserRole } from "@/services/settingsService";
import { useApp } from "@/context/AppContext";
import { RISK_LEVELS, type AppRole, type Settings } from "@/types";

const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  Administrator: "Everything, including connections, publishing rulesets and user management",
  "Security Analyst": "Edit rules and roles, run analyses, export role files",
  "Risk Owner": "Approve ruleset versions and red-role exports for their process",
  Auditor: "Read-only access to everything, including the audit log",
};

export default function SettingsPage() {
  const { can } = useApp();
  const admin = can("admin");
  const { data: saved, loading } = useService(getSettings);
  const { data: appUsers } = useService(getAppUsers);
  const [s, setS] = React.useState<Settings>();
  const [reason, setReason] = React.useState("");
  const [testName, setTestName] = React.useState("Z_FI_AP_INVOICE");

  React.useEffect(() => {
    if (saved && !s) setS(saved);
  }, [saved, s]);

  if (loading || !s) return <Skeleton className="h-96 rounded-xl" />;
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: "Settings" }]}
        title="Settings"
        description={admin ? "Changes are recorded in the audit log." : "Only administrators can change settings. You are viewing them read-only."}
        actions={
          <Button
            disabled={!dirty || !admin}
            onClick={async () => {
              await saveSettings(s, reason || undefined);
              setReason("");
              toast.success("Settings saved", { description: "Statuses are recalculated immediately." });
            }}
          >
            <Save /> Save changes
          </Button>
        }
      />
      <Tabs defaultValue="traffic">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="traffic">
            <Palette /> Traffic light
          </TabsTrigger>
          <TabsTrigger value="naming">
            <Tag /> Naming conventions
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users /> App users
          </TabsTrigger>
          <TabsTrigger value="sso">
            <KeyRound /> Single sign-on
          </TabsTrigger>
        </TabsList>

        <fieldset disabled={!admin}>
          <TabsContent value="traffic" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Risk level → status</CardTitle>
                <CardDescription>Which colour an unmitigated risk hit gets. A role or user always takes the worst status of its hits.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {RISK_LEVELS.map((l) => (
                  <div key={l} className="flex flex-wrap items-center gap-4">
                    <div className="w-24">
                      <LevelChip level={l} />
                    </div>
                    <Select value={s.levelToStatus[l]} onValueChange={(v) => setS({ ...s, levelToStatus: { ...s.levelToStatus, [l]: v as "red" | "amber" | "green" } })} disabled={!admin}>
                      <SelectTrigger className="w-56" aria-label={`Status for ${l} risks`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["red", "amber", "green"] as const).map((st) => (
                          <SelectItem key={st} value={st}>
                            <StatusBadge status={st} size="sm" />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-4 border-t pt-3">
                  <div className="flex w-24 items-center gap-1 text-sm font-medium">
                    Mitigated <HelpTip term="Mitigation" />
                  </div>
                  <Select value={s.mitigatedStatus} onValueChange={(v) => setS({ ...s, mitigatedStatus: v as "amber" | "green" })} disabled={!admin}>
                    <SelectTrigger className="w-56" aria-label="Status for mitigated risks">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["amber", "green"] as const).map((st) => (
                        <SelectItem key={st} value={st}>
                          <StatusBadge status={st} size="sm" />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Data freshness</CardTitle>
                <CardDescription>
                  Roles not analysed within this many days show as <StatusBadge status="grey" size="sm" />
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-4">
                <Field label="Staleness limit (days)" htmlFor="st-days">
                  <Input
                    id="st-days"
                    type="number"
                    min={1}
                    max={90}
                    className="w-32"
                    value={s.stalenessDays}
                    onChange={(e) => setS({ ...s, stalenessDays: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })}
                  />
                </Field>
                <Field label="Reason for change (audit log)" htmlFor="st-reason" className="min-w-[280px] flex-1">
                  <Textarea id="st-reason" rows={1} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
                </Field>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="naming">
            <Card>
              <CardHeader>
                <CardTitle>Role naming</CardTitle>
                <CardDescription>Enforced in Role Builder and template uploads.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Allowed prefixes (comma-separated)" htmlFor="nm-pre" hint="Customer namespace, e.g. Z_, Y_">
                  <Input
                    id="nm-pre"
                    value={s.namingPrefixes.join(", ")}
                    onChange={(e) => setS({ ...s, namingPrefixes: e.target.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) })}
                  />
                </Field>
                <Field label="Maximum length" htmlFor="nm-len">
                  <Input id="nm-len" type="number" min={10} max={30} value={s.maxRoleNameLength} onChange={(e) => setS({ ...s, maxRoleNameLength: Number(e.target.value) || 30 })} />
                </Field>
                <Field label="Pattern guidance" htmlFor="nm-pat" hint="Shown to analysts as a hint" className="md:col-span-2">
                  <Input id="nm-pat" value={s.namingPattern} onChange={(e) => setS({ ...s, namingPattern: e.target.value })} />
                </Field>
                <div className="rounded-xl border bg-muted/30 p-4 md:col-span-2">
                  <Field label="Try a name" htmlFor="nm-try" error={namingCheck(testName, s)} hint={!namingCheck(testName, s) ? "✓ Valid name" : undefined}>
                    <Input id="nm-try" className="font-mono" value={testName} onChange={(e) => setTestName(e.target.value.toUpperCase())} disabled={false} />
                  </Field>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>MySODAI users</CardTitle>
                <CardDescription>People who can sign in to MySODAI and what they can do.</CardDescription>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>App role</TableHead>
                    <TableHead>Can do</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(appUsers ?? []).map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        <Select
                          value={u.role}
                          disabled={!admin}
                          onValueChange={async (v) => {
                            await setAppUserRole(u.id, v as AppRole);
                            toast.success(`${u.name} is now ${v}`);
                          }}
                        >
                          <SelectTrigger className="w-44" aria-label={`App role for ${u.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(ROLE_DESCRIPTIONS) as AppRole[]).map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[u.role]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="sso">
            <Card>
              <CardHeader>
                <CardTitle>Single sign-on</CardTitle>
                <CardDescription>Connect your identity provider (SAP Cloud Identity Services, Microsoft Entra ID, Okta) via SAML 2.0 or OpenID Connect.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Protocol" htmlFor="sso-proto">
                  <Select defaultValue="saml" disabled>
                    <SelectTrigger id="sso-proto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="saml">SAML 2.0</SelectItem>
                      <SelectItem value="oidc">OpenID Connect</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="IdP metadata URL" htmlFor="sso-url">
                  <Input id="sso-url" placeholder="https://idp.example.com/metadata" disabled />
                </Field>
                <label className="flex items-center gap-3 text-sm md:col-span-2">
                  <Switch disabled aria-label="Enforce SSO" /> Enforce SSO for all users
                </label>
                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground md:col-span-2">Placeholder – SSO configuration will be available in a later release.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </fieldset>
      </Tabs>
    </>
  );
}
