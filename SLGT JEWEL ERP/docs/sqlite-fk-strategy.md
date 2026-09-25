# SQLite FK strategy

SQLite foreign keys are optional (`PRAGMA foreign_keys`). This ERP uses:

1. **Application-level integrity** in services (billing, inventory, advances) inside transactions.
2. **Selective unique indexes** where safe (barcode, shop+code CoA, request_id lookups).
3. **No cascading deletes** for financial/inventory history — soft revoke / cancel / status history instead.

Enable `PRAGMA foreign_keys = ON` per connection when adding declarative FKs in a future migration; do not enable blindly on existing DBs without a backup and orphan cleanup.
