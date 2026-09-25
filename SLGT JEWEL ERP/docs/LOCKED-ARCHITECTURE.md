# Locked Architecture — Jewellery ERP (Shop Cluster)

**Status:** LOCKED — production target  
**Date locked:** 2026-07-30  
**Supersedes:** prior Branch-only sketches, `docs/local-first-architecture.md` (cloud/LAN peer-writer coordination), and multi-master “every PC writes then merges” designs.

Cloud PostgreSQL / Neon is **optional** (versioned backup / archive only). Day-to-day billing and inventory authority live **entirely on the shop LAN**.

---

## One sentence

**One active host writer per shop + full local DB replicas on every PC + LAN event replication + ACID business transactions + deterministic host calculation + idempotent ops + manual failover with host fencing + immutable financials + audit + independent versioned backups.**

---

## Topology

```
                    JEWELLERY SHOP
                 Local LAN / Wi-Fi
                 Internet optional

                         │
              ┌──────────┴──────────┐
              │    SHOP CLUSTER     │
              │ Shop ID             │
              │ Active Host ID      │
              │ Host Term / Epoch   │
              └──────────┬──────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ PC1 ★ HOST      │
                │ Desktop ERP     │
                │ Local API       │
                │ Business Engine │
                │ Calculation     │
                │ Transaction     │
                │ Full Local DB   │
                │ Event Log       │
                │ Replication     │
                └────────┬────────┘
                         │
                    LAN replication
                  ┌──────┴───────┐
                  ▼              ▼
          ┌──────────────┐ ┌──────────────┐
          │ PC2 Replica  │ │ PC3 Replica  │
          │ Full DB      │ │ Full DB      │
          │ Event Log    │ │ Event Log    │
          └──────────────┘ └──────────────┘

                         │
                         ▼
                Versioned Backups
                  Local + Cloud (optional)
```

---

## Roles at any moment

| PC role | Local DB | Writes |
|---------|----------|--------|
| **HOST** | Full | READ + WRITE (sole authority) |
| **REPLICA** | Full | READ + apply replicated events only |

**Full database ≠ permission to independently modify it.**

Cashiers may bill from any PC; the PC always forwards mutating work to the active host over LAN.

---

## Sale path (any cashier PC)

```
Cashier on PC3
  Scan TAG → Create Sale
       │ LAN
       ▼
  HOST PC1
  Validate → lock/reserve tag → calculate → BEGIN TX
  Invoice + items + payment + inventory (+ scheme) + audit
  COMMIT → append durable events → replicate → ACK (≥1 replica when available)
       │
       ▼
  PC3 prints invoice / SUCCESS
```

Two PCs cannot independently sell the same unique tag.

---

## Non-negotiable rules

| # | Rule |
|---|------|
| 1 | Exactly **one** active host writer per `shop_id` at a time (`host_id` + `host_term`). |
| 2 | All billing / stock / payment / scheme mutations go **PC → Host**. Replicas do not invent authoritative writes. |
| 3 | Unique jewellery barcodes; **scan ≠ sell**; sell = host lock + mark SOLD / qty decrement inside one ACID TX. |
| 4 | Concurrent sales of the same unique tag: one wins; other gets “already sold”. |
| 5 | Quantity stock uses row locks — no lost updates. |
| 6 | Business operations are **ACID** (invoice + items + payment + inventory + scheme + audit = one COMMIT or ROLLBACK). |
| 7 | **One calculation engine on the host**; store money/weights as fixed precision; persist calculation inputs on the invoice so later rate changes never rewrite history. |
| 8 | **Idempotent** `operation_id` / `request_id` on sales, payments, refunds, returns, stock adjustments, scheme TX. |
| 9 | Replicate **committed ordered events**, not live DB file copies. New PC = snapshot + events after snapshot watermark. |
| 10 | Failover is **manual** (owner/admin): Settings → Shop Network → Make Host. No automatic election in V1. |
| 11 | **Host fencing** with `shop_id`, `node_id`, `host_id`, `host_term`. Old host after promote is untrusted until reconciled; instruct owner to shut down/isolate previous host before promote. |
| 12 | Critical sales/payments: prefer SUCCESS only after host durable commit **and** ≥1 replica ACK when a replica is online; otherwise warn “Running without replica protection”. |
| 13 | Finalized financial documents are **immutable** — VOID / CREDIT NOTE / RETURN / REFUND / CORRECTION only. |
| 14 | Append-only audit trail (who / which PC / what / why / host_term). No erase via normal app. |
| 15 | LAN is **not** trusted: pairing + device identity + auth + encrypted LAN traffic; RBAC (Owner / Manager / Cashier / Accountant / Inventory). |
| 16 | **Replication ≠ backup.** Versioned local snapshots + optional encrypted cloud backup; restore must be tested. |
| 17 | Isolated PC with no path to host **must not** bill unique shared inventory (fail closed). Prefer stop over wrong money/stock. |
| 18 | Availability never outranks inventory/financial correctness. |
| 19 | Internet optional for shop operations. Cloud DB not required for billing. |

