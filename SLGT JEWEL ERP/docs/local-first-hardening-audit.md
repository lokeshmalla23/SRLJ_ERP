# Local-First Hardening Audit

**Date:** 2026-07-28  
**Auditor:** Code inspection (automated + manual)  
**Scope:** All 73 sections of the Local-First POS hardening specification  
**Codebase snapshot:** `c:/crm` — monorepo (frontend, backend, desktop, shared)

---

## Status legend

| Symbol | Meaning |
|--------|---------|
| ✅ IMPLEMENTED | Working code + tests exist |
| ⚠️ PARTIAL | Partially implemented; gaps noted |
| ❌ MISSING | Not yet started |
| 🔴 UNSAFE | Implemented but has correctness/security risk |
| 🧪 UNTESTED | Code exists; no automated test coverage |

---

## Executive Summary

The repository is a **partially-migrated local-first POS**. Phases 1–5 (billing, inventory, concurrency, outbox, multi-PC infrastructure) are **production-ready for a single authoritative Branch Service + PostgreSQL** deployment. The target architecture (SQLite embedded in every `.exe`, no PostgreSQL on shop PCs) is **designed but not yet operational for billing** — Phase C (SQLite embedding) is complete, but Phases D–P (hydration, SQLite billing, authority state machine, LAN coordination, split-brain, offline auth, installer bundling) are **not started**.

**Critical gaps before production:**
1. No authority state machine (CLOUD_COORDINATED / LAN_COORDINATED / ISOLATED) in code
2. SQLite billing not implemented — installer still requires external Branch + PostgreSQL
3. `audit_events` table exists in SQLite schema only — not wired to any app writes
4. Invoice numbering unsafe for offline multi-device
5. `DELETE /products/:id` and `DELETE /purchases/:id` allow hard deletion of records that underpin the movement ledger
6. No offline authentication (login requires Branch API)
7. No LAN peer authentication or message security
8. Split-brain protection is write-fence only — not tested under network partition

---

## Section-by-Section Audit

---

### §1 Gap Audit

**Status: ✅ IMPLEMENTED** — this document.

---

### §2 Authority Model (CLOUD_COORDINATED / LAN_COORDINATED / ISOLATED)

**Status: ❌ MISSING**

**Current implementation:**  
`docs/local-first-architecture.md` defines the three states in prose. The SQLite schema has a `coordination_state` table. The backend `requireAuthoritativeHost` middleware enforces write-fence for the Branch Service (role = `active_host`). There is no runtime authority state machine that classifies a device's current state and gates transactions accordingly.

**Relevant files:**
- `docs/local-first-architecture.md` — defines states (prose only)
- `desktop/lib/db/sqlite.js` — `coordination_state` table in schema
- `backend/src/middleware/requireAuthoritativeHost.js` — write-fence (Branch only)
- `frontend/src/lib/api.js` — connectivity check (online/offline only)

**Current tests:** None for authority state.

**Missing behavior:**
- No `AuthorityStateService` or equivalent that determines the current state
- No runtime transitions between CLOUD_COORDINATED → LAN_COORDINATED → ISOLATED
- No gating of checkout on authority state
- `coordination_state` table is never written or read by application code

**Risk:** CRITICAL — without an authority model, the system has no way to enforce "fail closed" for unique-tag sales when cloud and LAN are both unavailable. The frontend shows generic "offline" status only.

**Proposed minimal change:**
- Create `desktop/lib/services/authorityState.js` — singleton that:
  - Pings cloud health endpoint
  - Probes trusted LAN peers
  - Emits `CLOUD_COORDINATED | LAN_COORDINATED | ISOLATED`
  - Writes current state to `coordination_state` table
  - Exposes state via IPC to renderer
- Gate all unique-tag checkout operations on this state

---

### §3 Cloud-Coordinated Unique Item Sale

**Status: 🔴 UNSAFE**

**Current implementation:**  
`inventoryService.markUniqueItemSold()` uses `SELECT FOR UPDATE` + conditional `UPDATE WHERE status = 'available'` in a single PostgreSQL transaction. This prevents double-sale **within the same Branch writer**. The Branch Service is the single authority.

**Relevant files:**
- `backend/src/services/inventoryService.js` — `markUniqueItemSold`
- `backend/src/services/billingService.js` — calls `markUniqueItemSold` in TX
- `backend/tests/inventoryService.test.js` — concurrent race test passes

**Current tests:** `inventoryService.test.js` — concurrent race with two clients → one wins. ✅ Passes within single Branch.

**Missing behavior:**
- No cloud **pre-commit reservation** / authority lease mechanism
- If two Branch Services existed simultaneously (split-brain), each could independently grant authority for the same item
- No `authority_id`, `issued_at`, `expires_at`, `status` lifecycle
- No lease expiry (item permanently stuck if client crashes after reserve but before commit)

**Risk:** CRITICAL — in the target SQLite-per-device architecture, two devices can both read `status=available` from their local SQLite copies and attempt to commit a sale without cloud pre-check.

**Proposed minimal change:**
- Cloud API: `POST /api/authority/reserve` — atomically checks+reserves item, returns bounded lease
- Desktop: before SQLite commit, acquire authority; commit includes `authority_id`; release on commit or crash expiry
- Authority lifecycle: `REQUESTED → GRANTED → COMMITTED → RELEASED | EXPIRED | REJECTED`

---

### §4 LAN-Coordinated Unique Item Sale

**Status: ❌ MISSING**

**Current implementation:**  
UDP discovery (`lanDiscovery.js`) locates the active host. All clients route through the single active host via HTTP. There is no LAN pre-commit coordination protocol separate from the Branch Service.

**Relevant files:**
- `backend/src/services/lanDiscovery.js` — UDP broadcast advertising
- `backend/src/routes/devices.js` — discovery endpoints

