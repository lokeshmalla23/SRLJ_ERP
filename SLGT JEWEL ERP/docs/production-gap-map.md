# Production Gap Map — Shop Cluster vs Current Code

**Date:** 2026-07-30 (updated)  
**Locked target:** [`LOCKED-ARCHITECTURE.md`](./LOCKED-ARCHITECTURE.md)

## Status after full-replica slice

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Full replicas (not cache) | **DONE** — snapshot bootstrap + domain event apply + local Branch as replica |
| 2 | Local service on every PC | **DONE** — `BRANCH_ROLE` host/replica from desktop config |
| 3 | TLS / device auth | **PARTIAL** — wiring + cert script; enforce in prod builds next |
| 4 | No default prod password | **DONE** — Create Owner on first launch; seed password only with `CRM_DEV_SEED` |
| 5–6 | Safer offline session | **DONE** — `offline.*` session + limited permissions; not a JWT |
| 7 | Event replication + domain apply | **DONE** — pull/apply/ACK; widen more entity emitters over time |
| 8 | Idempotency critical ops | **PARTIAL** — invoice create/void; expand refund/stock/scheme |
| 9 | CRITICAL vs NORMAL ACK | **DONE** — `/api/cluster/ack-policy` + sale ACK wait |
| 10 | Failover fencing | **DONE** — host_term + isolate confirm |
| 11 | Promote eligibility | **DONE** — `/promote-eligibility` + Shop Network UI |
| 12–13 | Stock/financial ledgers | **PARTIAL** — movements + void; credit-note model next |
| 14 | Calculation engine | **MOSTLY DONE** |
| 15 | Encrypted backups | **PARTIAL** — service + UI |
| 16 | Cashier-friendly networking | **PARTIAL** — diagnostics folded; Join still has advanced URL |

## Honest product statement

You now have a **shop cluster foundation**: identical exe, full snapshot on join, local replica service, event apply, create-owner, offline session separation, promote eligibility.

Still polish before “perfect production”: force TLS/mTLS in packaged builds, credit notes, remaining idempotent ops, SQLCipher binary, Join shop-name cards only.
