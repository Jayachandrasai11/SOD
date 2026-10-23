import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dtf = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const df = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const fmtDateTime = (iso?: string) => (iso ? dtf.format(new Date(iso)).replace(",", "") : "—");
export const fmtDate = (iso?: string) => (iso ? df.format(new Date(iso)) : "—");
export const fmtNumber = (n: number) => n.toLocaleString("en-GB");

/** "now" for the mock world – keeps staleness rules deterministic */
export const MOCK_NOW = new Date("2026-10-23T09:30:00Z");

export function relativeTime(iso: string, now = MOCK_NOW) {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  const d = Math.round(diff / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export const daysBetween = (iso: string, now = MOCK_NOW) =>
  (now.getTime() - new Date(iso).getTime()) / 86_400_000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, type = "text/plain") {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

/** Glob-style match supporting * and ?, case-insensitive (e.g. Z_FI_*) */
export function globMatch(pattern: string, value: string) {
  const p = pattern.trim();
  if (!p) return true;
  if (!/[*?]/.test(p)) return value.toLowerCase().includes(p.toLowerCase());
  const re = new RegExp(
    "^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    "i",
  );
  return re.test(value);
}

export const todayStamp = () => MOCK_NOW.toISOString().slice(0, 10);
