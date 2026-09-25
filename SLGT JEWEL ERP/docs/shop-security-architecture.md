# Shop Security Architecture

**Status:** LOCKED — baseline with [`LOCKED-ARCHITECTURE.md`](./LOCKED-ARCHITECTURE.md)  
**Date:** 2026-07-30

Treat the local database as **sensitive financial and customer data** even though it stays inside the shop. Encryption covers the database, backups, LAN communication, credentials, and device access.

---

## Layers

```
             APPLICATION
                  │
          User Authentication (Argon2id)
                  │
             RBAC / ACL
                  │
             Local API
                  │
             TLS / mTLS LAN
                  │
       ┌──────────┴──────────┐
       │                     │
     HOST                 REPLICA
   Encrypted DB          Encrypted DB
   OS Key Store          OS Key Store
   TPM / BitLocker when available
              │
         Audit (hash-chained)
              │
      Encrypted versioned backups
       Local + optional cloud
```

---

## Non-negotiable security rules

| # | Rule |
|---|------|
| 1 | Encrypt every local DB at rest (engine encryption where available) + recommend BitLocker FDE. |
| 2 | Never store DB keys beside the DB file or hard-code them. Use OS credential store; prefer TPM-backed when available. |
| 3 | Each install has its own device identity. A copied DB does not make another PC trusted. |
| 4 | LAN sync uses TLS; prefer mTLS between paired devices. No plain HTTP for production shop LAN. |
| 5 | Pairing: discover → request → owner approve → short-lived one-time code → device cert/credentials. Same Wi‑Fi ≠ trusted. |
| 6 | Device auth ≠ user auth. Trusted PC + authenticated employee + RBAC. |
| 7 | Password hashing: Argon2id (legacy bcrypt hashes still verify until rehash). |
| 8 | Backups are encrypted authenticated archives (`.enc`), including USB/NAS/cloud. Owner must have recoverable key. |
| 9 | Host ERP API is **not** exposed to the public internet. Bind shop LAN; OS firewall; outbound-only for updates/backup. |
| 10 | Audit trail for sensitive actions; prefer hash-chained events. |
| 11 | Never log passwords, keys, tokens, OTPs, full customer PII, or payment credentials. |
| 12 | Cashiers cannot promote host, restore backups, or change gold rates. |

---

## RBAC matrix (minimum)

| Operation | Cashier | Inventory | Manager | Owner |
|-----------|---------|-----------|---------|-------|
| Billing | ✓ | — | ✓ | ✓ |
| Quotation | ✓ | — | ✓ | ✓ |
| Add inventory | — | ✓ | ✓ | ✓ |
| Change gold rate | — | — | ✓ | ✓ |
| Cancel invoice | — | — | Approval | ✓ |
| Promote host | — | — | — | ✓ |
| Restore backup | — | — | — | ✓ |

---

## Implementation map

| Concern | Module / path |
|---------|----------------|
| Cluster fence + term | `backend/src/services/clusterService.js` |
| Event log / LAN catch-up | `backend/src/services/eventLogService.js`, `replicationService.js` |
| TLS / mTLS | `backend/src/security/tlsServer.js`, `deviceCerts.js` |
| DB / backup encryption | `backend/src/security/cryptoBox.js`, `encryptedBackupService.js` |
| Password hashing | `backend/src/utils.js` (Argon2id) |
| Audit chain | `backend/src/services/auditTrailService.js` |
| Log redaction | `backend/src/security/logRedaction.js` |
| Shop Network UI | Settings → Shop Network |

See also `docs/shop-cluster-build-plan.md`.