**Current tests:** None for LAN authority coordination.

**Missing behavior:**
- No LAN coordinator election
- No LAN authority grant/reject protocol
- No authenticated LAN message exchange for exclusive item authority
- Broadcasting ITEM_SOLD after commit is not implemented (correct: pre-commit authority is needed)

**Risk:** HIGH — when AWS is down and multiple PCs exist, no safe coordination mechanism exists for unique-tag sales.

**Proposed minimal change:**
- Design `desktop/lib/services/lanAuthority.js` — HTTP-based (not UDP) exclusive authority requests to the elected LAN coordinator
- LAN coordinator responds: GRANTED | REJECTED | COORDINATOR_UNAVAILABLE
- Winner commits local SQLite TX; emits durable SALE event to peers

---

### §5 Temporary LAN Coordinator

**Status: ❌ MISSING**

**Current implementation:**  
The Branch Service acts as a permanent coordinator via its role enforcement. There is no temporary/elected coordinator mechanism for the SQLite-per-device architecture.

**Relevant files:**
- `backend/src/services/recoveryService.js` — manual promotion (closest analog)
- `backend/src/middleware/requireAuthoritativeHost.js` — write-fence

**Current tests:** Manual promotion tested in acceptance suite.

**Missing behavior:**
- No deterministic coordinator selection algorithm
- No coordinator epoch/term
- No coordinator heartbeat + lease expiry
- No safe re-election if coordinator disappears
- No ISOLATED mode entry when coordinator unavailable

**Risk:** HIGH — without a coordinator, LAN-coordinated sales cannot safely proceed.

**Proposed minimal change:**
- Coordinator = lowest `device_id` (lexicographic) among devices with `last_seen` within 30s
- Epoch = incrementing integer; old coordinator cannot grant authority after epoch change
- Heartbeat every 5s; election timeout 15s
- Document: this is NOT Raft; it is a simple deterministic lease with fail-closed behavior

---

### §6 Split-Brain Protection

**Status: ⚠️ PARTIAL (write-fence only, not network-partition tested)**

**Current implementation:**  
`requireAuthoritativeHost.js` calls `fenceIfSuperseded()` which queries `Device` table for another active host. If found, the old host is fenced and returns 503. This prevents dual-active writes **when both hosts can still reach the same PostgreSQL database**.

**Relevant files:**
- `backend/src/middleware/requireAuthoritativeHost.js`
- `backend/src/services/recoveryService.js` — `fenceIfSuperseded`

**Current tests:** `acceptanceSimulation.test.js` — promote + fence tested. ✅

**Missing behavior:**
- Fencing only works if both hosts share the same DB (PostgreSQL). In SQLite-per-device architecture, there is no shared DB to fence through.
- Network partition where PC1 and PC2 are separated but each can reach their own SQLite — not tested
- No quorum/majority rule for coordinator authority

**Risk:** CRITICAL — in the target architecture, the write-fence mechanism must be redesigned for SQLite.

**Proposed minimal change:**
- Coordinator epoch must be verified at each authority grant
- If coordinator cannot confirm quorum (>50% of registered devices reachable), refuse to grant authority
- Document: with 2 PCs, partition = ISOLATED for both sides (no majority possible)

---

### §7 Isolated Mode

**Status: ❌ MISSING**

**Current implementation:**  
The frontend shows a generic "Offline" banner via `ConnectivityBanner`. There is no ISOLATED mode that explicitly blocks unique-tag checkout.

**Relevant files:**
- `frontend/src/components/common/ConnectivityBanner.jsx` — online/offline display
- `frontend/src/lib/api.js` — connectivity check

**Current tests:** None for ISOLATED mode behavior.

**Missing behavior:**
- No distinction between "cloud offline but LAN active" and "fully isolated"
- No checkout gate that checks authority state before allowing payment
- No specific error message explaining why checkout is blocked
- Safe operations (product lookup, customer lookup, invoice history, reprint, drafts) not explicitly whitelisted in isolated mode

**Risk:** HIGH — an isolated device could successfully create a local invoice for a unique tag that another device is simultaneously selling on the LAN.

**Proposed minimal change:**
- `AuthorityStateService` emits ISOLATED event
- Checkout route checks authority state; if ISOLATED, block unique-tag checkout with specific error
- UI shows "ISOLATED — unique item billing unavailable" (not generic "offline")

---

### §8 Authority Loss During Checkout

**Status: ❌ MISSING**

**Current implementation:**  
No authority lifecycle is implemented. There is no mechanism to detect authority loss between grant and commit.

**Missing behavior:**
- No `REQUESTED → GRANTED → COMMITTED → RELEASED | EXPIRED | REJECTED` lifecycle
- No expiry check at payment confirmation time
- No behavior defined for "authority granted, network disappears, cashier clicks Pay"

**Risk:** MEDIUM — in current single-Branch architecture, authority is implicit (transaction lock holds for duration of HTTP request). In distributed architecture, a stale unexpired authority could be used after network recovery.

**Proposed minimal change:**
- Authority expires in ≤30s (billing must complete within window)
- At payment confirmation, verify authority is still GRANTED and not expired before SQLite COMMIT
- If expired: reject, reacquire, inform cashier

---

### §9 Invoice Numbering

**Status: 🔴 UNSAFE for distributed offline**

**Current implementation:**  
`invoiceSequence.js` uses PostgreSQL `FOR UPDATE` on `invoice_sequences` table within the billing TX. Format: `PREFIX-YYMMDD-NNNN`. Race-safe for single Branch writer. 40 concurrent test cases pass with no collision.

**Relevant files:**
- `backend/src/services/invoiceSequence.js`
- `backend/src/migrations/20260728120003-create-invoice-sequences.js`
- `backend/tests/invoiceSequence.test.js`

