# Current Architecture Audit — Jewellery CRM

**Date:** 2026-07-28  
**Mode:** AUDIT ONLY — no code, schema, or architecture changes were made for this report.  
**Method:** Repository inspection + safe test runs against the configured `DATABASE_URL`.  
**Do not treat docs alone as proof of completion.**

---

## 1. Executive summary

The codebase is a **monorepo** with:

| Package | Role |
|---------|------|
| `frontend/` | React 19 + Vite SPA |
| `backend/` | Express + Sequelize + PostgreSQL API (modes: `cloud` \| `branch`) |
| `desktop/` | Electron shell (`JewelleryCRM-Setup.exe` via electron-builder) |

**There is no SQLite, no IndexedDB offline store, and no per-PC billing database.** Persistence is PostgreSQL only (cloud Neon-style URL and/or local Branch Postgres via bootstrap scripts).

**What works in code today (when Branch Service + local PG are running):**

- Server-authoritative billing in one DB transaction (locks, sequences, `request_id` idempotency, cancel/void with stock return).
- Unique-tag and quantity inventory with row locks and `inventory_movements`.
- Branch mode Express (`APP_MODE=branch`), LAN bind, sync outbox for **invoice create/cancel**, UDP host discovery, device pairing, recovery snapshots + promote, write-fence middleware for superseded hosts.
- Electron Create Shop / Join Shop UI that points the React app at a Branch API URL — **does not start Postgres or Branch Service**.

**Critical honesty for “offline multi-PC”:**

- Offline shop billing works **only if** the active host’s Branch Service + local PostgreSQL remain reachable on the LAN.
- Closing Electron does not stop Branch (if Branch runs as a separate Node/NSSM process). Electron also does **not** install/start that stack.
- Installer does **not** yet bundle Branch + Postgres (`docs/phase-11-hardening.md` + `desktop/package.json` files list).
- Sync outbox is **invoice-centric**; pull-apply on branch is implemented but **not wired** into the sync worker.
- No `audit_events` table exists.

**Potential final architecture you described (one Branch Host + LAN clients + AWS sync) is largely the direction already coded — packaging and completeness gaps remain.**

---

## 2. Repository structure

### Top-level (relevant)

```
crm/
├── backend/                 # Express API, migrations, tests, branch scripts
├── frontend/                # React/Vite SPA
├── desktop/                 # Electron main/preload/first-launch + builder
├── docs/                    # Architecture & phase docs
├── memory/                  # PRD notes
├── tests/                   # (repo-level; primary tests under backend/tests)
├── README.md
└── package-lock.json        # root lockfile present; apps have own package.json
```

### Backend (simplified)

```
backend/
├── package.json             # start, start:branch, branch:bootstrap, test:*
├── src/
│   ├── index.js             # Express app, health, syncWorker start, write-fence
│   ├── db.js                # Sequelize ← DATABASE_URL (Postgres only)
│   ├── migrate.js           # Umzug
│   ├── config/              # appMode, branchConfig, schemaVersion
│   ├── middleware/          # auth.js, requireAuthoritativeHost.js
│   ├── models/              # Shop, Device, Invoice, Sync*, Inventory*, …
│   ├── services/            # billing, inventory, sync*, recovery, lanDiscovery, backup
│   ├── controllers/ + routes/
│   ├── migrations/          # 13 numbered migrations (+ _helpers)
│   └── scripts/             # bootstrapBranchPostgres, startBranch, audits, smoke*
├── tests/                   # invoiceSequence, inventory, billing, sync, acceptance
└── scripts/windows/         # NSSM install notes (.md only)
```

### Frontend (simplified)

```
frontend/
├── package.json             # vite :3000, decimal.js
├── src/
│   ├── main.jsx             # initApiBackend() then React root
│   ├── lib/api.js           # axios → branch/cloud URL
│   ├── lib/billingCalc.js + money.js
│   ├── pages/POS.jsx        # billing_allowed gate
│   └── components/layout/ConnectivityBanner.jsx
```

### Desktop (simplified)

