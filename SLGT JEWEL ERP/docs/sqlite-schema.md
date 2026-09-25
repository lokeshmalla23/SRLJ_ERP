# SQLite Schema — Embedded Local Store

**Phase:** C  
**Owner:** Electron main process only (never expose SQL to renderer)  
**File:** `%APPDATA%/jewellery-crm/data/jewellery-crm.sqlite` (via `app.getPath('userData')/data`)  
**Driver:** `better-sqlite3`

Cloud PostgreSQL remains the AWS authority store. This document describes the **shop PC local** schema and entity classification.

---

## Pragmas (chosen)

| Pragma | Value | Why |
|--------|-------|-----|
| `journal_mode` | `WAL` | Concurrent readers + better crash resilience |
| `foreign_keys` | `ON` | Referential integrity |
| `busy_timeout` | `5000` | Wait on lock instead of immediate SQLITE_BUSY |
| `synchronous` | `NORMAL` | Durable with WAL; avoid FULL cost on every write |
| `temp_store` | `MEMORY` | Faster temp tables |

Backup uses SQLite Backup API (`db.backup`), not `serialize()` (Electron 35 / native quirks).

---

## Migrations

Tracked in:

- `local_schema_migrations` — applied migration ids  
- `local_schema_meta.local_schema_version` — current version integer  

Initial migration: `001_initial_schema` → version **1**.

---

## Entity classification

### LOCAL_REQUIRED

Must exist for offline POS / inventory / membership. Written by local domain (later phases).

| Table | Notes |
|-------|-------|
| `shops` | Local shop identity + settings_json |
| `devices` | This PC + known peers |
| `device_membership` | Pairing / active membership |
| `users` / `employees` | Auth cache + salesperson list |
| `customers` | Operational customer records |
| `products` | Catalog + stock snapshot |
| `inventory_movements` | Append-oriented stock history |
| `invoice_sequences` | Local sequence state (redesign in Phase E) |
| `invoices` / `invoice_items` | Local authoritative billing rows |
| `quotations` / `orders` / `schemes` | Operational payloads |
| `settings` | Rates, GST prefs, etc. |
| `audit_events` | Local append-only audit |
| `sync_outbox` | Pending cloud/LAN events |
| `sync_processed_events` | Idempotency of inbound events |
| `sync_state` | Per-channel cursors |
| `coordination_state` | Connectivity / coordinator epoch |

### LOCAL_CACHE

Same tables may hold cloud-hydrated rows (snapshot pull in Phase D). Treat as writable local copies with sync provenance via outbox/processed events — not a separate read-only replica DB.

### CLOUD_ONLY (not in SQLite)

Do **not** embed these as primary local tables in Phase C:

| Concern | Stays on AWS |
|---------|----------------|
| Multi-shop SaaS registry (canonical) | Cloud shops/devices registry |
| Billing / subscription / platform admin | Cloud |
| Cross-shop analytics warehouse | Cloud |
| Long-term audit archive | Cloud (local keeps recent + outbox) |
| Global sale authority leases | Cloud coordination tables (Phase G) |

Local may cache a **subset** of registry fields on `shops`/`devices` for offline boot.

---

## Key constraints (local)

- `invoices (shop_id, invoice_no)` unique  
- `invoices.request_id` unique when present (partial index)  
- `sync_outbox.event_id` unique  
- `devices (shop_id, device_identifier)` unique  
- Product barcode/code indexed per shop  

Money stored as REAL for now; domain math remains HALF_UP in `@crm/domain` (Phase B). Integer minor-units may come later if needed.

---

## Access rules

1. Only Electron **main** (or Node test harness) opens the DB.  
2. Renderer uses IPC (`db:status`, `db:backup`) — no raw SQL channels.  
3. Business writes go through domain repositories (Phase D–E), not ad-hoc SQL from UI.  
4. Do not point billing at SQLite until Phase E gate.

---

## Related code

```
desktop/lib/db/sqlite.js      # open / pragmas / backup
desktop/lib/db/migrate.js     # ordered migrations
desktop/lib/db/migrations/    # schema versions
desktop/lib/db/index.js       # initLocalDb / shutdown
desktop/tests/desktopDb.test.js
```
