# Legacy Python / Mongo backend — QUARANTINED

**Do not run `backend/server.py` in production or Electron.**

## Active stack

- Electron Host/Client → Node Express (`backend/src/index.js`) via `desktop/lib/backendProcess.js`
- Persistence: SQLite (Sequelize)

## Legacy artifact

| Path | Status |
|------|--------|
| `backend/server.py` | FastAPI + Mongo — **unused** by the desktop app |
| Related Python tests under `backend/tests/*.py` | Legacy only |

## Removal criteria (Phase 21)

1. Prove packaged Electron never invokes `python` / `uvicorn` / `server.py` (covered by `phase2Plus` desktop scan).
2. Ops runbooks point only to Node health `/api/health`.
3. After one release cycle with no Python start path, delete or move `server.py` to `backend/legacy/`.

Until then, keep the file as a reference only — **do not extend features in Python/Mongo**.
