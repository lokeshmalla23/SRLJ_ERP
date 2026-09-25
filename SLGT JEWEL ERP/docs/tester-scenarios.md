# Tester Guide — Jewellery CRM Offline Branch System

**Purpose:** Hand this document to QA. Each scenario has steps, expected result, and pass/fail.  
**Build under test:** Branch Service + Desktop (`JewelleryCRM-Setup.exe`) + local PostgreSQL.  
**Login:** Use the owner account created for your environment (do not share passwords in this doc).

Mark each scenario: **PASS** / **FAIL** / **BLOCKED** + notes.

---

## Prep (before testing)

### Environment A — Single PC (minimum)
1. Run Branch Service locally (`npm run branch:bootstrap` then `npm run start:branch` in `backend/`).
2. Open `http://127.0.0.1:8000/api/health` → `ready: true`, `app_mode: branch`.
3. Install or run desktop CRM, or use browser at Vite URL pointed at Branch.
4. Login as owner.

### Environment B — Three PCs (full acceptance)
| PC | Role |
|----|------|
| PC1 | Active Branch Host (Postgres + Branch Service + CRM) |
| PC2 | Client / recovery-capable |
| PC3 | Client |

Same Wi‑Fi/LAN. PC1 firewall allows TCP **8000** and UDP **41779**.

### Useful screens
- **POS** — billing  
- **Settings → System Health** — DB, sync, pairing, backup, recovery  
- **Inventory / Products** — stock  
- Connectivity banner at top of app (Offline / Pending sync)

---

## Section 1 — Login & basics

### T1.1 Login success
1. Open CRM → login with valid owner credentials.  
**Expect:** Dashboard loads; no error.

### T1.2 Login failure
1. Wrong password.  
**Expect:** Clear error; stay on login; no crash.

### T1.3 Session
1. Login → use POS → refresh page.  
**Expect:** Still logged in (or clean redirect to login if token expired — not a blank white screen).

---

## Section 2 — Billing correctness (critical)

### T2.1 Normal sale (quantity item)
1. Ensure a product with stock ≥ 2.  
2. POS: add item → pay full amount (cash) → complete.  
**Expect:** Invoice number like `PREFIX-YYMMDD-####`; stock decreased by qty; print/preview shows server totals.

### T2.2 Insufficient stock
1. Product with stock `0` (or try qty > stock).  
2. Attempt sale.  
**Expect:** Error; **no** invoice created; stock unchanged.

### T2.3 Unique tag — one physical piece
1. Product in unique-tag mode, status available, stock 1.  
2. Sell once.  
**Expect:** Success; item sold / stock 0.  
3. Sell same item again.  
**Expect:** Rejected (already sold).

### T2.4 GST / totals not trusted from client
1. Create a bill; note grand total on screen.  
2. If possible, inspect network request and confirm invoice response totals match print (server wins).  
**Expect:** CGST/SGST present where GST applies (~3% split 1.5/1.5); invoice stored totals match print.

### T2.5 Split payment
1. Pay half cash + half UPI equaling grand total.  
**Expect:** Invoice paid; both modes stored.

### T2.6 Invalid payments
1. Negative amount / unknown mode / amount far below total.  
**Expect:** Rejected; no invoice.

### T2.7 Empty cart
1. Checkout with zero items.  
**Expect:** Rejected.

### T2.8 Double-click / retry submit
1. Complete a bill; immediately repeat same submit (or network retry with same request).  
**Expect:** **One** invoice only (idempotent); stock reduced once.

### T2.9 Quotation → Invoice
1. Create quotation with product lines → convert to invoice → pay.  
**Expect:** Invoice created; stock reduced; quotation marked converted.  
2. Convert same quotation again.  
**Expect:** Rejected (already converted).

### T2.10 Cancel invoice
1. Create invoice → cancel via API or UI if exposed (`POST /api/invoices/:id/cancel`).  
**Expect:** Status cancelled; **same invoice number kept**; stock restored; can still see original invoice (not deleted).  
2. Cancel again.  
**Expect:** Rejected.

### T2.11 Snapshot after product rename
1. Sell product “Ring A”.  
2. Rename product to “Ring B”.  
3. Re-open old invoice.  
**Expect:** Line still shows **Ring A** (snapshot).

---

## Section 3 — Inventory

### T3.1 Stock after sale
1. Note stock before/after sale.  
**Expect:** Matches sold qty; movement history shows SALE.

