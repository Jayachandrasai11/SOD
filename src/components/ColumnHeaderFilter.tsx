import * as React from "react";
import { ArrowDown, ArrowUp, Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function ColumnHeaderFilter({
  title,
  isActive,
  align = "start",
  children,
  onReset,
  sortField,
  currentSortField,
  sortOrder,
  onSort,
  hoverClassName,
}: {
  title: string;
  isActive?: boolean;
  align?: "start" | "end";
  children?: React.ReactNode;
  onReset?: () => void;
  sortField?: string;
  currentSortField?: string | null;
  sortOrder?: "asc" | "desc";
  onSort?: (field: string) => void;
  hoverClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const isSorted = !!sortField && currentSortField === sortField;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 group rounded-md px-1.5 py-0.5 -mx-1.5 transition-all duration-150",
        hoverClassName || "hover:bg-primary/10 hover:text-primary",
      )}
    >
      {sortField && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortField)}
          className={cn(
            "flex items-center gap-1 font-semibold tracking-wide uppercase text-xs transition-colors select-none text-left rounded py-0.5",
            isSorted ? "text-primary font-bold" : "text-muted-foreground group-hover:text-inherit",
          )}
          title={`Click to sort by ${title} (${isSorted ? (sortOrder === "asc" ? "Ascending → Click for Descending" : "Descending → Click to clear") : "Sort Ascending"})`}
        >
          <span className="whitespace-nowrap">{title}</span>
        </button>
      ) : (
        <span className="font-semibold tracking-wide uppercase text-xs text-muted-foreground group-hover:text-inherit transition-colors whitespace-nowrap">
          {title}
        </span>
      )}

      {children && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded transition-all",
                "hover:bg-accent hover:text-foreground text-muted-foreground/60",
                isActive && "bg-primary/15 text-primary font-medium hover:bg-primary/25 shadow-2xs",
              )}
              title={`Filter & sort ${title}`}
              aria-label={`Filter & sort ${title}`}
            >
              <Filter className={cn("h-3 w-3", isActive && "fill-primary text-primary")} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align={align}
            className="w-64 p-2.5 shadow-lg border rounded-lg bg-popover text-popover-foreground z-30 font-normal normal-case"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/70">
              <div className="flex items-center gap-1.5">
                <Filter className="h-3 w-3 text-primary" />
                <span className="text-xs font-semibold text-foreground">Filter & Sort</span>
              </div>
              {onReset && (
                <button
                  type="button"
                  onClick={() => {
                    onReset();
                    setOpen(false);
                  }}
                  className={cn(
                    "text-[11px] font-medium px-2 py-0.5 rounded transition-colors",
                    isActive
                      ? "text-primary bg-primary/10 hover:bg-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  Reset
                </button>
              )}
            </div>

            {sortField && onSort && (
              <div className="mb-2 pb-2 border-b border-border/60">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>Sort Order</span>
                  {isSorted && (
                    <button
                      type="button"
                      onClick={() => onSort(sortField)}
                      className="text-primary hover:underline lowercase font-normal"
                    >
                      toggle
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSorted || sortOrder !== "asc") onSort(sortField);
                    }}
                    className={cn(
                      "flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs transition-colors border",
                      isSorted && sortOrder === "asc"
                        ? "bg-primary/15 text-primary font-semibold border-primary/30"
                        : "hover:bg-muted text-foreground border-border/50",
                    )}
                  >
                    <ArrowUp className="h-3 w-3" />
                    <span>Ascending</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSorted || sortOrder !== "desc") onSort(sortField);
                    }}
                    className={cn(
                      "flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs transition-colors border",
                      isSorted && sortOrder === "desc"
                        ? "bg-primary/15 text-primary font-semibold border-primary/30"
                        : "hover:bg-muted text-foreground border-border/50",
                    )}
                  >
                    <ArrowDown className="h-3 w-3" />
                    <span>Descending</span>
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">{children}</div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

