# Support Guide — Diagnostics & Safe Ops

## Collect diagnostics

Authenticated:

```http
GET /api/system/diagnostics
GET /api/health
GET /api/sync/status
GET /api/recovery/status
GET /api/system/eod
```

Include: app version, schema version, device id, pending/failed sync, recent errors from Branch Service log.

**Never send:** `.env`, `.env.branch`, `JWT_SECRET`, `RECOVERY_KEY`, `DATABASE_URL`, passwords, full card data.

## Common issues

| Issue | Check |
|-------|--------|
| Cannot login offline | Local users table; Branch up; not pointing at cloud-only URL |
| Duplicate invoice fear | `request_id` idempotency; check invoice list |
| Stock fight | Unique-tag / qty locks — one wins with 4xx |
| Sync stuck | `POST /api/sync/retry`; check `CLOUD_ENDPOINT` / key / schema |
| Discovery empty | Firewall UDP 41779; same LAN/broadcast domain |

## Backup

`POST /api/system/backup` — verify `.backups` file grows; retention ~30.