**Current tests:** ✅ 40 concurrent, no collisions.

**Missing behavior:**
- If two devices are offline and each run their own sequence, they will produce colliding invoice numbers
- No offline-capable numbering strategy documented or implemented
- No `docs/invoice-numbering-design.md`

**Risk:** CRITICAL — legal/GST compliance requires unique invoice numbers. Duplicates from offline devices merging into cloud is a compliance failure.

**Proposed minimal change:**
- Option A (Recommended): Cloud pre-allocates blocks of N numbers per device (`DEV001-001` through `DEV001-100`). Device uses block until exhausted, then requests next block. Works offline for block size duration.
- Option B: Device-scoped series: `{SHOP_PREFIX}-{DEVICE_ID_SHORT}-{DATE}-{SEQ}` — unique by design
- Create `docs/invoice-numbering-design.md` with chosen strategy and migration impact

---

### §10 Global IDs

**Status: ✅ IMPLEMENTED (for most entities)**

**Current implementation:**  
All primary keys use UUID (`defaultValue: DataTypes.UUIDV4`). Invoice, payment, inventory movement, customer, order, repair, scheme, sync event — all use UUID.

**Relevant files:**
- All model files in `backend/src/models/` — UUID primary keys
- `backend/src/services/syncOutbox.js` — `event_id = uuidv4()`

**Current tests:** Implicit in all existing tests.

**Missing behavior:**
- Local SQLite auto-increment IDs exist for internal indexing — acceptable per spec as long as sync identity uses UUID
- No ULID usage (UUIDs are collision-safe; ULID would add lexicographic sortability)
- `sync_outbox.event_id` is UUID ✅

**Risk:** LOW — UUIDs are collision-safe. No action required unless ULID ordering is needed.

---

### §11 Entity Conflict Policy

**Status: ❌ MISSING**

**Current implementation:**  
No formal conflict policy documented or implemented. Sync push is invoice-centric. Cloud ingest processes events but does not handle conflicts for customers, products, or settings.

**Missing behavior:**
- No `docs/conflict-policy.md`
- No per-entity classification of: source of authority, offline mutability, conflict strategy
- No merge logic for customer field conflicts (phone on PC1, address on PC2)
- No protection against stale product edits overwriting inventory state

**Risk:** HIGH — without conflict policy, multi-device sync will produce silent data loss on merge.

---

### §12 Financial Event Rules

**Status: ✅ IMPLEMENTED (for billing) / ❌ MISSING (for general sync)**

**Current implementation:**  
Invoice creation is atomic and append-only (outbox enqueued in same TX). `cancelInvoice` creates a SALE_RETURN movement and soft-deletes (never hard-deletes). Invoice numbers are never reused.

**Relevant files:**
- `backend/src/services/billingService.js` — atomic TX
- `backend/src/services/inventoryService.js` — append-only movements

**Missing behavior:**
- Cloud sync ingest does not validate financial event transitions before applying
- No compensating operation workflow (VOID/RETURN/REFUND) in the UI beyond cancel
- Completed invoices can still be edited via direct PATCH if no guard exists

**Risk:** MEDIUM.

---

### §13 Customer Conflicts

**Status: ❌ MISSING**

**Current implementation:**  
Customers can be created/edited on any PC. No merge logic exists. Sync push does not include customer create/update events.

**Missing behavior:**
- Field-level merge (phone + address from different PCs)
- Same-field conflict detection and resolution or flagging
- Customer events not enqueued in outbox

**Risk:** MEDIUM — data loss on customer edits across PCs.

---

### §14 Product Master Conflicts

**Status: ⚠️ PARTIAL**

**Current implementation:**  
`controllers/products.js` strips `stock_qty` and `status` from PATCH requests (inventory state protected). Product master fields (name, weights, purity, HSN, tax) are patchable.

**Relevant files:**
- `backend/src/controllers/products.js` — strips inventory fields from PATCH
- `shared/domain/inventory.js` — `PROTECTED_INVENTORY_FIELDS`

**Missing behavior:**
- Barcode changes not audited or guarded against overwriting sold item history
- No version field for product master (last-write-wins)
- Product master conflicts not resolved on sync

**Risk:** MEDIUM.

---

### §15 Gold Rate / Tax Config Versioning

**Status: ⚠️ PARTIAL**

**Current implementation:**  
`billingService.js` fetches current gold rate from `Setting` at invoice time and stores `gold_rate_snapshot` on the invoice. GST slab stored per line item. Invoice snapshot is preserved.

**Relevant files:**
- `backend/src/services/billingService.js` — `gold_rate_snapshot` written to invoice
- `backend/src/models/Invoice.js` — `gold_rate_snapshot`, `gst_slab` fields

**Current tests:** ✅ GST calc tests use snapshot.

**Missing behavior:**
- Gold rate changes are not audited (no `audit_events` write on setting change)
- No effective configuration version for offline devices
- No "config too stale" warning for isolated devices

**Risk:** MEDIUM.

---

### §16 Offline Authentication

**Status: ❌ MISSING**

**Current implementation:**  
Login via `POST /api/auth/login` → Branch Service validates password (bcrypt) → issues JWT. Requires Branch API to be reachable. If Branch is down, login is impossible.

**Relevant files:**
- `backend/src/routes/auth.js` — login endpoint
- `backend/src/middleware/auth.js` — JWT validation

**Current tests:** None for offline auth scenario.

**Missing behavior:**
- No cached user list with password hashes in SQLite for offline auth
- No offline session validity window
- No behavior defined for password change, employee disable, or role change propagation to offline devices
- No behavior for device revocation impact on cached sessions
- Auth secrets not stored in main process only (JWT validated in backend, not renderer — this is correct)

**Risk:** HIGH — a device that loses Branch connectivity cannot authenticate any user.

---

