# FINAL PRODUCTION VERIFICATION REPORT

**Date:** 2026-07-31  
**Method:** Independent code audit + runnable automated tests. Prior “FIXED” claims were not trusted.  
**Environment:** Windows host, SQLite `jewellery-crm.sqlite`. Packaged Electron installer **not** rebuilt/reinstalled in this verification session.

> **Update:** Loyalty points module has since been **removed** from the product. References to loyalty earn/redeem/fence below are historical; legacy DB tables/columns may remain unused.

---

## Verdict

**NOT READY**

Core Host POS / unique-tag concurrency / invoice `request_id` idempotency are strong and test-proven.  
The **full claimed production matrix** (multi-PC money APIs, atomic financial side-effects, accounting completeness, automated restore, packaged build proof) still has **genuine P0 gaps**.

A careful **single Host PC** cash/UPI shop could operate day-to-day with known limitations, but that is **not** the same as the architecture claimed complete.

---

## Critical Workflow Matrix

| Feature | Verified | Test | Result | Evidence |
|---------|----------|------|--------|----------|
| Node Express is live backend | Code | phase2 desktop scan | PASS | `desktop/lib/backendProcess.js` spawns `src/index.js` only |
| Python/Mongo quarantined from Electron | Code + test | `test:phase2` | PASS | No desktop spawn; `server.py` banner + docs |
| DB integrity | Runtime | PRAGMA | PASS | `integrity_check=ok` |
| SQLite foreign_keys ON | Runtime | PRAGMA | **FAIL** | `foreign_keys=0` (OFF) |
| Purchase → unique tags (code) | Code | — | PARTIAL | Expands qty→N tags in TX; movement/history errors swallowed |
| Purchase → Tag → POS → Return | Auto | `test:purchase-e2e` | PASS | Sale + credit note restore |
| Server pricing authority | Code | billing tests historically | PASS | `createInvoice` uses `calcInvoiceTotals`; ignores client `grand_total` |
| Unique tag double-sale | Auto | `test:lan-p0` | PASS | Atomic status UPDATE + reserve lease |
| Qty stock double-sale | Auto | `test:lan-p0` | PASS | `WHERE stock_qty >= ?` |
| Invoice idempotency `request_id` | Auto | `test:lan-p0` | PASS | Unique index + operation ledger |
| Split payments rows | Code | — | PARTIAL | `Payment.create` in TX but errors swallowed |
| Customer advance receive/apply | Code | — | PARTIAL | FIFO + `LOCK.UPDATE`; apply failures swallowed on invoice |
| Old gold receipt | Code | — | PARTIAL | Receipt row; no journal; API can still send `old_gold_exchange` payment |
| Credit note / partial return | Code + E2E | `test:purchase-e2e` | PARTIAL | Stock restored; **no journal reverse** |
| Full cancel (separate from return) | Code | billing suite | PASS | `POST /invoices/:id/cancel` + stock restore |
| Customer 360 API | Code | — | PARTIAL | `/customers/:id/360` aggregates; UI loads it |
| Loyalty earn/redeem | Code | — | PARTIAL | Redeem guarded; earn unlocked; redeem errors swallowed on invoice |
| Minimal GL postings | Code | — | PARTIAL | Cash/Bank↔Sales; advance liability; **returns/old-gold/purchase unposted** |
| GST settings | Code | — | PARTIAL | Settings exist; many hardcoded `3` fallbacks remain |
| Reports GST/inventory | Code | — | PARTIAL | Endpoints exist; return/credit-note netting weak |
| LAN write fence (frontend) | Code | phase1 | PASS | Mutating blocked unless HOST/CONNECTED |
| Host authoritative fence | Code | — | **GAP** | `/api/advances`, `/api/loyalty` **not** in `AUTHORITATIVE_PREFIXES` |
| Rate limits | Auto | phase1 | PASS | Login/join/transfer limited |
| Soft device revoke | Code | — | PASS | Soft status + 403 `DEVICE_REVOKED` when `X-Device-Id` set |
| Watchdog | Code + phase1 | phase1 | PASS | Backoff + restart limit + health poll |
| Encrypted backup create/retention | Code | — | PARTIAL | Hourly/daily/monthly schedule; retention by tier |
| Restore live DB | Code | — | **MISSING** | Decrypt-to-path only; no live swap/stop-writes/restart |
| Packaged Electron Host+Client | — | — | **UNPROVEN** | No `desktop/dist` build in this session |
| Multi-PC physical LAN / no internet | — | — | **UNPROVEN** | Only unit/simulation tests |
| Host IP change / UDP rediscovery | Code | — | UNPROVEN runtime | Logic in `hostConnector`; not live-tested here |
| Manager PIN on POS discount | Code | — | **MISSING** | Settings PIN unused by POS |
| StockHistory dual-write | Code | — | PASS (dead) | Deprecated; movements authoritative |

---

