# Migration Phase B Checkpoint

**Phase:** B — Shared domain / repository abstraction  
**Date:** 2026-07-28  
**Branch:** `migration/local-first-sqlite`  
**Status:** COMPLETE (abstraction introduced; PG path preserved)

---

## What was implemented

Created DB-agnostic shared domain package:

```
shared/
  package.json          (@crm/domain)
  domain/
    money.js            # decimal HALF_UP money helpers
    billingCalc.js      # line/invoice totals, payments validation
    inventory.js        # inventory modes, movements, unique statuses
    index.js
```

**Compatibility shims (old import paths still work):**

| Old path | Now |
|----------|-----|
| `backend/src/utils/money.js` | re-exports `shared/domain/money.js` |
| `backend/src/services/billingCalc.js` | re-exports `shared/domain/billingCalc.js` |
| `backend/src/constants/inventory.js` | re-exports `shared/domain/inventory.js` |
| `frontend/src/lib/money.js` | re-exports `@crm/domain/money` |
| `frontend/src/lib/billingCalc.js` | re-exports shared + `softDiscount` for POS preview |

Vite alias: `@crm/domain` → `../shared/domain`.

## What was NOT done (deferred)

- SQLite repositories (Phase C+)  
- Removing Branch/PG runtime  
- Extracting full `inventoryService` / `billingService` transaction orchestration (still Sequelize-bound; pure calc is shared)  
- Electron IPC domain API  

## Preserve guarantee

Cloud/Branch Express + PostgreSQL + existing Sequelize services remain the operational path.

## Tests

- `test:sequences` / `test:inventory` / `test:billing` — must stay green after re-export.

## Next

**Phase C — Embedded SQLite + migrations** (Electron main ownership; no renderer SQL).

---

**Do not start Phase O cleanup.**
