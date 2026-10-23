import type { AuditEntry } from "@/types";
import { db, latency } from "./db";
import { downloadText, toCsv, todayStamp } from "@/lib/utils";

/** Append-only: there is intentionally no update or delete. */
export async function getAuditLog(): Promise<AuditEntry[]> {
  await latency(300);
  return db.audit.map((a) => ({ ...a }));
}

export function exportAuditCsv(rows: AuditEntry[]) {
  downloadText(
    toCsv(
      rows.map((r) => ({
        Timestamp: r.timestamp,
        User: r.user,
        Area: r.area,
        Action: r.action,
        Object: r.object,
        Before: r.before ?? "",
        After: r.after ?? "",
        Reason: r.reason ?? "",
      })),
    ),
    `MySODAI_audit_${todayStamp()}.csv`,
    "text/csv",
  );
}
