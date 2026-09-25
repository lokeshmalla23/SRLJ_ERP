# Invoice Numbering Design

## Problem

A single `invoice_sequences` table in PostgreSQL is race-safe for one Branch writer.
In the target local-first architecture, each PC runs its own SQLite database.
If two offline devices both use `MAX(invoice_number) + 1`, they will produce colliding
invoice numbers — a GST compliance failure.

## Decision: Device-Scoped Series

Each registered device gets a unique short identifier (first 4 chars of `device_id` UUID).
Invoice numbers are structured as:

```
{SHOP_PREFIX}-{DEVICE_SHORT}-{YYMMDD}-{SEQ:04d}
```

Examples:
- `SSJ-A3F2-260728-0001`
- `SSJ-A3F2-260728-0002`
- `SSJ-B7C1-260728-0001`  ← different device, same date — no collision

### Properties
- **Unique per device per date**: `(SHOP_PREFIX, DEVICE_SHORT, YYMMDD, SEQ)` tuple is globally unique
- **No coordination required**: each device sequences independently
- **Restart-safe**: sequence stored in SQLite, persisted across restarts
- **Auditable**: `DEVICE_SHORT` in the number identifies the originating device
- **GST compatible**: legally, invoice numbers must be unique within a financial year per GSTIN — device-scoped series satisfies this

### Sequence storage (SQLite)

```sql
CREATE TABLE IF NOT EXISTS invoice_sequences (
  id          TEXT PRIMARY KEY,
  shop_prefix TEXT NOT NULL,
  device_short TEXT NOT NULL,
  seq_date    TEXT NOT NULL,   -- YYMMDD
  next_value  INTEGER NOT NULL DEFAULT 1,
  UNIQUE(shop_prefix, device_short, seq_date)
);
```

Allocation is a single atomic SQLite write:

```js
const row = db.prepare(`
  INSERT INTO invoice_sequences (id, shop_prefix, device_short, seq_date, next_value)
  VALUES (?, ?, ?, ?, 2)
  ON CONFLICT(shop_prefix, device_short, seq_date) DO UPDATE
  SET next_value = next_value + 1
  RETURNING next_value - 1 AS allocated
`).get(newId(), prefix, deviceShort, date);
return `${prefix}-${deviceShort}-${date}-${String(row.allocated).padStart(4, '0')}`;
```

SQLite's `RETURNING` + single-statement atomicity makes this race-safe even with
concurrent access within the same process.

## Cloud Allocation Alternative (not chosen)

Cloud pre-allocates blocks of N numbers per device. Works but requires cloud connectivity
to request each new block. Rejected because:
1. Requires cloud just to start billing — conflicts with offline-first requirement
2. Block size is a tunable tradeoff (too small = frequent cloud calls; too large = gaps)
3. Device-scoped series is simpler and provides the same uniqueness guarantee

## Migration from PostgreSQL sequence

Existing invoices keep their current numbers (`PREFIX-YYMMDD-NNNN` without device segment).
New invoices after migration use the device-scoped format.
Cloud ingest accepts both formats (validated by regex: either format is acceptable).
No renumbering of historical invoices.

## Single-PC Shop

With one device, the device-scoped format simplifies to a single device series.
Numbers look slightly different from the legacy format but are unique and auditable.

## Rollover

`seq_date` resets the sequence to 1 each calendar day. This prevents ever-growing
sequence numbers and keeps the number human-readable.
