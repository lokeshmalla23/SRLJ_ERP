# Offline / Local-First Architecture

**Status:** Phases 1–11 implemented · Full 3-PC hardware acceptance still required before production sign-off  
**Product:** Sri Srinivasa Jewellers ERP (`aurum-backend` / React frontend)  
**Date:** 2026-07-28  
**Updated:** 2026-07-28 (Phase 3 — see `docs/phase-3-inventory.md`)

---

## Executive summary

The CRM is a **cloud-first, single-shop web app**: React + Vite SPA talking to an Express + Sequelize + PostgreSQL API over JWT. Phase 1 audit found POS billing is transactional for stock decrement + invoice create, but invoice numbering is race-prone (`count()+1`), sales do not write stock history, barcodes are not uniquely constrained, and GST/totals are client-trusted.

**Approved reuse strategy:** Keep the existing Express + Sequelize backend as the Branch Service (cloud/branch modes via configuration—no duplicated business backend). Package the existing React app in Electron later. Local and cloud databases are both **PostgreSQL** (no SQLite). Sync extends the same backend (`/api/sync/*`, `/api/devices/*`, `/api/provision/*`)—no separate microservice in V1. Recovery V1 uses **encrypted snapshots + durable outbox**, not clustering/consensus.

---

## Approved architectural decisions

| # | Decision |
|---|----------|
| 1 | **Local DB = PostgreSQL** (same dialect as cloud/Neon). SSL env-aware: cloud may require SSL; local may disable. |
| 2 | **Reuse Express backend** as Branch Service; configure cloud vs branch mode; keep `/api/*` contracts compatible. |
| 3 | **Introduce `shops` table now.** V1 remains single-shop/single-branch; `shop_id` scopes devices, sync, sequences, inventory, customers, invoices. No multi-branch UX. |
| 4 | **Keep invoice format** `PREFIX-YYMMDD-####`; replace generator with transactional `invoice_sequences`. |
| 5 | **One unique inventory/tag identity per physical tagged item.** Do not infer uniqueness from `stock_qty === 1`. Quantity-based inventory must be modeled intentionally. Barcode uniqueness `(shop_id, barcode)` for non-null barcodes. |
| 6 | **Recovery V1:** controlled promotion + encrypted recovery snapshots including unsynced outbox. No Raft/Paxos/auto election. |
| 7 | **Cloud sync:** extend existing backend later. Do not implement sync engine until its phase. |

---

## Revised implementation order (approved)

| Phase | Focus |
|-------|--------|
| **2** | Migrations + core data model (`shops`, devices, sequences, sync schema, audit fields, permissions) |
| **3** | Inventory ledger + unique item model |
| **4** | Billing correctness (locks, sequence in sale TX, server totals, quotation convert) |
| **5** | Branch Service + local PostgreSQL |
| **6** | Electron desktop |
| **7** | Offline operation |
| **8** | Cloud synchronization |
| **9** | Multi-PC (single active writer) |
| **10** | Controlled recovery |
| Then | Status UI, End-of-Day, backups, full failure testing |

**Rationale:** Fix data correctness (inventory + billing) before packaging POS in Electron.

---

## 1. Current architecture summary

```
Browser (Vite React :3000)
  AuthContext → JWT in localStorage (ssj_token)
  axios → VITE_BACKEND_URL/api
        │
        ▼
Express API (backend/src/index.js :8000)
  authenticate + requirePermission
  Sequelize models (23 tables)
        │
        ▼
Cloud PostgreSQL (DATABASE_URL, SSL required)
  Schema via sequelize.sync({ alter }) — no formal migrations
```

| Layer | Location | Stack |
|-------|----------|-------|
| Frontend | `frontend/` | React 19, Vite 6, Tailwind 4, react-router-dom 7, axios, no Redux |
| Backend | `backend/src/` | Express 4, Sequelize 6, `pg`, JWT, bcrypt, UUID PKs |
| Database | Cloud Postgres (Neon/similar) | SSL on; `sequelize.sync` at boot |
| Auth | JWT Bearer, 7-day expiry | Roles + JSONB permissions |
| Desktop | **None** | PRD notes Electron as future P2 |
| Offline | **None** | Explicitly deferred in `memory/PRD.md` |
| Legacy | `backend/server.py` | Old FastAPI + Mongo — **not** the live path |

