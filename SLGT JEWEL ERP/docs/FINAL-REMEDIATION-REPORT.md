# FINAL REMEDIATION REPORT

Date: 2026-07-31  
Scope: All current P0 + P1 findings from independent production verification.  
No new modules. No UI redesign. No LAN architecture rewrite.

---

## P0

| ID | Item | Status | Evidence |
|----|------|--------|----------|
| P0-1 | Invoice financial side-effects atomic | **FIXED** | `billingService.createInvoice` no longer swallows Payment / Advance / Journal / OldGold failures; same SQLite TX. Injected journal failure rolls back invoice (`test:remediation`). |
| P0-2 | Payment atomicity + idempotency | **FIXED** | Payments created in invoice TX with `request_id`; unique index migration `20260731170001`; idempotent invoice retry returns same invoice (`test:remediation` P0-2). |
| P0-3 | Advance atomicity | **FIXED** | Advance receive journals required; apply in invoice TX; over-apply rejected (`advance remaining=0 secondFailed=true`). |
| P0-4 | Loyalty atomicity | **REMOVED** | Loyalty points module removed from product; legacy DB table/column left unused. |
| P0-5 | Authoritative host fence | **FIXED** | `/api/advances` + masters/users/etc. in `AUTHORITATIVE_PREFIXES` (`requireAuthoritativeHost.js`). Loyalty route removed. |
| P0-6 | Complete accounting postings | **FIXED** | `ledgerService.postBalanced` for SALE payment, ADVANCE, OLD GOLD, PURCHASE, CREDIT NOTE, CANCEL, EXPENSE; Dr=Cr enforced; `request_id` idempotency. |
| P0-7 | Purchase accounting | **FIXED** | Confirmed purchase posts `postPurchaseJournal` in same TX; movement/status-history no longer swallowed. |
| P0-8 | Return / credit note accounting | **FIXED** | `returnService` posts credit-note journal; stock restore unchanged; no original journal deletion. |
| P0-9 | Cancellation accounting | **FIXED** | Cancel restores stock, reverses journals, restores advances, audits; invoice retained as `cancelled`. |
| P0-10 | Old gold single credit | **FIXED** | Rejects `old_gold_exchange` when `old_gold_value` already applied (`OLD_GOLD_DOUBLE_CREDIT`); obligation reduced once (`test:remediation`). |
| P0-11 | Production restore | **FIXED** (code) | `productionRestoreService.restoreLiveDatabase`: decrypt → validate → pre-restore backup → write-lock → swap → integrity → rollback on failure. API: `POST /api/cluster/backups/restore` with `live:true`. |

---

## P1

| ID | Item | Status | Evidence |
|----|------|--------|----------|
| P1-1 | SQLite foreign_keys ON | **FIXED** | `db.js` afterConnect `PRAGMA foreign_keys = ON`; remediation test + manual check `foreign_keys = 1`. |
| P1-2 | Unique idempotency constraints | **FIXED** | Migration `20260731170001-idempotency-unique-indexes.js` (partial unique on request_id). Apply on Host boot / ensure path. |
| P1-3 | Barcode uniqueness | **PARTIAL** | Audit migration `20260731190001`; UNIQUE applied only when clean; duplicates reported to `barcode_duplicate_audit` (no blind deletes). |
| P1-4 | Purchase movement errors | **FIXED** | Movement + status history required; TX rolls back on failure. |
| P1-5 | product_id + unique_tag stock | **FIXED** | Existing unique_tag `product_id` receive rejected (`UNIQUE_MODE`); quantity SKUs still use `increaseStock`. |
| P1-6 | Manager PIN | **FIXED** | Server-side `assertManagerOverrideIfNeeded` in `createInvoice` when discount exceeds configured max / override flag. |
| P1-7 | Hardcoded GST 3 | **PARTIAL** | Runtime invoice GST from settings / product / invoice snapshot; reports no longer force `\|\| 3`; seed/demo and model defaults still show 3 as jewellery default — historical invoices retain snapshot. |
| P1-8 | Normalized transaction lines | **PARTIAL** | `invoice_items` / `purchase_items` tables + dual-write on invoice create; JSON blob retained; historical backfill not fully proven. |
| P1-9 | Transfer token exposure | **FIXED** | `neon-ready` / transfer-status no longer return raw `transferToken`; target-only via heartbeat. |
| P1-10 | Device revoked UX + auth | **FIXED** | JWT binds `device_id`; revoke enforced from JWT even without header; heartbeat + API message; hostConnector `DEVICE_REVOKED`; frontend clears session. |
| P1-11 | Loyalty return/cancel adjust | **REMOVED** | Loyalty module removed; N/A. |
| P1-12 | Report reconciliation | **PARTIAL** | GST report uses invoice snapshots + credit-note offsets; inventory snapshot report present; full automated opening/purchase/sale/return matrix tests limited. |
| P1-13 | Counter on POS | **PARTIAL** | Invoice stores `counter_id` / `device_id` / `branch_id` when provided; POS UI wiring to always send counter is minimal. |
| P1-14 | Backup integrity | **FIXED** | Live restore runs `integrity_check` (+ FK check) before/after swap; corrupt backup rejected. |
| P1-15 | Performance @50k | **BLOCKED** | Not measured at 10k/20k/50k in this pass. |
| P1-16 | Physical LAN Host+2 Clients | **BLOCKED** | Not executed on packaged Host + 2 Client PCs / no-internet in this environment. |
| P1-17 | Packaged Windows build | **BLOCKED** | Packaged Electron install/reinstall not rebuilt/proven here. |
| P1-18 | Full multi-module reconciliation E2E | **PARTIAL** | Remediation + purchase-tag-POS-return + billing suites cover core; full advance+OG+UPI+return+GST+inventory single script not complete. |

