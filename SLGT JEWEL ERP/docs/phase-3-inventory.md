  # Phase 3 — Inventory Ledger + Unique Item Model

  **Status:** Complete — awaiting review before Phase 4  
  **Date:** 2026-07-28  
  **Schema version:** 3

  ---

  ## 1. Final inventory model

  | Mode | Field | Semantics |
  |------|--------|-----------|
  | `quantity` | `products.inventory_mode = 'quantity'` | Interchangeable units; `stock_qty` is the fast-read balance |
  | `unique_tag` | `products.inventory_mode = 'unique_tag'` | One product row = one physical tagged piece |

  **Materialized state:** `products.stock_qty` (+ `status` for unique items)  
  **Audit ledger:** `inventory_movements` (append-only)

  Existing products remain `quantity` (not auto-converted).

  ---

  ## 2. Unique-tag modelling decision

  **Decision: keep Product as the inventory identity. Do not add `inventory_items` / tag table in Phase 3.**

  ### Evidence from live data (post Phase 2)

  | Metric | Value |
  |--------|--------|
  | Products | 42 |
  | `inventory_mode=quantity` | 42 |
  | `stock_qty > 1` | 32 |
  | With barcode | 42 |
  | Missing barcode | 0 |
  | Status mix | available / on_display only |

  ### Why not normalize further now

  1. Current rows are **catalog + quantity**, not one-row-per-physical-tag.  
  2. Product already carries barcode, weights, and status.  
  3. Introducing a second table would force a large data migration with little gain while most SKUs remain quantity-based.  
  4. `unique_tag` mode reuses the Product row: `stock_qty ∈ {0,1}`, barcode required for sale, status drives availability.

  Operators can opt into `unique_tag` later via inventory APIs / admin (`setInventoryMode`) once qty is 0 or 1 and barcode exists.

  ---

  ## 3. Movement schema (`inventory_movements`)

  | Column | Notes |
  |--------|--------|
  | id | UUID string PK |
  | shop_id | Required; must match product.shop_id |
  | product_id | Required |
  | movement_type | See below |
  | quantity | **Signed** delta (+ in / − out) |
  | gross_weight, net_weight, stone_weight | Snapshot from product (or override) |
  | qty_before, qty_after | Balance around the change |
  | reference_type / reference_id | invoice, purchase, inventory_adjustment, … |
  | origin_device_id, created_by, notes, meta | Audit |
  | created_at | Append-only (no updated_at) |

  Indexes: shop+product+created, shop+type+created, reference, product+type.

  ---

  ## 4. Movement types

  | Type | Qty | Meaning |
  |------|-----|---------|
  | `OPENING` | + | Ledger baseline / product create opening |
  | `PURCHASE` | + | Finished-goods purchase receive |
  | `SALE` | − | Invoice sale / unique sold |
  | `SALE_RETURN` | + | Explicit return restoring stock / unique availability |
  | `ADJUSTMENT_ADD` | + | Manual add / return-to-stock adjustment |
  | `ADJUSTMENT_REMOVE` | − | Manual remove |
  | `DAMAGE` | − | Damage / write-off |
  | `REPAIR_IN` | + | Reserved for repair return (domain ready; not wired to UI) |
  | `REPAIR_OUT` | − | Reserved for repair outbound |

  No invented types beyond current CRM meaning + repair placeholders already implied by orders/repairs module.

  ---

  ## 5. Unique item state transitions

  Statuses: `available`, `on_display`, `reserved`, `sold`, `damaged`

  | From | Allowed to |
  |------|------------|
  | available | on_display, reserved, sold, damaged |
  | on_display | available, reserved, sold, damaged |
  | reserved | available, on_display, sold, damaged |
  | sold | available (**only via `returnUniqueItem` / SALE_RETURN**) |
  | damaged | (terminal in V1) |

  Double-sale protection:

  1. `SELECT … FOR UPDATE` on product  
  2. Conditional `UPDATE … WHERE status IN ('available','on_display','reserved') … RETURNING`  
  3. Parallel test: only one of two concurrent sells succeeds  

  Generic `PATCH /products/:id` strips `stock_qty`, `status`, `inventory_mode` and rejects restoring sold unique items.

  ---

  ## 6. Existing data migration

  Migrations:

  1. `20260728140001-create-inventory-movements.js` — table + indexes; schema_version → 3  
  2. `20260728140002-baseline-inventory-movements.js` — OPENING per product from current `stock_qty`; backfill prior `inventory_adjustments` if any

  **Baseline strategy:** one `OPENING` per product with note  
  `"Inventory balance at ledger migration"`  
  — **no invented historical SALE/PURCHASE rows**.

  ---

  ## 7. `stock_history` decision

  **A. `inventory_movements` is the authoritative ledger.**

  | Legacy | Fate |
  |--------|------|
  | `stock_history` | Preserved; **deprecated for new writes** (`recordStockChange` warns) |
  | `inventory_adjustments` | Still created for API compatibility; movements are source of truth |
  | `GET /api/stock/history` | Now reads **`inventory_movements`** (legacy-compatible shape) |
  | `GET /api/stock/movements` | Explicit ledger endpoint |

  ---

  ## 8. Purchase integration

  `createPurchase` for `finished_goods` + `product_id`:

  ```
  BEGIN
    increaseStock(PURCHASE)  // stock + movement
    create purchase row
    update vendor balances
  COMMIT
  ```

  Non–finished-goods types unchanged (no stock).

  ---

  ## 9. Adjustment integration

  `POST /api/stock/adjustments` uses `adjustStock()` inside a transaction:

  - add → `ADJUSTMENT_ADD`  
  - remove → `ADJUSTMENT_REMOVE`  
  - damage → `DAMAGE` (quantity or unique)  
  - return → `ADJUSTMENT_ADD`  

  Stock update + movement + `inventory_adjustments` row are atomic.

  ---

  ## 10. Direct stock-edit findings

  | Location | Before Phase 3 | After |
  |----------|----------------|-------|
  | `invoices.createInvoice` | Direct `stock_qty -=` | `applySaleLine()` + SALE movement |
  | `purchases.createPurchase` | Direct `stock_qty +=` | `increaseStock(PURCHASE)` |
  | `stockHistory.createAdjustment` | Non-atomic updates | `adjustStock()` in TX |
  | `products.updateProduct` | Blind `req.body` | Strips inventory fields |
  | `products.createProduct` | Sets stock only | OPENING movement when applicable |
  | `seed.js` / `demoSeed.js` | Direct creates | Untouched (dev seeds) |
  | Quotation convert | No stock | **Still no stock** (Phase 4) |

  ---

  ## 11. Barcode findings

  - Phase 2 unique `(shop_id, barcode)` retained.  
  - Live data: **0 missing barcodes**, **0 unique_tag products** yet.  
  - `unique_tag` sale requires barcode (`BARCODE_REQUIRED`).  
  - No silent barcode generation during migration.

  ---

  ## 12. Inventory service

  `backend/src/services/inventoryService.js`

  - `recordMovement`, `increaseStock`, `decreaseStock`, `adjustStock`  
  - `markUniqueItemSold`, `returnUniqueItem`, `damageUniqueItem`  
  - `validateAvailability`, `applySaleLine`  
  - `stripInventoryFieldsFromProductUpdate`, `setInventoryMode`  
  - Cross-shop guard (`CROSS_SHOP`)

  Constants: `backend/src/constants/inventory.js`

  ---

  ## 13. Tests

  `npm run test:inventory` — **ALL PASSED**

  Covered: qty inc/dec, insufficient stock, adjustments, purchase movement, unique sell, double-sell (serial + parallel), sold lock via strip, return, rollback, cross-shop, barcode unique, opening present, mode guard.

  ---

  ## 14. Inventory audit results

  `npm run audit:inventory` → `docs/inventory-audit.json`

  After cleanup of ephemeral test rows:

  ```
  Products checked: 42
  Balanced: 42
  Mismatched: 0
  Unique-tag violations: 0
  Missing barcodes (unique_tag): 0
  ```

  (OPENING baseline + subsequent test movements reconcile to `stock_qty`.)

  ---

  ## 15. Unresolved issues for Phase 4

  1. Quotation → invoice still skips inventory.  
  2. POS still trusts client GST/totals (no server recompute).  
  3. Invoice TX hardening (full lock order, payment validation) beyond `applySaleLine`.  
  4. Purchase update/delete does not reverse stock.  
  5. No sale-return UI module (domain `returnUniqueItem` / `SALE_RETURN` ready).  
  6. `REPAIR_IN` / `REPAIR_OUT` not wired to orders workflow.  
  7. Weight edits on product form do not create movements (by design for Phase 3).  
  8. Optional future: separate `inventory_items` table if shops adopt widespread unique tagging + multi-qty variants of same design.

  ---

  ## Commands

  ```bash
  cd backend
  npm run migrate
  npm run test:inventory
  npm run audit:inventory
  ```

  ---

  **STOP — Phase 3 complete.** Do not begin Phase 4 until approved.
