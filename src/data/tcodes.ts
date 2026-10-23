import type { Permission, Process, Tcode } from "@/types";

const t = (tcode: string, description: string, process: Process): Tcode => ({ tcode, description, process });

export const TCODES: Tcode[] = [
  // Finance
  t("FB50", "Post G/L account document", "Finance"),
  t("F-02", "Enter G/L account posting", "Finance"),
  t("FV50", "Park G/L account document", "Finance"),
  t("FBV1", "Park accounting document", "Finance"),
  t("F-65", "Preliminary posting", "Finance"),
  t("FBV0", "Post parked document", "Finance"),
  t("FS00", "Maintain G/L account master", "Finance"),
  t("FB60", "Enter vendor invoice", "Finance"),
  t("F110", "Automatic payment run", "Finance"),
  t("F-53", "Post outgoing payment", "Finance"),
  t("F-28", "Post incoming payment", "Finance"),
  t("FK02", "Change vendor (accounting)", "Finance"),
  t("FK03", "Display vendor (accounting)", "Finance"),
  t("BP", "Maintain business partner", "Finance"),
  t("FBL1N", "Vendor line items", "Finance"),
  t("FBL3N", "G/L account line items", "Finance"),
  t("FBL5N", "Customer line items", "Finance"),
  t("FB03", "Display accounting document", "Finance"),
  t("AS01", "Create asset master", "Finance"),
  t("AS02", "Change asset master", "Finance"),
  t("AFAB", "Post depreciation run", "Finance"),
  t("FAGLB03", "Display G/L balances", "Finance"),
  t("F.01", "Financial statements", "Finance"),
  t("OB52", "Open/close posting periods", "Finance"),
  t("FF7A", "Cash position", "Finance"),
  t("FI12", "Maintain house banks", "Finance"),
  t("FD32", "Customer credit management", "Finance"),
  // Procurement
  t("ME21N", "Create purchase order", "Procurement"),
  t("ME22N", "Change purchase order", "Procurement"),
  t("ME23N", "Display purchase order", "Procurement"),
  t("ME29N", "Release purchase order", "Procurement"),
  t("ME28", "Release purchase orders (collective)", "Procurement"),
  t("ME2M", "Purchase orders by material", "Procurement"),
  t("ME31K", "Create contract", "Procurement"),
  t("ME32K", "Change contract", "Procurement"),
  t("MIRO", "Post vendor invoice", "Procurement"),
  t("MIR4", "Display invoice document", "Procurement"),
  t("MIGO", "Goods movement", "Procurement"),
  t("MB51", "Material document list", "Procurement"),
  t("MI01", "Create physical inventory document", "Procurement"),
  t("MI04", "Enter inventory count", "Procurement"),
  t("MI07", "Post inventory difference", "Procurement"),
  t("MM01", "Create material", "Procurement"),
  t("MM02", "Change material", "Procurement"),
  // Sales
  t("VA01", "Create sales order", "Sales"),
  t("VA02", "Change sales order", "Sales"),
  t("VA03", "Display sales order", "Sales"),
  t("VF01", "Create billing document", "Sales"),
  t("VF02", "Change billing document", "Sales"),
  t("VF03", "Display billing document", "Sales"),
  t("VF04", "Maintain billing due list", "Sales"),
  t("VK11", "Create condition (pricing)", "Sales"),
  t("VK12", "Change condition (pricing)", "Sales"),
  t("VL01N", "Create outbound delivery", "Sales"),
  t("VL02N", "Change outbound delivery", "Sales"),
  t("VKM1", "Release blocked sales documents", "Sales"),
  // HR
  t("PA30", "Maintain employee master data", "HR"),
  t("PA40", "Personnel actions", "HR"),
  t("PA20", "Display employee master data", "HR"),
  t("PA51", "Display time data", "HR"),
  t("PC00_M40_CALC", "Run payroll (India)", "HR"),
  t("PC00_M99_CIPE", "Post payroll results to accounting", "HR"),
  t("PT60", "Time evaluation", "HR"),
  t("CAT2", "Enter time sheet", "HR"),
  // Basis
  t("PFCG", "Maintain roles", "Basis"),
  t("SU01", "Maintain user master", "Basis"),
  t("SU10", "Mass maintenance of users", "Basis"),
  t("SU53", "Display authorisation check", "Basis"),
  t("SUIM", "User information system", "Basis"),
  t("SM37", "Job overview", "Basis"),
  t("SM21", "System log", "Basis"),
  t("SM50", "Work process overview", "Basis"),
  t("ST22", "ABAP runtime errors", "Basis"),
  t("STMS", "Transport management", "Basis"),
  t("SE01", "Transport organiser", "Basis"),
  // Fiori apps
  t("F0718", "Manage Journal Entries (Fiori)", "Finance"),
  t("F1591", "Manage Supplier Invoices (Fiori)", "Procurement"),
  t("F0842A", "Manage Purchase Orders (Fiori)", "Procurement"),
];

export const TCODE_MAP: Record<string, Tcode> = Object.fromEntries(TCODES.map((x) => [x.tcode, x]));