```
desktop/
├── package.json             # electron + electron-builder → JewelleryCRM-Setup.exe
├── main.js                  # BrowserWindow, IPC, first-launch vs UI
├── preload.js               # jewelleryCRM bridge (sandboxed)
├── first-launch.html        # Create Shop / Join Shop
└── lib/config.js            # userData/desktop-config.json
```

**Not present as packages:** shared npm workspace library, Redis, SQLite package as a runtime dependency of the app (sqlite3 may appear transitively in lockfiles; **app code uses `pg` + Sequelize only**).

---

## 3. Current architecture (verified from code)

| Question | Answer (code-verified) |
|----------|-------------------------|
| Frontend runs where? | Browser (Vite) or Electron renderer loading Vite URL / packaged `frontend/dist` |
| Backend runs where? | Separate Node process (`node src/index.js` or `npm run start:branch`) — **not** inside Electron |
| Database runs where? | PostgreSQL pointed to by `DATABASE_URL` (cloud host or `127.0.0.1` local) |
| Does React call cloud API directly? | **It can.** Base URL = Electron `branch_api_url` → `localStorage ssj_backend_url` → `VITE_BACKEND_URL` → `http://127.0.0.1:8000`. No hard ban on cloud URL. |
| Local backend? | **Yes, optional:** same Express with `APP_MODE=branch` |
| Cloud/branch modes? | **Yes:** `backend/src/config/appMode.js` |
| Branch Service? | **Same Express app** in branch mode + branch scripts — not a separate microservice repo |
| Electron? | **Yes:** `desktop/` |
| SQLite? | **No app usage** for CRM data |
| Local PostgreSQL? | **Yes, via scripts:** `branch:bootstrap` / `branch:setup-system-pg` |
| PG install automated in `.exe`? | **No** — Electron does not bootstrap PG; docs say separate bootstrap + NSSM |
| Every PC own DB? | **Not by design.** Intended: one Branch host DB; clients have no local CRM DB |
| Shared local DB? | **Yes, when** clients point at host Branch API |
| LAN communication? | HTTP to Branch URL; UDP discovery port **41779** |
| Device discovery? | `lanDiscovery.js` + first-launch scan |
| Active Host concept? | Device `role: active_host \| recovery \| client` + `branchConfig.role` |
| Recovery/failover? | Snapshots + `promoteToActiveHost` + write fence — **manual**, not auto-election |

### Runtime picture (actual)

```
[Optional AWS/Neon Postgres + Express APP_MODE=cloud]
              ↑ sync worker (branch only) POST /api/sync/push
[Active Host PC]
  Local Postgres (bootstrap) ← Express APP_MODE=branch :8000
              ↑ HTTP /api/*
[PC1/PC2/PC3] Electron or browser → configured branch_api_url
```

Closing the Electron window **does not** stop Branch/Postgres (they are separate). Electron also **does not start them**.

---

## 4. Phase completion matrix

Evidence standard: code/migrations/tests present. Docs alone ≠ IMPLEMENTED.

| Phase | Status | Proving artifacts |
|-------|--------|-------------------|
| **1 — Architecture audit** | **IMPLEMENTED** (docs) | `docs/offline-architecture.md`, later `LOCKED-ARCHITECTURE.md` |
| **2 — Data foundation** | **IMPLEMENTED** | Migrations shops/devices/sequences/sync/shop_id; models; `schemaVersion.js` |
| **3 — Inventory ledger** | **IMPLEMENTED** | `inventory_movements`, `inventoryService.js`, `test:inventory` PASS |
| **4 — Billing hardening** | **IMPLEMENTED** | `billingService.js`, `billingCalc.js`, `money.js`, invoice columns migration, `test:billing` PASS |
| **5 — Branch Service / local DB** | **PARTIAL** | `APP_MODE=branch`, `branchConfig`, `startBranch`, `bootstrapBranchPostgres`, smoke script; **not** bundled in installer; NSSM is markdown notes only |
| **6 — Electron** | **PARTIAL** | `desktop/` shell, Create/Join, NSIS config; **does not** auto-start Branch/PG; signing/hardware unverified here |
| **7 — Offline** | **PARTIAL** | Offline = Branch up + cloud down. Banner + POS gate. **No** local cache DB if Branch down |
| **8 — Cloud sync** | **PARTIAL** | Outbox + worker + push idempotency tested; **only invoice create/cancel** enqueued; pull-apply not connected to worker |
| **9 — Multi-PC** | **PARTIAL** | Discovery, pairing, device registry, one-host promote/demote in local Device table; **no DB unique constraint** for single active_host |
| **10 — Recovery** | **PARTIAL** | Encrypted snapshots (metadata/outbox, not full DB); promote; fence middleware wired; snapshot ≠ full PG restore |
| **11 — Production hardening** | **PARTIAL** | Tests/acceptance scripts, guides; installer incomplete; Authenticode / 3-PC drill = process, not code |

