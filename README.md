# MySODAI – SoD workbench for SAP S/4HANA

A Segregation of Duties workbench (GRC suite) for SAP security analysts, business risk owners and auditors.
Import rules → connect S/4HANA → analyse roles → fix conflicts → export a role file.

**Stack:** React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui (Radix) · lucide-react · Recharts · SheetJS (xlsx) · ExcelJS · jsPDF · TanStack Virtual

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
```

Node 18+ required. All data is mock and in-memory; a page reload resets it.

## Project layout

```
src/
  types/            Domain model (Risk, Function, Action, Permission, Role, User, AnalysisRun…)
  data/             Mock data – ruleset (10 risks / 16 functions), 2 systems, 45 roles, 60 users, audit log, tcode catalogue + SU24 proposals
  lib/sod.ts        Pure SoD engine – used by batch analysis AND the Role Builder live check
  services/         Service layer – the ONLY place that touches data. Replace bodies with real APIs:
    db.ts             in-memory store, change subscription, useService() hook
    sapService.ts     systems, connection test, sync, roles/users snapshot   (→ OData / RFC agent)
    rulesService.ts   risks, functions, versions/diff, import wizard, Excel export
    analysisService.ts runs, role/user results, summaries, remediation hints
    roleBuilderService.ts live check, validation, export, SoD role template (download/upload)
    auditService.ts   append-only log, CSV export
    settingsService.ts traffic-light mapping, naming rules, app users
  components/
    StatusBadge.tsx   THE traffic light – icon + text, never colour alone
    common.tsx        PageHeader/breadcrumbs, LevelChip, HelpTip glossary, EmptyState, StepIndicator, ConfirmDialog, Field…
    TcodeTypeahead.tsx accessible combobox searching code + business description
    layout/AppShell   sidebar, top bar (system selector, global search Ctrl K, notifications, user/role switcher, job progress)
    ui/               shadcn/ui primitives
  pages/            Home · Rules (Library/Import/Versions) · Connections · Roles & Analysis · Role Builder · Audit Log · Settings
```

## Traffic light

| Status | Label | Rule |
|---|---|---|
| Red | Act now | Critical/High conflict, no mitigation |
| Amber | Review | Medium/Low conflict, mitigated conflict, or partial data |
| Green | Clean | No risks fire |
| Grey | Not analysed | Never analysed or older than the staleness limit (7 days) |

A role/user takes the worst status of its hits. Mapping and staleness are editable in **Settings**.

## Demo walkthrough

1. **Home** – checklist shows step 3 pending → *Run analysis*.
2. **Roles & Analysis** – filter `Z_FI_*`, open `Z_FI_AP_CLERK` → *SoD results* → click a hit for the drill-down drawer → *Fix in Role Builder*.
3. **Role Builder** – the suggested removal banner appears; remove it and watch the Live SoD check change. *Export role file* → Red roles require justification + approver.
4. **Rules → Import** – *Use a sample file* to see auto-mapping, plain-language errors (e.g. “Row 14: function MG-F-FI02 has no actions”) and import modes.
5. **Connections → Add system** – choose *RFC agent* + tier *Prod* to see a failing technical-user check with a fix hint; a host containing `fail` simulates an unreachable system.
6. Switch the demo user (avatar menu) to **Auditor** to see the read-only experience.

## Notes

- **Template data validation:** SheetJS Community Edition cannot write Excel data-validation dropdowns, so the SoD role template is *generated* with ExcelJS (dropdowns, frozen header, protected SoD_Reference sheet). SheetJS is used for everything else: parsing uploaded templates/rule files and Excel exports.
- SheetJS is installed from the official CDN tarball (`xlsx-0.20.3`), as recommended by SheetJS – the npm registry copy is outdated.
- Secrets entered in the Add system wizard are kept only in component memory, never persisted in drafts, and never shown again.
- MySODAI is read-only towards SAP: every export is a file the user uploads themselves.
