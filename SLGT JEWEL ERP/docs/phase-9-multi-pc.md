# Phase 9 — Multi-PC LAN + Dynamic Joining

**Status:** Complete — foundation gate passed  
**Date:** 2026-07-28

---

## 1. Architecture

```
PC1 (Active Branch Host) ── Branch Service + PostgreSQL
        ▲
        │ LAN (HTTP API only — no direct Postgres)
   ┌────┴────┐
  PC2       PC3
Electron   Electron
 clients
```

Exactly **one** `active_host` writer. Clients use Branch API. Concurrency correctness from Phase 3–4 locks.

---

## 2. What changed

### Discovery

UDP broadcast/listen on port **41779** (`lanDiscovery.js`):

- Active host advertises shop/device/api_port/addresses
- Clients: `GET /api/devices/discover`
- Not a trust boundary

### Authorized joining

1. Owner: `POST /api/devices/pairing-code` (10 min code)
2. New PC: `POST /api/devices/register` with code + device_identifier
3. Registered as `client` or `recovery` — **cannot** self-claim `active_host`

### Device registry

- `GET /api/devices` — list
- `POST /api/devices/heartbeat`
- Roles: `active_host` | `recovery` | `client`

### Dynamic scale

1 PC → works alone. Add PC2/PC3 via pairing. Remove client → others continue. No reinstall.

### Security

- LAN ≠ trusted: JWT + pairing required
- PostgreSQL not exposed to clients
- Idempotent invoice `request_id` prevents duplicate submits on reconnect

---

## 3. Gate

| Gate | Status |
|------|--------|
| Multi-client against one Branch Service | Supported (same API + locks) |
| Offline internet, LAN continues | Yes (local PG + Branch) |
| Unique-tag double sell | Phase 3/4 |

**Known:** Desktop Join UI still accepts URL; discovery API available for Phase 11 polish.

**Checkpoint:** Proceed to Phase 10.
