import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  KeyRound,
  Loader2,
  ShieldCheck,
  Sparkles,
  Users,
  Layers,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  enrichAppsWithLlm,
  getFioriAppDetail,
  type FioriAppDetailResponse,
} from "@/services/fioriService";

function renderAccessBadge(cat: string) {
  switch (cat) {
    case "CREATE":
      return (
        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800">
          CREATE
        </Badge>
      );
    case "UPDATE":
      return (
        <Badge className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800">
          UPDATE
        </Badge>
      );
    case "DELETE":
      return (
        <Badge className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800">
          DELETE
        </Badge>
      );
    case "READ_ONLY":
      return (
        <Badge className="bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800">
          READ_ONLY
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground border-dashed">
          PENDING
        </Badge>
      );
  }
}

export default function FioriAppDetailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const appId = params.get("appId") || "";

  const [detail, setDetail] = React.useState<FioriAppDetailResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshingAi, setRefreshingAi] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const loadDetail = React.useCallback(async () => {
    if (!appId) {
      setError("No appId provided.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getFioriAppDetail(appId);
      setDetail(data);
    } catch (e: any) {
      setError(e.message || "Failed to load app details.");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  React.useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleResendToAi = async () => {
    if (!detail?.app) return;
    setRefreshingAi(true);
    setNotice(null);
    try {
      await enrichAppsWithLlm({ appIds: [detail.app.AppId], forceReenrich: true });
      setNotice(`Updated AI description and vector embedding for ${detail.app.AppId}.`);
      await loadDetail();
    } catch (e: any) {
      setError(e.message || "Failed to resend to AI.");
    } finally {
      setRefreshingAi(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm">Loading SAP app details...</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={error || "SAP App not found."}
        action={
          <Button variant="outline" onClick={() => navigate("/fiori")}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Catalog
          </Button>
        }
      />
    );
  }

  const { app, roles, users, authObjects, relatedApps } = detail;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Home", to: "/" },
          { label: "SAP Fiori & T-Code AI Catalog", to: "/fiori" },
          { label: app.TCode },
        ]}
        title={app.AppName || app.TCode}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/fiori")} className="gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Button
              variant="outline"
              asChild
              className="gap-1.5"
            >
              <a
                href={app.FioriLibraryUrl || "https://fioriappslibrary.hana.ondemand.com"}
                target="_blank"
                rel="noopener noreferrer"
              >
                SAP Fiori Library
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
            <Button
              onClick={handleResendToAi}
              disabled={refreshingAi}
              className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {refreshingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {app.Status === "Enriched" ? "Resend to AI" : "Send to AI"}
            </Button>
          </div>
        }
      />

      {notice && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="font-bold px-1">
            ×
          </button>
        </div>
      )}

      {/* App AI Overview Card */}
      <Card className="mb-6 p-5 border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs px-2.5 py-0.5 bg-background">
                {app.TCode}
              </Badge>
              {renderAccessBadge(app.ActionCategory)}
              {app.hasVector && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                  <Sparkles className="h-3 w-3" />
                  vector(768)
                </span>
              )}
            </div>
            <p className="text-sm text-foreground leading-relaxed">
              {app.OneLineDescription || "No AI description generated yet. Click Send to AI to analyze this app."}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border bg-background px-4 py-2">
              <div className="text-lg font-bold">{roles.length}</div>
              <div className="text-[11px] text-muted-foreground">Roles</div>
            </div>
            <div className="rounded-lg border bg-background px-4 py-2">
              <div className="text-lg font-bold">{new Set(users.map((u) => u.Uname)).size}</div>
              <div className="text-[11px] text-muted-foreground">Users</div>
            </div>
            <div className="rounded-lg border bg-background px-4 py-2">
              <div className="text-lg font-bold">{authObjects.length}</div>
              <div className="text-[11px] text-muted-foreground">Auth Objects</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Detailed Tabs */}
      <Tabs defaultValue="roles" className="space-y-4">
        <TabsList>
          <TabsTrigger value="roles" className="gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            Roles ({roles.length})
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="h-4 w-4" />
            Users ({users.length})
          </TabsTrigger>
          <TabsTrigger value="auth" className="gap-1.5">
            <KeyRound className="h-4 w-4" />
            Auth Objects ({authObjects.length})
          </TabsTrigger>
          <TabsTrigger value="similar" className="gap-1.5">
            <Layers className="h-4 w-4" />
            Related Apps ({relatedApps.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Roles */}
        <TabsContent value="roles">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-100/90 dark:bg-slate-900/90">
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>Role Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Parent Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground text-sm">
                      No roles found referencing {app.TCode}.
                    </TableCell>
                  </TableRow>
                ) : (
                  roles.map((r, i) => (
                    <TableRow key={r.AgrName} className="hover:bg-muted/50">
                      <TableCell className="text-center font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono font-medium">
                        <Link
                          to={`/roles/${encodeURIComponent(r.AgrName)}`}
                          className="text-primary hover:underline"
                        >
                          {r.AgrName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.RoleDesc || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {r.RoleType || "Single"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.ParentAgr || "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Tab 2: Users */}
        <TabsContent value="users">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-100/90 dark:bg-slate-900/90">
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Assigned via Role</TableHead>
                  <TableHead>Account Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground text-sm">
                      No user assignments found for roles using {app.TCode}.
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((u, i) => (
                    <TableRow key={`${u.Uname}-${u.AgrName}`} className="hover:bg-muted/50">
                      <TableCell className="text-center font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono font-medium">{u.Uname}</TableCell>
                      <TableCell className="text-sm">{u.FullName || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.Department || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link to={`/roles/${encodeURIComponent(u.AgrName)}`} className="text-primary hover:underline">
                          {u.AgrName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {u.Locked ? (
                          <Badge className="bg-rose-50 text-rose-700 border-rose-200">Locked</Badge>
                        ) : (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Tab 3: Authorization Objects */}
        <TabsContent value="auth">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-100/90 dark:bg-slate-900/90">
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>Auth Object</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Low Value</TableHead>
                  <TableHead>High Value</TableHead>
                  <TableHead className="text-center">Roles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {authObjects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground text-sm">
                      No authorization object entries found.
                    </TableCell>
                  </TableRow>
                ) : (
                  authObjects.map((a, i) => (
                    <TableRow key={`${a.Object}-${a.Field}-${a.Low}-${i}`} className="hover:bg-muted/50">
                      <TableCell className="text-center font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono font-medium">{a.Object}</TableCell>
                      <TableCell className="font-mono text-xs">{a.Field}</TableCell>
                      <TableCell className="font-mono text-xs">{a.Low}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{a.High || "—"}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {a.RoleCount}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Tab 4: Related Apps (pgvector) */}
        <TabsContent value="similar">
          {relatedApps.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No related apps found yet. Ensure this app has a vector embedding.
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {relatedApps.map((rel) => (
                <Card
                  key={rel.AppId}
                  onClick={() => navigate(`/fiori/detail?appId=${encodeURIComponent(rel.AppId)}`)}
                  className="p-4 cursor-pointer hover:border-indigo-400 hover:shadow-sm transition-all flex flex-col justify-between gap-2"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-primary">{rel.TCode}</span>
                      <div className="flex items-center gap-1.5">
                        {renderAccessBadge(rel.ActionCategory)}
                        <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200">
                          {(rel.similarity * 100).toFixed(0)}% Match
                        </Badge>
                      </div>
                    </div>
                    <div className="font-medium text-sm">{rel.AppName || rel.TCode}</div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{rel.OneLineDescription}</p>
                  </div>
                  <div className="text-[11px] text-muted-foreground pt-1 border-t">
                    Used in {rel.RoleCount} {rel.RoleCount === 1 ? "role" : "roles"}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