## Honesty

**Foundation is correct; not production-ready yet.**  
Clients today still behave closer to **UI + cache talking to the owner PC** than **full replicas that can safely become host**. See [`production-gap-map.md`](./production-gap-map.md).

Software cannot guarantee “no fraud” if an authorized user or compromised machine acts maliciously. We design prevention, auditability, tamper resistance, and no silent duplicate billing. Host fencing cannot perfectly stop a powered-but-partitioned old host that never observes the new term — operational isolation before promote is mandatory.

---

## Production target (required)

Every PC runs the same `JewelleryCRM.exe` (UI + local service + full DB + event log + sync).  
`role=active_host` writes; `role=replica` mirrors and forwards mutations to host.  
Any **fully synced + integrity-OK** replica can be manually promoted.

Plain HTTP and seeded owner passwords are **dev-only**, not production.

---

## Operating matrix

| Condition | Billing |
|-----------|---------|
| Internet ✓ LAN ✓ | All PCs via host ✅ |
| Internet ❌ LAN ✓ | All PCs via host ✅ |
| Host healthy, no replica | Allowed with warning (policy) ⚠️ |
| Active host fails | Pause → owner promotes synced replica |
| Router/LAN fails | Isolated clients ❌ (unique inventory) |
| Dual-active risk / integrity uncertain | ❌ |

---

## Explicit rejects

- Multi-master: every PC independently writes and later merges  
- Switching cloud billing ↔ local billing as two code paths  
- Whole-database dump sync as the primary replication model  
- Silent edit/delete of finalized invoices  
- Automatic Raft / leader election (V1)  
- Direct client → database engine (bypass host API)  
- Unrestricted offline billing on an isolated replica  

---

## Shop cluster metadata

Every node tracks:

- `shop_id`
- `node_id` (this PC)
- `host_id` (current active writer)
- `host_term` / epoch (monotonic; increments on each successful promote)
- replication watermark (last applied event id)

---

## Security & RBAC (minimum)

| Action | Owner | Manager | Cashier |
|--------|-------|---------|---------|
| Bill / take payment | ✅ | ✅ | ✅ |
| Void / return (authorized) | ✅ | ✅ | ❌ / limited |
| Promote host | ✅ | ❌ | ❌ |
| Change gold rates | ✅ | ✅ | ❌ |
| Delete / mass adjust inventory | ✅ | limited | ❌ |
| Restore backups | ✅ | ❌ | ❌ |
| Pair new PC | ✅ | ❌ | ❌ |

---

## Backup (independent of replication)

```
Live DB
  ├── Frequent local snapshots
  ├── Daily backup
  ├── Weekly backup
  └── Monthly archive
         +
  Optional encrypted cloud backup
```

Replication copies mistakes; backups enable point-in-time restore.

---

## Implementation posture (from current repo)

**Reuse / extend:** Branch host concept, device pairing, `request_id` idempotency, ACID billing services, inventory locks, void/cancel, recovery promote + fence sketches, desktop Create/Join.

**Build / finish for this lock:**

1. Full replica DB on every PC (not thin clients only)  
2. Durable ordered event log + LAN catch-up protocol  
3. Host term fencing enforced on all mutating APIs  
4. Strong replication ACK path for critical TX  
5. Shop Network UI (status, sync lag, Make Host)  
6. Versioned backup manager (local; cloud optional)  
7. Remove Neon/cloud as required runtime dependency for shop billing  

Phased build order: see `docs/shop-cluster-build-plan.md`.

---

## Security baseline

See **[`docs/shop-security-architecture.md`](./shop-security-architecture.md)** — encrypted DB/backups, OS key store, TLS/mTLS LAN, pairing, RBAC, Argon2id, hash-chained audit, log redaction, no public internet bind.

---

## Next slice (ordered)

1. Lock docs + reject competing targets *(this document)*  
2. Cluster identity (`shop_id` / `node_id` / `host_id` / `host_term`) + write fence middleware  
3. Durable event log schema + append on COMMIT  
4. Replica apply + catch-up over LAN  
5. Critical TX replica ACK policy + UI warning  
6. Shop Network promote UX + old-host isolation guidance  
7. Encrypted backup manager + restore drill  
8. Full security stack + strip mandatory cloud DB from shop runtime  
