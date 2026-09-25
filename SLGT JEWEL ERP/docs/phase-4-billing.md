# Phase 4 — Billing Correctness

**Status:** Complete — gate passed  
**Date:** 2026-07-28  
**Schema version:** 4

---

## 1. What changed

### Central billing service

Authoritative sale path lives in `backend/src/services/billingService.js`:

- Product validation + stock locks (deterministic product ID order)
- Server-side jewellery line calc + GST + totals (`billingCalc.js` + `money.js`)
- Payment validation
- Invoice number allocation (`invoice_sequences`)
- Invoice + item snapshots + payments
- Inventory SALE via `applySaleLine`
- Quotation → invoice through the **same** `createInvoice` pipeline
- Purchase stock reconcile / reverse with compensating movements
- Request-level idempotency (`request_id` UUID)

Controllers (`invoices.js`, `quotations.js` convert, `purchases.js` stock paths) call the service; they do not trust client money totals.

### Monetary precision

| Concern | Rule |
|---------|------|
| Currency precision | 2 decimal places (paise) |
| Library | `decimal.js` — no authoritative float math |
| Line rounding | HALF_UP to 2 dp per line amount |
| GST | 3% default on taxable (after discount); CGST/SGST = half each (1.5% / 1.5%) |
| Invoice rounding | Totals via Decimal; stored as NUMERIC |
| Payment comparison | Full payment within ₹0.50 tolerance |

Frontend POS still previews totals; checkout sends `product_id`-centric lines + `request_id`. **Server response is authoritative** for print/persist.

### GST snapshots

Invoice stores `gst_pct`, `gst_amount`, `cgst_amount`, `sgst_amount`. Line snapshots include taxable value, GST rate, CGST/SGST, line total. Historical renders use snapshots, not live product/settings.

### Invoice transaction

```
BEGIN
  auth (route) → resolve shop
  validate customer/products
  lock inventory rows (sorted IDs)
  validate stock / unique availability
  calculate lines + taxes + totals
  validate payments
  allocate invoice number
  create invoice + items + payments
  apply SALE movements / stock
COMMIT
```

Failure → ROLLBACK. Success only after COMMIT.

### Concurrency

- Quantity: row locks + stock check prevent oversell (stock=1 → only one of two concurrent sales succeeds).
- Unique-tag: Phase 3 conditional status UPDATE; only one sale succeeds.
- Invoice numbers: sequence allocator under lock.
- Idempotency: unique partial index on `request_id`; retries return the same invoice.

### Quotation conversion

`convertQuotation` → marks converted → `createInvoice` (same pipeline). Second convert → `QUOTATION_ALREADY_CONVERTED`. Idempotent key `quote-convert-{id}`.

### Purchase correction

Updates/deletes use compensating movements (`reconcilePurchaseStock` / `reversePurchaseStock`). Historical movements are not deleted.

### Invoice cancellation

Cancel columns added (`cancelled_at`, `cancelled_by`, `cancel_reason`, status). **Cancel API/UI not shipped in Phase 4** — deferred; do not reuse invoice numbers when implemented.

---

## 2. Migrations

| Migration | Purpose |
|-----------|---------|
| `20260728160001-billing-invoice-columns.js` | `discount_type`, `cgst_amount`, `sgst_amount`, `old_gold_value`, `gold_rate`, `request_id` (+ partial unique), `created_by`, cancel fields; money columns NUMERIC; `schema_meta` → 4 |

---

## 3. Architecture decisions

1. **Backend owns money** — client totals ignored for persistence.
2. **Reuse inventory service** — no parallel stock path for sales.
3. **JSONB item snapshots** — preserve name, barcode, HSN, purity, weights, rate, making/stone, discount, tax, line total.
4. **Empty invoices rejected** unless business later opts in.
5. **No customer credit ledger** yet — partial pay only within existing payment validation rules.
6. **Cancel deferred** — columns ready; no void API until Phase 11 hardening if needed.

---

## 4. Tests

```bash
cd backend && npm run test:billing
```

**Result:** `ALL BILLING TESTS PASSED`

Covered:

| Area | Covered |
|------|---------|
| Normal quantity sale + SALE movement | Yes |
| Insufficient stock | Yes |
| Quantity concurrency (stock 1) | Yes |
| Unique-tag sale + concurrency | Yes |
| GST / totals / ignore client manipulation | Yes |
| Split / negative / bad mode / underpay | Yes |
| Empty invoice + over-discount | Yes |
| Idempotent retry | Yes |
| Quotation convert + duplicate | Yes |
| Invoice snapshot after product rename | Yes |

Note: transient Sequelize rollback warning during unique concurrency stress was observed; assertions still passed.

Scripts:

- `npm run test:billing`
- `npm run audit:billing` → `docs/billing-audit.json`

---

## 5. Audit results

### Billing (`docs/billing-audit.json`)

| Check | Result |
|-------|--------|
| Invoices checked | 41 |
| Duplicate invoice numbers | 0 |
| Orphan SALE movements | 0 |
| Negative stock | 0 |
| Unique-tag inconsistencies | 0 |
| Post-ledger invoices missing SALE | 0 |
| Empty-item invoices | 1 (legacy `AUR-260728-0001` — pre Phase 4; not blocking) |

Exit code 0 (critical checks clean).

### Inventory (`npm run audit:inventory`)

| Check | Result |
|-------|--------|
| Products | 42 balanced / 0 mismatched |
| Unique-tag violations | 0 |

### POS gate

Existing POS checkout path uses `billingService` + `request_id`. Server response drives invoice print data.

---

## 6. Known issues / leftovers

1. One legacy empty-item invoice remains in DB (pre Phase 4).
2. Invoice cancel/void API not implemented (columns only).
3. Cross-shop / RBAC covered at route middleware; dedicated billing unit cases for foreign `shop_id` product not expanded in `test:billing` (inventory service already enforces `CROSS_SHOP`).
4. Sale-return UI still deferred (ledger type exists from Phase 3).
5. Unique-concurrency stress can log a connection-kill warning under Neon SSL — worth watching under local PG in Phase 5.

---

## 7. Next-phase dependencies

Phase 5 (Branch Service) can proceed:

- Billing + inventory correctness are server-side and portable with the Express app.
- Local PostgreSQL will run the same migrations (`schema_version` 4).
- Outbox events for sync (Phase 8) should wrap the same billing TX later — **do not fork billing logic**.

---

## PHASE 4 GATE

| Gate | Status |
|------|--------|
| Billing tests pass | Pass |
| Inventory audit still passes | Pass |
| Existing POS uses authoritative billing | Pass |

**Checkpoint:** Proceed to Phase 5.