### T3.2 Adjustment
1. Manual stock adjustment (add/remove) if UI available.  
**Expect:** Stock updates; movement recorded; cannot set stock via random product edit if protected.

### T3.3 Purchase receive (finished goods)
1. Receive purchase that increases stock.  
**Expect:** Stock up; PURCHASE movement.  
2. Edit/cancel purchase qty if supported.  
**Expect:** Stock corrected via compensating movement; old movements not deleted.

### T3.4 Two cashiers, stock = 1 (quantity)
1. Two sessions try to sell the last unit at the same time.  
**Expect:** Only one succeeds; other gets insufficient stock.

### T3.5 Two cashiers, same unique tag
1. Same as T2.3 but from two PCs/browsers at once.  
**Expect:** Exactly one success.

---

## Section 4 — Offline / Branch (no internet)

### T4.1 Start with internet OFF
1. Disable Wi‑Fi/WAN (LAN between PCs can stay for multi-PC).  
2. Start Branch Service + CRM.  
**Expect:** Login works; banner may show **Offline — Shop operations available. Cloud sync paused.**

### T4.2 Full offline billing
1. Create customer → sell → pay → print.  
**Expect:** All succeed without cloud.

### T4.3 Restart while offline
1. Close CRM → reopen → check invoice and stock.  
**Expect:** Data still present.

### T4.4 Restart Branch Service while offline
1. Stop/start Branch Service → login → verify last invoice.  
**Expect:** Data intact.

### T4.5 No scary “network failed” for expected offline
1. With cloud disconnected, use POS normally.  
**Expect:** Shop ops work; status is calm Offline/pending — not generic fatal network errors on every click.

---

## Section 5 — Sync (cloud)

**Needs:** `CLOUD_ENDPOINT` configured on Branch; cloud API running.

### T5.1 Offline then reconnect
1. Internet OFF → create 2–3 invoices.  
2. Settings → System Health → note **Pending Sync** > 0.  
3. Internet ON → wait / Retry Failed Sync.  
**Expect:** Pending → 0; cloud has those invoices **once each**.

### T5.2 No duplicates on retry
1. Force sync retry twice.  
**Expect:** Still one copy per invoice on cloud.

### T5.3 Cloud down all day
1. Point to bad cloud URL or block cloud.  
2. Keep billing.  
**Expect:** Local billing OK; pending grows; no data loss.

### T5.4 System Health accuracy
1. Compare banner + System Health pending/failed/online with reality.  
**Expect:** Counts match; no secrets shown (no passwords/URLs with credentials).

---

## Section 6 — Desktop / installer

### T6.1 Install
1. Run `JewelleryCRM-Setup.exe` → Install.  
**Expect:** App installs; shortcuts created.

### T6.2 First launch — Create Shop
1. Choose Create / Set Up Shop → default `http://127.0.0.1:8000` (Branch running).  
**Expect:** Health ping OK → CRM opens → login works.

### T6.3 First launch — Join Shop
1. On PC2: Join Existing Shop → Scan or enter PC1 URL → pairing code from PC1 System Health.  
**Expect:** Paired; CRM talks to PC1; login/billing works.

### T6.4 Uninstall does not wipe DB by surprise
1. Uninstall desktop app.  
**Expect:** Branch DB / data not silently destroyed (userData may remain; Postgres data remains).

### T6.5 Printing
1. Print invoice / barcode label if printers configured.  
**Expect:** Print dialog works; no crash if printer missing (billing still saved).

### T6.6 Barcode scanner (keyboard wedge)
1. Focus POS search → scan barcode.  
**Expect:** Product added like typed input.

---

## Section 7 — Multi-PC LAN

### T7.1 1 PC alone
1. Only PC1 running host.  
**Expect:** Full CRM works.

### T7.2 Add PC2
1. Pair PC2 → both bill.  
**Expect:** Both see consistent stock after refresh; no duplicate invoice numbers.

### T7.3 Add PC3
1. Pair PC3 → three users bill.  
**Expect:** Same as T7.2.

### T7.4 Remove PC3
1. Close/uninstall PC3.  
**Expect:** PC1/PC2 continue.

### T7.5 Unauthorized join
1. Try register without pairing code / expired code.  
**Expect:** Rejected.

### T7.6 Client LAN drop
1. Disconnect PC2 from LAN mid-work → reconnect → resubmit carefully.  
**Expect:** Reconnecting state; no duplicate invoices if same request id / user doesn’t double-create.

