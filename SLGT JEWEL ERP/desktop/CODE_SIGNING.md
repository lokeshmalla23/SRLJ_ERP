# Code signing (Windows SmartScreen)

`JewelleryCRM-Setup.exe` is **not** Authenticode-signed in this repo.

Without a certificate, Windows may show **SmartScreen → More info → Run anyway**. That is expected.

## To remove the warning

1. Buy/issue an Authenticode code-signing certificate (EV preferred for reputation).
2. Set env vars before `npm run dist` in `desktop/`:

```bat
set CSC_LINK=C:\path\to\certificate.pfx
set CSC_KEY_PASSWORD=your-pfx-password
cd C:\crm\desktop
npm run dist
```

Or place the cert per [electron-builder code signing docs](https://www.electron.build/code-signing).

Signing cannot be faked in the build; it requires your organization’s certificate.
