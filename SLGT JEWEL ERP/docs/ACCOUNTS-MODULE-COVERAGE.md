# Accounts Module — Coverage vs Specification

Date: 2026-08-11

## Covered (production-ready / integrated)

| Spec area | Status | How |
|-----------|--------|-----|
| Accounting transaction engine (accrual) | Done | `ledgerService.js` |
| Chart of Accounts | Done | System CoA + Statements vouchers |
| Journal entries (balanced) | Done | Manual vouchers + auto journals |
| P&L / Balance Sheet / Trial Balance | Done | Statements sub-tabs |
| Customer / Vendor ledger | Done | Party ledger panels |
| Dashboard KPIs | Done | Overview → Dashboard |
| Sales / Purchase Accounts | Done | Registers |
| Receivables / Payables ageing | Done | As-of date filter |
| Cash / Bank Book | Done | GL 1000 / 1010–1030 |
| Receipts / Payments registers | Done | From payments + advances |
| Expenses + categories | Done | CRUD + date/category/mode filters + GL |
| Scheme Accounts | Done | Liability register |
| GST / Tax | Done | Liability summary |
| Gold / Metal | Done | Stock + old gold |
| Day Closing / Pure Metal Daily | Done | Ops tabs |
| Day Book / Audit Trail | Done | Journals + audit_events |
| Integrity / cutover | Done | KPIs + **warnings table** + cutover |
| Bank accounts + reconciliation | Done | Named banks + mark matched |
| Employee Sales | Done | Sales & receivables → Employee Sales |
| Print / CSV / Excel | Done | Filter bar exports |
| Permissions | Done | Module-level `accounts` |
| Duplicate expense refs | Done | UPI / bank / bank_transfer / cheque |

## Nav groups → tabs (all wired)

1. Overview → Dashboard  
2. Daily ops → Day Closing, Pure Metal Daily, Day Book  
3. Sales & receivables → Sales Accounts, Customer Receivables, Receipts, Customer Ledger, **Employee Sales**  
4. Purchases & payables → Purchase Accounts, Vendor Payables, Payments, Vendor Ledger, Expenses  
5. Cash & bank → Cash Book, Bank Book, Bank Reconciliation  
6. Metal, schemes & tax → Gold/Metal, Scheme Accounts, GST/Tax  
7. Statements & control → P&L/BS/TB/Vouchers, Audit Trail, Integrity/Cutover  

## Intentionally not duplicated

- Invoice create / collect payment (POS)  
- Reports GST HSN detail (Reports module)  
- Live GSTN filing (offline JSON only in Reports)  
