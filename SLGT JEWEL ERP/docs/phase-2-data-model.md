# Phase 2 — Migrations + Core Data Model

**Status:** Complete — awaiting review before Phase 3  
**Date:** 2026-07-28  
**Scope:** Database foundation only. No Electron, sync workers, recovery, Branch Service packaging, inventory ledger, or billing rewrite beyond invoice sequence allocation.

---

## Summary

Phase 2 introduces versioned Umzug migrations, a real `shops` table with `shop_id` backfill, devices/sync/sequence schema, selective audit metadata, canonical RBAC permission persistence, schema versioning, and concurrency-safe invoice number allocation — while keeping the existing Express API and React CRM usable.

---

## Migrations added

Located in `backend/src/migrations/`. Runner: `backend/src/migrate.js` (Umzug + `sequelize_meta` table).

| Migration | Purpose |
|-----------|---------|
| `20260728120001-create-schema-meta-and-shops.js` | `schema_meta`, `shops`; set schema version |
| `20260728120002-create-devices.js` | `devices` registry |
| `20260728120003-create-invoice-sequences.js` | `invoice_sequences` |
| `20260728120004-create-sync-tables.js` | `sync_outbox`, `sync_processed_events`, `sync_state` |
| `20260728120005-add-shop-id-and-audit-columns.js` | Additive columns on existing tables + `products.inventory_mode` |
| `20260728120006-backfill-shop-and-sequences.js` | Create default shop from `settings.company`; backfill `shop_id`; seed sequences from existing invoices |
| `20260728120007-shop-id-not-null.js` | `ALTER … SET NOT NULL` where no nulls remain |
| `20260728120008-normalize-permissions.js` | Canonical object-form permissions for all users |
| `20260728120009-barcode-unique-if-safe.js` | Partial unique index `(shop_id, barcode)` if no duplicates |

**Commands:**

```bash
cd backend
npm run migrate          # up
npm run migrate:down     # revert last
```

**Bootstrap (`src/index.js`):**

1. `sequelize.sync({ alter: false })` — create missing base tables on fresh DBs only  
2. Optional `DB_SYNC_ALTER=true` (dev only — warned)  
3. `runMigrations()` — production schema evolution path  
4. `seedDatabase()`

Production must **not** rely on `sync({ alter })`.

---

## Tables added

### `shops`
Stable shop identity (V1 single shop).

| Column | Notes |
|--------|--------|
| id | UUID string PK |
| name, code, gstin, phone, email, address | From company settings where available |
| invoice_prefix | Used by sequence allocator |
| status | default `active` |
| settings | JSONB |
| created_at / updated_at | |

### `devices`
Future desktop registration (no election/recovery logic yet).

| Column | Notes |
|--------|--------|
| id | UUID |
| shop_id | required |
| device_name | |
| device_identifier | unique per shop |
| role | `active_host` \| `recovery` \| `client` (default `client`) |
| status | `pending` \| `active` \| `revoked` \| `offline` |
| last_seen_at, meta | |
| created_at / updated_at | |

Indexes: `(shop_id, device_identifier)` unique; `(shop_id, role)`; `(shop_id, status)`.

### `invoice_sequences`
Concurrency-safe daily counters.

| Column | Notes |
|--------|--------|
| shop_id | |
| sequence_date | `YYYYMMDD` |
| prefix | e.g. `SSJ` / `AUR` |
| next_value | next integer to allocate |
| Unique | `(shop_id, sequence_date, prefix)` |

Allocation: `INSERT … ON CONFLICT DO NOTHING` then `UPDATE … RETURNING next_value - 1` inside the caller transaction. Format retained: `{prefix}-{YYMMDD}-{####}`.

### Sync metadata (schema only — no workers)

**`sync_outbox`** — event_id (UUID unique), shop_id, origin_device_id, entity_type, entity_id, operation, payload, status, attempt_count, last_error, synced_at, timestamps.  
Indexes for pending processing: `(shop_id, status, created_at)`, `(status, attempt_count)`, `(entity_type, entity_id)`.

**`sync_processed_events`** — event_id PK (idempotency), shop_id, entity refs, processed_at, result.

**`sync_state`** — per shop/device/direction cursors.

### `schema_meta`
Key/value store. Key `schema_version` → `{ version: 2, phase: 2 }`. Constant: `SCHEMA_VERSION = 2` in `src/config/schemaVersion.js`.

### `barcode_duplicate_audit`
Created only if duplicates are found during migration 009 (not created in this environment).

---

## Columns added (existing tables)

### `shop_id` (then NOT NULL after backfill)
users, settings, categories, attributes, catalog_items, products, customers, invoices, quotations, orders, schemes, scheme_plans, vendors, purchases, stock_history, inventory_adjustments, barcode_templates, employees, expenses, expense_categories, daily_closings, campaigns, campaign_messages, notifications.

### Audit / version (mutable synced entities)
`version` (default 1), `deleted_at`, `origin_device_id` on:  
users, products, customers, vendors, schemes, scheme_plans, quotations, orders, purchases, categories, attributes, catalog_items, employees, barcode_templates, settings.

### Origin only
`origin_device_id` on: invoices, expenses, daily_closings, stock_history, inventory_adjustments, campaigns, campaign_messages, notifications.

### Products
`inventory_mode` — default `'quantity'`. Preparatory for Phase 3 unique-tag model (`unique_tag`). **No sell-once enforcement in Phase 2.**

---

## Indexes / constraints

