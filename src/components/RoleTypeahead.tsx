import * as React from "react";
import { Copy, Plus, Search, X } from "lucide-react";
import { db } from "@/services/db";
import type { Role } from "@/types";
import { cn } from "@/lib/utils";

export interface RoleTypeaheadProps {
  onSelect: (role: Role) => void;
  exclude?: string[];
  placeholder?: string;
  className?: string;
  id?: string;
  filterType?: "Single" | "Composite";
  icon?: "copy" | "plus" | "search";
}

export function RoleTypeahead({
  onSelect,
  exclude = [],
  placeholder = "Search role by name or description…",
  className,
  id,
  filterType,
  icon = "search",
}: RoleTypeaheadProps) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const matches = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const excludeSet = new Set(exclude);
    const list: Role[] = [];
    for (const r of db.roles) {
      if (excludeSet.has(r.name)) continue;
      if (filterType && r.type !== filterType) continue;
      if (!s) {
        list.push(r);
        if (list.length >= 15) break;
      } else if (r.name.toLowerCase().includes(s) || (r.description && r.description.toLowerCase().includes(s))) {
        list.push(r);
        if (list.length >= 15) break;
      }
    }
    return list;
  }, [q, exclude, filterType]);

  const IconComp = icon === "copy" ? Copy : icon === "plus" ? Plus : Search;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <IconComp className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        className="flex h-9 w-full rounded-lg border border-input bg-background pl-9 pr-8 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {q && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            setOpen(false);
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
          title="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-md">
          {matches.length === 0 ? (
            <div className="py-2.5 px-3 text-xs text-muted-foreground">
              No roles found matching &ldquo;{q}&rdquo;.
            </div>
          ) : (
            matches.map((r) => (
              <button
                key={r.name}
                type="button"
                className="flex w-full items-start justify-between rounded px-2.5 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                onClick={() => {
                  onSelect(r);
                  setQ("");
                  setOpen(false);
                }}
              >
                <div className="min-w-0 flex-1 mr-2">
                  <div className="font-mono font-medium truncate text-foreground">{r.name}</div>
                  {r.description && <div className="text-[11px] text-muted-foreground truncate">{r.description}</div>}
                </div>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                  {r.type}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