**Deployment today:** Manual Node processes; no Docker/compose in repo; frontend env `VITE_BACKEND_URL`; backend requires `DATABASE_URL`, `JWT_SECRET`, optional `CORS_ORIGINS`, `DB_ALTER`, admin seed vars.

**Shop model:** Single tenant per database. Company profile and gold rates are rows in `settings` (`key` = `company` | `gold_rate`). No `shop_id`, no multi-branch.

---

## 2. Database / table map

All PKs are string UUIDs (`uuid` package / `newId()`), except `barcode_templates.id` (Sequelize UUID). Timestamps: `created_at` / `updated_at` (underscored). **No Sequelize associations** — FKs are plain string columns with app-level joins. Many line-items and payments are **JSONB arrays** on parent rows.

| Table | Model | Purpose | Notable columns |
|-------|-------|---------|-----------------|
| `users` | User | Auth + RBAC | email (unique), password_hash, role, permissions (JSONB), active |
| `settings` | Setting | Shop config | key (unique), value (JSONB) |
| `categories` | Category | Product tree | parent_id, code_prefix, defaults for wastage/making |
| `attributes` | Attribute | Dynamic product fields | field_type, options, category_ids |
| `catalog_items` | CatalogItem | collections/tags/metals/stones/purities/units | type, code, meta |
| `products` | Product | Inventory items | barcode (**not unique**), weights, stock_qty, status, gst_slab, vendor_id |
| `customers` | Customer | CRM | mobile, gst_number, total_purchases (legacy `loyalty_points` column unused) |
| `invoices` | Invoice | POS sales | invoice_no (unique), items (JSONB), payments (JSONB), gst_* |
| `quotations` | Quotation | Quotes | quote_no, items, status, converted_invoice_id |
| `orders` | Order | Custom + repair | order_no (unique), type, status workflow, karigar_* |
| `schemes` | Scheme | Gold schemes | payments (JSONB), scheme_type, status |
| `scheme_plans` | SchemePlan | Plan templates | plan_type, duration, bonus_months |
| `vendors` | Vendor | Suppliers | outstanding_balance, bank_details |
| `purchases` | Purchase | Buying | po_number (unique), items, payments (JSONB) |
| `stock_history` | StockHistory | Qty audit trail | change_type, qty_*, reference_* — **not written by POS** |
| `inventory_adjustments` | InventoryAdjustment | Manual stock changes | add/remove/damage/return |
| `barcode_templates` | BarcodeTemplate | Label layouts | fields, label_size, is_default |
| `employees` | Employee | HR | optional user_id |
| `expenses` | Expense | Accounts | amount, payment_mode |
| `expense_categories` | ExpenseCategory | Expense taxonomy | |
| `daily_closings` | DailyClosing | Day end | date (unique), cash/upi/card/bank totals |
| `campaigns` | Campaign | Promotions | WhatsApp-style |
| `campaign_messages` | CampaignMessage | Per-recipient | |
| `notifications` | Notification | In-app alerts | low_stock etc. |

### Missing for target architecture (to be designed in Phase 2+)

- `shops` / `shop_id` (or equivalent tenant key)
- `devices` / `device_id` / host role (active vs recovery)
- `sync_outbox` / `sync_inbox` / processed event ledger
- Proper `inventory_movements` ledger (evolve or replace `stock_history`)
- Invoice number sequence table (safe offline + concurrent allocation)
- Soft-delete / version columns on mutable synced entities
- Formal SQL/Sequelize migrations (replace `sync({ alter })` for production)

---

## 3. Current POS transaction flow

**UI:** `frontend/src/pages/POS.jsx` → `POST /api/invoices`  
**API:** `backend/src/controllers/invoices.js` → `createInvoice`