---

## 5. Database architecture

| Store | Purpose | Location | Authoritative? | Writers | Readers |
|-------|---------|----------|----------------|---------|---------|
| **PostgreSQL** (Sequelize) | All CRM business data | `DATABASE_URL` (Neon/cloud or local Branch) | **Yes** | Express API | Express API, reports |
| **Neon / cloud PG** | Typical cloud deploy | Remote host in URL | Yes when `APP_MODE=cloud` | Cloud API | Cloud API / sync apply |
| **Local Branch PG** | Shop authority when branch | `.local-pgdata` / system PG via scripts | Yes when branch host | Branch Express | Clients via Branch HTTP |
| **SQLite** | — | Not used by app | — | — | — |
| **IndexedDB** | — | Not used | — | — | — |
| **Electron `desktop-config.json`** | UI setup: mode, `branch_api_url`, shop/device names | `app.getPath('userData')` | Config only | Electron main | Preload/renderer |
| **localStorage** | `ssj_token`, `ssj_backend_url`, held bills | Browser/Electron | Cache/session | Frontend | Frontend |
| **In-memory pairing codes** | Device join codes | Branch process RAM | Ephemeral | `devices` controller | Join flow |
| **Recovery files** | Encrypted snapshots | `RECOVERY_DIR` or `backend/.recovery` | Recovery aid | recoveryService | promote |
| **Redis** | — | Not present | — | — | — |

### Connection / env (names only — no secrets)

| Variable | Role |
|----------|------|
| `DATABASE_URL` | Required Postgres connection |
| `DB_SSL` | Force SSL on/off; else auto by host locality (`db.js`) |
| `APP_MODE` | `cloud` (default) \| `branch` |
| `BRANCH_*` / `.env.branch` | Branch listen, shop, device, cloud endpoint, role |
| `JWT_SECRET` / `RECOVERY_KEY` | Auth / snapshot encryption |
| `VITE_BACKEND_URL` | Frontend default API |
| `CLOUD_ENDPOINT` (branch) | Sync push target |
| `DISCOVERY_PORT` | UDP discovery (default 41779) |

---

## 6. Migration status

**Schema version constant:** `SCHEMA_VERSION = 5` (`backend/src/config/schemaVersion.js`).  
Migration `20260728180001` writes schema_meta version **5** (customer pan fields).

| Order | Migration | Architecture relevance |
|-------|-----------|------------------------|
| 1 | `20260728120001-create-schema-meta-and-shops` | `schema_meta`, `shops` |
| 2 | `20260728120002-create-devices` | `devices` registry |
| 3 | `20260728120003-create-invoice-sequences` | `invoice_sequences` |
| 4 | `20260728120004-create-sync-tables` | `sync_outbox`, `sync_processed_events`, `sync_state` |
| 5 | `20260728120005-add-shop-id-and-audit-columns` | `shop_id`, version/deleted_at/origin on entities |
| 6 | `20260728120006-backfill-shop-and-sequences` | Backfill shop + sequences |
| 7 | `20260728120007-shop-id-not-null` | Harden shop_id |
| 8 | `20260728120008-normalize-permissions` | RBAC shape |
| 9 | `20260728120009-barcode-unique-if-safe` | Partial unique barcode **or skip** if dupes |
| 10 | `20260728140001-create-inventory-movements` | Ledger table |
| 11 | `20260728140002-baseline-inventory-movements` | Opening baselines |
| 12 | `20260728160001-billing-invoice-columns` | GST split, `request_id` unique, cancel fields, money DECIMAL |
| 13 | `20260728180001-customer-pan-fields` | `customers.pan_number`, `pan_image` |

