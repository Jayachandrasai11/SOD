import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Lock, Plus, ShieldAlert, UserMinus, UserPlus } from "lucide-react";
import { Field } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  getCapWriteCapabilities,
  sapAssignRoleToUser,
  sapCreateRole,
  sapRemoveRoleFromUser,
  type CapWriteActionError,
  type CapWriteCapabilities,
} from "@/services/sapService";
import { cn } from "@/lib/utils";

function CapWriteStatusBanner({
  open,
  systemId,
  actionName,
  payloadPreview,
}: {
  open: boolean;
  systemId: string;
  actionName: "createRole" | "assignRoleToUser" | "removeRoleFromUser";
  payloadPreview: Record<string, string>;
}) {
  const [caps, setCaps] = React.useState<CapWriteCapabilities | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    getCapWriteCapabilities(systemId)
      .then((res) => active && setCaps(res))
      .catch(() => active && setCaps(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open, systemId]);

  return (
    <div className="space-y-2 text-xs">
      {!loading && caps && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2.5 space-y-1",
            caps.writeActionsEnabled && caps.hasRoleAdministratorScope
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
              : "border-primary/30 bg-primary/5 text-foreground"
          )}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            {caps.writeActionsEnabled && caps.hasRoleAdministratorScope ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Live SAP BTP Provisioning Active</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>Enterprise Catalog Provisioning Active</span>
              </>
            )}
          </div>
          {caps.writeActionsEnabled && caps.hasRoleAdministratorScope ? (
            <p className="text-[11px] opacity-90">
              RoleAdministrator scope verified. Action will execute directly on SAP CAP and update your governance catalog.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              OAuth token scope: <span className="font-mono font-medium text-foreground">[{caps.grantedScopes.join(", ") || "uaa.resource"}]</span>. Actions will be registered directly in your database catalog for immediate SoD and Role Analysis, and queued for BTP synchronization once RoleAdministrator scope is active.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border bg-muted/40 px-3 py-2 space-y-1">
        <div className="text-[11px] text-muted-foreground font-medium">CAP OData V4 Action Request</div>
        <div className="font-mono text-[11px] text-foreground break-all">POST /role-service/{actionName}</div>
        <pre className="font-mono text-[11px] text-muted-foreground overflow-x-auto">{JSON.stringify(payloadPreview)}</pre>
      </div>
    </div>
  );
}

function ActionErrorAlert({ error }: { error: CapWriteActionError | null }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-status-red/40 bg-status-red-bg/50 px-3 py-2.5 text-xs text-status-red flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="space-y-1 min-w-0">
        <div className="font-semibold">
          SAP CAP Error {error.status ? `(HTTP ${error.status})` : ""}
        </div>
        <p className="break-words">{error.message}</p>
      </div>
    </div>
  );
}

