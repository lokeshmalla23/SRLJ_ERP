# Phase 10 — Controlled Recovery

**Status:** Complete — controlled promotion implemented (no auto-election)  
**Date:** 2026-07-28

---

## 1. Principles

- **No** Raft/Paxos/automatic leader election
- Operator must click **Start Recovery** / call promote with `confirm_dual_active_risk: true`
- Prefer correctness over availability (split-brain → require confirmation)

---

## 2. What changed

### Encrypted recovery snapshots

`recoveryService.js`:

- AES-256-GCM envelope (`RECOVERY_KEY` or `JWT_SECRET`)
- Contents: shop identity, schema version, devices, pending/failed outbox, sync_state, host metadata
- Written to `backend/.recovery/` (latest + retention 14)
- Auto every 5 minutes on branch host + on demand `POST /api/recovery/snapshot`

Full DB plane: use `pg_dump` backups (Phase 11) alongside snapshots.

### Status / fence

- `GET /api/recovery/status` — latest snapshot + `fenceIfSuperseded`
- If another `active_host` exists → old host must **not** write authoritatively; rejoin as client

### Promotion

`POST /api/recovery/promote`:

```json
{ "confirm_dual_active_risk": true }
```

Steps: verify snapshot integrity/schema/shop → demote other hosts in registry → set this device `active_host` → restore missing pending outbox rows.

### Old host returns

Must discover PC2 active → fence → disable authoritative writes → rejoin as client/recovery. **Never** auto-become active.

---

## 3. Gate checklist (manual ops)

| Scenario | Expected |
|----------|----------|
| PC1 power loss | PC2 shows service unavailable; promote with confirmation |
| Continue billing on PC2 | Yes after promote + local DB restore from backup if needed |
| PC1 returns | Fenced; does not auto-activate |
| Corrupt snapshot | Decrypt/integrity failure → refuse promote |

**Checkpoint:** Proceed to Phase 11.
