# Phase 11 — Production Hardening

**Status:** Complete — hardening APIs + guides; full 3-PC acceptance still operator-run  
**Date:** 2026-07-28

---

## 1. What changed

### End of Day

`GET /api/system/eod` — invoices, sales total, payments by mode, movements, pending/failed sync.  
**Not** a sync trigger — reconciliation only.

### Backups

`POST /api/system/backup` — `pg_dump` to `backend/.backups/` (retention 30) + recovery snapshot.  
Cloud sync ≠ backup.

### Diagnostics

`GET /api/system/diagnostics` — app/schema/device/sync (no secrets).

### Logging / security review

- Structured console logs include mode/device on startup
- Never log passwords/JWT/DB URLs in health
- Electron: contextIsolation, IPC allowlist
- Sync optional `SYNC_API_KEY`
- Recovery encryption AES-GCM
- RBAC unchanged on business routes

### Installer

`desktop/dist/JewelleryCRM-Setup.exe` (NSIS). Bundle Branch Service + Postgres in future installer revision; V1 documents separate `branch:bootstrap` + NSSM.

### Performance targets

Documented for soak: 10k products/customers, 1k pending sync — run on shop hardware before go-live.

---

## 2. Failure matrix (summary)

| Scenario | Behavior |
|----------|----------|
| Internet down at open | Local Branch + PG work |
| Internet during bill | Local commit; outbox pending |
| Cloud down all day | Pending grows; billing OK |
| Duplicate submit | `request_id` idempotent |
| Two counters same unique | One SALE wins |
| Active host crash | Controlled promote on recovery PC |
| Old host returns | Fence / rejoin client |
| Printer down | Billing still commits |
| Schema mismatch sync | 409 SCHEMA_MISMATCH |

---

## 3. Final docs

- `docs/deployment-guide.md`
- `docs/recovery-guide.md`
- `docs/support-guide.md`
- `docs/final-architecture.md`

## 4. Production-ready claim

**Not claimed** until the full 3-PC acceptance scenario in the project brief is executed on real hardware and signed off. Engine + tests for billing/inventory/sync/branch are in place; multi-PC recovery promotion must be drilled once per deployment.
