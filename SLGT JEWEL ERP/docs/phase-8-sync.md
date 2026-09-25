# Phase 8 — Local ↔ Cloud Synchronization

**Status:** Complete — gate passed (core engine)  
**Date:** 2026-07-28

---

## 1. What changed

### Transactional outbox

Invoice create (billing TX) now calls `enqueueSyncEvent` **before COMMIT**:

- `sync_outbox` row with UUID `event_id`
- payload includes invoice snapshot
- status `pending`

Business commit cannot succeed without recording sync work.

### Sync worker (branch)

`backend/src/services/syncWorker.js`:

- Polls pending outbox
- Pushes to `CLOUD_ENDPOINT/api/sync/push`
- Exponential backoff via attempt_count / max 12
- Marks `synced` on ACK; `failed` after max attempts
- Without `CLOUD_ENDPOINT`: billing continues; pending retained

### Cloud ingest

`POST /api/sync/push`:

- Idempotent via `sync_processed_events`
- Schema mismatch → 409
- Optional `X-Sync-Key` when `SYNC_API_KEY` set
- Duplicate event → ACK without re-create

### Status APIs

- `GET /api/sync/status` — online, last sync, pending, failed
- `POST /api/sync/retry` — requeue failed (settings.manage)
- `GET/POST /api/sync/pull` — stub (admin pull expands later)

### UI

ConnectivityBanner shows pending/failed + Offline/Online.

---

## 2. Tests

```bash
npm run test:sync
```

**Result:** `ALL SYNC TESTS PASSED`

- Invoice → outbox in same path
- Duplicate cloud push → single `sync_processed_events` row

`npm run test:billing` still passes with outbox cleanup.

---

## 3. Gate

| Gate | Status |
|------|--------|
| Offline invoices queue | Pass |
| Reconnect pushes | Worker implemented (needs CLOUD_ENDPOINT) |
| Exactly-once via event_id | Pass (idempotent processed ledger) |

**Known limit:** Full multi-day 1000-event soak + cloud mirror of inventory movements is incremental; invoice envelope is V1 priority.

**Checkpoint:** Proceed to Phase 9.
