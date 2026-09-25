# Sync Protocol

All business writes are captured in a local outbox and replayed to the cloud when connectivity allows. The cloud ingest endpoint is idempotent, so retries are safe.

---

## Outbox-First Pattern

Every business write follows this pattern — **in a single SQLite transaction**:

```
BEGIN IMMEDIATE
  INSERT/UPDATE business table (sales, stock, invoices, ...)
  INSERT sync_outbox (event_id, entity_type, entity_id, operation, event_version, payload_json)
COMMIT
```

The outbox row is written atomically with the business row. If the transaction rolls back, neither row exists. There is no window where a business record exists without a corresponding outbox event.

---

## Event Format

```json
{
  "event_id":       "uuid-v4",
  "entity_type":    "invoice | sale | stock_item | customer | ...",
  "entity_id":      "uuid or integer PK of the affected row",
  "operation":      "create | update | cancel | adjust",
  "event_version":  3,
  "payload_json":   { ... full snapshot of the entity at time of write ... },
  "device_id":      "uuid",
  "shop_id":        "uuid",
  "created_at":     "ISO-8601 UTC"
}
```

`event_version` is a monotonically increasing integer maintained per `entity_type`. It increments when the payload shape changes. The cloud rejects unknown versions with **HTTP 422** so the desktop knows not to retry until it is upgraded.

---

## sync_outbox Table

```sql
CREATE TABLE sync_outbox (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT    NOT NULL UNIQUE,    -- UUID, idempotency key
  entity_type    TEXT    NOT NULL,
  entity_id      TEXT    NOT NULL,
  operation      TEXT    NOT NULL,
  event_version  INTEGER NOT NULL,
  payload_json   TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending',  -- pending | synced | failed
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  created_at     TEXT    NOT NULL,
  synced_at      TEXT
);
```

---

## Sync Worker Behavior

The sync worker runs in the main process and polls `sync_outbox WHERE status = 'pending'` ordered by `id ASC` (oldest first).

```
Poll pending events
    |
    For each event:
    |
    +-- POST /api/sync/ingest { event }
    |
    |   200 OK     --> markSynced(id)
    |   422        --> markFailed(id, 'unsupported_version') -- do not retry
    |   409        --> markSynced(id) -- already processed (idempotent)
    |   4xx other  --> markFailed(id, error) if attempt_count >= 3 else re-queue
    |   5xx / net  --> increment attempt_count, back off (exponential, max 5 min)
    |
    +-- next event
```

Events with `attempt_count >= 3` are marked `status = 'failed'` and surfaced in the admin UI for manual review. They are never automatically deleted.

---

## Cloud Ingest Endpoint

`POST /api/sync/ingest`

```
Request body: { event: EventObject }
Response 200: { ok: true }
Response 409: { ok: true, reason: 'already_processed' }   -- idempotent duplicate
Response 422: { ok: false, reason: 'unknown_event_version', supported: [1,2,3] }
Response 500: { ok: false, reason: '...' }
```

Idempotency is enforced via the `sync_processed_events` PostgreSQL table:

```sql
CREATE TABLE sync_processed_events (
  event_id    UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

On receipt, the cloud checks for `event_id` in this table before applying the business logic. If found, it returns 409 without re-applying. The desktop treats 409 as success.

---

## Migration Gate

Before running a schema migration, `desktop/lib/db/migrate.js` checks that `sync_outbox` has no pending events. If events are pending, the migration is deferred until the outbox drains. This prevents a situation where a migration changes the payload shape while old-format events are still in flight.

---

## Implementation

`desktop/lib/services/outboxService.js` — `enqueue(event)`, `markSynced(id)`, `markFailed(id, error)`

The sync worker is started from the main process after the DB is ready and runs continuously. It respects the connectivity state — it only attempts cloud sync when state is `CLOUD_COORDINATED`.
