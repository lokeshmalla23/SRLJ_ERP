# LAN Coordination

When AWS is unreachable, devices on the same local network elect a coordinator to grant transaction authority, preventing double-sells without cloud access.

---

## Overview

```
  [Device A]  [Device B]  [Device C]
      |            |            |
      +----UDP 41779 heartbeat--+    (every 5s, broadcast)
      |                        |
      |   Election: lowest     |
      |   deviceId wins        |
      v                        |
  [COORDINATOR]                |
  HTTP :41780                  |
      ^                        |
      |---POST /lan/reserve-----+    (client requests authority)
      |---POST /lan/release-----+
```

---

## Peer Discovery (UDP :41779)

Each device broadcasts a heartbeat UDP packet every **5 seconds** to the LAN subnet.

Heartbeat payload (JSON):
```json
{
  "deviceId": "uuid",
  "shopId":   "uuid",
  "epoch":    42,
  "at":       "2025-01-01T10:00:00.000Z"
}
```

- `epoch` increments each time this device triggers a re-election.
- Devices with a different `shopId` are ignored (multi-tenant LAN safety).
- A peer is considered **live** if a heartbeat was received within the last **30 seconds**.

---

## Coordinator Election

Election rule: **lowest `deviceId` (lexicographic UUID comparison) among currently live peers**.

Election is triggered when:
1. The local peer list changes (peer joins or expires).
2. A re-election debounce timer fires (**2 seconds** after the triggering change).
3. The current coordinator stops responding to HTTP probes.

When a device determines it is the coordinator, it starts the HTTP server on `:41780`. When it loses coordinator status, it shuts the server down.

**Epoch tracking**: each election increments the local epoch. Heartbeats carry the epoch so peers can detect stale coordinator information. A device only trusts authority responses from a coordinator whose epoch is >= the highest epoch it has seen.

---

## LAN Authority Server (HTTP :41780)

The coordinator runs a lightweight HTTP server. All requests must include a valid HMAC-SHA256 signature (see [device-security.md](device-security.md)).

| Method | Path            | Description                              |
|--------|-----------------|------------------------------------------|
| POST   | /lan/reserve    | Request a lease for an entity_id         |
| POST   | /lan/release    | Release a lease early                    |
| GET    | /lan/health     | Liveness probe used by peer devices      |

### Reserve flow

```
Client  POST /lan/reserve  { request_id, entity_id, device_id, shop_id }
                                    |
                        Already leased by same request_id?
                               /           \
                             yes            no
                              |              |
                        return existing   entity already leased?
                           lease            /       \
                                          yes        no
                                           |          |
                                        REJECT      GRANT
                                                  (30s TTL)
```

Leases are stored in-memory in a `Map<entity_id, LeaseRecord>`. They are **not** persisted to disk — coordinator crash = all in-memory leases expire, clients must re-request after the new coordinator is elected.

### Lease TTL

Leases expire after **30 seconds** if not explicitly released. A background timer sweeps expired leases every **5 seconds**.

---

## Re-election Scenarios

| Trigger                                    | Behavior                                          |
|--------------------------------------------|---------------------------------------------------|
| Coordinator device shuts down cleanly      | Sends goodbye UDP packet; peers re-elect in ~2 s  |
| Coordinator crashes (no goodbye)           | Peers detect via 30 s heartbeat expiry; re-elect  |
| New device joins with lower deviceId       | Re-election fires; new device becomes coordinator |
| Network partition heals                    | Heartbeats resume; re-election normalises state   |

During re-election (gap between coordinator loss and new coordinator ready), clients in LAN_COORDINATED state treat pending reserve attempts as failed and surface an error to the operator. Existing already-committed sales are unaffected.

---

## Implementation

`desktop/lib/services/lanCoordinator.js`

Key internals:
- `PeerRegistry` — tracks live peers, fires `peerListChanged` event
- `ElectionManager` — debounced re-election, epoch management
- `CoordinatorServer` — Express HTTP server, starts/stops with coordinator status
- `LeaseStore` — in-memory Map with TTL sweep
