# Recovery Guide — Active Host Failure

## Symptoms

Clients show: **Shop service unavailable**.

`GET /api/recovery/status` on a recovery-capable PC shows last snapshot time.

## Promote PC2 (controlled)

1. Confirm PC1 is truly down (power, network, service).
2. Restore latest DB backup onto PC2 local PostgreSQL if PC2 was not already hosting data (copy `.backups` + recovery snapshot).
3. Start Branch Service on PC2 (`APP_MODE=branch`).
4. Owner/manager calls:
   ```http
   POST /api/recovery/promote
   Authorization: Bearer <token>
   { "confirm_dual_active_risk": true }
   ```
5. Point clients at PC2 URL (or rediscover).
6. Continue billing. Pending outbox will sync when cloud returns.

## When PC1 returns

1. PC1 must **not** auto-start as active writer if PC2 is active.
2. Check `/api/recovery/status` → `fence.fenced: true`.
3. Reconfigure PC1 as client: set desktop Join URL to PC2; demote local role.
4. Do not run two Branch Services as `active_host` on the same shop.

## Corrupt / stale snapshot

- Decrypt failure → refuse promote; restore from last good `pg_dump`.
- Stale snapshot → prefer newer backup; reconcile pending outbox carefully.

## Split-brain

If unsure whether another host is active: **do not promote** until confirmed. Correctness > availability.