```
Cashier scans barcode (keyboard wedge → focused input)
  → match product by barcode/code in memory
  → cart line (weights, making, wastage, purity × gold rate)
  → optional customer, discount, old-gold exchange
  → split payments (cash/upi/card/bank_transfer/cheque/old_gold_exchange)
  → frontend enforces |balance| ≤ 0.5
  → POST /invoices with client-computed subtotal/discount/gst/grand_total
        │
        ▼
  BEGIN sequelize.transaction
    for each item with product_id:
      load product
      if stock_qty < qty → rollback 400
      stock_qty -= qty          ← NO row lock / SELECT FOR UPDATE
      ← does NOT set status='sold'
      ← does NOT write stock_history
    generateInvoiceNo()         ← Invoice.count()+1 (race-prone)
    Invoice.create(...)
    if customer_id: bump total_purchases
  COMMIT
        │
        ▼
  UI shows success + browser print (window.open HTML + window.print)
  Held bills: localStorage `ssj_held_bills` only (not server)
```

### Atomic today

| Step | Atomic with invoice? |
|------|----------------------|
| Stock qty decrement | Yes (same transaction) |
| Invoice row + items JSONB | Yes |
| Payments JSONB | Yes (stored as payload) |
| Customer total_purchases update | Yes |
| Stock history / movements | **No — not recorded** |
| Product status → sold | **No** |
| Server payment validation | **No** |
| Cloud sync | N/A |

### Gaps for local-first / multi-PC

1. Concurrent sells of same unique piece can both pass the stock check (read-modify-write without lock).
2. Invoice numbers from `count()+1` can collide under concurrency (`invoice_no` unique may cause one failure).
3. Quotation convert (`POST /quotations/:id/convert`) creates invoice **without** stock decrement.
4. GST is hardcoded 3% on POS; product `gst_slab` unused at checkout; print splits CGST/SGST client-side only.

---

## 4. Current inventory flow

**Source of truth:** `products.stock_qty` (FLOAT).

| Path | Stock effect | History |
|------|--------------|---------|
| POS invoice create | Decrement | **None** |
| Manual adjustment `POST /stock/adjustments` | add/remove/damage/return | `inventory_adjustments` + `stock_history` |
| Purchase create (`finished_goods` + product_id) | Increment | **None** |
| Quotation → invoice | **None** | N/A |
| Product create/edit | Direct field edit | None |

`recordStockChange()` exists in `controllers/stockHistory.js` and is used by adjustments only.

**Barcode:** Stored on `products.barcode` / `code`. No DB unique constraint. Templates + bulk generate-missing in `/api/barcodes`. Labels rendered in frontend (JsBarcode / QR). Keyboard-wedge scanning only (no camera API).

**Unique jewellery reality vs model:** The product model supports qty > 1 and a soft `status` enum (`available|on_display|reserved|sold|damaged`), but sales only change `stock_qty`. For tag-per-piece jewellery, Phase 3 must enforce **one sale per unique item** via movements + constraints, not UI alone.

---

## 5. Current authentication / RBAC flow

```
POST /api/auth/login
  → bcrypt verify → JWT { sub, email, type:'access' } 7d
  → frontend stores ssj_token

Every API call: Authorization: Bearer …
  → authenticate middleware loads User by PK
  → requirePermission(module, action)
       shop_owner → allow all
       else permissions[module][action] must be true
```

**Roles** (`constants.js`): shop_owner, manager, accountant, cashier, inventory_manager, sales_executive, gold_schemes_manager path, repair_manager.

**Modules:** dashboard, inventory, catalog, pos, customers, gold_schemes, reports, settings, users, vendors, purchases, orders, quotations, barcodes, employees, accounts, promotions, stock, backup.

**Frontend:** `AuthContext.can(module, action)` expects permission **arrays**; Settings UI normalizes object↔array. Backend middleware expects **object** `{ action: bool }`. Both shapes appear in the wild — must be normalized carefully for offline auth copies.

**Offline implication:** Login today always hits the API. Local-first requires authenticating against the **Branch Service local user store** (synced from cloud), not cloud-only JWT issuance.

---

## 6. Modules that can work largely unchanged

