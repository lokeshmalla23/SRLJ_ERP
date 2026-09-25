# Connectivity State Machine

Tracks which authority source the desktop app can reach. Drives what transaction types are permitted.

---

## States

```
                     AWS reachable + authed
          +------------------------------------------+
          |                                          |
          v                                          |
  +-------------------+   AWS down,         +-------------------+
  |                   |   LAN coord         |                   |
  | CLOUD_COORDINATED | ------------------> | LAN_COORDINATED   |
  |                   |   reachable         |                   |
  +-------------------+                    +-------------------+
          |                                          |
          | AWS + LAN both                           | LAN coord
          | unreachable                              | lost
          |                                          |
          v                                          v
  +---------------------------------------------------+
  |                    ISOLATED                       |
  +---------------------------------------------------+
          |
          | AWS reachable + authed     (or LAN coord seen)
          +---> CLOUD_COORDINATED  (or LAN_COORDINATED)
```

---

## Transition Conditions

| From                | To                  | Condition                                              |
|---------------------|---------------------|--------------------------------------------------------|
| any                 | CLOUD_COORDINATED   | AWS health endpoint reachable AND session authenticated |
| CLOUD_COORDINATED   | LAN_COORDINATED     | AWS probe fails AND LAN coordinator responds on :41780  |
| LAN_COORDINATED     | CLOUD_COORDINATED   | AWS probe succeeds again                               |
| CLOUD_COORDINATED   | ISOLATED            | AWS probe fails AND no LAN coordinator found           |
| LAN_COORDINATED     | ISOLATED            | LAN coordinator stops responding (missed 2 probes)     |
| ISOLATED            | CLOUD_COORDINATED   | AWS probe succeeds                                     |
| ISOLATED            | LAN_COORDINATED     | LAN coordinator appears on :41780                      |

---

## Permitted Operations by State

| Operation                          | CLOUD_COORDINATED | LAN_COORDINATED | ISOLATED |
|------------------------------------|:-----------------:|:---------------:|:--------:|
| Standard sales (non-unique items)  | Yes               | Yes             | Yes      |
| Unique-tag sales                   | Yes               | Yes             | No       |
| Quantity-controlled sales          | Yes               | Yes             | No       |
| Invoice creation                   | Yes               | Yes             | Yes      |
| Offline login (cached credentials) | Yes               | Yes             | Yes      |
| Settings sync                      | Yes               | Queued          | Queued   |

ISOLATED blocks unique-tag and quantity sales to prevent double-sell without any authority source.

---

## Probe Behavior

| Parameter            | Value                       |
|----------------------|-----------------------------|
| Probe interval       | 15 seconds                  |
| AWS health timeout   | 5 seconds per attempt       |
| LAN probe timeout    | 2 seconds per attempt       |
| LAN coordinator port | 41780                       |
| Peer expiry window   | 30 seconds (no heartbeat)   |
| Re-election debounce | 2 seconds after peer change |

Probes run concurrently — AWS and LAN are checked in parallel on each cycle.

---

## Persistence

Current state is written to the `coordination_state` SQLite table after every transition.

```sql
CREATE TABLE coordination_state (
  id          INTEGER PRIMARY KEY,   -- always row 1 (upserted)
  state       TEXT    NOT NULL,      -- 'CLOUD_COORDINATED' | 'LAN_COORDINATED' | 'ISOLATED'
  updated_at  TEXT    NOT NULL       -- ISO-8601 UTC
);
```

On startup the machine reads this row to initialise state before the first probe completes. This prevents a flash of ISOLATED on boot when connectivity is actually fine.

---

## Implementation

`desktop/lib/services/authorityState.js` — `AuthorityStateMachine extends EventEmitter`

Key events emitted:
- `stateChange` `{ from, to, at }` — consumed by auditService and UI renderer
- `probeResult` `{ aws, lan }` — internal, used to drive transitions