### §17 Revocation Limitation

**Status: ❌ MISSING (documentation only)**

**Missing behavior:**
- No documented offline validity window for auth
- No `last_sync_time` check before allowing high-risk actions
- No documented policy for what isolated devices may do with stale credentials

**Risk:** LOW for now (single Branch path). HIGH in distributed SQLite architecture.

---

### §18 Device Identity

**Status: ⚠️ PARTIAL**

**Current implementation:**  
`Device` model stores `device_identifier` (UUID, unique per shop). Generated at registration. Desktop config (`desktop-config.json`) stores `device_name`. No cryptographic key pair. No Windows Credential Store usage.

**Relevant files:**
- `backend/src/models/Device.js`
- `desktop/lib/config.js` — stores device_name only
- `desktop/main.js` — no key generation

**Missing behavior:**
- No durable cryptographic device identity (key pair)
- No Windows Credential Store integration
- Device identity not stored outside `desktop-config.json` (plaintext JSON in userData)
- Renderer cannot be prevented from reading userData JSON (not private key, but identity is exposed)

**Risk:** MEDIUM — `device_identifier` is a UUID, not a cryptographic credential. Device can be impersonated if `desktop-config.json` is copied.

---

### §19 Device Pairing

**Status: ⚠️ PARTIAL**

**Current implementation:**  
`POST /api/devices/pairing-code` generates a 6-digit code stored in process RAM for 10 minutes. `POST /api/devices/register` validates code + registers device. Role assigned as `client`.

**Relevant files:**
- `backend/src/routes/devices.js` — pairing + register endpoints
- `backend/tests/acceptanceSimulation.test.js` — pairing tested

**Current tests:** ✅ Pairing flow tested in acceptance suite.

**Missing behavior:**
- Pairing code stored in process RAM (lost on crash; not durable)
- No audit event for device pairing (who approved, when, which device)
- Desktop Join UI still uses manual URL entry (mDNS/auto-discovery deferred)
- No cryptographic challenge-response in pairing (code only)

**Risk:** MEDIUM.

---

### §20 Device Revocation

**Status: 🧪 UNTESTED**

**Current implementation:**  
`Device.status` enum includes `revoked`. `PUT /api/devices/:id/revoke` exists. Cloud would reject sync from revoked device IF credential check is implemented (not verified in cloud sync route).

**Relevant files:**
- `backend/src/models/Device.js` — `status: revoked`
- `backend/src/routes/devices.js` — revoke endpoint

**Current tests:** No test for revocation rejection of sync/auth.

**Missing behavior:**
- Cloud sync push does not verify device status before processing events
- Peers do not receive revocation events or apply them
- No audit event for revocation
- UI for revocation in Settings/Devices not verified

**Risk:** HIGH — revoked device can continue syncing indefinitely.

---

### §21 LAN Peer Authentication

**Status: ❌ MISSING**

**Current implementation:**  
UDP discovery (`lanDiscovery.js`) locates active host candidates. Clients use HTTP with JWT for Branch API calls. UDP discovery packets are unauthenticated — any process on the LAN can respond to discovery.

**Relevant files:**
- `backend/src/services/lanDiscovery.js` — unauthenticated UDP

**Missing behavior:**
- No peer authentication before accepting authority requests, sale events, or sync events
- No device credential verification on LAN messages
- Any laptop on shop Wi-Fi could advertise itself as active host via UDP

**Risk:** HIGH in target architecture.

---

### §22 LAN Message Security

**Status: ❌ MISSING**

**Current implementation:**  
LAN messages are UDP broadcast (discovery) or HTTP (Branch API). No message-level authentication, HMAC, nonce, or replay protection.

**Missing behavior:**
- No shop/device identity in LAN messages
- No message ID or nonce for replay protection
- No payload integrity verification
- No cross-shop message rejection

**Risk:** HIGH.

---

### §23 Clock Safety

**Status: ⚠️ PARTIAL**

**Current implementation:**  
Invoice timestamps use `created_at` (server wall clock). Sequence numbers use date portion (`YYMMDD`) — vulnerable to clock skew. `event_id` is UUID (not time-ordered but collision-safe).

**Missing behavior:**
- No logical clock / per-device sequence for distributed ordering
- `YYMMDD` in invoice numbers vulnerable to clock manipulation
- Inventory winner never decided by timestamp (correct — uses DB locks) ✅
- No detection or audit of significant clock discrepancies

**Risk:** MEDIUM.

---

### §24 Durable Outbox

**Status: ✅ IMPLEMENTED (for invoices)**

**Current implementation:**  
`billingService.createInvoice` writes `sync_outbox` row in the **same Sequelize transaction** as invoice + inventory + payment. Uses `t.afterCommit()` to trigger sync. If TX rolls back, outbox row does not exist.

**Relevant files:**
- `backend/src/services/billingService.js` — outbox in same TX
- `backend/src/services/syncOutbox.js` — `enqueueSyncEvent`
- `backend/tests/syncService.test.js` — enqueue + exactly-once tested

**Current tests:** ✅ Enqueue + idempotent push tested.

**Missing behavior:**
- Only invoice create/cancel is enqueued
- Customer, product, stock adjustment, purchase events NOT enqueued
- SQLite analog not yet implemented (Phase D+)

**Risk:** MEDIUM — partial coverage.

---

### §25 Crash Matrix

**Status: 🧪 UNTESTED**

**Current implementation:**  
Atomic TX means crashes before COMMIT produce no partial state. Crashes after COMMIT but before sync are safe because outbox was committed in same TX. No automated crash tests exist.

**Current tests:** Manual acceptance scenarios only.

**Missing behavior:** No automated crash injection tests for any of the 13 crash points (A–M).

**Risk:** MEDIUM — logic is correct by design; coverage is unverified.

---

