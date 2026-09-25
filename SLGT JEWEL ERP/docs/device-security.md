# Device Security

Covers device identity, key storage, LAN message authentication, and cloud device registration.

---

## Device Identity

Each installation generates a unique identity on first run.

| Component      | Value                          | Storage location                              |
|----------------|-------------------------------|-----------------------------------------------|
| Device ID      | UUID v4                       | Electron app config (`userData/config.json`)  |
| ECDH key pair  | P-256 (prime256v1)            | Private key: Electron safeStorage; Public key: app config + cloud DB |
| Device short ID| First 6 chars of Device ID    | Used in invoice sequence prefix               |

The Device ID is stable for the lifetime of the installation. Re-installing the app generates a new Device ID and key pair; the old device record in the cloud is deactivated.

---

## Key Generation and Storage

Key pair is generated once using Node.js `crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })`.

```
First run
  |
  +-- generateKeyPairSync P-256
  |
  +-- privateKeyPem  --> Electron safeStorage.encryptString()
  |                      --> stored as Buffer in userData/device-key.enc
  |
  +-- publicKeyPem   --> stored plaintext in userData/config.json
  |                  --> POST /api/devices (registration)
  |
  +-- deviceId UUID  --> stored in userData/config.json
```

**Electron safeStorage** delegates to the OS credential store:
- Windows: DPAPI (`CryptProtectData`) — tied to the Windows user account
- macOS: Keychain
- Linux: libsecret / kwallet

The encrypted blob is useless outside the originating OS user session. Copying `device-key.enc` to another machine does not expose the private key.

---

## LAN Message Authentication

All HTTP messages on the LAN coordinator channel (`:41780`) are authenticated with **HMAC-SHA256**.

| Parameter     | Value                                    |
|---------------|------------------------------------------|
| Algorithm     | HMAC-SHA256                              |
| Shared key    | Shop-scoped secret, provisioned at setup |
| Replay window | 10 seconds                               |

### Request signing

```
timestamp = Math.floor(Date.now() / 1000)   // Unix seconds
nonce     = crypto.randomBytes(16).hex()
body      = JSON.stringify(payload)
message   = `${timestamp}:${nonce}:${body}`
signature = HMAC-SHA256(shopSecret, message).hex()

Headers sent:
  X-Timestamp: <timestamp>
  X-Nonce:     <nonce>
  X-Signature: <signature>
```

### Coordinator verification

1. Parse `X-Timestamp`. Reject if `|now - timestamp| > 10s` (replay window).
2. Check nonce has not been seen within the replay window (in-memory nonce cache, swept every 30 s).
3. Recompute HMAC over `${timestamp}:${nonce}:${rawBody}`. Reject if mismatch.

The shop secret is stored in Electron safeStorage (same mechanism as the private key) and is never transmitted over the network after initial setup.

---

## Cloud Device Registration

On first run (or after re-install), the desktop registers the device with the cloud:

```
POST /api/devices
{
  "device_id":   "uuid",
  "shop_id":     "uuid",
  "public_key":  "-----BEGIN PUBLIC KEY-----\n...",
  "hostname":    "PC-SHOP-01",
  "platform":    "win32"
}
```

The cloud stores the public key in the `devices` PostgreSQL table. It is used to verify device-signed payloads in future protocol extensions and for admin audit of which devices are registered to a shop.

Device deactivation (from the cloud admin panel) sets `devices.active = false`. The desktop checks this flag on each authenticated session start and refuses to operate if deactivated.

---

## Threat Model Notes

- LAN HMAC prevents rogue devices on the same network from injecting authority grants.
- DPAPI/Keychain binding means the private key cannot be exfiltrated without OS credential access.
- The 10 s replay window limits time-of-capture replay attacks on LAN messages.
- Cloud registration provides an audit trail of devices; deactivation is administrative, not cryptographic revocation.

---

## Implementation

`desktop/lib/services/deviceIdentity.js` — key generation, safeStorage read/write, device ID management
`desktop/lib/services/lanCoordinator.js` — HMAC signing (`signRequest`) and verification (`verifyRequest`)