### T7.7 Internet off, LAN on
1. WAN down; PC2/PC3 still reach PC1.  
**Expect:** Local multi-PC billing continues.

---

## Section 8 — Recovery (controlled)

### T8.1 Host unavailable message
1. Stop Branch Service on PC1.  
2. Open CRM on PC2/PC3.  
**Expect:** Shop service unavailable / reconnecting — not silent corruption.

### T8.2 Promote PC2 (owner action)
1. Ensure recovery snapshot exists (System Health → Write Recovery Snapshot on host before failure, or on recovery PC after restore).  
2. Restore DB backup on PC2 if needed → start Branch on PC2.  
3. Owner promotes with confirmation (`confirm_dual_active_risk`).  
**Expect:** PC2 becomes active host; billing works.

### T8.3 PC3 reconnects to new host
1. Point PC3 at PC2 URL / rediscover.  
**Expect:** Works against PC2.

### T8.4 Old host PC1 returns
1. Start PC1 again **without** promoting it.  
**Expect:** PC1 does **not** silently become second active writer; must rejoin as client.  
2. Create invoice only on PC2.  
**Expect:** No split-brain duplicate shops.

### T8.5 Corrupt / refuse bad promote
1. Attempt promote without confirmation flag.  
**Expect:** Rejected.

### T8.6 Backup
1. System Health → Run Backup Now.  
**Expect:** Success message; backup file created under backend backups folder.

---

## Section 9 — End of Day & reports

### T9.1 EOD numbers
1. Create known invoices today → open EOD / System Health today totals.  
**Expect:** Invoice count and sales total match; payments by mode sensible.

### T9.2 EOD is not sync
1. With pending sync > 0, view EOD.  
**Expect:** EOD shows pending; does not claim “synced” just by opening EOD.

### T9.3 Reports / customers / orders / schemes
1. Smoke each main module: list, create one record if safe.  
**Expect:** No 500s; data persists after refresh.

---

## Section 10 — Security & permissions

### T10.1 Role permissions
1. Login as limited staff (if available).  
**Expect:** Cannot access Settings manage / cancel / pairing if denied.

### T10.2 Cross-shop (if multi-shop ever enabled)
1. Attempt to use another shop’s product id.  
**Expect:** Rejected.

### T10.3 No secrets in health/diagnostics
1. Open `/api/health` and System Health / diagnostics.  
**Expect:** No passwords, JWT, or full DB connection strings.

---

## Section 11 — Final acceptance day (copy for sign-off)

Use Environment B. Tester initials + date at bottom.

| # | Scenario | Pass? |
|---|----------|-------|
| 1 | 8:00 — No internet; all 3 PCs start; CRM works | |
| 2 | PC2 creates invoice | |
| 3 | PC3 creates invoice | |
| 4 | Inventory correct after both | |
| 5 | Simultaneous unique-tag sale — only one wins | |
| 6 | Create customer / order / payment / stock change offline | |
| 7 | Restart PC2 offline — data remains | |
| 8 | Restart Branch Service — data remains | |
| 9 | 11:00 — Internet on — pending → 0; cloud no duplicates | |
| 10 | 1:00 — Internet off again — billing continues | |
| 11 | 3:00 — PC1 fails — PC2/PC3 see unavailable | |
| 12 | Promote PC2 — billing continues | |
| 13 | PC3 reconnects to PC2 | |
| 14 | PC1 returns — does NOT become active | |
| 15 | PC1 rejoins safely as client | |
| 16 | Internet on — everything syncs | |
| 17 | EOD — Pending 0, Failed 0, inventory OK, backup OK | |

**Sign-off**

- Tester: _______________ Date: _______________  
- Owner: _______________ Date: _______________  
- Result: ☐ Production ready ☐ Fixes required (attach bugs)

---

## How to report a bug

Include:
1. Scenario ID (e.g. T2.8)  
2. PC role (host/client)  
3. Online/offline  
4. Steps  
5. Expected vs actual  
6. Invoice numbers / product barcodes  
7. Screenshot of System Health + any error toast  
8. **Do not** paste `.env`, passwords, or `DATABASE_URL`

---

## Automated checks (dev/QA optional)

```bash
cd backend
npm run test:billing
npm run test:inventory
npm run test:sync
npm run test:acceptance
npm run audit:billing
npm run audit:inventory
```

These support QA; they **do not** replace Section 11 on real PCs.
