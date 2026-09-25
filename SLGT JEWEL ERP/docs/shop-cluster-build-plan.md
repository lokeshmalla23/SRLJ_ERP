# Shop Cluster Build Plan

**Locked target:** [`docs/LOCKED-ARCHITECTURE.md`](./LOCKED-ARCHITECTURE.md)  
**Security:** [`docs/shop-security-architecture.md`](./shop-security-architecture.md)  
**Date:** 2026-07-30

Goal: move from today’s mixed Neon + SQLite/branch stack to **one active host + full replicas + LAN event replication**, with cloud optional for backups only.

---

## Implementation status

| Phase | Status |
|-------|--------|
| 0 Lock docs | Done |
| 1 Cluster identity + write fence | Done |
| 2 Durable event log + operation ledger | Done (invoice wired; expand void/stock/scheme next) |
| 3 LAN replica pull/apply/ACK | Done (event store catch-up; full domain row-apply progressive) |
| 4 Critical replica ACK on sales | Done |
| 5 Shop Network UI + promote | Done |
| 6 Encrypted versioned backups | Done |
| 7 Security baseline | Done (SQLCipher binary + mTLS pairing UX polish remaining) |

---

## Remaining polish

1. Progressive domain apply of all entity payloads on replicas (beyond event_log store)
2. Wire void/payment/stock/scheme to event log the same way as invoices
3. Production SQLCipher build of `better-sqlite3` (OS key already provisioned; BitLocker required until then)
4. Pairing flow that issues per-device mTLS certs in UI (`npm run certs:generate` exists)
5. Run `npm run migrate` on Postgres/Neon so `operation_ledger` / `event_log` / `cluster_state` exist

---

## Suggested first coding slice (historical)

**Phase 1** — cluster metadata + write-fence — completed.
