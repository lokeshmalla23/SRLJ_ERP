# Offline Conflict Resolution Policy

**Status:** Decided  
**Date:** 2026-07-28  
**Scope:** All entities written by offline devices that sync to the cloud authority

---

## Guiding Principles

1. **Financial records are immutable once committed.** Invoices, invoice line items, and inventory movements can never be overwritten or merged — only appended or compensated.
2. **Last-write-wins applies only to descriptive/profile fields**, where the cost of a wrong value is low and easily corrected.
3. **Additive fields use delta semantics.** The cloud applies the delta the device computed, not the absolute value the device holds.
4. **The cloud authority is the single source of truth** for ordering concurrent writes. Devices that lose the race receive a typed error and must respond accordingly.

---

## Entity-by-Entity Rules

### Product / Catalog

| Field category | Strategy | Rationale |
|---|---|---|
| Name, description, images, tags, category | Last-write-wins (by `updated_at`) | Cosmetic; any version is acceptable |
| Weight, purity, metal | Last-write-wins (by `updated_at`) | Correctable; POS re-prices at billing time |
| Base price, making charge | Last-write-wins (by `updated_at`) | Soft field; actual billing uses live rate |
| Financial history (`invoice_items`) | Append-only — never touched during product sync | History lives on invoices, not products |

Stale-write guard: the sync payload must include `updated_at`. Cloud rejects if the stored `updated_at` is newer than the incoming one and the device is not the originator of the stored version.

---

### Invoices

**Invoice numbers are device-scoped** (format `<device_id>-<seq>`), so number collision is structurally impossible.

| Scenario | Resolution |
|---|---|
| Two devices create invoices for the same customer simultaneously | Both accepted — different numbers, no conflict |
| Two devices attempt to cancel the same invoice | First writer wins. Cloud transitions status to `CANCELLED` and returns `ALREADY_CANCELLED` to the second device. Second device must surface this to the user and reload the invoice. |
| Two devices attempt to mark the same invoice as paid | First writer wins. Cloud returns `ALREADY_SETTLED` to the second device. |
| Device tries to edit an invoice already in `CANCELLED` or `SETTLED` state | Cloud rejects with `INVOICE_IMMUTABLE`. Device must discard the local edit and reload. |

Invoice records (`invoice_items`) are **immutable once the invoice is committed**. No field on a committed invoice may be overwritten — only a credit note or return invoice may reverse it.

---

### Customers

| Field category | Strategy |
|---|---|
| Name, mobile, email, address, notes | Last-write-wins (by `updated_at`) |
| Total purchases | Last-write-wins / server-side increment on invoice (authoritative host) |

Loyalty points are **not a product feature** — the legacy `customers.loyalty_points` column may exist in older DBs but is unused.

---

### Stock / Inventory Movements

The inventory movement ledger is **strictly append-only**. A movement record is never updated or deleted after it is committed.

| Scenario | Resolution |
|---|---|
| Normal sale or receipt | Appended as-is; cloud recalculates running stock |
| Cloud rejects movement due to negative stock | Cloud returns `INSUFFICIENT_STOCK` with the current quantity. Device emits a **compensation movement** (type `SYNC_COMPENSATION`, quantity = committed quantity - rejected quantity) to bring the local ledger in line. |
| Two devices sell the last unit simultaneously | One succeeds; the other receives `INSUFFICIENT_STOCK` and must void the local line or emit compensation |

Devices must never mutate an existing movement row — not even to fix a typo. Corrections are made by appending an adjustment movement.

---

### Gold Rate / Shop Settings

| Field | Strategy |
|---|---|
| Gold rate (per-gram, by karat) | Last-write-wins by `updated_at` timestamp |
| Shop settings (GST number, SGST/CGST %, making charge defaults, etc.) | Last-write-wins by `updated_at` |

The `updated_at` field is set by the device at the moment the user saves. The cloud applies the write only if the incoming `updated_at` is greater than (newer than) the stored value. A stale write is silently dropped and the cloud returns the current authoritative value so the device can refresh its cache.

Gold rate changes have a **1-minute write-lock window**: if the cloud has accepted a rate update in the last 60 seconds, it will reject a second update from a different device with `RATE_LOCKED` and the remaining lock seconds. This prevents rapid oscillation from two managers editing the rate simultaneously.

---

## What Last-Write-Wins Is Never Allowed On

The following are financial records and must never be resolved with last-write-wins:

- `invoices` (status, amounts)
- `invoice_items` (any field once committed)
- `inventory_movements` (any field once committed)
- `scheme_instalments` (amount, paid_at — append or reject only)

Attempts to overwrite these fields must be rejected at the cloud with a typed error. The device must surface the error to the user, never silently discard it.

---

## Error Catalogue (device must handle all of these)

| Code | Triggered by | Device action |
|---|---|---|
| `ALREADY_CANCELLED` | Second cancel on same invoice | Show user, reload invoice |
| `ALREADY_SETTLED` | Second payment on same invoice | Show user, reload invoice |
| `INVOICE_IMMUTABLE` | Edit on committed invoice | Discard local edit, reload |
| `INSUFFICIENT_STOCK` | Movement pushes stock negative | Emit compensation movement, notify user |
| `LOYALTY_STALE` | ~~Legacy~~ Loyalty module removed — unused | — |
| `RATE_LOCKED` | Gold rate updated too soon after prior update | Wait lock window, retry or notify |
| `STALE_WRITE` | `updated_at` older than stored | Discard, reload from cloud |
