# Disaster Recovery

Covers SQLite backup and restore procedures for the desktop app. Cloud PostgreSQL backup is a separate concern managed at the infrastructure level.

---

## Automatic Pre-Migration Backup

Before every schema migration, `desktop/lib/db/migrate.js` creates a timestamped copy of the live database:

```
userData/
  jewellery-crm.sqlite          <-- live database
  backups/
    jewellery-crm-20250601-143022.sqlite   <-- pre-migration snapshot
    jewellery-crm-20250512-091500.sqlite
    ...
```

The backup is created using SQLite's `VACUUM INTO` (or file copy with WAL checkpoint) before any DDL is applied. If the migration fails, the backup can be restored manually.

The migration also runs a **post-migration integrity check** (`PRAGMA integrity_check`) after DDL completes. If the check fails, the migration is considered failed and the app reports the error to the operator.

---

## Outbox Drain Gate

Migrations wait for the sync outbox to be empty before proceeding:

```
migrate.js startup
  |
  +-- Check sync_outbox WHERE status = 'pending'
  |     count > 0 --> defer migration, retry after 30 s
  |     count = 0 --> proceed with pre-migration backup, then DDL
```

This prevents a migration from changing the payload schema while unsynced events are still in flight.

---

## Manual Backup

Operators (or automated scripts) can trigger a manual backup via IPC:

```
IPC channel: db:backup
Handler:     backupDatabase()
Output:      userData/backups/jewellery-crm-{timestamp}.sqlite
```

The timestamp format is `YYYYMMDD-HHmmss` (local time). The backup operation checkpoints the WAL and then performs an online backup using the SQLite backup API — the live database remains readable during the backup.

---

## Backup Retention

There is no automated purge of backup files. Disk management is the operator's responsibility. Typical backup sizes for a single-shop installation are 10–100 MB depending on transaction volume.

---

## Restore Procedure

Restoring from a backup requires the application to be fully closed:

```
1. Close JewelleryCRM.exe completely (check Task Manager).
2. Navigate to %APPDATA%\JewelleryCRM\  (Windows)
3. Rename jewellery-crm.sqlite  -->  jewellery-crm.sqlite.bak   (keep as safety)
4. Copy the chosen backup file:
     backups\jewellery-crm-20250601-143022.sqlite
     -->  jewellery-crm.sqlite
5. Restart JewelleryCRM.exe.
6. Verify data by checking recent invoices and stock levels.
7. If correct, delete jewellery-crm.sqlite.bak.
```

After restore the sync outbox will contain events from after the backup point. These will re-sync to the cloud automatically when connectivity is available. The cloud ingest endpoint is idempotent — re-sending already-processed events returns 409 (treated as success), so re-sync is safe.

---

## Recovery Scenarios

| Scenario                            | Recovery action                                              |
|-------------------------------------|--------------------------------------------------------------|
| Failed migration                    | Restore pre-migration backup; report bug before retrying     |
| Corrupted SQLite file               | Restore latest manual or pre-migration backup                |
| Accidental data deletion (in-app)   | Restore backup; re-sync outbox to cloud                      |
| Machine failure (hardware)          | Install on new machine; restore from backup; re-register device |
| Cloud data loss                     | Re-ingest from outbox events across all devices (last resort) |

---

## Cloud PostgreSQL (Out of Scope)

Cloud database backup is managed at the AWS infrastructure level (RDS automated snapshots or equivalent). Point-in-time recovery is available independently of desktop backups. See the infrastructure runbook for cloud recovery procedures.

---

## Implementation

`desktop/lib/db/migrate.js` — pre-migration backup, outbox drain check, DDL application, integrity check
`desktop/lib/db/backup.js` (or inline in main IPC handler) — `backupDatabase()` triggered by `db:backup` IPC