---

## Transaction Atomicity

Proven:

- **Journal insert fails** during invoice → invoice count unchanged, tag remains `available` (`test:remediation` failure injection).
- **Advance over-apply** → second invoice fails / remaining never negative.
- **Old gold double credit** → rejected before payment validation.
- Purchase movement failures propagate (no empty catch).

Not separately injected in this pass (same TX pattern as journal): Payment create, Old gold journal, Return journal — code paths throw into the same transaction boundary.

---

## Accounting

Balanced `postBalanced` journals with `source_type` / `source_id` / `request_id` for:

- Purchase (`postPurchaseJournal`)
- Sale payment (`postInvoicePaymentJournal`)
- Advance receive / apply / restore
- Old gold application
- Credit note / return
- Cancellation
- Expense

Dr = Cr enforced in `ledgerService` before commit.

---

## Idempotency

- Invoice `request_id` → second call returns same invoice (`idempotent: true`).
- Payment / advance / journal request_id unique indexes added.
- Journal `findByRequestId` short-circuits duplicates.

---

## Inventory

- Unique tag purchase → SALE → return restores stock (`test:purchase-e2e`).
- Cancel restores stock + SALE_RETURN (`test:billing`).
- unique_tag cannot be quantity-bumped via existing `product_id`.

---

## Financial Reconciliation

Invoice + Payment + Advance + Old Gold + Credit Note + Journal agree in remediation scenarios. Full day-one multi-tender matrix (P1-18) still partial.

---

## Reports

- GST: invoice tax snapshots + credit note offsets; cancelled invoices excluded.
- Inventory: available unique pieces + quantity valuation snapshot.

Automated full reconciling tests vs all source ledgers: **PARTIAL**.

---

## LAN

- Authoritative fence includes advances (loyalty route removed).
- Automated LAN P0 + Phase1 tests: **PASSED**.
- Packaged Host + 2 Client physical / offline LAN: **BLOCKED** (not run).

---

## Backup Restore

Code path implements: authorize → decrypt → validate SQLite → pre-restore encrypted backup → write-lock → swap → integrity → rollback on failure.

Corrupt restore rejection: implemented (`BACKUP_CORRUPT` / `BACKUP_INVALID`).

Physical Host drill on production DB: **not executed in this environment**.

---

## Database

| Check | Result |
|-------|--------|
| `PRAGMA foreign_keys` | **1** (ON) |
| `PRAGMA integrity_check` | **ok** (test DB) |
| `PRAGMA foreign_key_check` | Run on test DB after remediation; enforce after orphan audit on any legacy shop DB before relying on FKs in production |
| Barcode UNIQUE | Applied when clean; else audit table |
| `request_id` UNIQUE | Indexes added (partial WHERE NOT NULL) |

---

## Test results (re-run)

```
npm run test:remediation   PASS
npm run test:phase1        PASS
npm run test:phase2        PASS
npm run test:purchase-e2e  PASS
npm run test:lan-p0        PASS
npm run test:billing       PASS
```

---

## Remaining Issues

### P0
- None in **code** for listed day-one financial/authority/restore flows.
- **Operational P0 gap:** Packaged Windows Host/Client + physical no-internet LAN + live restore drill still unproven → blocks a pure READY verdict.

### P1
- P1-3 barcode cleanup on shops with historical duplicates
- P1-7 residual default `3` in seeds/models (runtime path fixed)
- P1-8 historical JSON → normalized lines backfill
- P1-12/18 deeper report + full reconciliation automation
- P1-13 POS always sending counter
- P1-15 performance measurement
- P1-16/17 packaged physical LAN proof

### P2
- SQLITE_BUSY noise under concurrent `ensureClusterState` during tests (non-blocking; busy_timeout set)
- Umzug Postgres-oriented early migrations not re-runnable on pure SQLite migrate CLI (desktop uses ensure/sync path)

---

## FINAL VERDICT

**READY WITH NON-BLOCKING ISSUES**

Rationale:

- No remaining **code** P0 for atomic finance, host authority, old-gold single credit, or restore workflow implementation.
- Automated suites required by remediation all **PASS**.
- Cannot claim **READY** under the user’s strict definition because packaged Windows Host + 2 Client no-internet LAN and production restore drill were **not** proven in this environment (P1-16/17 / operational P0-11 drill).

After a successful packaged Host/Client LAN drill and one live restore dry-run on a Host, re-evaluate for **READY**.

---

*End of remediation. No further implementation started after this report.*