| Name | Definition |
|------|------------|
| `devices_shop_id_device_identifier_uk` | UNIQUE (shop_id, device_identifier) |
| `invoice_sequences_shop_date_prefix_uk` | UNIQUE (shop_id, sequence_date, prefix) |
| `sync_outbox_*` | pending-work indexes (see above) |
| `sync_state_shop_device_direction_uk` | UNIQUE (shop_id, device_id, direction) |
| `products_shop_id_barcode_uk` | UNIQUE (shop_id, barcode) WHERE barcode present — **applied** (no duplicates) |
| `*_shop_id_idx` | Non-unique shop filters on key tables |

---

## Existing-data backfill

1. Default shop created from `settings` key `company` (name, gstin, phone, email, address, prefix).  
2. All scoped rows updated `shop_id = default shop` where null.  
3. `settings.company.value.shop_id` set for reference.  
4. `invoice_sequences` seeded from max existing `invoice_no` matching `PREFIX-YYMMDD-####` so new numbers do not collide.  
5. User permissions rewritten to canonical object form.

**Verified on current DB:**

| Metric | Value |
|--------|--------|
| Shop | Sri Srinivasa Jewellers (`e6a0fe23-…`) |
| Users / products / customers / invoices | 2 / 42 / 22 / 40 |
| Products with null shop_id | 0 |
| Schema version | 2 |

---

## Compatibility decisions

| Topic | Decision |
|-------|----------|
| Local/cloud DB | PostgreSQL both; `DB_SSL` / host detection for SSL |
| Backend reuse | Same Express app; `APP_MODE=cloud\|branch` config stub (`src/config/appMode.js`) |
| API contracts | Existing `/api/*` preserved; `/api/health` adds `app_mode`, `schema_version` |
| Invoice format | Unchanged `PREFIX-YYMMDD-####`; generator replaced |
| Fresh DB | `sync({ alter:false })` + idempotent migrations (`IF NOT EXISTS` / table checks) |
| Creates without shop_id | Sequelize `beforeCreate` hooks auto-fill default shop (`services/defaultShop.js`) |
| Multi-branch | Not implemented; no `branch_id` UX |
| Sync / recovery / Electron | Schema only / deferred |

---

## Duplicate barcode findings

Audit script: `npm run audit:barcodes` → `docs/barcode-duplicate-audit.json`

```json
{
  "duplicate_groups": 0,
  "conflicts": [],
  "unique_constraint_safe": true
}
```

Partial unique index **was applied**. No barcodes were modified or deleted.

---

## Permission normalization

**Canonical persisted shape:** `{ [module]: { [action]: boolean } }`

| Layer | Behavior |
|-------|----------|
| Migration 008 + `npm run normalize:permissions` | Rewrite stored JSONB |
| `src/permissions.js` | Shared normalize / hasPermission |
| Auth middleware + login | Always return canonical shape |
| Users create/update | Normalize on write |
| Frontend `lib/permissions.js` | `hasPermission` accepts object or legacy arrays |
| Settings UI | Edits as arrays; saves via `actionArraysToPermissionsObject` |

---

## Code touchpoints

| Area | Path |
|------|------|
| Migrations | `backend/src/migrations/` |
| Migrator | `backend/src/migrate.js` |
| Sequence service | `backend/src/services/invoiceSequence.js` |
| Invoice/quotation create | uses `allocateInvoiceNumber` inside TX |
| Models | Shop, Device, InvoiceSequence, Sync*, SchemaMeta + audit fields |
| SSL / DB | `backend/src/db.js` |
| Bootstrap | `backend/src/index.js` |

---

## Tests performed

| Test | Result |
|------|--------|
| `npm run migrate` (9 migrations) | Pass |
| Existing row counts intact | Pass (users/products/customers/invoices) |
| Backend starts (`APP_MODE=cloud`, schema_version=2) | Pass |
| `GET /api/health` | Pass |
| Login + RBAC (`shop_owner`, `pos.create`) | Pass |
| `GET /api/products`, `/customers`, `/invoices` | Pass (42 / 22 / 40) |
| `POST /api/invoices` (empty cart smoke) | Pass — `AUR-260728-0001` with `shop_id` |
| `npm run test:sequences` (40 parallel allocations) | **PASS** — 40 unique numbers |
| `npm run audit:barcodes` | 0 duplicates; constraint safe |
| Default shop backfill | Pass |

---

## Unresolved risks / follow-ups for later phases

1. **Unique-tag sell-once** not enforced yet (`inventory_mode` preparatory only) — Phase 3.  
2. **POS still lacks row locks / stock history / server-side GST** — Phase 4.  
3. **Quotation convert** still does not decrement stock — Phase 4.  
4. **Shop invoice_prefix** may still reflect legacy `AUR` from company settings; rename in settings if desired (non-blocking).  
5. **Composite uniques** for `(shop_id, email)`, `(shop_id, invoice_no)`, `(shop_id, date)` deferred while V1 is single-shop.  
6. **Sync outbox** is not written by business transactions yet — Phase 8.  
7. **`DB_SYNC_ALTER`** remains available for local experiments; must stay off in production.  
8. Some migrations take minutes on remote Neon (many `ADD COLUMN` round-trips) — acceptable for one-time upgrade.

---

## How to operate

```bash
# Apply migrations
cd backend && npm run migrate

# Concurrency proof
npm run test:sequences

# Barcode audit
npm run audit:barcodes

# Permission re-normalize (idempotent)
npm run normalize:permissions

# Env notes
# DB_SSL=false          # local Postgres
# DB_SSL=true           # force SSL
# DB_SYNC_ALTER=true    # DEV ONLY
# APP_MODE=cloud|branch
```

---

**STOP — Phase 2 complete.**  
Do not begin Phase 3 (inventory ledger + unique item model) until this document is reviewed and approved.