## Remaining P0

1. **Invoice financial side-effects are not atomic.**  
   `billingService.createInvoice` wraps Payment / Advance apply / Journal / OldGoldReceipt / Loyalty redeem in empty `catch` blocks. Invoice + stock can commit while advances/journals/payments fail silently.  
   Evidence: `backend/src/services/billingService.js` (multiple `catch { /* … */ }` around money side-effects).

2. **Authoritative Host fence omits money APIs.**  
   `AUTHORITATIVE_PREFIXES` includes invoices/purchases/products/… but **not** `/api/advances` or `/api/loyalty`. A replica Node process can accept those writes if targeted.  
   Evidence: `backend/src/middleware/requireAuthoritativeHost.js` L11–27 vs routes registered in `routes/index.js`.

3. **Disaster restore is not production-complete.**  
   `restoreEncryptedBackup` only decrypts to a caller-supplied path. No automatic live-DB replace, write freeze, integrity gate, or backend restart. Corrupt-file rejection depends only on decrypt failure.  
   Evidence: `backend/src/services/encryptedBackupService.js` L116–120.

4. **Packaged Windows Host/Client with latest code was not verified.**  
   Cannot confirm installer ships watchdog / fence / Phase 2+ UI without a rebuild + install test in this session.

---

## Remaining P1

- SQLite `PRAGMA foreign_keys = 0` → application-level integrity only; orphan risk under bugs.
- `payments` / advance application `request_id` lack DB unique constraints (app-level only).
- Barcode unique index is conditional (`barcode-unique-if-safe`); may be absent if historical dupes.
- Credit notes / returns do **not** reverse journals.
- Old gold has no journal; raw API can combine `old_gold` reduction + `old_gold_exchange` payment (double-credit risk).
- Purchase path swallows `recordMovement` / status-history errors; existing `product_id` + unique_tag + `increaseStock` is incompatible.
- Manager override PIN exists in settings but POS never calls `/settings/verify-manager-pin`.
- GST still hardcoded `3` in many defaults/fallbacks despite settings.
- Invoice/purchase lines are JSON blobs (no normalized invoice_items / purchase_items tables).
- Transfer `neon-ready` can expose transfer token to privileged clients.
- `hostConnector` never sets device state `DEVICE_REVOKED` (API rejects; UX state incomplete).
- Performance at 10k/20k/50k scale **not** measured.

---

## Remaining P2

- Loyalty return/cancel point clawback.
- Full CoA reports / trial balance UI polish.
- Weekly backup tier auto-schedule (daily/monthly present; weekly manual).
- HSN master UX beyond API defaults.
- Counter selection on POS (counters saved in settings only).
- Remove/move `backend/server.py` after one release cycle.

---

## Accounting Reconciliation

**Claimed:** every sale posts balanced journals.

**Proven for cash-like invoice payments (happy path):**

| Entry | Debit | Credit |
|-------|-------|--------|
| Cash/Bank (`1000`/`1010`) | amount_paise | 0 |
| Sales (`4000`) | 0 | amount_paise |

Source: `ledgerService.postInvoicePaymentJournal` — intentionally **no GST split** (full amount to Sales).

**Advance receive:** Dr Cash/Bank, Cr Customer Advances (`2000`) — code present.

**Not proven / missing automatic postings:**

| Event | Journal |
|-------|---------|
| Purchase / supplier payable | MISSING |
| Old gold acceptance | MISSING |
| Credit note / return | MISSING |
| Invoice cancel | MISSING |
| Expense | Separate cashbook, not CoA journals |

**Debit = Credit:** only for the minimal payment/advance journal helpers when they succeed. Because those helpers are optional/`catch`-swallowed, **books can diverge from inventory/invoice reality**.

---

## Inventory Reconciliation

**Automated E2E (`test:purchase-e2e`) on live SQLite:**

| Step | Tag status / stock |
|------|--------------------|
| After simulated purchase receive | `available`, qty 1 |
| After POS sale | `sold` |
| After credit-note return | restored to sellable (`available` / qty>0) |

**LAN P0 suite:** unique tag sold once under concurrency; qty stock atomic decrement.

**Not fully proven here:** realistic 3-piece purchase with distinct weights via HTTP UI path; purchase rollback under forced mid-flight failure (TX exists, but swallowed movement errors can leave “product without movement”).

**StockHistory:** deprecated stub for legacy reads only — **not** authoritative.

---

## Financial Reconciliation

| Component | Status |
|-----------|--------|
| Invoice totals | Server recalculated — VERIFIED |
| Payments table | Written when tables exist — PARTIAL (swallowed errors) |
| Advance ledger | FIFO apply with locks — PARTIAL (swallowed on invoice) |
| Old gold | Reduces grand; receipt row — PARTIAL (no GL; double-credit API risk) |
| Credit note | Created; stock restored — PARTIAL (no GL reverse) |
| Net effect across subsystems | **Not independently reconciled** in a single scripted money+journal scenario |

