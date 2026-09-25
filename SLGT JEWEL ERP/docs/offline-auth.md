# Offline Authentication

Allows staff to log in when the AWS backend is unreachable by comparing credentials against a locally cached bcrypt hash.

---

## Cache Policy

On every **successful online login**, the server returns the user's bcrypt hash. The desktop stores it in the local `users` SQLite table:

```sql
CREATE TABLE users (
  user_id    TEXT PRIMARY KEY,
  shop_id    TEXT NOT NULL,
  username   TEXT NOT NULL,
  bcrypt_hash TEXT NOT NULL,        -- bcrypt(password, cost=12)
  disabled   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL          -- ISO-8601 UTC, set on each cache refresh
);
```

The cache entry is valid for **72 hours** from `updated_at`. After 72 hours the cached hash is not used — the user must wait for online connectivity to re-authenticate.

---

## Offline Login Flow

```
Renderer: login form submit
    |
    v
IPC: auth:login { username, password }
    |
    v
offlineAuthService.loginOffline(username, password)
    |
    +-- Query users WHERE username = ? AND shop_id = ?
    |
    +-- Row found?
    |     No  --> return { ok: false, reason: 'no_cache' }
    |
    +-- updated_at within 72h?
    |     No  --> return { ok: false, reason: 'cache_expired' }
    |
    +-- disabled === 1?
    |     Yes --> return { ok: false, reason: 'account_disabled' }
    |
    +-- bcrypt.compare(password, bcrypt_hash)
    |     Fail --> return { ok: false, reason: 'bad_credentials' }
    |
    +-- return { ok: true, user: { user_id, username, role, ... } }
    |
    v
auditService.log('auth.loginOffline', { user_id, success: true/false })
```

The bcrypt compare runs in a worker thread (via `bcryptjs` async API) to avoid blocking the main process.

---

## Revocation Handling

The `disabled` column is the local copy of the cloud account status. It is updated on every successful online sync of the users table.

| Scenario                                    | Behavior                                                      |
|---------------------------------------------|---------------------------------------------------------------|
| Account disabled in cloud admin panel       | Propagated to desktop on next online login / user sync        |
| User logs in offline before sync            | Permitted if `disabled = 0` and cache is within 72 h TTL     |
| User logs in online after account disabled  | Cloud rejects — desktop writes `disabled = 1`, resets session |
| Cache TTL expires before re-enable          | User cannot log in offline; must wait for connectivity        |

**Important**: disabling an account in the cloud does not immediately terminate an active offline session on a disconnected device. Session termination requires the device to come online.

---

## Security Notes

- The cached hash uses **bcrypt with cost factor 12** (matching the server-side hash stored in PostgreSQL). The desktop never stores the plaintext password.
- The `users` table is inside the app's SQLite file, which is stored in Electron's `userData` directory. On Windows this is `%APPDATA%\JewelleryCRM\`.
- Physical access to the machine could expose the SQLite file. The threat model assumes the Windows user account is protected.
- The 72 h TTL limits the window in which a stolen device can be used with cached credentials after it is physically recovered.

---

## Implementation

`desktop/lib/services/offlineAuthService.js` — `loginOffline(username, password)`

Called from the auth IPC handler when the connectivity state is LAN_COORDINATED or ISOLATED (and also as a fallback when the online auth request times out in CLOUD_COORDINATED state).
