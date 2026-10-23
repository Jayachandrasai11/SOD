import * as React from "react";
import { Link } from "react-router-dom";
import { Check, ChevronRight, Info, type LucideIcon } from "lucide-react";
import type { RiskLevel } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input, Textarea } from "./ui/input";
import { Label } from "./ui/label";

// ---------------------------------------------------------------- Page header + breadcrumbs

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  crumbs: Crumb[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 space-y-3">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {crumbs.map((c, i) => (
            <li key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
              {c.to && i < crumbs.length - 1 ? (
                <Link to={c.to} className="hover:text-foreground hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={i === crumbs.length - 1 ? "page" : undefined} className={i === crumbs.length - 1 ? "text-foreground" : ""}>
                  {c.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Level chip

const LEVEL_CLS: Record<RiskLevel, string> = {
  Critical: "bg-status-red text-white dark:text-black border-transparent",
  High: "bg-status-red-bg text-status-red border-status-red/30",
  Medium: "bg-status-amber-bg text-status-amber border-status-amber/30",
  Low: "bg-muted text-muted-foreground border-border",
};

export function LevelChip({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold", LEVEL_CLS[level], className)}>
      {level}
    </span>
  );
}

// ---------------------------------------------------------------- Help tooltip

export const GLOSSARY = {
  Risk: "A risk is a combination of activities that one person should not be able to perform alone – e.g. creating a vendor and paying it. Each risk has a level and an owner.",
  Function: "A function is a business activity, such as “Pay vendors”. An SoD risk fires when one user or role can perform two conflicting functions.",
  Action: "An action is how SAP lets someone perform a function: a transaction code (e.g. F110) or a Fiori app ID.",
  Permission:
    "A permission is the authorisation check behind an action: auth object, field and value range (e.g. F_BKPF_BUK · ACTVT · 01 = create). It makes rules precise – having the transaction alone is not always enough.",
  Mitigation: "A mitigating control is a compensating check (e.g. a weekly review report) that reduces a risk you have accepted. Mitigated risks show as Review instead of Act now.",
  Snapshot: "Analysis runs on a copy of SAP role and user data taken at sync time. Results are only as fresh as the snapshot.",
  SU24: "SU24 holds SAP's default authorisation proposals per transaction. Role Builder pre-fills these as “Proposed” values for you to accept or edit.",
} as const;

export function HelpTip({ term, text, className }: { term?: keyof typeof GLOSSARY; text?: string; className?: string }) {
  const body = text ?? (term ? GLOSSARY[term] : "");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn("inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground", className)}
          aria-label={term ? `What is a ${term}?` : "More information"}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {term && <p className="mb-1 font-semibold">{term}</p>}
        {body}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- Empty state

export function EmptyState({
  icon: Icon,
  title,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center", className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">{title}</p>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- Step indicator (wizards)

export function StepIndicator({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={cn("flex w-full flex-wrap items-center gap-2", className)} aria-label="Progress">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex flex-1 items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-primary ring-4 ring-primary/15",
                !done && !active && "text-muted-foreground",
              )}
            >
              {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <span className={cn("text-sm", active ? "font-semibold" : "text-muted-foreground")}>
              {s}
              <span className="sr-only">{done ? " (completed)" : active ? " (current)" : ""}</span>
            </span>
            {i < steps.length - 1 && <span className="mx-1 hidden h-px flex-1 bg-border md:block" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- KPI tile

export function KpiTile({
  label,
  value,
  icon: Icon,
  hint,
  accent,
  to,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  hint?: React.ReactNode;
  accent?: React.ReactNode;
  to?: string;
}) {
  const inner = (
    <div className="flex h-full flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{label}</span>
        {accent ?? (Icon && <Icon className="h-4 w-4" aria-hidden />)}
      </div>
      <div className="tabular text-2xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ---------------------------------------------------------------- Run metadata

export function RunMeta({ runId, version, snapshot, className }: { runId: string; version: string; snapshot: string; className?: string }) {
  return (
    <dl className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      <div className="flex gap-1">
        <dt>Run ID</dt>
        <dd className="font-mono text-foreground">{runId}</dd>
      </div>
      <div className="flex gap-1">
        <dt>Ruleset</dt>
        <dd className="text-foreground">v{version}</dd>
      </div>
      <div className="flex gap-1">
        <dt>Snapshot</dt>
        <dd className="text-foreground">{snapshot}</dd>
      </div>
    </dl>
  );
}

// ---------------------------------------------------------------- Confirm dialog

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  typedConfirmation,
  requireReason,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** User must type this exact text to enable the button */
  typedConfirmation?: string;
  requireReason?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (!open) {
      setTyped("");
      setReason("");
    }
  }, [open]);
  const ok = (!typedConfirmation || typed === typedConfirmation) && (!requireReason || reason.trim().length >= 5);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        {requireReason && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-reason">Reason (recorded in the audit log)</Label>
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you doing this?" />
          </div>
        )}
        {typedConfirmation && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-typed">
              Type <span className="font-mono font-semibold">{typedConfirmation}</span> to confirm
            </Label>
            <Input id="confirm-typed" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!ok}
            onClick={() => {
              onConfirm(reason);
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Field wrapper

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  help,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  help?: keyof typeof GLOSSARY;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-status-red"> *</span>}
        </Label>
        {help && <HelpTip term={help} />}
      </div>
      {children}
      {error ? (
        <p className="text-xs font-medium text-status-red" role="alert" id={htmlFor ? `${htmlFor}-error` : undefined}>
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Wrapper that makes a block keyboard-actionable like a button */
export function onActivate(fn: () => void) {
  return {
    onClick: fn,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fn();
      }
    },
    tabIndex: 0,
  };
}
