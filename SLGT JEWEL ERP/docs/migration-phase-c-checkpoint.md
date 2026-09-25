# Migration Phase C Checkpoint

**Phase:** C — Embedded SQLite + migrations  
**Date:** 2026-07-28  
**Branch:** `migration/local-first-sqlite`  
**Status:** COMPLETE (SQLite path introduced; POS still on Branch/PG)

---

## What was implemented

Embedded local SQLite owned by Electron main:

```
desktop/lib/db/
  sqlite.js              # open under userData/data, WAL pragmas, backup API
  migrate.js             # ordered migrations + local_schema_version
  migrations/
    001_initial_schema.js
  index.js               # initLocalDb / shutdown / status / backup

desktop/tests/desktopDb.test.js   # Electron-ABI harness
docs/sqlite-schema.md             # LOCAL_REQUIRED / LOCAL_CACHE / CLOUD_ONLY
```

**Wiring**

- `main.js`: `initLocalDb(app.getPath('userData'))` on ready; `shutdownLocalDb` on quit  
- IPC: `db:status`, `db:backup` (no raw SQL to renderer)  
- `preload.js`: `getLocalDbStatus`, `backupLocalDb`  
- Deps: `better-sqlite3`, `@electron/rebuild`; `asarUnpack` for native module  

**Pragmas:** WAL, foreign_keys ON, busy_timeout 5000, synchronous NORMAL, temp_store MEMORY.

**Schema version:** 1 (`initial_schema`) — shops, devices, users, employees, customers, products, inventory_movements, invoices/items, sequences, quotations, orders, schemes, settings, audit_events, sync_*, coordination_state, device_membership.

## What was NOT done (deferred)

- POS / billing writes to SQLite (Phase E)  
- Cloud snapshot hydration (Phase D)  
- Sync protocol (Phase F)  
- Removing Branch Host / local PostgreSQL (Phase O)  
- Production installer polish (Phase N)

## Preserve guarantee

Cloud Express + Branch/PostgreSQL remain the operational billing path. SQLite is initialized beside the existing shell only.

## Tests

```bash
cd desktop && npm run test:desktop-db
```

(Uses Electron so `better-sqlite3` ABI matches; do not run under host Node after `electron-rebuild`.)

Expected: fresh install, idempotent migrate, backup, transaction rollback — all PASS.

## Next

**Phase D — Local operational data + cloud snapshot** (hydrate LOCAL_REQUIRED without switching POS yet).

---

**Do not start Phase O cleanup.**
