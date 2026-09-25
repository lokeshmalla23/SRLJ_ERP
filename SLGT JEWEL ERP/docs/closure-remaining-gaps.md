# Closure — Remaining Gaps Addressed

**Date:** 2026-07-28

## Closed in this pass

| Gap | Resolution |
|-----|------------|
| Invoice cancel/void | `POST /api/invoices/:id/cancel` — preserves number, SALE_RETURN, outbox event |
| Sync pull empty | `syncPull.js` — settings/users/employees incremental; financial still push-only |
| Join UX | Desktop first-launch: LAN scan + pairing code register |
| System Health UI | Settings → System Health (DB, cloud, sync, recovery, EOD, backup, pairing) |
| Acceptance suite | `npm run test:acceptance` — multi-client concurrency, unique race, idempotency, sync exactly-once, cancel, promote |
| Architecture lock | `docs/LOCKED-ARCHITECTURE.md` — single Branch authority + AWS sync |
| Dual-active write fence | `requireAuthoritativeHost` middleware rejects money/stock writes when superseded |
| Isolated client billing | POS hard-disables checkout when Branch health/`billing_allowed` fails |

## Still cannot be “perfect” in software alone

| Item | Why |
|------|-----|
| Code-signed Setup.exe | Needs your Authenticode certificate |
| Physical 3-PC shop drill | Needs 3 Windows PCs + real NIC offline tests |
| SmartScreen reputation | Builds with signing + install base over time |
| `audit_events` archive | Next implementation slice |
| Cash till sessions | EOD exists; drawer open/close/variance UX still thin |

## Commands

```bash
cd backend
npm run test:billing
npm run test:sync
npm run test:acceptance
npm run smoke:branch   # Branch Service must be running
```