**Verified present conceptually:** shops, shop_id, devices, invoice_sequences, sync_*, inventory_movements, billing/idempotency, shop audit fields.  
**Not found as tables:** `audit_events`, dedicated recovery tables, branch-host singleton constraint.

---

## 7. Inventory architecture

| Capability | Status | Evidence |
|------------|--------|----------|
| `inventory_mode` quantity / unique_tag | **Code** | `constants/inventory.js`, Product model, `inventoryService` |
| Quantity decrease with lock | **Code + tests** | `decreaseStock` + FOR UPDATE; concurrency test |
| Unique mark SOLD | **Code + tests** | `markUniqueItemSold` conditional UPDATE; parallel double-sale test |
| `inventory_movements` | **Code** | Model + migration + SALE/PURCHASE/SALE_RETURN/adjust |
| Stock adjustments API | **Code** | `/api/stock/adjustments` + `InventoryAdjustment` |
| Product PATCH cannot set stock | **Code** | Strip inventory fields on product update |
| Barcode uniqueness | **PARTIAL** | Unique index only if no existing duplicates |
| Scan ≠ sell | **Code** | POS cart add; stock changes only in `createInvoice` TX |

---

## 8. Billing architecture

| Capability | Status | Evidence |
|------------|--------|----------|
| `billingService.createInvoice` atomic TX | **YES** | `sequelize.transaction` |
| Server totals / GST (decimal.js) | **YES** | `billingCalc` + `money`; ignores client subtotal/grand |
| Client can pass `gst_pct` | **YES (risk)** | Used if provided |
| Invoice sequence allocator | **YES** | `invoiceSequence.js`; `test:sequences` PASS |
| Inventory lock in sale | **YES** | Product UPDATE locks before apply |
| Line snapshots | **YES** | JSON items on invoice |
| Payments / split / validation | **YES** | `validatePayments` |
| Old gold | **YES** | In totals calc |
| Quotation → invoice | **YES** | Convert path + tests |
| Cancel / SALE_RETURN | **YES** | `POST /invoices/:id/cancel`; no DELETE |
| `request_id` idempotency | **YES** | Lookup + unique index; test |
| Empty invoice rejected | **YES** | Tests |
| Frontend preview calc | **Aligned** | `frontend/src/lib/billingCalc.js` |

**Concurrency:**

- Two counters, same unique tag → one wins (`ALREADY_SOLD`) — **tested**.
- Two counters, qty stock 1 → one wins — **tested**.
- Double-click / retry same `request_id` → same invoice — **tested**.

---

## 9. Electron status

| Item | Status |
|------|--------|
| Main / preload / renderer | **Present** |
| React integration | Loads Vite (dev) or packaged `frontend/dist` |
| IPC | Allowlisted: config, ping, print, setup reload |
| Local API config | `branch_api_url` in userData JSON → `initApiBackend` |
| Auto-update | **Not found** |
| Installer | electron-builder NSIS → `JewelleryCRM-Setup.exe` |
| Printing | `print:page` IPC |
| Barcode | Via UI keyboard/scanner into POS — no native HID layer |
| Security | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |

### What happens when JewelleryCRM.exe starts **today**

1. Load `desktop-config.json`.
2. If `setup_complete` false → `first-launch.html` (Create/Join; probes Branch URL; may UDP-discover via reachable host).
3. Else load React UI.
4. React calls configured Branch/API URL.
5. **No child_process starts Postgres or Express.**

---

## 10. Branch Service status

| Topic | Reality |
|-------|---------|
| Separate binary named branch-service? | **No** — same `backend` Express |
| Mode selection | `APP_MODE=branch` (+ `.env.branch` via `startBranch.js`) |
| Local DB | `DATABASE_URL` to local PG; `DB_SSL=false` typical |
| Start/stop | Manual `npm run start:branch` / bootstrap scripts; NSSM **documented**, not auto |
| Electron close stops it? | **No** (separate process) |
| Write fence | `requireAuthoritativeHost` on mutating money/stock routes when branch |
| Health | `/api/health` includes `authority`, `billing_allowed` |