### §26 Idempotency

**Status: ✅ IMPLEMENTED (invoice) / ❌ MISSING (other entities)**

**Current implementation:**  
Invoice creation: `request_id` unique partial index → lookup before create → return existing. Sync push: `event_id` unique → `SyncProcessedEvent` check → skip if seen. Cancel: idempotent (check `cancelled_at` before proceeding).

**Relevant files:**
- `backend/src/services/billingService.js` — `request_id` check
- `backend/src/routes/sync.js` — `SyncProcessedEvent` check
- `backend/tests/billingService.test.js` — double-click test ✅

**Missing behavior:**
- Void/refund idempotency not tested
- Payment creation idempotency (split payment retry) not verified
- LAN event receiver idempotency not implemented

**Risk:** MEDIUM.

---

### §27 Event Versioning

**Status: ❌ MISSING**

**Current implementation:**  
`SyncOutbox` has `event_type` and `payload` (JSONB). No `event_version` field. No version handling in sync ingest.

**Missing behavior:**
- No `event_version` on outbox events
- No compatibility handling for old/new event versions
- No safe failure for unknown event versions

**Risk:** MEDIUM — will become HIGH when first schema-breaking event change ships.

---

### §28 App Version Compatibility

**Status: ❌ MISSING**

**Current implementation:**  
`SchemaMeta` table tracks `schema_version`. Desktop `db:status` IPC returns schema version. No peer/cloud handshake verifies compatibility.

**Missing behavior:**
- No `sync_protocol_version` tracking
- No COMPATIBLE / UPDATE_RECOMMENDED / INCOMPATIBLE states
- No blocking of risky distributed transactions between incompatible protocol versions

**Risk:** MEDIUM.

---

### §29 SQLite Migration Safety

**Status: ⚠️ PARTIAL**

**Current implementation:**  
`desktop/lib/db/migrate.js` applies migrations idempotently (tracked in `local_schema_migrations`). `desktopDb.test.js` verifies idempotent re-run. No pre-migration backup, no integrity check, no rollback path.

**Relevant files:**
- `desktop/lib/db/migrate.js`
- `desktop/tests/desktopDb.test.js`

**Current tests:** ✅ Idempotent migration test passes.

**Missing behavior:**
- No pre-migration backup
- No pending outbox count verification before migration
- No post-migration integrity check
- No rollback/recovery path if migration fails mid-way
- No test for upgrade with pending unsynced events

**Risk:** HIGH — a failed migration could corrupt the only local copy of unsynced invoices.

---

### §30 SQLite File Security

**Status: ⚠️ PARTIAL**

**Current implementation:**  
SQLite accessed exclusively from Electron main process. IPC allowlist prevents renderer from executing raw SQL. No DB encryption. `contextIsolation=true`, `nodeIntegration=false`.

**Relevant files:**
- `desktop/main.js` — IPC allowlist
- `desktop/preload.js` — validated channel bridge

**Missing behavior:**
- SQLite file sits unencrypted in `userData/data/` — accessible to any process with user-level access
- No filesystem permission restriction beyond OS user account
- No integrity hash of DB file on startup

**Risk:** MEDIUM — spec acknowledges "assume privileged machine owner can interfere." Cloud reconciliation is the mitigation. Encryption explicitly evaluated and deferred per spec.

---

### §31 Audit Log Integrity

**Status: ❌ MISSING**

**Current implementation:**  
SQLite schema includes `audit_events` table. No application writes to it. No hash chaining or HMAC.

**Relevant files:**
- `desktop/lib/db/migrations/001_initial_schema.js` — `audit_events` table defined
- No service or controller writes audit events

**Missing behavior:**
- No `writeAuditEvent()` function
- No hash chaining between events
- Cloud does not receive or validate audit events

**Risk:** HIGH — no forensic trail for any sensitive action.

---

### §32 Audit Actions

**Status: ❌ MISSING**

**Current implementation:**  
None. No audit events written for any action listed in the spec.

**Missing behavior:** All 32 listed action types: login, device pair, invoice create/void, payment, stock adjustment, gold rate change, etc.

**Risk:** HIGH.

---

### §33 No Silent Delete of Financial Records

**Status: 🔴 UNSAFE**

**Current implementation:**  
- `POST /api/invoices/:id/cancel` — soft-delete (sets `cancelled_at`) ✅ Safe  
- `DELETE /api/products/:id` — **hard delete** 🔴  
- `DELETE /api/purchases/:id` — **hard delete** 🔴  
- `DELETE /api/customers/:id` — requires investigation

**Relevant files:**
- `backend/src/routes/invoices.js` — cancel only ✅
- `backend/src/routes/products.js` — DELETE endpoint exists 🔴
- `backend/src/routes/purchases.js` — DELETE endpoint exists 🔴

**Risk:** HIGH — deleting a product removes the foreign key anchor for `inventory_movements`, potentially breaking the movement ledger.

**Proposed minimal change:**
- Remove `DELETE /api/products/:id` from API; replace with `status=discontinued` soft-delete
- Remove `DELETE /api/purchases/:id`; replace with VOID operation
- Add DB-level `ON DELETE RESTRICT` for `inventory_movements.product_id`

---

### §34 Manager Approval

**Status: ⚠️ PARTIAL**

**Current implementation:**  
RBAC permissions system exists (`users.permissions` JSON, `requirePermission` middleware). Sensitive routes (`/settings`, `/employees`, `/stock-adjustments`) require manager-level permission. No explicit second-factor approval flow (PIN/password confirm for sensitive actions).

**Relevant files:**
- `backend/src/middleware/auth.js` — `requirePermission`
- `backend/src/permissions.js` — permission constants

**Missing behavior:**
- No in-app manager PIN confirmation flow for void, large discount, gold rate override
- Requester + approver not stored separately on sensitive operations
- No approval workflow for device pairing

