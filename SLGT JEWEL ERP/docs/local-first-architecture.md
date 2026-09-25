# Local-First Architecture (HISTORICAL TARGET)

> **SUPERSEDED** 2026-07-30 by [`docs/LOCKED-ARCHITECTURE.md`](./LOCKED-ARCHITECTURE.md)  
> (Shop Cluster: one active host writer + full replicas + LAN event replication; cloud optional for backups only).
>
> This document described a peer SQLite + cloud/LAN temporary coordination model.  
> **Do not implement new shop runtime against this file.** Keep only as migration archaeology until obsolete code is removed.

**Former status:** TARGET — migration on `migration/local-first-sqlite`  
**Superseded:** 2026-07-30

---

## One sentence (former)

**Every shop PC runs JewelleryCRM.exe with embedded SQLite + domain engine; AWS coordinates sync and conflicting sales when reachable; LAN coordinates temporarily when cloud is down; isolated devices fail closed on unsafe unique sales.**

---

## Why superseded

The production choice is **not** multi-writer peers with later merge/coordination.  
Settled design: **exactly one authoritative host**; other PCs hold **full replicas** and forward writes to the host; failover is **manual** with `host_term` fencing.

See locked topology and rules in `docs/LOCKED-ARCHITECTURE.md`.  
Build order: `docs/shop-cluster-build-plan.md`.

---

## Preserved business rules (still apply under locked arch)

- `shop_id`, devices, RBAC  
- Invoice uniqueness / sequencing semantics  
- Barcode uniqueness; inventory quantity + unique_tag  
- Inventory movements + double-sale / oversell protections  
- Authoritative billing, GST, money precision, snapshots, payments, old gold  
- Void/cancel (not silent delete)  
- `request_id` / `operation_id` + `event_id` idempotency  
- Fail closed when correctness cannot be established  

---

## Former topology (reference only)

```
                     AWS CLOUD
            Express + PostgreSQL
                     │
        ┌────────────┼────────────┐
      PC1.exe      PC2.exe      PC3.exe
   SQLite+Domain  SQLite+Domain  SQLite+Domain
        └──── Secure LAN (peers) ─┘
```

Replaced by host ★ + replica topology in the locked document.
