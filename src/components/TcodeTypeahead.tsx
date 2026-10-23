import * as React from "react";
import { Plus, Search } from "lucide-react";
import { TCODES } from "@/data/tcodes";
import type { Tcode } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Accessible combobox for transaction codes / Fiori app IDs.
 * Searches by code and business description: "post vendor" finds MIRO / FB60.
 */
export function TcodeTypeahead({
  onSelect,
  exclude = [],
  placeholder = "Add transaction – type a code or what it does…",
  className,
  id,
}: {
  onSelect: (t: Tcode) => void;
  exclude?: string[];
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = React.useId();

  const matches = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return TCODES.filter((t) => !exclude.includes(t.tcode) && (t.tcode.toLowerCase().includes(s) || t.description.toLowerCase().includes(s))).slice(0, 8);
  }, [q, exclude]);

  const pick = (t: Tcode) => {
    onSelect(t);
    setQ("");
    setOpen(false);
    setActive(0);
  };

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id={id}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].tcode}` : undefined}
        className="flex h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && matches[active]) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-md">
          {matches.map((t, i) => (
            <li
              key={t.tcode}
              id={`${listId}-${t.tcode}`}
              role="option"
              aria-selected={i === active}
              className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm", i === active && "bg-accent text-accent-foreground")}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(t);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>
                {t.description} <span className="font-mono text-xs text-muted-foreground">({t.tcode})</span>
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {t.process}
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