Scripts: `bootstrapBranchPostgres.js`, `setupLocalPostgres.js`, `startBranch.js`, `smokeBranch.js`.

---

## 11. Offline status

**Definition in this codebase:** Branch reachable; cloud may be down.

| Operation if **internet** down but **Branch LAN** up | Works? |
|------------------------------------------------------|--------|
| Login (JWT vs local Branch users) | **Yes** (local API) |
| POS / barcode / billing / inventory / customers | **Yes** (local API) |
| Printing | **Yes** (client-side) |
| Cloud sync | **Paused** (outbox pending) |

| Operation if **Branch** unreachable (LAN dead / host down / only cloud URL offline) | Works? |
|--------------------------------------------------------------------------------------|--------|
| Login / POS checkout | **No** — health fails; POS disables checkout |
| Stale in-memory product list | May still display; **must not** complete sale |

**No** SQLite/IndexedDB offline billing cache.

---

## 12. Sync status

| Component | SCHEMA | IMPLEMENTED | CONNECTED TO BUSINESS WRITES | TESTED |
|-----------|--------|-------------|------------------------------|--------|
| `sync_outbox` | ✓ | ✓ | ✓ invoice create/cancel only | ✓ |
| `sync_processed_events` | ✓ | ✓ | cloud push path | ✓ duplicate push |
| `sync_state` | ✓ | ✓ | worker / pull meta | partial |
| Sync worker push | ✓ | ✓ | branch `index.js` start | partial (unit via push API) |
| Cloud `/api/sync/pull` | ✓ | ✓ | HTTP | — |
| `applyPulledChanges` on branch | ✓ | ✓ | **Not called by worker** | — |
| Customer/product/stock events | ✓ tables | ✗ enqueue | ✗ | ✗ |

**Current data flow:** Invoice TX → outbox row same TX → worker POST cloud `/api/sync/push` → processed event_id ack.

**Not:** whole DB morning download / EOD dump sync (backup `pg_dump` is separate from sync).

---

## 13. Multi-PC status

| Feature | Status |
|---------|--------|
| LAN HTTP API | Yes (clients → host URL) |
| UDP discovery | Yes, port 41779, active_host advertises |
| mDNS/Bonjour | Not found |
| Device pairing codes | Yes (in-memory, 10 min) |
| Device registry | `devices` table |
| Host discovery UI | first-launch + Settings health (per docs/UI) |
| Local TLS | Not enforced; HTTP LAN typical |
| Firewall automation | Docs only |

**Can three PCs bill simultaneously?**  
**Yes, if** all point at one live Branch host with one shared Postgres — concurrency protected in billing/inventory services.  
**Not** via three independent offline databases.

---

## 14. Recovery status

| Feature | Code | Docs/planned |
|---------|------|--------------|
| Encrypted snapshots | ✓ AES-GCM metadata/outbox | ✓ |
| Full DB in snapshot | ✗ (use `pg_dump` backup separately) | Documented caveat |
| Promote to active_host | ✓ | ✓ |
| Dual-active confirmation flag | ✓ | ✓ |
| Old host rejoin as client | Operational + fence | ✓ |
| Fence blocks writes | ✓ middleware | ✓ |
| Auto failover / Raft | ✗ | Explicitly non-goal |

---

## 15. Audit / anti-fraud status

| Control | Status |
|---------|--------|
| Append-only `audit_events` | **MISSING** |
| Invoice void vs delete | **Cancel only** (no DELETE route) |
| Edit completed invoice | **No PATCH/PUT** on invoices |
| Manager approval PIN flows | **Not found** as dedicated approval service |
| Stock adjustment records | **Yes** (`InventoryAdjustment` + movements) |
| Gold-rate / GST settings change audit | Settings storage; **no** dedicated audit event stream |
| Device + user on requests | JWT user; device via config/outbox origin fields |
| `request_id` | On invoices |
| Cash / EOD | Daily closing + `/api/system/eod`; till sessions thin |
| Product hard delete | Possible via product delete APIs — residual risk |
| Purchase delete | Exists in purchases domain — residual risk |

---

## 16. Test results (this audit run)

Run on 2026-07-28 against configured DB (safe automated suites):

