# Production readiness report — Phase 1 + Phase 2+ foundations

**Date:** 2026-07-31  
**Stack:** Electron + Node Express + SQLite (Python/Mongo quarantined)

## Phase 1 — LAN stability & security

| Item | Status |
|------|--------|
| 1.1 Backend crash watchdog | FIXED |
| 1.2 Rate limits (login/join/register/pairing/transfer) | FIXED |
| 1.3 Host write fence + LAN status normalization | FIXED |
| 1.4 Soft device revoke + Settings UI | FIXED |
| 1.5 Authenticated LAN secret adopt | FIXED |
| 1.6 Bootstrap token via headers + device bind | FIXED |
| 1.7 Faster host keepalive / reconnect | FIXED |
| Phase 1 tests (`lanPhase1`) | PASS |

LAN P0 hardening remains preserved (export tokens, atomic stock, shop HMAC, request_id, unique reservation, offline IPC).

## Phase 2+ — foundations landed (PARTIAL → FIXED where scoped)

| Area | Status | Notes |
|------|--------|-------|
| Money / weight helpers | FIXED | `shared/domain/money.js` paise + mg |
| Payments table + billing dual-write | FIXED | Rows + optional GL journals |
| Customer advances API/UI | FIXED | Receive / balance / apply on POS |
| Loyalty transactions | **REMOVED** | Not a product feature; legacy DB assets unused |
| Product status history (tag lifecycle) | FIXED | Reserve / sell / purchase receive |
| Purchase → Product/tag create | FIXED | Finished goods without `product_id` |
| Invoice GST % / payment modes settings | FIXED | Settings → Billing; POS reads |
| Shop counters master | FIXED | Settings → Billing |
| Minimal CoA + journals | PARTIAL | Cash/Bank/Sales/Advances seeded; posting on payment/advance |
| Invoice cancel from POS | FIXED | Uses existing cancel API |
| Encrypted backup restore UI | FIXED | Settings → Backup restore drill |
| Audit viewer | FIXED | Settings → Audit list + verify |
| Snapshot includes new tables | FIXED | payments/advances/history/GL/counters (legacy loyalty table unused) |
| Branch config (single shop) | FIXED | Existing `branchConfig` + counters |
| Legacy Python quarantine | FIXED | Doc + desktop spawn scan in tests |
| Partial returns / credit notes | PARTIAL | Full cancel only |
| Full GL reports / multi-branch | DEFERRED | Config-first single shop |
| FLOAT→DECIMAL mass migration | PARTIAL | New money in paise; gradual invoice FLOAT |

## Tests to run

```bash
cd backend
node tests/lanPhase1.test.js
node tests/phase2Plus.test.js
npm run test:lan-p0
npm run test:billing
```

## Residuals (documented, not blocking Phase 1 exit)

1. Partial return / credit-note entity still missing (cancel restores stock).
2. Old-gold first-class receipt entity remain thin.
3. Invoice/purchase FLOAT money columns migrate gradually with backups.
4. Packaged installer must be rebuilt to pick up desktop watchdog + UI.

## Architecture preserved

Physical jewellery remains **Product + `inventory_mode=unique_tag`** — no parallel Tag table. Host is sole writer; clients use LAN API.