export function CreateSapRoleDialog({
  open,
  onOpenChange,
  systemId = "HMF-100",
  initialRole = "",
  initialDesc = "",
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  systemId?: string;
  initialRole?: string;
  initialDesc?: string;
  onSuccess?: (roleName: string) => void;
}) {
  const [role, setRole] = React.useState(initialRole);
  const [desc, setDesc] = React.useState(initialDesc);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<CapWriteActionError | null>(null);

  React.useEffect(() => {
    if (open) {
      setRole(initialRole);
      setDesc(initialDesc);
      setError(null);
    }
  }, [open, initialRole, initialDesc]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res: any = await sapCreateRole({ role, description: desc, systemId });
      const cleanRole = role.trim().toUpperCase();
      if (res?.mode === "CATALOG_PROVISIONED") {
        toast.success(`Role ${cleanRole} created in role catalog!`, {
          description: "Registered in PostgreSQL database & immediately available for analysis.",
        });
      } else {
        toast.success(`Role ${cleanRole} created in SAP CAP & catalog!`);
      }
      onSuccess?.(cleanRole);
      onOpenChange(false);
    } catch (e) {
      const err = e as CapWriteActionError;
      setError(err);
      toast.error("Create role failed", { description: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" /> Create SAP Role (CAP Write Action)
          </DialogTitle>
          <DialogDescription>
            Creates and provisions the role in the governance catalog and invokes live CAP sync when BTP RoleAdministrator scope is available.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <Field label="Role Name (AgrName)" htmlFor="cap-create-role" required hint="Uppercase SAP role name, max 30 characters (e.g. Z_FI_AP_CLERK)">
            <Input
              id="cap-create-role"
              className="font-mono"
              maxLength={30}
              value={role}
              onChange={(e) => setRole(e.target.value.toUpperCase().replace(/\s+/g, "_"))}
              placeholder="Z_TEST_ROLE"
            />
          </Field>
          <Field label="Description" htmlFor="cap-create-desc" required>
            <Input
              id="cap-create-desc"
              maxLength={80}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Role business description"
            />
          </Field>

          <CapWriteStatusBanner
            open={open}
            systemId={systemId}
            actionName="createRole"
            payloadPreview={{ Role: role.trim().toUpperCase() || "<ROLE>", Desc: desc.trim() || "<DESC>", Flag: "ROLE" }}
          />
          <ActionErrorAlert error={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !role.trim() || !desc.trim()}>
            {busy ? "Creating Role..." : "Create Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssignUserToRoleDialog({
  open,
  onOpenChange,
  systemId = "HMF-100",
  roleName,
  suggestedUsers = [],
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  systemId?: string;
  roleName: string;
  suggestedUsers?: { id: string; name: string }[];
  onSuccess?: () => void;
}) {
  const [userId, setUserId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<CapWriteActionError | null>(null);

  React.useEffect(() => {
    if (open) {
      setUserId("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sapAssignRoleToUser({ role: roleName, user: userId, systemId });
      toast.success(`Assigned ${userId.trim().toUpperCase()} to ${roleName}`);
      onSuccess?.();
      onOpenChange(false);
    } catch (e) {
      const err = e as CapWriteActionError;
      setError(err);
      toast.error("Assign role to user failed", { description: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" /> Assign User to Role
          </DialogTitle>
          <DialogDescription>
            Invokes CAP <span className="font-mono">assignRoleToUser</span> (Flag=<span className="font-mono">ASSIGN</span>) for <span className="font-mono font-semibold text-foreground">{roleName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <Field label="SAP User ID (Uname)" htmlFor="cap-assign-user" required hint="Enter SAP username (max 12 chars)">
            <Input
              id="cap-assign-user"
              list="cap-user-suggestions"
              className="font-mono"
              maxLength={12}
              value={userId}
              onChange={(e) => setUserId(e.target.value.toUpperCase().trim())}
              placeholder="e.g. JSMITH"
            />
            {suggestedUsers.length > 0 && (
              <datalist id="cap-user-suggestions">
                {suggestedUsers.slice(0, 200).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </datalist>
            )}
          </Field>

          <CapWriteStatusBanner
            open={open}
            systemId={systemId}
            actionName="assignRoleToUser"
            payloadPreview={{ Role: roleName, User: userId.trim().toUpperCase() || "<USER>", Flag: "ASSIGN" }}
          />
          <ActionErrorAlert error={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !userId.trim()}>
            {busy ? "Assigning..." : "Assign User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveUserFromRoleDialog({
  open,
  onOpenChange,
  systemId = "HMF-100",
  roleName,
  userId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  systemId?: string;
  roleName: string;
  userId: string;
  onSuccess?: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<CapWriteActionError | null>(null);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sapRemoveRoleFromUser({ role: roleName, user: userId, systemId });
      toast.success(`Removed ${userId} from ${roleName}`);
      onSuccess?.();
      onOpenChange(false);
    } catch (e) {
      const err = e as CapWriteActionError;
      setError(err);
      toast.error("Remove role assignment failed", { description: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserMinus className="h-4 w-4 text-status-red" /> Remove User Role Assignment
          </DialogTitle>
          <DialogDescription>
            Invokes CAP <span className="font-mono">removeRoleFromUser</span> (Flag=<span className="font-mono">REMOVE</span>) to revoke{" "}
            <span className="font-mono font-semibold text-foreground">{roleName}</span> from user{" "}
            <span className="font-mono font-semibold text-foreground">{userId}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <CapWriteStatusBanner
            open={open}
            systemId={systemId}
            actionName="removeRoleFromUser"
            payloadPreview={{ Role: roleName, User: userId, Flag: "REMOVE" }}
          />
          <ActionErrorAlert error={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? "Removing..." : "Remove Assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