| Suite | Command | Result |
|-------|---------|--------|
| Invoice sequences | `npm run test:sequences` | **PASS** (40 concurrent unique numbers) |
| Inventory | `npm run test:inventory` | **PASS** |
| Billing | `npm run test:billing` | **PASS** |
| Sync | `npm run test:sync` | **PASS** (outbox + push idempotency) |
| Acceptance | `npm run test:acceptance` | **Not re-run in this pass** (exists: `tests/acceptanceSimulation.test.js`) |
| Electron / multi-PC hardware | — | **No automated pass in this audit** |

---

## 17. Current data-flow diagrams (actual)

### A. Login

```
UI → POST {branch_or_cloud}/api/auth/login
   → JWT stored localStorage ssj_token
   → subsequent API calls Authorization: Bearer
```

### B. Barcode scan

```
POS scan → GET/local products list already loaded OR lookup
         → add line to React cart only
         → no stock mutation
```

### C. Invoice creation

```
POS Complete Sale → POST /api/invoices { request_id, items, payments, … }
  → requireAuthoritativeHost (branch)
  → authenticate + RBAC
  → billingService.createInvoice in ONE transaction:
       idempotent request_id?
       lock products
       calc server totals
       allocate invoice_no
       applySaleLine (qty/unique)
       write invoice + payments snapshot
       enqueueSyncEvent (invoice/create)
  → commit
```

### D. Inventory update (sale)

```
Inside invoice TX → inventoryService applySaleLine
  → FOR UPDATE product
  → unique: status → sold + SALE movement
  → qty: stock_qty -= n + SALE movement
```

### E. Payment

```
Validated inside createInvoice (modes/amounts vs grand ± ₹0.50)
Stored on invoice JSON / payment fields — not a separate open ledger service
```

### F. Cloud interaction

```
Branch syncWorker → POST cloud /api/sync/push { events[] }
Cloud → SyncProcessedEvent by event_id (exactly-once apply intent)
Pull endpoint exists; branch worker does not auto-apply pull
```

### G. Offline behavior

```
Internet down + Branch up → billing continues; outbox grows; banner “cloud sync paused”
Branch down → POS billing_allowed false; checkout blocked
```

### H. Multi-PC communication

```
PC2/PC3 HTTP → Active Host Branch :8000 /api/*
Host may UDP broadcast discovery :41779
Pairing: host creates code; client registerDevice → role client
```

---

## 18. Old-architecture components (KEEP / LIKELY KEEP / ARCHITECTURE-SPECIFIC / UNUSED / UNKNOWN)

| Component | Classification | Notes |
|-----------|----------------|-------|
| Electron `desktop/` | **ARCHITECTURE-SPECIFIC** (LIKELY KEEP for .exe UX) | Shell only |
| `APP_MODE` branch/cloud | **ARCHITECTURE-SPECIFIC** | Core to Branch plan |
| `bootstrapBranchPostgres.js` | **ARCHITECTURE-SPECIFIC** | Local PG |
| `lanDiscovery.js` | **ARCHITECTURE-SPECIFIC** | Multi-PC |
| `devices` + pairing | **ARCHITECTURE-SPECIFIC** | Multi-PC |
| `sync_outbox` / worker / push | **ARCHITECTURE-SPECIFIC** | Cloud sync |
| `recoveryService` + fence middleware | **ARCHITECTURE-SPECIFIC** | Host failover |
| `backupService` pg_dump | **LIKELY KEEP** | Ops regardless |
| NSSM markdown | **ARCHITECTURE-SPECIFIC** | Windows host service |
| Billing/inventory/sequences/money | **KEEP** | Independent of packaging |
| shop_id / migrations | **KEEP** | Multi-shop / sync foundation |
| ConnectivityBanner / POS gate | **LIKELY KEEP** | Safety UX |
| `applyPulledChanges` unused by worker | **UNKNOWN / incomplete** | Dead path until wired |
| SQLite/IndexedDB offline | **N/A** | Never implemented |
| Peer-to-peer billing DBs | **N/A** | Never implemented |

---

## 19. Architecture-independent components (must not casually remove)

Preserve even if packaging/sync topology is reconsidered:

