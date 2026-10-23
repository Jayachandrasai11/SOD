import { AlertTriangle, CheckCircle2, CircleDashed, XCircle, type LucideIcon } from "lucide-react";
import type { Status } from "@/types";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<Status, { label: string; icon: LucideIcon; long: string; cls: string; solid: string }> = {
  red: {
    label: "Act now",
    long: "Critical or High SoD conflict without mitigation",
    icon: XCircle,
    cls: "bg-status-red-bg text-status-red border-status-red/30",
    solid: "bg-status-red text-white dark:text-black",
  },
  amber: {
    label: "Review",
    long: "Medium/Low conflict, mitigated conflict, or partial data",
    icon: AlertTriangle,
    cls: "bg-status-amber-bg text-status-amber border-status-amber/30",
    solid: "bg-status-amber text-white dark:text-black",
  },
  green: {
    label: "Clean",
    long: "No risks fire",
    icon: CheckCircle2,
    cls: "bg-status-green-bg text-status-green border-status-green/30",
    solid: "bg-status-green text-white dark:text-black",
  },
  grey: {
    label: "Not analysed",
    long: "No analysis yet, or data older than the staleness limit",
    icon: CircleDashed,
    cls: "bg-status-grey-bg text-status-grey border-status-grey/30",
    solid: "bg-status-grey text-white dark:text-black",
  },
};

interface Props {
  status: Status;
  size?: "sm" | "md" | "lg";
  /** Hide text visually (still announced to screen readers). Use only where a legend is adjacent. */
  iconOnly?: boolean;
  className?: string;
  suffix?: string;
}

/**
 * The single traffic-light component used everywhere. Status is always
 * conveyed by icon shape + text, never colour alone (WCAG 1.4.1).
 */
export function StatusBadge({ status, size = "md", iconOnly, className, suffix }: Props) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium",
        m.cls,
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-2.5 py-0.5 text-xs",
        size === "lg" && "px-4 py-1.5 text-base",
        className,
      )}
      title={m.long}
    >
      <Icon className={cn(size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5")} aria-hidden />
      <span className={cn(iconOnly && "sr-only")}>
        {m.label}
        {suffix ? ` ${suffix}` : ""}
      </span>
    </span>
  );
}

export function StatusLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} aria-label="Status legend">
      {(Object.keys(STATUS_META) as Status[]).map((s) => (
        <StatusBadge key={s} status={s} size="sm" />
      ))}
    </div>
  );
}
