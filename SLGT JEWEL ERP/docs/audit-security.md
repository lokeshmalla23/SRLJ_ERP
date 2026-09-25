# Audit and Security Logging

An append-only audit trail records security-sensitive and business-critical actions. Audit writes never block or fail business operations.

---

## Audit Table

```sql
CREATE TABLE audit_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id       TEXT    NOT NULL,
  device_id     TEXT    NOT NULL,
  user_id       TEXT,                   -- NULL for system actions
  action        TEXT    NOT NULL,       -- dot-namespaced, see below
  entity_type   TEXT,                   -- 'invoice' | 'stock_item' | 'user' | ...
  entity_id     TEXT,                   -- PK of the affected row
  request_id    TEXT,                   -- authority request_id when applicable
  reason        TEXT,                   -- operator-provided reason (cancellations etc.)
  metadata_json TEXT,                   -- arbitrary extra context, JSON string
  created_at    TEXT    NOT NULL        -- ISO-8601 UTC, set at write time
);
```

There is no `UPDATE` or `DELETE` API for this table. The application layer never issues `DELETE FROM audit_events`. Rows accumulate indefinitely and are only ever read.

---

## Action Namespaces

| Action                          | Triggered by                                             |
|---------------------------------|----------------------------------------------------------|
| `auth.login`                    | Successful online login                                  |
| `auth.loginFailed`              | Failed online login attempt                              |
| `auth.loginOffline`             | Offline login attempt (success or failure)               |
| `auth.logout`                   | User session ended                                       |
| `authority.stateChange`         | Connectivity state machine transitions                   |
| `authority.leaseGranted`        | Cloud or LAN authority lease granted                     |
| `authority.leaseRejected`       | Authority reserve request rejected                       |
| `invoice.create`                | New invoice created                                      |
| `invoice.cancel`                | Invoice cancelled (includes `reason`)                    |
| `stock.adjust`                  | Manual stock adjustment (includes before/after quantity) |
| `settings.goldRate.change`      | Gold rate updated (includes old and new values)          |

Additional actions can be added without schema changes — the `action` column is free-text.

---

## Non-Throwing Contract

`auditService.log()` wraps every write in a `try/catch` and swallows all errors. It never re-throws. Callers must not rely on the return value to confirm that the audit row was written.

```js
// Correct usage — fire and forget
auditService.log('invoice.create', { shop_id, device_id, user_id, entity_id: invoiceId, metadata_json: { total } });

// The business operation continues regardless of audit outcome
await createInvoice(data);
```

Audit failure is logged to the Electron console (`console.error`) for local debugging but does not surface to the user and does not roll back the enclosing transaction.

---

## Integrity Properties

| Property             | Mechanism                                                       |
|----------------------|-----------------------------------------------------------------|
| Append-only          | No DELETE/UPDATE API; enforced at application layer             |
| Tamper detection     | Not implemented — file-system integrity relies on OS controls   |
| Retention            | Indefinite (no automated purge)                                 |
| Sync to cloud        | audit_events are NOT synced via the outbox — local record only  |
| Concurrent writes    | SQLite serialises writes; no additional locking needed          |

---

## Cloud Audit (Separate)

The AWS backend maintains its own audit log for API-level events (authority grants, sync ingests, admin actions). That log is managed independently and is not covered by this document.

---

## Implementation

`desktop/lib/services/auditService.js` — `log(action, fields)` async, never throws

The service opens a dedicated write connection to SQLite to avoid contention with the business transaction connection.
