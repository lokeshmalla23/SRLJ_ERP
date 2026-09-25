# Phase 5 — Branch Service + Local PostgreSQL

**Status:** Complete — gate passed  
**Date:** 2026-07-28  
**Schema version:** 4 (unchanged)

---

## 1. What changed

### Single Express app, two modes

| Mode | `APP_MODE` | Database | Listen |
|------|------------|----------|--------|
| Cloud | `cloud` (default) | Neon / remote `DATABASE_URL` | typically localhost bind |
| Branch | `branch` | Local PostgreSQL | `0.0.0.0` (LAN-ready) |

Business services are **shared** — no duplicated billing/inventory/controllers.

### Branch configuration

- `backend/src/config/branchConfig.js` — shop/device/role/listen/cloud endpoint
- `backend/config/branch.example.json` — template (no secrets)
- Auto-generates `device_id` into `backend/config/branch.json` on first branch start
- Secrets via environment / `.env.branch` only

### Health

`GET /api/health` returns (no secrets):

- `app_mode`, `schema_version`, `shop_id`, `device_id`, `device_name`, `role`
- `database.status` (+ name/version when ok)
- `cloud` status (`not_configured` in branch without endpoint)
- `ready` boolean

### Local PostgreSQL automation

| Script | Purpose |
|--------|---------|
| `npm run branch:bootstrap` | Isolated local cluster in `backend/.local-pgdata` (port **55432**, trust localhost only) + `.env.branch` |
| `npm run branch:stop-db` | Stop that cluster |
| `npm run branch:setup-system-pg` | Optional: use system PostgreSQL (`--password=…`) |
| `npm run start:branch` | Load `.env.branch` and start API in branch mode |
| `npm run smoke:branch` | Login + customers/products/orders/schemes/settings + invoice on local DB |

Installer-era full automation (service account, firewall) is prepared via NSSM notes; production packaging completes in Phases 6/11.

### Windows service prep

`backend/scripts/windows/install-branch-service.ps1.md` — NSSM install so CRM UI close does **not** stop Branch Service.

### Startup sequence (branch)

```
load config (.env.branch + branch.json)
→ connect local PostgreSQL
→ sync models (alter:false) + Umzug migrations
→ verify/resolve shop
→ seed if empty
→ listen 0.0.0.0:PORT
→ ready
```

---

## 2. Migrations

None new. Fresh local DB applied all Phase 2–4 migrations successfully (12 migrations).

---

## 3. Architecture decisions

1. **Reuse Express** — `APP_MODE` switch only; no second backend.
2. **Isolated test cluster** — avoid requiring the system Postgres password; dedicated port 55432.
3. **Trust localhost only** on the branch cluster `pg_hba.conf` for Phase 5; production installer will use password auth + Windows ACLs.
4. **Cloud optional** — branch health reports cloud as `not_configured`; business APIs do not call cloud.
5. **Frontend still uses `VITE_BACKEND_URL`** — discovery comes in Phases 6/9.

---

## 4. Tests

```bash
cd backend
npm run branch:bootstrap
npm run start:branch   # separate terminal
npm run smoke:branch
```

**Result:** `BRANCH SMOKE PASSED (local PostgreSQL, no cloud required)`

Verified:

- Health `app_mode=branch`, schema 4, device + shop present
- Login (seeded owner)
- Customers, products, orders, schemes, settings
- Invoice create via Phase 4 billing on **local** DB (`SSJ-260728-0001`)

Cloud Neon was not used for this run (`DATABASE_URL` → `127.0.0.1:55432`).

---

## 5. Audit / gate

| Gate | Status |
|------|--------|
| CRM/API works against local PostgreSQL | Pass |
| Core APIs without cloud | Pass |
| Shared business logic (no fork) | Pass |

Also fixed payment validation message ordering in `billingCalc.js` (overpay vs underpay) discovered during smoke.

---

## 6. Known issues

1. System PostgreSQL (x64-14/18) not auto-wired — bootstrap uses scoop binaries + isolated data dir.
2. Branch cluster uses **trust** for 127.0.0.1 (dev/test). Installer must switch to SCRAM + secrets.
3. NSSM service install is documented, not auto-run on this machine.
4. Frontend Vite still pointed at env URL — Electron (Phase 6) will own discovery/config UX.
5. No schema bump — still version 4.

---

## 7. Next-phase dependencies

Phase 6 (Electron):

- Point desktop at Branch Service (`http://127.0.0.1:8000` or LAN host)
- First-launch: Create Shop / Join Shop
- Package Branch Service start with app where appropriate

---

## PHASE 5 GATE

| Gate | Status |
|------|--------|
| CRM works against local PostgreSQL | **Pass** |
| Disconnect cloud — core local APIs work | **Pass** |

**Checkpoint:** Proceed to Phase 6.