export const describeTcode = (tc: string) => TCODE_MAP[tc]?.description ?? "Custom transaction";

/**
 * SU24-like default authorisation proposals per transaction.
 * Used by Role Builder ("Proposed" tag) and to fabricate role auth rows.
 */
export const SU24: Record<string, Permission[]> = {
  FB50: [{ object: "F_BKPF_BUK", field: "ACTVT", low: "01" }, { object: "F_BKPF_BUK", field: "BUKRS", low: "$BUKRS" }],
  "F-02": [{ object: "F_BKPF_BUK", field: "ACTVT", low: "01" }, { object: "F_BKPF_BUK", field: "BUKRS", low: "$BUKRS" }],
  FBV0: [{ object: "F_BKPF_BUK", field: "ACTVT", low: "01" }, { object: "F_BKPF_BUK", field: "BUKRS", low: "$BUKRS" }],
  FV50: [{ object: "F_BKPF_BUK", field: "ACTVT", low: "77" }, { object: "F_BKPF_BUK", field: "BUKRS", low: "$BUKRS" }],
  FBV1: [{ object: "F_BKPF_BUK", field: "ACTVT", low: "77" }, { object: "F_BKPF_BUK", field: "BUKRS", low: "$BUKRS" }],
  "F-65": [{ object: "F_BKPF_BUK", field: "ACTVT", low: "77" }],
  FS00: [{ object: "F_SKA1_BUK", field: "ACTVT", low: "01", high: "02" }, { object: "F_SKA1_BUK", field: "BUKRS", low: "$BUKRS" }],
  FB60: [{ object: "F_BKPF_KOA", field: "KOART", low: "K" }, { object: "F_BKPF_BUK", field: "ACTVT", low: "01" }],
  MIRO: [{ object: "M_RECH_WRK", field: "ACTVT", low: "01" }, { object: "M_RECH_WRK", field: "WERKS", low: "$WERKS" }],
  F110: [{ object: "F_REGU_BUK", field: "FBTCH", low: "11", high: "21" }, { object: "F_REGU_BUK", field: "BUKRS", low: "$BUKRS" }],
  "F-53": [{ object: "F_BKPF_KOA", field: "KOART", low: "K" }, { object: "F_BKPF_BUK", field: "ACTVT", low: "01" }],
  "F-28": [{ object: "F_BKPF_KOA", field: "KOART", low: "D" }, { object: "F_BKPF_BUK", field: "ACTVT", low: "01" }],
  BP: [{ object: "B_BUPA_RLT", field: "RELTYPE", low: "FLVN01" }, { object: "B_BUPA_RLT", field: "ACTVT", low: "02" }],
  FK02: [{ object: "F_LFA1_BUK", field: "ACTVT", low: "02" }, { object: "F_LFA1_BUK", field: "BUKRS", low: "$BUKRS" }],
  ME21N: [{ object: "M_BEST_EKO", field: "ACTVT", low: "01" }, { object: "M_BEST_EKO", field: "EKORG", low: "$EKORG" }],
  ME22N: [{ object: "M_BEST_EKO", field: "ACTVT", low: "02" }, { object: "M_BEST_EKO", field: "EKORG", low: "$EKORG" }],
  ME29N: [{ object: "M_EINK_FRG", field: "FRGCO", low: "01", high: "02" }, { object: "M_EINK_FRG", field: "FRGGR", low: "Z1" }],
  ME28: [{ object: "M_EINK_FRG", field: "FRGCO", low: "01" }],
  VF01: [{ object: "V_VBRK_FKA", field: "ACTVT", low: "01" }, { object: "V_VBRK_VKO", field: "VKORG", low: "$VKORG" }],
  VA01: [{ object: "V_VBAK_AAT", field: "ACTVT", low: "01" }, { object: "V_VBAK_VKO", field: "VKORG", low: "$VKORG" }],
  PA30: [{ object: "P_ORGIN", field: "AUTHC", low: "W" }, { object: "P_ORGIN", field: "INFTY", low: "0008" }],
  PC00_M40_CALC: [{ object: "P_ABAP", field: "REPID", low: "HINCALC0" }, { object: "P_PCLX", field: "RELID", low: "RD" }],
  PFCG: [{ object: "S_USER_AGR", field: "ACTVT", low: "01", high: "02" }, { object: "S_USER_AGR", field: "ACT_GROUP", low: "*" }],
  SU01: [{ object: "S_USER_GRP", field: "ACTVT", low: "01", high: "02" }, { object: "S_USER_GRP", field: "CLASS", low: "*" }],
  SU10: [{ object: "S_USER_GRP", field: "ACTVT", low: "02" }, { object: "S_USER_GRP", field: "CLASS", low: "*" }],
  MIGO: [{ object: "M_MSEG_WMB", field: "ACTVT", low: "01" }, { object: "M_MSEG_WMB", field: "WERKS", low: "$WERKS" }],
};

/** Which org-level variables each auth object needs */
export const ORG_LEVEL_DEFS: Record<string, string> = {
  BUKRS: "Company code",
  WERKS: "Plant",
  EKORG: "Purchasing organisation",
  VKORG: "Sales organisation",
  PERSA: "Personnel area",
};
