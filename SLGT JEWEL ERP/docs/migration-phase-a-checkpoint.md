# Migration Phase A Checkpoint

**Phase:** A — Current architecture verification + backup/checkpoint  
**Date:** 2026-07-28  
**Git branch:** `migration/local-first-sqlite`  
**Status:** COMPLETE (documentation + branch checkpoint)  

---

## Purpose

Establish a recoverable baseline **before** any embedded SQLite or Branch-path removal.

## Inputs verified

| Artifact | Role |
|----------|------|
| `docs/current-architecture-audit.md` | Code-verified baseline of *current* Branch/PG/Electron state |
| `docs/offline-architecture.md` | Historical Branch-era design |
| `docs/phase-2-data-model.md` … `phase-4-billing.md` | Domain rules to preserve |
| `docs/LOCKED-ARCHITECTURE.md` | Previous shop-runtime lock (Branch Host + local PG) — **superseded as target** by `local-first-architecture.md` |

## Baseline findings (from audit — not re-inferred)

1. Shop runtime today depends on Branch Express + PostgreSQL (local or cloud URL).  
2. Electron does **not** embed Postgres/Branch; installer incomplete for “.exe only.”  
3. Billing/inventory/sequence/sync unit tests exist and were previously green.  
4. Business rules to **preserve** are listed in `local-first-architecture.md` and the audit “SAFE TO KEEP” section.  
5. Components to **eventually remove** (after gates): local PG bootstrap, NSSM Branch host, permanent active_host DB model — listed as ARCHITECTURE-SPECIFIC in the audit.

## Checkpoint actions taken

1. Created git branch `migration/local-first-sqlite` from `client-requirement` working tree.  
2. Published target architecture: `docs/local-first-architecture.md`.  
3. Published phase plan: `docs/migration-phase-plan.md`.  
4. **Did not** delete Branch/local PG code.  
5. **Did not** add SQLite runtime yet (Phase C).  
6. **Did not** switch Electron to local domain API yet (Phase B+).

## Critical tests (Phase A gate)

Re-run on this checkpoint (see commit message / CI log for exact results):

- `npm run test:sequences`  
- `npm run test:inventory`  
- `npm run test:billing`  
- `npm run test:sync`  

If any fail: **STOP** — do not start Phase B until green.

## Explicit non-goals of Phase A

- No SQLite schema  
- No removal of `bootstrapBranchPostgres.js` / `APP_MODE=branch`  
- No API surface change for production cloud path  

## Gate decision

| Criterion | Result |
|-----------|--------|
| Audit document exists and is code-based | PASS |
| Migration branch created | PASS |
| Target architecture documented | PASS |
| Old path preserved in tree | PASS |
| Critical tests green | **PASS** (sequences, inventory, billing, sync — 2026-07-28) |

## Next phase

**Phase B — Shared domain / repository abstraction**

Extract billing/inventory/tax/payment validation into a shared domain layer usable by:

- existing Sequelize/PostgreSQL repositories (cloud/branch — keep working)  
- future SQLite repositories (desktop)

Preserve existing `test:billing` / `test:inventory` by adapting imports, not discarding rules.

---

**Phase A ends here. Do not begin Phase C until Phase B checkpoint exists.**
