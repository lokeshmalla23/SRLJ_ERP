# Phase 7 — Full Offline Operation

**Status:** Complete — gate passed  
**Date:** 2026-07-28

---

## 1. What changed

### Architecture (local-first)

```
Desktop / Browser
  → Branch Service (APP_MODE=branch)
  → Local PostgreSQL
```

Cloud is **optional**. Morning cloud download is **not** required.

### Offline modules (via Branch Service)

Login, POS, barcode, customers, products, inventory, payments, orders, schemes, settings, reports, printing APIs — all already local when `DATABASE_URL` points at local PG (Phase 5).

### Frontend routing

- Business calls go through `api.js` → Branch URL.
- Settings backup downloads switched from raw `VITE_BACKEND_URL` to `getBackendUrl()`.
- No Neon/cloud host hardcoding in business pages.

### Authentication offline

- JWT + bcrypt hashes in **local** `users` table (seeded/provisioned).
- Passwords never stored plaintext.
- Existing employees log in while cloud unavailable.
- Cloud-only admin ops (remote user push) remain unavailable until Phase 8 pull expands.

### UI status

`ConnectivityBanner` in `AppShell`:

- **Offline** — Shop operations available. Cloud sync paused.
- Pending / failed sync counts when present
- Shop service unavailable (amber) when Branch health fails — not a generic “network error”

---

## 2. Migrations

None.

---

## 3. Tests / gate

| Gate | How verified |
|------|----------------|
| Internet not required at startup | Branch Service on local PG (Phase 5 bootstrap); `CLOUD_ENDPOINT` empty |
| Billing workflow offline | Phase 5 `smoke:branch` invoice + Phase 4 billing on local DB |
| Restart retains data | Local PostgreSQL durable cluster `.local-pgdata` |

---

## 4. Known issues

1. Banner uses `/api/sync/status` (auth) — if token missing on login page, banner only on AppShell (authenticated).
2. Full Windows cold-start with internet disabled end-to-end is documented for acceptance; automated CI cannot flip host NIC.

---

## PHASE 7 GATE: **Pass** — proceed to Phase 8.
