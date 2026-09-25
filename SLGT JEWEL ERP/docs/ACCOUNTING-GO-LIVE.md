# Accounting Go-Live (Phase 1 Accrual)

Date: 2026-08-10  
Scope: Full-accrual journal engine, cutover opening balances, no Accounts/Reports UI redesign.

## Decision

**Do not replay historical transactions into full-accrual journals.**

Prior journals (where they exist) used a cash-shaped model:

- Payment → Dr Cash / Cr Sales (GST-inclusive)
- GST Payable (`2100`) unused
- COGS unused
- Expenses not journalled
- Purchase AP not cleared on payment

Operational tables also lack enough fidelity for a safe event-by-event rebuild (weak payment dates, `balance_due` not backfilled, no IGST, expenses never posted).

## Strategy

1. Run `GET /api/accounts/assessment` — reconstructability classes and counts.
2. Pick cutover date `D` (shop setting `accounting_cutover_date`).
3. Enter physical cash/bank/UPI/card counts and optional GST snapshot.
4. Call `POST /api/accounts/cutover` with those counts.
5. System posts one balanced `opening_balance` voucher (AR/AP/advances/inventory/OG from ops; cash/GST from input; plug to Opening Equity `3000`).
6. From `D` forward, all money events post **full accrual** journals.
7. Pre-`D` journals remain in the DB but are **not authoritative** for statements after cutover. Prefer `from=D` on P&L.

## Reconstructability classes

| Event | Class |
|-------|--------|
| Cash / credit sale | Partially reconstructable |
| Partial collections | Partially reconstructable |
| Advances (post-table) | Partially → Fully |
| Purchases | Partially reconstructable |
| Expenses | Fully (simple cash) — never journalled historically |
| Returns | Partially reconstructable |
| Old gold | Partially reconstructable |
| Full accrual P&L history | **Not safely reconstructable** |

Where reconstruction is not safe, **values are not invented**.

## APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/accounts/assessment` | Historical assessment |
| GET | `/api/accounts/opening-snapshot` | Ops-derived opening figures |
| POST | `/api/accounts/cutover` | Apply opening voucher + save cutover date |
| GET | `/api/accounts/integrity` | TB + AR/AP/advance control checks |
| GET | `/api/accounts/gl?account=1100` | General ledger by account |
| GET | `/api/accounts/customers/:id/ledger` | Customer ledger |
| GET | `/api/accounts/suppliers/:id/ledger` | Supplier ledger |

### Cutover body example

```json
{
  "cutover_date": "2026-08-10",
  "cash": 482500,
  "bank": 824300,
  "upi": 0,
  "card": 0,
  "output_gst": 0,
  "input_gst": 0
}
```

## Forward posting (after cutover)

- **Sale:** Dr Cash/Bank/UPI/Card + AR + Advances + Old Gold + Scheme / Cr Sales + Output GST (`2100`)
- **COGS:** Dr COGS (`5000`) / Cr Inventory (`1200`) when `purchase_price` known
- **Collect:** Dr Cash… / Cr AR
- **Purchase:** Dr Inventory + Input GST (`1400`) / Cr AP (+ cash if paid)
- **Supplier pay:** Dr AP / Cr Cash…
- **Expense:** Dr Expenses / Cr Cash…
- **Return:** Dr Sales Returns + Output GST / Cr Cash or AR; reverse COGS when cost known
- **Cancel:** append-only reverse of all invoice journals

## Chart of accounts (codes kept)

| Code | Name |
|------|------|
| 1000 | Cash |
| 1010 | Bank |
| 1020 | UPI |
| 1030 | Card |
| 1100 | Accounts Receivable |
| 1200 | Inventory |
| 1300 | Old Gold Stock |
| 1400 | Input GST |
| 2000 | Customer Advances |
| 2100 | Output GST Payable |
| 2200 | Supplier Payable |
| 2300 | Scheme Liability |
| 3000 | Opening Equity |
| 3100 | Suspense |
| 4000 | Sales |
| 4100 | Sales Returns |
| 5000 | COGS |
| 5100 | Expenses |

## Success checks after go-live

1. `GET /api/accounts/integrity` → trial balance balanced.
2. New cash sale posts `sale_invoice` with Sales + `2100`.
3. Expense create posts `expense` journal.
4. Purchase payment posts `purchase_payment` (AP clears).
5. Injected journal failure still rolls back invoice create.
