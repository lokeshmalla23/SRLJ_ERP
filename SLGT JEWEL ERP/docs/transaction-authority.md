# Transaction Authority

Describes the two authority tracks used to prevent double-selling unique-tag or quantity-controlled items across multiple devices.

---

## Authority Tracks

### Track A — Cloud Authority (CLOUD_COORDINATED state)

```
Desktop                         AWS Backend
  |                                 |
  |-- POST /api/authority/reserve ->|  (request_id, device_id, entity_id, ttl=30s)
  |<- 200 { lease_id, expires_at } -|
  |                                 |
  |-- SQLite BEGIN IMMEDIATE        |  (local write)
  |-- INSERT sale / decrement stock |
  |-- INSERT sync_outbox event      |
  |-- SQLite COMMIT                 |
  |                                 |
  |-- POST /api/authority/commit  ->|  (lease_id)
  |<- 200 OK ---------------------- |
  |                                 |
  |  (outbox worker syncs later)    |
```

If the SQLite commit fails, the lease is released via `POST /api/authority/release`. If the app crashes after the local commit but before `/commit`, the lease expires naturally after 30 s and the cloud record stays uncommitted — the outbox sync will replay and complete it.

### Track B — LAN Authority (LAN_COORDINATED state)

```
Desktop (client)                LAN Coordinator (lowest deviceId)
  |                                 |
  |-- POST /lan/reserve ----------->|  (HMAC-signed, request_id, entity_id)
  |<- 200 { lease_id } ------------ |  (in-memory lease store)
  |                                 |
  |-- SQLite BEGIN IMMEDIATE        |
  |-- INSERT sale / decrement stock |
  |-- INSERT sync_outbox event      |
  |-- SQLite COMMIT                 |
  |                                 |
  |-- POST /lan/release ----------->|
  |<- 200 OK ---------------------- |
  |                                 |
  |  (outbox syncs when cloud       |
  |   becomes reachable again)      |
```

---

## Lease Parameters

| Parameter              | Cloud (AWS)            | LAN Coordinator        |
|------------------------|------------------------|------------------------|
| TTL                    | 30 seconds             | 30 seconds             |
| Storage                | PostgreSQL SaleAuthority table | In-memory Map on coordinator |
| Expiry behavior        | Lease record auto-expires; no commit = no sale recorded | Lease released; slot re-available |
| Crash recovery         | TTL expiry handles it — no manual cleanup needed | TTL expiry handles it  |
| Max concurrent leases  | Unlimited (per entity) | One per entity_id      |

---

## Idempotency

Every reserve call includes a client-generated `request_id` (UUID v4).

- **Cloud**: `/api/authority/reserve` is idempotent — if the same `request_id` is retried, the existing lease is returned rather than a new one being created.
- **LAN**: coordinator checks `request_id` before granting — duplicate returns the existing lease.

This means network retries on the reserve step are safe and will not consume multiple leases.

---

## Expiry and Crash Recovery

| Scenario                                      | Outcome                                                  |
|-----------------------------------------------|----------------------------------------------------------|
| App crashes after reserve, before SQLite write | Lease expires after 30 s. No sale recorded anywhere.     |
| App crashes after SQLite commit, before /commit| Outbox worker replays event. Cloud ingest completes sale. Lease was already expired but the outbox event is authoritative. |
| Coordinator crashes mid-LAN-sale              | Client retries against newly elected coordinator. Outbox ensures cloud eventually consistent. |
| Network flap between reserve and commit        | Client retries /commit with same lease_id (idempotent). |

---

## Backend Endpoints

`POST /api/authority/reserve` — creates lease, returns `{ lease_id, expires_at }`
`POST /api/authority/commit`  — marks lease committed
`POST /api/authority/release` — frees lease early (on failure path)

All three are idempotent by `request_id` / `lease_id`. Implemented in the `SaleAuthority` Sequelize model.

---

## Implementation Files

- `desktop/lib/services/authorityClient.js` — cloud reserve/commit/release
- `desktop/lib/services/lanCoordinator.js` — LAN HTTP server + in-memory lease store
- Backend: `server/models/SaleAuthority.js`, `server/routes/authority.js`