**Risk:** MEDIUM.

---

### §35 Cash Reconciliation

**Status: 🧪 UNTESTED**

**Current implementation:**  
`POST /api/system/eod` exists. Expected cash calculation not verified in code review.

**Relevant files:**
- `backend/src/routes/system.js` — EOD endpoint

**Missing behavior:**
- Opening cash tracking not confirmed
- Cash additions/removals during day not confirmed
- Manager acknowledgment of shortfall not confirmed
- Persistence of expected/actual/difference not confirmed

**Risk:** MEDIUM.

---

### §36 EOD Control Panel

**Status: 🧪 UNTESTED**

**Current implementation:**  
EOD API exists. Frontend EOD view not verified.

**Missing behavior:**
- All fields listed in spec not confirmed present
- Pending/failed sync events in EOD not confirmed
- Per-device sync status in EOD not confirmed

**Risk:** MEDIUM.

---

### §37 Backup vs Sync

**Status: ⚠️ PARTIAL**

**Current implementation:**  
`backupService.js` runs `pg_dump + gzip` to `backend/.backups/`. SQLite backup via `db:backup` IPC (SQLite Backup API — safe with WAL). Both exist as separate mechanisms.

**Relevant files:**
- `backend/src/services/backupService.js`
- `desktop/main.js` — `db:backup` IPC
- `desktop/tests/desktopDb.test.js` — backup test ✅

**Missing behavior:**
- Backup restore flow not tested (backup → corrupt DB → restore → verify invoices)
- PostgreSQL backup restore not automated
- Backup scheduling not automatic (manual trigger only)

**Risk:** MEDIUM.

---

### §38 Local Durability Level

**Status: ❌ MISSING**

**Current implementation:**  
No durability state is tracked or exposed. SQLite WAL provides COMMIT-level durability. No `COMMITTED_LOCAL | REPLICATED_LAN | SYNCED_CLOUD` distinction.

**Missing behavior:**
- No durability state on invoice/transaction records
- EOD does not expose per-transaction durability
- No UI indication beyond sync pending count

**Risk:** MEDIUM.

---

### §39 Single-PC Shop

**Status: 🧪 UNTESTED**

**Current implementation:**  
Architecture supports single PC — Branch Service + local PG is the only PC. LAN coordination not needed. Cloud sync works normally.

**Missing behavior:**
- No documented single-device offline authority policy
- No test for single-PC offline unique-tag sale (is it safe? Must be proven, not assumed)
- Recovery scenario with single PC not tested

**Risk:** LOW-MEDIUM.

---

### §40 Adding More PCs

**Status: ⚠️ PARTIAL**

**Current implementation:**  
Device registry supports dynamic membership. Pairing code generates per-request. No hardcoded PC1/PC2. Discovery is broadcast-based (finds any advertising host).

**Missing behavior:**
- No test for 5+ PCs simultaneously
- No load test for discovery/heartbeat at scale
- Maximum device count not defined

**Risk:** LOW.

---

### §41 Peer Catch-Up

**Status: 🧪 UNTESTED**

**Current implementation:**  
`SyncState` table tracks cursors. `syncPull.js` stub exists. No automated catch-up flow when a PC reconnects.

**Missing behavior:**
- PC3 disconnecting and reconnecting does not trigger pull of missed events
- No catch-up mechanism verified
- Cloud event history retention not defined

**Risk:** HIGH — without catch-up, disconnected PCs will have stale inventory indefinitely.

---

### §42 Peer Stale-State Detection

**Status: ❌ MISSING**

**Missing behavior:**
- No `last_sync_time` check before allowing coordinated checkout
- No policy for "stale for > N hours → require catch-up before billing"
- No stale-state UI warning

**Risk:** HIGH.

---

### §43 Cloud Reconciliation

**Status: ⚠️ PARTIAL**

**Current implementation:**  
Cloud sync push validates `event_id` idempotency via `SyncProcessedEvent`. No conflict detection for financial events beyond duplicate prevention.

**Missing behavior:**
- No validation of inventory transitions in cloud ingest (can accept SALE for already-sold item)
- No `sync_conflict` record type
- No conflict review UI for owner

**Risk:** HIGH.

---

### §44 Sync Ordering

**Status: ❌ MISSING**

**Current implementation:**  
Events pushed in batch by `syncWorker`. No dependency ordering enforced.

**Missing behavior:**
- Payment event pushed before invoice event could fail
- Void pushed before original invoice could fail
- No dependency-aware retry

**Risk:** MEDIUM.

---

### §45 Payment Safety

**Status: ✅ IMPLEMENTED (for current path)**

**Current implementation:**  
`validatePayments` enforces sum within ±₹0.50. Multiple payment modes supported. Payment stored as JSONB snapshot on invoice. `request_id` prevents double-create.

**Current tests:** ✅ Payment validation tests pass.

**Missing behavior:**
- Online payment gateway distinction (initiated/authorized/captured) not needed for cash-first jewellery POS
- Split payment retry idempotency not explicitly tested
- Payment correction audit not implemented

**Risk:** LOW for current scope.

---

### §46 Barcode Safety

**Status: ⚠️ PARTIAL**

**Current implementation:**  
Partial unique index `(shop_id, barcode)` added in migration 09 — **conditional**: migration skips index if duplicates exist in the database.

**Relevant files:**
- `backend/src/migrations/20260728120009-barcode-unique-index.js`

**Current tests:** `docs/barcode-duplicate-audit.json` exists (audit run).

**Missing behavior:**
- If the migration was skipped (duplicates existed), barcode uniqueness is not enforced
- No check on product edit that barcode change doesn't collide with sold item
- No audit event for barcode changes

**Risk:** HIGH if duplicates exist and index was skipped.

---

