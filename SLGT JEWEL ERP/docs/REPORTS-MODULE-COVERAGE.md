# Reports Module — Coverage vs Report Center Spec

Date: 2026-08-11

## Entry

Reports opens on **Report Center** (`reportCatalog.js` + category pills in `Reports.jsx`).

- **API reports** → `UnifiedReportView` (local calendar dates, KPIs, table, print/export)
- **Quick inventory reports** → quick report components
- **Workspaces** → Sales / GST / Inventory / Customers / Schemes / Purchases / More tabs

## Covered by category

| Category | Status | Notes |
|----------|--------|-------|
| Executive | Done | Overview, P&L, cash |
| Financial | Done | P&L, BS, TB, books, AR/AP, integrity |
| Sales | Done | Workspace + list/employee/counter/top/trend + sales accounts |
| Customers | Done | Workspace + list/pending/frequency/loyal/inactive/top/birthday/anniversary + AR |
| Suppliers | Done | Workspace + pending/outstanding/metal/trend + AP |
| Inventory | Done | Workspace + all quick reports |
| Jewellery | Done | Metal, hallmark (flatten), old gold, commission, rate history |
| GST | Done | Workspace + HSN/rate/monthly/liability + accounts GST + **GSTR-1/3B catalog** + collection trend |
| Expenses | Done | Expense register + P&L lines |
| Schemes | Done | Workspace + list/maturity/missed/overdue/collection + liability |

## Permissions

Feature-pack **read** reports (old gold buybook, gold rate history, metal issues list, karigar ledger) use `reports:view`. Mutating routes keep stricter modules.

## Notes

- GSTR JSON is an offline filing aid — not live GSTN submission.
- Report dates use **local** YYYY-MM-DD (IST-safe), matching Accounts.