These can keep current React pages and Express route/controller shapes if the Branch Service exposes the same `/api/*` contracts:

| Module | Why reusable |
|--------|----------------|
| Catalog / categories / attributes | Pure CRUD; low conflict risk |
| Customers | CRUD + detail; soft conflicts OK with versioning |
| Product form / Inventory list UI | UI stays; backend stock rules change |
| Barcode Manager UI | Print/templates stay browser/Electron |
| Orders / repairs UI | Workflow CRUD |
| Scheme plans + schemes UI | Enrol + payments (JSONB) — sync carefully |
| Quotations UI | Mostly unchanged; convert path needs stock fix |
| Vendors / Purchases UI | Same API surface |
| Employees / Users UI | Local auth store must stay in sync |
| Accounts / expenses / daily closing UI | Local ops; sync later |
| Reports UI | Local reports for shop; cloud reports separate later |
| Dashboard KPIs | Point at local API |
| Settings company / gold rate | Local authoritative for billing |
| Promotions | Can remain cloud-preferring later; not POS-critical |
| CSV backup exports | Evolve into local backup tooling |

**Frontend packaging:** Electron wrapper around existing Vite build — no React rewrite required for V1.

**Backend reuse:** Prefer running the **same Express app** as Branch Service with config switches (local DB URL, sync worker enabled, discovery endpoints) rather than duplicating business logic.

---

## 7. Modules requiring modification

| Area | Why |
|------|-----|
| **Invoice create** | Row locks, movements ledger, outbox in same TX, safe invoice numbers, unique-item sold guard, optional status update |
| **Purchases / adjustments** | Same movement + outbox pattern |
| **Quotation convert** | Must apply same stock/movement rules as POS |
| **Invoice numbering** | Replace `count()+1` with allocated sequence (local, offline-safe, unique) |
| **Auth / bootstrap** | Local login; device registration; cloud auth only for provision/recovery |
| **API base URL** | Discovery of Branch Service instead of fixed `VITE_BACKEND_URL` |
| **DB layer** | Formal migrations; SSL optional for local Postgres; shop/device metadata |
| **Stock history** | Elevate to full inventory_movements with weights + movement_type |
| **Backup** | Beyond CSV export — local snapshots + recovery replicas |
| **Settings / shell UI** | Online/offline/sync indicator; recovery workflow; End-of-Day screen |
| **CORS / bind** | LAN bind + allowed Electron origins |
| **Held bills** | Today localStorage only — optional move to Branch Service for multi-PC share |

---

## 8. Local database strategy (approved)

| Choice | Decision |
|--------|----------|
| Engine | **PostgreSQL** locally and in cloud (Neon). **No SQLite.** |
| SSL | Environment-aware: cloud may require SSL; local Postgres typically without SSL |
| Schema | Same business tables + shops/devices/sync/sequence tables |
| IDs | UUID string PKs (`newId()`) — offline-friendly |
| Migrations | Umzug versioned migrations; production must not use `sync({ alter })` |
| Provisioning | Later phase: cloud auth → provision local → ready |
| Ongoing | Local DB authoritative for shop writes; cloud = backup/remote/sync |

**Do not** sync by replacing entire DB files as the normal path.

---

## 9. Proposed Branch Service strategy

```
Windows PC (Active Host)
┌─────────────────────────────────────────────┐
│  Branch Service (Windows service / startup) │
│  ├── Express API (reuse backend/src)        │
│  ├── Local PostgreSQL                       │
│  ├── Sync Engine (outbox + inbox)           │
│  ├── Discovery (mDNS / LAN beacon)          │
│  ├── Recovery snapshot publisher            │
│  └── Health + role: ACTIVE | RECOVERY       │
└─────────────────────────────────────────────┘
         ▲ LAN HTTP
┌────────┴────────┐
│ Electron CRM    │  (all PCs)
│ React build     │
│ preload bridge  │
└─────────────────┘
```

**Responsibilities of active Branch Service:**

