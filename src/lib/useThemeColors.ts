import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";

const VARS = ["--status-red", "--status-amber", "--status-green", "--status-grey", "--primary", "--muted-foreground", "--border"] as const;
type Key = "red" | "amber" | "green" | "grey" | "primary" | "muted" | "border";

/** Resolve CSS custom properties to concrete colours for SVG chart attributes (re-reads on theme change) */
export function useThemeColors(): Record<Key, string> {
  const { theme } = useApp();
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => `hsl(${cs.getPropertyValue(n).trim()})`;
    return {
      red: v(VARS[0]),
      amber: v(VARS[1]),
      green: v(VARS[2]),
      grey: v(VARS[3]),
      primary: v(VARS[4]),
      muted: v(VARS[5]),
      border: v(VARS[6]),
    };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    // wait one frame so the .dark class has been applied
    const id = requestAnimationFrame(() => setC(read()));
    return () => cancelAnimationFrame(id);
  }, [theme]);
  return c;
}
