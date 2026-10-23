import type { RiskHit } from "@/types";
import { STATUS_META } from "@/components/StatusBadge";
import { fmtDateTime } from "./utils";

/** Generate a simple evidence PDF for one risk hit (client-side, jsPDF) */
export async function exportEvidencePdf(hit: RiskHit, meta: { runId: string; version: string; snapshot: string; explanation: string; remediation?: string }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = 48;
  const line = (text: string, size = 10, bold = false, gap = 14) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const parts = doc.splitTextToSize(text, W - 96) as string[];
    parts.forEach((p) => {
      if (y > 780) {
        doc.addPage();
        y = 48;
      }
      doc.text(p, 48, y);
      y += gap;
    });
  };

  doc.setFillColor(55, 48, 163);
  doc.rect(0, 0, W, 6, "F");
  line("MySODAI – SoD evidence", 16, true, 22);
  line(`Run ID ${meta.runId} · Ruleset v${meta.version} · Snapshot ${meta.snapshot} · Generated ${fmtDateTime(new Date().toISOString())}`, 9);
  y += 8;
  line(`${hit.subjectKind}: ${hit.subject}`, 12, true, 18);
  line(`Risk ${hit.riskId} – ${hit.description}`, 11, true);
  line(`Level ${hit.level} · Type ${hit.type} · Process ${hit.process} · Status ${STATUS_META[hit.status].label}`);
  if (hit.mitigation) line(`Mitigated by ${hit.mitigation.controlId}: ${hit.mitigation.control} (valid to ${hit.mitigation.validTo})`);
  y += 6;
  line("What this means", 11, true);
  line(meta.explanation);
  y += 6;
  hit.functions.forEach((f, i) => {
    line(`Function ${String.fromCharCode(65 + i)}: ${f.functionName} (${f.functionId})`, 11, true);
    f.actions.forEach((a) => {
      line(`• ${a.description} (${a.tcode}) – granted by ${a.grantedBy.join(", ")}`);
      a.auths.forEach((p) => line(`     ${p.object} · ${p.field} = ${p.low}${p.high ? `–${p.high}` : ""}`, 9));
    });
    y += 4;
  });
  if (meta.remediation) {
    line("Suggested remediation", 11, true);
    line(meta.remediation);
  }
  doc.save(`Evidence_${hit.subject}_${hit.riskId}.pdf`);
}
