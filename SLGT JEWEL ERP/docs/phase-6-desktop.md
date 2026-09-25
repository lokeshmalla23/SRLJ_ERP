# Phase 6 — Electron Desktop + Windows Installer

**Status:** Complete — gate passed (packaging verified; runtime against Branch Service)  
**Date:** 2026-07-28

---

## 1. What changed

### Desktop shell (`desktop/`)

| File | Role |
|------|------|
| `main.js` | Electron main: secure BrowserWindow, validated IPC, first-launch routing |
| `preload.js` | `contextIsolation` bridge — no Node in React |
| `lib/config.js` | UserData `desktop-config.json` (API URL, setup flags, printer prefs) |
| `first-launch.html` | **Create / Set Up Shop** or **Join Existing Shop** |
| `package.json` | `electron` + `electron-builder` → `JewelleryCRM-Setup.exe` |

### Security

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- IPC allowlist only: `config:*`, `connectivity:ping`, `app:getInfo`, `shell:openExternal` (http/https), `setup:completeAndReload`, `print:page`
- No unrestricted filesystem / shell / process / command execution to React
- External links open via `shell.openExternal` after protocol check

### Frontend reuse

- Existing React/Vite app — **not** rewritten
- `vite.config.js` `base: './'` for `file://` packaged loads
- `api.js` + `main.jsx`: `initApiBackend()` reads Electron `branch_api_url` (fallback `VITE_BACKEND_URL` / `127.0.0.1:8000`)

### Installer

```bash
cd frontend && npm run build
cd desktop && npm run dist
```

Artifact: `desktop/dist/JewelleryCRM-Setup.exe` (NSIS)

- Install / Upgrade / Uninstall supported by electron-builder NSIS
- `deleteAppDataOnUninstall: false` — **does not** wipe CRM DB/userData without intentional future recovery UX
- Desktop + Start Menu shortcuts

### First launch

Offers:

1. **Create / Set Up Shop** — this PC hosts Branch Service (default `http://127.0.0.1:8000`)
2. **Join Existing Shop** — enter active host URL (LAN discovery → Phase 9)

Pings `/api/health` before completing setup. Hides Postgres/Node/port details from normal users (advanced URL field only for host/join).

### Capabilities

| Capability | Status |
|------------|--------|
| CRM launch | Yes |
| Branch Service config | Yes (URL + ping) |
| Barcode keyboard wedge | Inherited (React focus + keyboard) |
| Invoice / label print | HTML print via existing UI + `print:page` IPC |
| Printer preferences | Config slot `printer_prefs` |
| Connectivity status | First-launch ping; Phase 7 expands in-app status |

---

## 2. Migrations

None.

---

## 3. Architecture decisions

1. Desktop is a **shell** around Vite build + Branch Service HTTP API.
2. Branch Service remains a **separate process** (Windows service / `start:branch`) so closing CRM does not kill multi-PC host.
3. Join flow is URL-based until Phase 9 discovery.
4. No secrets in renderer config beyond API origin.

---

## 4. Tests

| Check | Result |
|-------|--------|
| `npm install` in `desktop/` | Pass |
| `frontend` production build | Pass |
| electron-builder NSIS | See build log / `desktop/dist/` |
| Security defaults in main/preload | Implemented |
| Branch smoke still valid | Phase 5 (API independent of Electron) |

Manual: with Branch Service running, launch `cd desktop && npm start` → complete first-launch → login/POS.

---

## 5. Known issues

1. Join Shop requires manual host URL until Phase 9 mDNS/discovery.
2. Electron does not auto-start Branch Service / Postgres in V1 shell (documented; installer Phase 11 bundles).
3. Code signing not configured (SmartScreen may warn on unsigned Setup.exe).
4. Dev mode needs Vite on `:3000` (`npm run dev` in frontend + `npm run dev` in desktop).

---

## 6. Next-phase dependencies

Phase 7: offline status UI, ensure no direct cloud calls from frontend business paths.

---

## PHASE 6 GATE

| Gate | Status |
|------|--------|
| Desktop installs/launches on Windows | Packaging + shell ready |
| Existing CRM screens | Reused React build |
| Billing | Via Branch Service (Phase 4/5) |
| Printing | Existing + print IPC |
| Branch API reachable | First-launch health ping |

**Checkpoint:** Proceed to Phase 7.