- All numbered **migrations** and Umzug history  
- **shop_id** and shop scoping  
- **invoice_sequences** + allocator  
- **Barcode uniqueness** intent (and audit of duplicates)  
- **inventory_movements** + **inventoryService** locks  
- **billingService** atomic sale/cancel, server GST/totals, idempotency  
- **RBAC** permissions  
- **Invoice line snapshots**  
- Shop audit columns (`version`, `deleted_at`, `origin_device_id`) as data columns  

Removing these without a replacement breaks financial integrity regardless of Electron/Branch packaging.

---

## 20. Risks

| Risk | Rank | Notes |
|------|------|-------|
| Dual-active hosts if old host still runs with own DB copy | **CRITICAL** | Fence is per-process Device table; split DB clones not fully prevented by physics |
| Branch down → no billing (by design) but operators may misconfigure cloud-only URL | **HIGH** | Offline promise fails if “backend” is remote-only |
| Sync incomplete (non-invoice entities; cancel mirror on cloud; pull unused) | **HIGH** | Cloud may diverge |
| Barcode unique index skipped when duplicates exist | **HIGH** | Double-tag risk |
| Client-supplied `gst_pct` | **MEDIUM** | Totals recomputed but rate influencable |
| No `audit_events` | **MEDIUM** | Forensics weak |
| Recovery snapshot ≠ full DB | **HIGH** | Promote without good `pg_dump` → data loss |
| Installer without Branch/PG | **HIGH** | Shop cannot “.exe only” yet |
| Product/purchase destructive APIs | **MEDIUM** | Bypass-style risk vs invoice immutability |
| Credentials in env / config files | **MEDIUM** | Standard; ensure OS ACLs / no commit of secrets |
| Unsynced outbox loss if disk dies before cloud + before backup | **HIGH** | Inherent single-host tradeoff |

---

## 21. Files likely affected by a future architecture change

**If changing packaging (bundle Branch+PG into exe):**  
`desktop/*`, `backend/src/scripts/bootstrap*`, `backend/scripts/windows/*`, `docs/deployment-guide.md`, installer CI.

**If changing sync topology:**  
`syncWorker.js`, `syncOutbox.js`, `controllers/sync.js`, `syncPull.js`, Sync* models, billing enqueue sites.

**If changing host election/recovery:**  
`recoveryService.js`, `requireAuthoritativeHost.js`, `devices.js`, `lanDiscovery.js`, Device model/migrations.

**If abandoning Branch entirely (cloud-only):**  
Would strand offline goals; touch `appMode`, branch scripts, Electron first-launch, fence, discovery — **not recommended without replacing offline authority**.

**Should stay stable:**  
`billingService.js`, `inventoryService.js`, `invoiceSequence.js`, `money.js`, `billingCalc.js`, inventory/billing migrations, core invoice routes.

---

# SAFE TO KEEP

- PostgreSQL + Sequelize domain model and migrations  
- Server-authoritative billing + decimal money + idempotency + cancel/void  
- Inventory ledger + unique/qty locks  
- Invoice sequences  
- shop_id / devices schema (even if pairing UX changes)  
- RBAC  
- Frontend billingCalc alignment  
- Automated billing/inventory/sequence/sync unit tests  

# NEEDS REVIEW

- Electron as sole distribution vs separate host service installer  
- Sync event coverage beyond invoices; pull-apply wiring  
- Recovery snapshot vs mandatory `pg_dump` pipeline  
- Whether cloud Express should ever accept POS writes (today it can if URL points there)  
- Barcode duplicate skip behavior  
- Daily closing mutability / cash drawer UX  
- Acceptance + physical 3-PC verification  

# ARCHITECTURE-SPECIFIC

- `APP_MODE=branch` + `branchConfig` + `startBranch` / `bootstrapBranchPostgres`  
- UDP `lanDiscovery`  
- Device pairing + active_host role  
- Sync outbox worker → cloud push  
- Recovery snapshots + promote + authoritative write fence  
- Electron first-launch Create/Join + `branch_api_url`  
- NSSM Windows service documentation  
- Connectivity / `billing_allowed` offline UX  

---

**End of audit. No architecture changes, deletions, migrations, or refactors were performed.**
