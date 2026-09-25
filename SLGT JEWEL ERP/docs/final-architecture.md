# Final Architecture — Jewellery CRM Offline Branch System

> **SUPERSEDED for product target** 2026-07-30 by [`LOCKED-ARCHITECTURE.md`](./LOCKED-ARCHITECTURE.md)  
> (Shop Cluster: host writer + full replicas + LAN event log; cloud optional backups).  
> This page remains as the Branch-era topology sketch.

```
                     CLOUD (optional backup / archive only under locked arch)
            ┌─────────────────────┐
            │ Express APP_MODE=cloud│
            │ Neon PostgreSQL      │
            │ /api/sync/push       │
            │ Device / processed   │
            └──────────┬──────────┘
                       │ Secure sync (optional)
                       ▼
                ACTIVE BRANCH HOST
            ┌─────────────────────┐
            │ Express APP_MODE=branch│
            │ Local PostgreSQL     │
            │ Billing + Inventory  │
            │ Sync outbox worker   │
            │ Recovery snapshots   │
            │ LAN discovery        │
            └──────────┬──────────┘
                       │ LAN HTTP
            ┌──────────┼──────────┐
           PC1        PC2        PC3
         Electron   Electron   Electron
```

## Pillars

See **[LOCKED-ARCHITECTURE.md](./LOCKED-ARCHITECTURE.md)** — single source of truth (Shop Cluster).

| Area | Implementation |
|------|----------------|
| Billing | Server-authoritative `billingService` + decimal money; path always Branch Service |
| Inventory | `inventory_movements` + qty/unique modes + row locks |
| Branch | Same Express app, local PG; write-fence when superseded |
| Desktop | Electron shell, Create Shop / Join Shop |
| Offline | Local auth + local APIs; POS checkout gated on Branch health |
| Sync | Transactional outbox + idempotent cloud |
| Multi-PC | One active host; pairing; UDP discovery |
| Recovery | Encrypted snapshots; explicit promote; old host rejoins as client |
| Backup | pg_dump + retention; ≠ sync |

## Non-goals (V1)

- Automatic leader election / consensus
- Direct client→Postgres
- Silent dual-active hosts
- Last-write-wins on financial events
- PC → AWS billing when online / local when offline (two paths)
- SQLite peer-to-peer multi-writer billing