### §47 Print Safety

**Status: ⚠️ PARTIAL**

**Current implementation:**  
Barcode tag printed after `api.post('/products')` succeeds (ProductForm). Invoice printing via `print:page` IPC. No verification that TX was committed before print is triggered.

**Missing behavior:**
- No explicit COMMIT confirmation before invoice print
- If `api.post` returns success but TX was not fully committed (edge case), print could precede actual commit
- Reprint creates a new print window from same invoice data (correct: does not create new invoice) ✅
- No reprint audit event

**Risk:** LOW (HTTP response implies COMMIT in Express/Sequelize flow).

---

### §48 System Health

**Status: ⚠️ PARTIAL**

**Current implementation:**  
`GET /api/system/diagnostics` returns: cloud_status, LAN_status, authority state, DB health, schema version, app version, pending/failed events, last sync, backup status.

**Relevant files:**
- `backend/src/routes/system.js`

**Current tests:** Implicit in acceptance suite.

**Missing behavior:**
- `coordination_state` (CLOUD_COORDINATED/LAN_COORDINATED/ISOLATED) not in diagnostics (not implemented yet)
- Device identity not in diagnostics
- sync_protocol_version not tracked

**Risk:** LOW.

---

### §49 User-Facing Connectivity

**Status: ⚠️ PARTIAL**

**Current implementation:**  
`ConnectivityBanner` shows online/offline. No distinction between "offline but LAN active" and "isolated."

**Missing behavior:**
- Three states not rendered: ONLINE / OFFLINE-SHOP-NETWORK-ACTIVE / LIMITED-OFFLINE
- No cashier-friendly message for blocked checkout in isolated mode

**Risk:** LOW-MEDIUM.

---

### §50 Failure UX

**Status: ❌ MISSING**

**Current implementation:**  
Generic API error toast. No specific error for "checkout blocked due to isolated mode."

**Missing behavior:**
- No ISOLATED-mode-specific error message
- No "Reconnect to shop network" guidance
- No "Continue Anyway" gate (blocking is required — this must not exist for unique-tag)

**Risk:** MEDIUM.

---

### §51 Observability

**Status: ⚠️ PARTIAL**

**Current implementation:**  
Express logs requests. No structured logging with `transaction_id`, `request_id`, `event_id`, `device_id`, `authority_id`.

**Missing behavior:**
- No structured log fields per spec
- No log sanitization check for password/key leakage
- No log aggregation path to cloud

**Risk:** LOW.

---

### §52 Cloud Data Loss / Disaster

**Status: 🧪 UNTESTED**

**Current implementation:**  
Recovery snapshots + pg_dump documented. No disaster recovery drills automated.

**Missing behavior:**
- No `docs/disaster-recovery.md`
- No verified restore flow for "all shop PCs lost"
- No documented RTO/RPO

**Risk:** HIGH.

---

### §53 Security Threat Model

**Status: ❌ MISSING**

**Missing behavior:**
- No `docs/security-threat-model.md`
- No per-threat risk/prevention/detection/recovery/limitation documentation

**Risk:** MEDIUM (operational risk without documentation).

---

### §54–§66 Required Tests

| Test | Status | Notes |
|------|--------|-------|
| §54 Same tag online | ✅ IMPLEMENTED | `acceptanceSimulation.test.js` — concurrent unique race, one winner |
| §55 Same tag LAN offline | ❌ MISSING | No LAN coordination implemented yet |
| §56 Network partition | ❌ MISSING | No partition test; write-fence not tested under partition |
| §57 Coordinator failure | ❌ MISSING | No coordinator election implemented |
| §58 App crash after commit | 🧪 UNTESTED | Logic correct (outbox in TX); no crash injection test |
| §59 Cloud ACK lost | ✅ IMPLEMENTED | `syncService.test.js` — duplicate event_id → idempotent ACK |
| §60 Device stolen / revoked | 🧪 UNTESTED | Revoke endpoint exists; sync rejection not tested |
| §61 Clock tampering | ❌ MISSING | No clock-independence test |
| §62 Old app version | ❌ MISSING | No compatibility check implemented |
| §63 SQLite tamper | ❌ MISSING | No integrity check on startup |
| §64 Update with pending events | ❌ MISSING | No migration-with-pending-events test |
| §65 New PC join | ⚠️ PARTIAL | Pairing flow tested; no full end-to-end installer test |
| §66 Single PC | 🧪 UNTESTED | Works by design; not explicitly verified |

---

### §67 Load Test

**Status: ❌ MISSING**

**Missing behavior:**
- No load test for 10,000 products, concurrent billing under sync load
- No barcode lookup performance test under concurrent billing

---

### §68 Regression — Existing Business Features

**Status: ✅ IMPLEMENTED (for current Branch path)**

**Current implementation:**  
POS, customers, products, inventory, purchases, quotations, orders/repairs, schemes, employees, permissions, reports, settings, barcode printing, invoice printing, split payments, old gold exchange — all implemented and passing in acceptance suite.

**Risk:** LOW for current path. MEDIUM after SQLite billing migration.

---

### §69–§73 Implementation Order / Documentation / Final Report

**Status: ❌ MISSING**

- `docs/connectivity-state-machine.md` — MISSING
- `docs/transaction-authority.md` — MISSING
- `docs/lan-coordination.md` — MISSING
- `docs/invoice-numbering-design.md` — MISSING
- `docs/conflict-policy.md` — MISSING
- `docs/offline-auth.md` — MISSING
- `docs/device-security.md` — MISSING
- `docs/sync-protocol.md` — MISSING
- `docs/audit-security.md` — MISSING
- `docs/eod-reconciliation.md` — MISSING
- `docs/disaster-recovery.md` — MISSING
- `docs/security-threat-model.md` — MISSING
- `docs/local-first-production-report.md` — MISSING