---

## LAN Verification

| Scenario | Result |
|----------|--------|
| No-internet design (no `navigator.onLine` gate) | Code VERIFIED |
| 2 Clients concurrent same tag | Auto test PASS (`lan-p0`) |
| Host crash watchdog | Code + unit export PASS; live Electron kill **UNPROVEN** |
| Host IP change / discovery | Code present; runtime **UNPROVEN** |
| Revocation | Soft revoke + middleware VERIFIED; connector UX PARTIAL |
| Client write when host down | Frontend fence VERIFIED |
| Replica local money APIs | **P0 gap** (advances/loyalty not fenced) |

---

## Backup Verification

| Step | Result |
|------|--------|
| Encrypted create | Code VERIFIED |
| Tier retention counts | Code VERIFIED (`frequent:24`, `daily:14`, …) |
| Hourly + daily + monthly schedule | Code VERIFIED in `index.js` |
| Integrity of `.enc` | Decrypt path; not separately hashed |
| Restore to live DB | **NOT** implemented (decrypt to path only) |
| Corrupt backup rejected | Likely via decrypt throw; live DB untouched if dest≠live — PARTIAL |
| Pre-restore safety backup / write stop | **MISSING** |

---

## Production Build Verification

| Item | Result |
|------|--------|
| Backend deps install | VERIFIED (`npm ls` ok) |
| Frontend / desktop package.json present | VERIFIED |
| Clean install from zero | Not fully re-run here |
| `electron-builder` Windows package | **NOT TESTED** this session (`desktop/dist` absent) |
| Installed Host + Client paths (SQLite, backups, secrets) | **UNPROVEN** |

---

## Stubs / TODOs

| Item | Production impact |
|------|-------------------|
| `StockHistory` deprecated controller | Low — movements authoritative |
| UI `placeholder=` attributes | None (HTML placeholders) |
| Billing `catch` “optional until migrate” | **High** — treats money side-effects as optional |
| `server.py` still in tree | Low if never started; quarantine docs present |
| Manager PIN settings without POS enforcement | Medium — RBAC override incomplete |

No widespread `TODO/FIXME/not implemented` stubs in backend `src` beyond intentional deprecation comments.

---

## Tests executed this verification

```
npm run test:phase1     → PASS
npm run test:phase2     → PASS
npm run test:purchase-e2e → PASS
npm run test:lan-p0     → PASS
PRAGMA integrity_check  → ok
PRAGMA foreign_keys     → 0 (OFF)
```

---

## Final Answer

| Question | Answer |
|----------|--------|
| Can a real jewellery store use this tomorrow? | **Not for the full claimed multi-PC + accounting + restore product.** Single-Host core selling is close, with caveats. |
| Can it operate entirely without internet? | **Designed yes** (code). Physical no-internet multi-PC run **not proven** here. |
| Can multiple counters safely sell simultaneously? | **Unique tags / qty stock: yes (tested).** Advances/loyalty on replica fence: **not safe enough**. |
| Can the same tag be sold twice? | **No** under Host concurrency tests. |
| Can duplicate invoice retries double-charge stock/payment/accounting? | **Invoice+stock: protected by `request_id`.** Payment/journal/loyalty/advance side-effects: **not equally guaranteed**. |
| Can an advance be spent twice? | **Host FIFO+locks intended to prevent;** not covered by a dedicated concurrent test; replica fence gap remains. |
| Can an item be returned twice? | **Should reject** (`status != sold`). One successful return proven in E2E. |
| Does every sale affect inventory? | **Yes** in createInvoice inventory path (if invoice commits). |
| Does every purchase affect inventory? | **Intended yes;** movement write can be swallowed → **PARTIAL**. |
| Are payments stored as auditable records? | **When Payment.create succeeds** — PARTIAL. |
| Does accounting balance? | **Only for successful minimal payment journals** — not for returns/old gold/purchases. |
| Do GST and inventory reports reconcile? | **Not proven** against credit notes/returns netting. |
| Can a disconnected Client commit business transactions? | **Frontend fence: no** for authoritative methods when not CONNECTED/HOST. |
| Can a revoked Client continue using Host APIs? | **No if `X-Device-Id` sent;** JWT without device header can still auth until token expires. |
| Can the Host recover from backend crash? | **Watchdog designed yes;** live Electron kill test **UNPROVEN**. |
| Can backup restore recover business data? | **Only via manual decrypt+file replace** — not guided production restore. |
| Are there ANY P0 issues remaining? | **Yes** (see Remaining P0). |

---

## Bottom line

Do **not** treat the previous completion report as deployment certification.

**Ship blockers for the claimed architecture:** atomic money side-effects, authoritative fence for advances/loyalty, real restore, and packaged build proof.

**Do not implement fixes in this verification pass** — fixes require a separate, prioritized remediation plan.