- Serve all current `/api/*` shop operations
- Local JWT auth against local `users`
- POS, inventory, payments, schemes, reports needed in shop
- Sync outbox → cloud when online
- Accept inbound cloud deltas (settings, remote user updates, etc.)
- Publish recovery snapshots / stream to recovery-capable PCs
- Exactly **one** ACTIVE writer per shop

**Desktop app:**

- Electron: `contextIsolation: true`, `nodeIntegration: false`, validated preload IPC
- Discover active host (mDNS `_ssj-branch._tcp` or equivalent + last-known config)
- Show connectivity + sync status
- Never talk to cloud for billing path

**Installer:** Bundles Electron app + Branch Service runtime + DB; no manual Node/Postgres/port/credential setup for the shop user.

---

## 10. Proposed synchronization strategy

**Pattern:** Transactional outbox (not full DB dump).

```
BEGIN
  mutate business data
  insert sync_outbox(event_id, entity_type, entity_id, operation, payload_ref, ...)
COMMIT
→ async worker posts to Cloud Sync API
→ cloud applies idempotently by event_id
→ ACK → mark outbox synced
```

| Direction | Mechanism |
|-----------|-----------|
| Local → Cloud | `sync_outbox` durable events |
| Cloud → Local | Cursor / version watermark + `sync_inbox` or pull API |
| Idempotency | `event_id` UUID; cloud processed-events table |
| Retries | Exponential backoff; never drop financial events |
| Conflicts | Immutable financial events append-only; mutable masters use `version` / last-write with audit; **never silently discard invoices/payments/movements** |

**Centralize sync status** in outbox/inbox — avoid sprinkling `sync_status` on every business column.

**Cloud Sync API (new):** Accept batch events, return ACKs, expose pull-since for devices, device registration, shop identity verification.

---

## 11. Recovery strategy (approved — Phase 10)

| Role | Behavior |
|------|----------|
| Active host | Only writer; serves LAN API |
| Recovery-capable PC | Holds **encrypted recovery snapshots** + **durable unsynced outbox** state |
| Client-only | Uses active host; may also be recovery-capable |

**V1 approach:** controlled promotion + encrypted snapshots (not PostgreSQL clustering / streaming replication initially). Streaming replication may be considered later if RPO requires it.

**Failure of active host:** authorized recovery workflow → verify old host unavailable → verify recovery watermark → promote → log → peers rediscover.

**Old host returns:** must not auto-become active; demote to recovery/client; catch up.

**V1 explicitly excludes:** Raft/Paxos, automatic failover, dual-active healing without human confirmation.

---

## 12. Schema changes required (preview — implement in Phase 2+)

Additive, migration-based; **no production data destruction**.

### New tables (illustrative)

- `shops` — or at minimum `shop_id` constant in settings until multi-branch exists  
- `devices` — device_id, shop_id, name, role (`active_host|recovery|client`), last_seen, public key/token  
- `sync_outbox` — event_id, shop_id, device_id, entity_type, entity_id, operation, payload, attempt_count, status, last_error, synced_at  
- `sync_processed_events` (cloud) — event_id PK for idempotency  
- `sync_state` — per-device cursors / last pull  
- `invoice_sequences` — shop_id, period/prefix, next_value (allocated in TX)  
- `inventory_movements` — extend beyond current `stock_history` (weights, movement_type enum, device_id)  
- `host_elections` / `promotion_log` — audit of recovery promotions  
- `recovery_replicas` metadata — last snapshot hash/time  

### Columns to add on synced entities (where appropriate)

`shop_id`, `created_by`, `updated_by`, `version`, `deleted_at`, `origin_device_id`  
(`created_at` / `updated_at` already exist on most models)

### Constraints to add

- Unique `(shop_id, barcode)` where barcode not null  
- Unique invoice_no per shop (already unique globally in single-shop DB)  
- Partial unique / check preventing double-sale of unique tagged items (e.g. movement SALE uniqueness on product_id, or status + qty constraints)

### `branch_id`

Reserve nullable `branch_id` on shop-scoped tables **only if** migrations can default it safely for the single existing shop. **Do not implement multi-branch UX/logic in V1.**

---

## 13. API changes required (preview)

### Keep compatible