---

## Summary Table

| Section | Requirement | Status |
|---------|-------------|--------|
| §2 | Authority model | ❌ MISSING |
| §3 | Cloud unique-tag authority | 🔴 UNSAFE (single-writer only) |
| §4 | LAN unique-tag authority | ❌ MISSING |
| §5 | Temporary LAN coordinator | ❌ MISSING |
| §6 | Split-brain protection | ⚠️ PARTIAL |
| §7 | Isolated mode | ❌ MISSING |
| §8 | Authority loss during checkout | ❌ MISSING |
| §9 | Invoice numbering | 🔴 UNSAFE (distributed) |
| §10 | Global IDs (UUID) | ✅ IMPLEMENTED |
| §11 | Entity conflict policy | ❌ MISSING |
| §12 | Financial event rules | ✅ / ❌ PARTIAL |
| §13 | Customer conflicts | ❌ MISSING |
| §14 | Product master conflicts | ⚠️ PARTIAL |
| §15 | Gold rate versioning | ⚠️ PARTIAL |
| §16 | Offline authentication | ❌ MISSING |
| §17 | Revocation limitation doc | ❌ MISSING |
| §18 | Device identity | ⚠️ PARTIAL |
| §19 | Device pairing | ⚠️ PARTIAL |
| §20 | Device revocation | 🧪 UNTESTED |
| §21 | LAN peer authentication | ❌ MISSING |
| §22 | LAN message security | ❌ MISSING |
| §23 | Clock safety | ⚠️ PARTIAL |
| §24 | Durable outbox | ✅ IMPLEMENTED (invoices only) |
| §25 | Crash matrix | 🧪 UNTESTED |
| §26 | Idempotency everywhere | ⚠️ PARTIAL |
| §27 | Event versioning | ❌ MISSING |
| §28 | App version compatibility | ❌ MISSING |
| §29 | SQLite migration safety | ⚠️ PARTIAL |
| §30 | SQLite file security | ⚠️ PARTIAL |
| §31 | Audit log integrity | ❌ MISSING |
| §32 | Audit actions | ❌ MISSING |
| §33 | No silent delete of financial records | 🔴 UNSAFE |
| §34 | Manager approval | ⚠️ PARTIAL |
| §35 | Cash reconciliation | 🧪 UNTESTED |
| §36 | EOD control panel | 🧪 UNTESTED |
| §37 | Backup vs sync | ⚠️ PARTIAL |
| §38 | Local durability level | ❌ MISSING |
| §39 | Single-PC shop | 🧪 UNTESTED |
| §40 | Adding more PCs | ⚠️ PARTIAL |
| §41 | Peer catch-up | 🧪 UNTESTED |
| §42 | Peer stale-state detection | ❌ MISSING |
| §43 | Cloud reconciliation | ⚠️ PARTIAL |
| §44 | Sync ordering | ❌ MISSING |
| §45 | Payment safety | ✅ IMPLEMENTED |
| §46 | Barcode safety | ⚠️ PARTIAL |
| §47 | Print safety | ⚠️ PARTIAL |
| §48 | System health | ⚠️ PARTIAL |
| §49 | User-facing connectivity | ⚠️ PARTIAL |
| §50 | Failure UX | ❌ MISSING |
| §51 | Observability | ⚠️ PARTIAL |
| §52 | Disaster recovery | 🧪 UNTESTED |
| §53 | Security threat model | ❌ MISSING |
| §54 | Test: same tag online | ✅ IMPLEMENTED |
| §55 | Test: same tag LAN offline | ❌ MISSING |
| §56 | Test: network partition | ❌ MISSING |
| §57 | Test: coordinator failure | ❌ MISSING |
| §58 | Test: crash after commit | 🧪 UNTESTED |
| §59 | Test: cloud ACK lost | ✅ IMPLEMENTED |
| §60 | Test: device stolen | 🧪 UNTESTED |
| §61 | Test: clock tampering | ❌ MISSING |
| §62 | Test: old app version | ❌ MISSING |
| §63 | Test: SQLite tamper | ❌ MISSING |
| §64 | Test: update with pending events | ❌ MISSING |
| §65 | Test: new PC join | ⚠️ PARTIAL |
| §66 | Test: single PC | 🧪 UNTESTED |
| §67 | Load test | ❌ MISSING |
| §68 | Regression: existing features | ✅ IMPLEMENTED |
| §69–73 | Implementation order / docs | ❌ MISSING |

---

## Counts

| Status | Count |
|--------|-------|
| ✅ IMPLEMENTED | 7 |
| ⚠️ PARTIAL | 20 |
| ❌ MISSING | 27 |
| 🔴 UNSAFE | 3 |
| 🧪 UNTESTED | 10 |
| **Total** | **67** |

---

## Implementation Priority (Phase 2 onwards)

**Blocking everything else (do first):**
1. §33 — Remove `DELETE /products/:id` and `DELETE /purchases/:id` hard-delete paths (immediate risk, 1-hour fix)
2. §2 — Authority state machine (prerequisite for §3–§8)
3. §9 — Invoice numbering redesign for offline devices

**Phase 2 critical path:**
4. §3 — Cloud pre-commit authority (unique-tag lease)
5. §7 — Isolated mode enforcement + checkout gate
6. §16 — Offline authentication (cached user list in SQLite)

**Phase 3:**
7. §5 + §4 — LAN coordinator + LAN authority protocol
8. §6 — Split-brain protection redesign for SQLite

**Phase 4+ (important but not immediately blocking):**
- §31 + §32 — Audit log wiring
- §11 + §13 + §14 — Conflict policies
- §27 + §28 — Event versioning + app compatibility
- §21 + §22 — LAN peer authentication + message security

---

*Audit complete. Proceed to Phase 2 implementation.*
