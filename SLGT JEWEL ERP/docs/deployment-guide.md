# Deployment Guide — Jewellery CRM (Offline Branch Architecture)

## Components

1. **Local PostgreSQL** (Branch)
2. **Branch Service** (Express, `APP_MODE=branch`)
3. **Desktop** (`JewelleryCRM-Setup.exe`) or browser → Branch API
4. **Cloud** (optional sync target, `APP_MODE=cloud`)

---

## PC1 — Active Branch Host (exact steps)

1. Install PostgreSQL binaries (or use scoop PostgreSQL).
2. Clone/copy CRM to `C:\crm` (or install path).
3. Backend:
   ```bat
   cd C:\crm\backend
   npm install
   npm run branch:bootstrap
   npm run start:branch
   ```
4. Confirm: open `http://127.0.0.1:8000/api/health` → `app_mode=branch`, `ready=true`.
5. (Recommended) Install Windows service via NSSM — see `backend/scripts/windows/install-branch-service.ps1.md`.
6. Install desktop: run `JewelleryCRM-Setup.exe` from `desktop/dist/`.
7. First launch → **Create / Set Up Shop** → default `http://127.0.0.1:8000` → Continue.
8. Login: permanent administrator `SLGT@ERP` / `SLGT@1821`, then create the owner login from **Settings → Company Profile → Update Password**.
9. Optional cloud sync: set `CLOUD_ENDPOINT` + `SYNC_API_KEY` in `.env.branch`, restart Branch Service.

---

## PC2 / PC3 — Join shop (exact steps)

1. Install `JewelleryCRM-Setup.exe` only (no local Postgres required for pure client).
2. On PC1 (owner): Settings/API → create pairing code:
   `POST /api/devices/pairing-code` (or future UI).
3. On PC2: First launch → **Join Existing Shop**.
4. Enter PC1 Branch URL (e.g. `http://192.168.1.10:8000`) — or use discovery API.
5. Complete pairing with code via `POST /api/devices/register`.
6. Login against Branch Service; bill as normal.
7. Optional: mark device `recovery` and copy `.recovery/latest.json.enc` + backup schedule.

Firewall on PC1: allow TCP **8000** (and UDP **41779** for discovery).

---

## Upgrade order

1. Stop clients briefly if schema migration required  
2. Backup (`POST /api/system/backup`)  
3. Upgrade Branch Service + run migrations  
4. Upgrade desktop  
5. Verify `/api/health` schema_version compatibility  

Never auto-migrate mid-transaction across clients without backup.