Existing `/api/products`, `/customers`, `/invoices`, `/orders`, `/schemes`, etc. should continue to work for the Electron app pointing at Branch Service.

### Add (Branch Service + Cloud)

| Endpoint area | Purpose |
|---------------|---------|
| `/api/sync/push` | Upload outbox batch |
| `/api/sync/pull` | Incremental cloud→local |
| `/api/sync/status` | Pending/failed counts for UI |
| `/api/devices/register` | Join shop |
| `/api/devices/heartbeat` | Liveness |
| `/api/host/status` | Active host identity + recovery watermark |
| `/api/host/promote` | Authorized recovery promotion |
| `/api/discovery` or mDNS | LAN find active service |
| `/api/provision` | First-PC bootstrap from cloud |
| Health extended | role, shop_id, sync lag, schema_version |

### Harden existing

- Invoice create: locking, movements, outbox, sequence allocation  
- Payment validation server-side  
- Stock adjustment + purchase: movements + outbox in one TX  

---

## 14. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Dual-active hosts after split-brain | **Critical** | Controlled promotion only; fence old host; promotion log; refuse writes if another active seen |
| Duplicate invoice numbers offline/multi-PC | **Critical** | Sequence table allocated inside local TX on single writer |
| Double-sell unique barcode | **Critical** | DB lock + unique sale movement / status constraint |
| Lost unsynced sales if only cloud backup | **Critical** | Recovery replica must include outbox |
| `sequelize.sync({ alter })` in production | High | Move to migrations before dual DBs |
| Client-trusted GST/totals | High | Recompute/validate server-side in Branch Service |
| JSONB payments/items harder to sync/conflict | Medium | Sync whole invoice document as immutable event; avoid partial JSON merges |
| Auth permission shape mismatch (array vs object) | Medium | Normalize once in shared util |
| Local Postgres SSL/config differs from cloud `db.js` | Medium | Env-driven SSL; local disable SSL |
| Electron print / scanner quirks | Medium | Keep keyboard wedge + browser print first; native print IPC later if needed |
| Quotation convert stock bug | Medium | Fix as part of billing atomicity work |
| Long cloud outage + full disk on outbox | Medium | Retention, alerts on End-of-Day, backup rotation |
| Schema version skew cloud vs local | High | version handshake; block incompatible sync with clear UI |
| Promoting stale recovery PC | **Critical** | Watermark comparison; refuse if behind known peers when detectable |

---

## 15. Step-by-step implementation plan (approved order)

Execute one phase at a time. Do not start a later phase until the prior phase is reviewed and approved.

### Phase 2 — Migrations + core data model *(current)*
1. Versioned migrations; stop production reliance on `sequelize.sync({ alter })`.  
2. `shops` + backfill `shop_id` on shop-scoped tables.  
3. `devices` schema (no election/recovery behavior yet).  
4. `invoice_sequences` + concurrency-safe allocation.  
5. Sync metadata tables only (`sync_outbox`, `sync_processed_events`, `sync_state`).  
6. Selective audit/version fields; permission normalization; schema version; barcode audit before unique constraint.

### Phase 3 — Inventory ledger + unique item model *(complete)*
1. `inventory_movements` authoritative ledger; OPENING baseline (no invented sales).  
2. `inventory_mode`: `quantity` | `unique_tag` on Product (no separate tag table — data is catalog+qty).  
3. Adjustments + purchases + invoice sale lines write movements via `inventoryService`.  
4. Unique double-sale guarded by row lock + conditional status UPDATE.  
5. `stock_history` deprecated for writes; history API reads movements.

### Phase 4 — Billing correctness *(complete)*
1. `billingService` atomic sale TX + `decimal.js` money + GST snapshots.  
2. Idempotent `request_id`; quotation convert shares pipeline.  
3. Purchase compensating movements; cancel columns reserved.  
4. `npm run test:billing` / `audit:billing` gate passed.

### Phase 5 — Branch Service + local PostgreSQL *(complete)*
1. Same Express app in `APP_MODE=branch`; local Postgres cluster + `.env.branch`.  
2. Enhanced `/api/health`; LAN bind `0.0.0.0`; NSSM service notes.  
3. `smoke:branch` passed (login + POS invoice on local DB, no cloud).

### Phase 6 — Electron desktop *(next)*
1. Electron shell around Vite build; secure preload.  
2. Windows installer; discovery/config IPC.  
3. Preserve barcode wedge + HTML print.

### Phase 7 — Offline operation
1. Local auth; POS-critical modules against Branch Service.  
2. Status: Offline + pending sync count.  
3. No morning full dump.

### Phase 8 — Cloud synchronization
1. Transactional outbox worker; `/api/sync/*`, `/api/devices/*`, `/api/provision/*` on existing backend.  
2. Idempotency, retries, pull path, diagnostics.  
3. Conflict policy: never silently discard financial events.

### Phase 9 — Multi-PC
1. Exactly one active Branch Service writer.  
2. Concurrent double-sell rejected at DB/TX layer.  
3. Discovery of active host (no hardcoded shop IP).

### Phase 10 — Controlled recovery
1. Encrypted recovery snapshots + durable unsynced outbox state.  
2. Authorized promotion UI; fence old host; returning host demotion.  
3. No automatic election / consensus.

### Then — Production hardening
1. Status UI (online/offline/sync issue).  
2. End-of-Day reconciliation (not primary sync).  
3. Automated backups + retention docs.  
4. Full failure-test matrix (20+ scenarios).

---

## Appendix A — Operations that must be atomic

| Operation | Must include in one local TX |
|-----------|------------------------------|
| Create invoice (sale) | Validate availability → lock → allocate invoice_no → invoice + items → payments → inventory movements → stock/status update → outbox event(s) |
| Sale return | Inverse movements + payment/credit records + outbox |
| Stock adjustment | Movement + stock update + outbox |
| Purchase receive (stocked goods) | Purchase row + stock movements + vendor balance + outbox |
| Scheme instalment payment | Append payment + status transitions + outbox |
| Purchase payment | Payment append + balances + outbox |
| Daily closing | Closing row consistency with computed totals (report may be derived) |
| Host promotion | Role flip + fence token + audit log (carefully ordered) |

---

## Appendix B — Key file map (as inspected)

| Concern | Path |
|---------|------|
| API entry | `backend/src/index.js` |
| DB | `backend/src/db.js` |
| Models | `backend/src/models/*.js` |
| Routes | `backend/src/routes/index.js` |
| POS / invoices | `backend/src/controllers/invoices.js` |
| Stock | `backend/src/controllers/stockHistory.js` |
| Purchases | `backend/src/controllers/purchases.js` |
| Auth | `backend/src/controllers/auth.js`, `middleware/auth.js`, `constants.js` |
| Frontend routes | `frontend/src/App.jsx` |
| API client | `frontend/src/lib/api.js` |
| Auth UI | `frontend/src/context/AuthContext.jsx` |
| POS UI | `frontend/src/pages/POS.jsx` |
| PRD (offline deferred) | `memory/PRD.md` |

---

## Appendix C — Approved decision log

| # | Question | Decision |
|---|----------|----------|
| 1 | Local DB | **PostgreSQL** locally and in cloud (no SQLite) |
| 2 | Branch Service | **Reuse Express + Sequelize**; cloud/branch config modes |
| 3 | Shop identity | **`shops` table** + `shop_id` (V1 single shop) |
| 4 | Invoice numbers | Keep **`PREFIX-YYMMDD-####`**; allocate via **`invoice_sequences`** |
| 5 | Unique jewellery | **One DB identity per physical tag**; quantity mode explicit; not `stock_qty===1` |
| 6 | Recovery | **Encrypted snapshots + outbox** (controlled promotion); no clustering/consensus in V1 |
| 7 | Cloud sync API | **Extend existing backend** (`/api/sync/*`, `/api/devices/*`, `/api/provision/*`) |

---

**Phase 1:** complete and approved.  
**Phase 2:** migrations + core data model — see `docs/phase-2-data-model.md`.  
Do not begin Phase 3 until Phase 2 is reviewed and approved.
