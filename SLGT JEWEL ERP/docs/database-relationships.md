# Database Tables & Relationships (Manual-Delete Reference)

This documents every table in the live schema, its columns/keys, and — most importantly —
**which tables reference which**, so you can tell what will be orphaned before you manually
delete a row.

Source of truth used to build this: Sequelize model files in `backend/src/models/*.js`
(51 models) and migrations in `backend/src/migrations/*.js` (68 files). Last verified: 2026-09-19.

## ⚠️ Read this first: there are NO real foreign-key constraints

A full grep of `backend/src` for `references:`, `REFERENCES`, `foreignKey`, `belongsTo`,
`hasMany`, `onDelete` returns **zero matches**. Every `*_id` column is a plain `STRING`
column with no Sequelize association declared, and `backend/src/models/index.js` never
calls `.belongsTo()`/`.hasMany()`.

Consequences:
- `PRAGMA foreign_keys = ON` (set in `backend/src/db.js` for SQLite) is a **no-op** — nothing
  is declared for it to enforce.
- Deleting a parent row is **never blocked** and **never cascades**. It will **silently
  orphan** any row elsewhere that stored that id.
- There is no `ON DELETE CASCADE/RESTRICT/SET NULL` anywhere — none exists to configure.
- All relationships below are "soft" (matched by convention in application code only).

So: **safety when deleting rows is entirely on you.** Use the "Referenced by" lists below to
find and clean up (or intentionally leave orphaned) dependent rows before/after deleting a
parent.

Almost every business table also carries **`shop_id`** (soft FK → `shops.id`) plus audit
columns `version`, `deleted_at`, `origin_device_id` (soft FK → `devices.id`). These are
omitted from the per-table notes below to avoid repetition — assume every table has them
unless stated otherwise.

Database is dual-mode: **SQLite** (Electron/desktop, file `backend/jewellery-crm.sqlite`) or
**PostgreSQL** (cloud, `DATABASE_URL`) — same schema either way, decided in `backend/src/db.js`.

---

## Quick answer: what can I safely delete?

**High fan-in — check dependents first, deleting these breaks the most things:**
`shops`, `customers`, `products`, `invoices`, `users`, `vendors`, `devices`, `categories`,
`catalog_items`.

**Low/no fan-in — safe leaf tables, little else points at them:**
`scheme_plans`, `inventory_adjustments`, `stock_history`, `product_status_history`,
`daily_closings`, `bank_reconciliation_items`, `purchase_items`, `invoice_items`,
`cashbook_entries`, `sale_authorities`, `audit_events`, `event_log`, `operation_ledger`.

**Watch out for polymorphic references** — columns named `reference_type`/`reference_id` or
`entity_type`/`entity_id` point at *different* tables depending on the type value. A plain
column-name search won't find these; you must also check the type value. They appear on:
`stock_history`, `inventory_movements`, `product_status_history`, `event_log`,
`audit_events`, `operation_ledger`, `sale_authorities`, `sync_outbox`,
`sync_processed_events`, and `journal_entries.source_type/source_id`.

**Dead/legacy, safe to ignore:**
- `draft_sales` — its `cashier_id`, `customer_id`, `promoted_invoice_id` columns are typed
  `INTEGER` while every real id in this schema is `STRING`. They don't resolve to real rows;
  treat this table as isolated.
- `loyalty_transactions`, `sync_outbox`, `sync_processed_events`, `sync_state` — created by
  migrations but have no Sequelize model and no code path uses them (loyalty points actually
  live inline on `customers.loyalty_points`).
- `pure_metal_dailies` — table was dropped entirely (migration
  `20260913100001-drop-pure-metal-daily.js`). Ignore if you see it mentioned in old docs.

---

## Full table inventory

Legend: **bold** = primary key or a soft foreign-key column. "Referenced by" = other tables
whose column points at this table's id (soft, unenforced).

### Core masters

#### `shops` — model: `Shop.js`
Columns: **id** (PK), name, code, gstin, phone, email, address, invoice_prefix, status,
settings (json), timestamps.
- References: none.
- **Referenced by (`shop_id`)**: virtually every table in this document. Deleting a shop
  orphans that shop's entire dataset — this is the single most destructive delete possible.

#### `users` — model: `User.js`
Columns: **id** (PK), email (unique), name, password_hash, role, permissions (json), active,
shop_id.
- Referenced by: `employees.user_id`, and `created_by`/`*_by`/`user_id` columns across most
  tables — `notifications`, `stock_history`, `inventory_adjustments`, `expenses`, `incomes`,
  `campaigns`, `orders`, `purchases`, `quotations`, `cashbook_entries`, `metal_issues`,
  `credit_notes`, `old_gold_receipts`, `old_gold_sales`, `journal_entries`,
  `gold_rate_history.changed_by`, `billing_rate_events.user_id`, `daily_closings.closed_by`,
  `invoices.created_by`/`cancelled_by`, `product_status_history.user_id`,
  `event_log.user_id`, `audit_events.user_id`, `operation_ledger.user_id`,
  `payments.received_by`, `customer_advances.received_by`,
  `bank_reconciliation_items.reconciled_by`, `barcode_stock_check_sessions.created_by`,
  `barcode_stock_check_scans.scanned_by`.

#### `employees` — model: `Employee.js`
Columns: **id** (PK), **user_id** (→ users.id, nullable), name, mobile, email, job_title,
department, salary, commission_pct/on, join_date, status, address, emergency_contact, notes,
employee_code.
- Referenced by: `invoices.salesperson_id`, `quotations.salesperson_id`,
  `schemes.salesperson_id`.

#### `categories` — model: `Category.js`
Columns: **id** (PK), name, description, **parent_id** (self-FK, subcategories),
**default_metal_type_id** (→ catalog_items.id), default_wastage_pct,
default_making_charge(_type), low_stock_threshold, **counter_id** (→ shop_counters.id).
- Referenced by: `categories.parent_id` (self), `products.category_id`/`subcategory_id`,
  `attributes.category_ids` (JSON array, loose), `barcode_stock_check_sessions.category_id`.

#### `attributes` — model: `Attribute.js`
Columns: **id** (PK), name, code, field_type, options (json), required, unit,
**category_ids** (JSON array → categories.id), display_order, help_text.
- Referenced by: none. (Attribute values are stored inline as JSON on
  `products.attribute_values`, not as normalized rows.)

#### `catalog_items` — model: `CatalogItem.js`
Columns: **id** (PK), **type** (`collection`/`tag`/`metal_type`/`stone_type`/`purity`/`unit` —
one table serves several lookup concepts), name, code, description, color, meta (json),
is_system.
- Referenced by: `products.metal_type_id`, `products.purity_id`, `products.unit_id`,
  `products.collection_ids`/`tag_ids`/`stone_type_ids` (JSON arrays),
  `categories.default_metal_type_id`. Deleting a row here can silently break several
  product-facing dropdowns — check the `type` value before deleting.

#### `hsn_codes` — model: `CreditNote.js` (exported `HsnCode`)
Columns: **id** (PK), code, description, gst_pct, is_active.
- Referenced by: none directly — products/invoices store `hsn_code` as free text, not an FK.

#### `barcode_templates` — model: `BarcodeTemplate.js`
Columns: **id** (PK, UUID), name, description, fields (json), barcode_type, columns,
label_size/width/height, show_border, font_size, is_default.
- Referenced by: none (self-contained print templates).

#### `settings` — model: `Setting.js`
Columns: **id** (PK), key (unique), value (json).
- No relationships either way.

### Inventory / catalog

#### `products` — model: `Product.js`
Columns: **id** (PK), name, code, barcode, **category_id**/**subcategory_id** (→
categories.id), collection_ids/tag_ids/stone_type_ids (JSON → catalog_items.id),
**metal_type_id**/**purity_id**/**unit_id** (→ catalog_items.id), attribute_values (json),
weights, making_charges, hsn_code (text), purchase/selling price, stock_qty, **counter_id**
(→ shop_counters.id), status, purchase_date, **vendor_id** (→ vendors.id), inventory_mode.
- Referenced by: `invoice_items.product_id`, `purchase_items.product_id`,
  `stock_history.product_id`, `inventory_adjustments.product_id`,
  `inventory_movements.product_id`, `product_status_history.product_id`,
  `barcode_stock_check_scans.product_id`, `sale_authorities.entity_id` (when
  `entity_type='product'`). Second-most heavily depended-on table — deleting a product
  orphans all its historical stock/sale/audit trail rows.

#### `inventory_movements` — model: `InventoryMovement.js`
**id** (PK), product_id (→ products.id), movement_type, quantity, weights, qty_before/after,
`reference_type`/`reference_id` (polymorphic), created_by. Append-only ledger, nothing
references it back.

#### `inventory_adjustments` — model: `InventoryAdjustment.js`
**id** (PK), product_id (→ products.id), product_name (snapshot), adjustment_type,
qty_before/change/after, reason, created_by. Nothing references it back.

#### `stock_history` — model: `StockHistory.js`
**id** (PK), product_id (→ products.id), product_name (snapshot), change_type,
qty_before/change/after, `reference_id`/`reference_type` (polymorphic), created_by. Nothing
references it back.

#### `product_status_history` — model: `ProductStatusHistory.js`
**id** (PK), product_id (→ products.id), from_status/to_status, reason,
`reference_type`/`reference_id` (polymorphic), user_id, device_id. Nothing references it back.

#### `metal_issues` — model: `MetalIssue.js`
**id** (PK), **order_id** (→ orders.id, nullable), **karigar_vendor_id** (→ vendors.id),
movement_type, metal_type, purity, weight, scrap_weight, created_by. Nothing references it
back.

#### `pure_products` — model: `PureProduct.js`
**id** (PK), metal, form_type, weight_g, name, stock_qty, low_stock_threshold, status.
Standalone (coin/bullion inventory) — no relationships either way.

#### `gold_rate_history` — model: `GoldRateHistory.js`
**id** (PK), rates (json), changed_by (→ users.id), source. Append-only; nothing references
it back.

#### `billing_rate_events` — model: `GoldRateHistory.js` (exported `BillingRateEvent`)
**id** (PK), event_type, gold_rate, previous_rate, **invoice_id** (→ invoices.id), user_id.
Nothing references it back.

### Customers / CRM

#### `customers` — model: `Customer.js`
Columns: **id** (PK), name, mobile, email, address, gst_number, pan_number/image,
aadhaar_number, dob, anniversary, tag, notes, total_purchases, loyalty_points.
- Referenced by: `invoices.customer_id`, `quotations.customer_id`, `orders.customer_id`,
  `schemes.customer_id`, `payments.customer_id`, `customer_advances.customer_id`,
  `campaign_messages.customer_id`, `credit_notes.customer_id`,
  `old_gold_receipts.customer_id`, and dead table `loyalty_transactions.customer_id`.
  **Heavily referenced** — deleting a customer leaves invoices/payments/schemes/etc. with
  only a text snapshot of the name/mobile and an id that no longer resolves.

#### `customer_advances` — model: `CustomerAdvance.js`
**id** (PK), **customer_id** (→ customers.id), amounts, used/remaining, mode, reference,
status, request_id, received_by, business_date.
- Referenced by: `customer_advance_applications.advance_id`, `quotations.advance_id`.

#### `customer_advance_applications` — model: `CustomerAdvance.js`
**id** (PK), **advance_id** (→ customer_advances.id), **invoice_id** (→ invoices.id),
amounts, request_id. Nothing references it back.

#### `campaigns` — model: `Campaign.js`
**id** (PK), name, type, message_template, segment(_config), status, scheduled_at, sent_at,
totals, created_by.
- Referenced by: `campaign_messages.campaign_id`.

#### `campaign_messages` — model: `CampaignMessage.js`
**id** (PK), **campaign_id** (→ campaigns.id, required), **customer_id** (→ customers.id,
nullable), customer_name/mobile (snapshot), message, whatsapp_url, status. Nothing
references it back.

### Sales / billing

#### `invoices` — model: `Invoice.js`
Columns: **id** (PK), invoice_no (unique), **customer_id** (→ customers.id), customer
name/mobile (snapshot), items (json — embedded line items, authoritative), totals, gold_rate,
**scheme_id** (→ schemes.id), **quotation_id** (→ quotations.id), payments (json),
balance_due, **salesperson_id** (→ employees.id), status, **created_by** (→ users.id),
**counter_id** (→ shop_counters.id), **device_id** (→ devices.id), cancelled_at,
**cancelled_by** (→ users.id), cancel_reason, business_date.
- Referenced by: `invoice_items.invoice_id`, `payments.invoice_id`,
  `credit_notes.invoice_id`, `old_gold_receipts.invoice_id`,
  `customer_advance_applications.invoice_id`, `cashbook_entries.linked_invoice_id`,
  `billing_rate_events.invoice_id`, `quotations.converted_invoice_id`, dead table
  `loyalty_transactions.invoice_id`. **The single most heavily referenced sales table** —
  check every list here before deleting an invoice.

#### `invoice_items` — model: `InvoiceItem.js`
**id** (PK), **invoice_id** (→ invoices.id, required), line_no, **product_id** (→
products.id, nullable), barcode, description, quantity, weights, rate, making, wastage, tax,
amount, hsn_code, snapshot_json. Nothing references it back. (Reporting/normalized copy —
`invoices.items` JSON stays authoritative.)

#### `payments` — model: `Payment.js`
**id** (PK), **invoice_id** (→ invoices.id, nullable), **customer_id** (→ customers.id,
nullable), mode, amounts, reference, **received_by** (→ users.id), request_id, status,
paid_at, business_date. Nothing references it back.

#### `quotations` — model: `Quotation.js`
**id** (PK), quote_no (unique), **customer_id** (→ customers.id), customer snapshot fields,
items (json), gold_rate, totals, valid_until, status, **converted_invoice_id** (→
invoices.id), advance_paid, **advance_id** (→ customer_advances.id), advance_payments (json),
booked_at, business_date, **created_by** (→ users.id), **salesperson_id** (→ employees.id).
Nothing references it back — it's a referencer, not referenced.

#### `draft_sales` — model: `DraftSale.js`  ⚠️ legacy/isolated
**id** (PK, UUID), cashier_id (INTEGER), customer_id (INTEGER), items (text/json), totals,
quoted_gold_rate, notes, status, conflict_reason, promoted_invoice_id (INTEGER),
pricing_mode. The `*_id` columns are `INTEGER` while every real id elsewhere is `STRING` —
they don't resolve to real rows. Safe to treat as isolated.

#### `orders` — model: `Order.js`
**id** (PK), order_no (unique), type (custom|repair), **customer_id** (→ customers.id),
customer snapshot, description, metal_type, purity, estimated_weight, stone_details,
estimated_price, advance_paid/payments, balance_due, karigar_name, **karigar_vendor_id** (→
vendors.id), delivery_date, status, priority, **created_by** (→ users.id).
- Referenced by: `metal_issues.order_id`.

#### `credit_notes` — model: `CreditNote.js`
**id** (PK), credit_note_no, **invoice_id** (→ invoices.id, required), **customer_id** (→
customers.id, nullable), items (json), totals, reason, status, request_id, **created_by** (→
users.id), business_date. Nothing references it back.

#### `old_gold_receipts` — model: `CreditNote.js` (exported `OldGoldReceipt`)
**id** (PK), receipt_no, **customer_id** (→ customers.id, nullable), **invoice_id** (→
invoices.id, nullable), weight_g, purity, rate, values, description, status, trail_notes,
**old_gold_sale_id** (→ old_gold_sales.id, set once disposed), created_by, business_date.
- Referenced by: `old_gold_sales.receipt_ids` (JSON array of receipt ids it disposed of).

#### `old_gold_sales` — model: `OldGoldSale.js`
**id** (PK), sale_no, business_date, buyer_name, **vendor_id** (→ vendors.id, nullable),
**receipt_ids** (JSON array → old_gold_receipts.id), weights, book_value, sale_value,
refining_charges, gain_loss_amount, payment_mode, reference_no, status, cancelled_at/by/
reason, **created_by** (→ users.id), request_id.
- Referenced by: `old_gold_receipts.old_gold_sale_id`.

### Schemes

#### `schemes` — model: `Scheme.js`
**id** (PK), **customer_id** (→ customers.id), customer snapshot, `plan_name` (⚠️ text copy —
**not** an FK, no `scheme_plan_id` column exists), scheme_type, plan_type, monthly_amount,
duration_months, bonus_months, start_date, status, payments (json), redeemed_at,
**salesperson_id** (→ employees.id).
- Referenced by: `invoices.scheme_id`.

#### `scheme_plans` — model: `SchemePlan.js`
**id** (PK), name, plan_type, duration_months, bonus_months, default_monthly_amount,
description, active.
- Referenced by: **nothing formally** — `schemes` only copies `plan_name` as text. Safest
  table in the schema to delete from; just be aware `schemes.plan_name` text could then look
  stale/orphaned in display, not in data integrity.

### Purchases / vendors

#### `vendors` — model: `Vendor.js`
**id** (PK), name, type (gold_supplier|stone_supplier|manufacturer|karigar|other), contact
info, gst/pan, bank_details (json), credit_limit/days, outstanding_balance, total_purchases,
status.
- Referenced by: `products.vendor_id`, `purchases.vendor_id`, `orders.karigar_vendor_id`,
  `metal_issues.karigar_vendor_id`, `old_gold_sales.vendor_id`.

#### `purchases` — model: `Purchase.js`
**id** (PK), po_number (unique), **vendor_id** (→ vendors.id), vendor_name (snapshot),
purchase_date, purchase_type, items (json), totals, payments (json), status, **created_by**
(→ users.id).
- Referenced by: `purchase_items.purchase_id`.

#### `purchase_items` — model: `PurchaseItem.js`
**id** (PK), **purchase_id** (→ purchases.id, required), line_no, **product_id** (→
products.id, nullable), barcode, description, quantity, weight_g, rate, tax, amount,
snapshot_json. Nothing references it back.

### Accounts / cash / GL

#### `chart_of_accounts` — model: `ChartOfAccount.js`
**id** (PK), code, name, type (asset|liability|equity|income|expense), is_system. Unique
(shop_id, code).
- Referenced by: `journal_lines.account_id`.

#### `journal_entries` — model: `ChartOfAccount.js` (exported `JournalEntry`)
**id** (PK), entry_date, memo, `source_type`/`source_id` (polymorphic — invoices, payments,
expenses, etc.), request_id, **created_by** (→ users.id), voucher_type/no, is_opening.
- Referenced by: `journal_lines.journal_entry_id`,
  `bank_reconciliation_items.journal_entry_id`.

#### `journal_lines` — model: `ChartOfAccount.js` (exported `JournalLine`)
**id** (PK), **journal_entry_id** (→ journal_entries.id, required), **account_id** (→
chart_of_accounts.id, required), debit_paise, credit_paise, memo.
- Referenced by: `bank_reconciliation_items.journal_line_id`.

#### `bank_accounts` — model: `BankAccount.js`
**id** (PK), name, bank_name, account_number, ifsc, gl_code, opening_balance, status.
- Referenced by: `bank_reconciliation_items.bank_account_id`.

#### `bank_reconciliation_items` — model: `BankAccount.js` (exported `BankReconciliationItem`)
**id** (PK), **bank_account_id** (→ bank_accounts.id, required), **journal_entry_id** (→
journal_entries.id, nullable), **journal_line_id** (→ journal_lines.id, nullable),
entry_date, description, amount, status, statement_ref/date, reconciled_at/by. Nothing
references it back.

#### `cashbook_entries` — model: `CashbookEntry.js`
**id** (PK), date, entry_type (in|out), mode, amount, contra, reference,
**linked_expense_id** (→ expenses.id, nullable), **linked_invoice_id** (→ invoices.id,
nullable), created_by. Nothing references it back.

#### `expense_categories` — model: `ExpenseCategory.js`
**id** (PK), name, description, icon, color.
- Referenced by: `expenses.category_id`.

#### `expenses` — model: `Expense.js`
**id** (PK), **category_id** (→ expense_categories.id), category_name (snapshot),
description, amount, payment_mode, reference, date, time, **created_by** (→ users.id).
- Referenced by: `cashbook_entries.linked_expense_id`.

#### `incomes` — model: `Income.js`
**id** (PK), description, amount, payment_mode, reference, date, time, created_by. No
relationships either way (no category link, unlike expenses).

#### `daily_closings` — model: `DailyClosing.js`
**id** (PK), date, opening/closing_cash, expected_cash, variance, cash totals, counts,
snapshot_json, checklist_json, status, **closed_by** (→ users.id), closed_at. Unique
(shop_id, date). Nothing references it back.

### Devices / sync / cluster infra (hidden from the app's own DB browser — see below)

#### `devices` — model: `Device.js`
**id** (PK), shop_id (required), device_name, device_identifier, device_number, role,
status, last_seen_at. Unique (shop_id, device_identifier).
- Referenced by (`origin_device_id`/`device_id`, loosely): most tables using the shared
  audit mixins — invoices, shop_counters, sale_authorities, product_status_history,
  barcode_stock_check_sessions/scans, audit_events, replica_acks, operation_ledger,
  event_log, inventory_movements, and any table with `origin_device_id`.

#### `invoice_sequences` — model: `InvoiceSequence.js`
**id** (PK), sequence_date, prefix, next_value. Unique (shop_id, sequence_date, prefix).
Standalone counter.

#### `barcode_sequences` — model: `BarcodeSequence.js`
**shop_id** (PK), next_value. Standalone counter.

#### `schema_meta` — model: `SchemaMeta.js`
**key** (PK), value (json), updated_at. App metadata, no relationships.

#### `shop_counters` — model: `ShopCounter.js`
**id** (PK), name, code, **device_id** (→ devices.id, nullable), is_default, status.
- Referenced by: `products.counter_id`, `categories.counter_id`, `invoices.counter_id`.

#### `sale_authorities` — model: `SaleAuthority.js`
**id** (PK, UUID), **device_id** (→ devices.id), request_id, entity_type, **entity_id**
(polymorphic, e.g. → products.id when `entity_type='product'`), status, expires/committed/
released_at, reject_reason. Nothing references it back.

#### `cluster_state` — model: `ClusterState.js`
**id** (PK), shop_id (unique — one row per shop), node_id, host_id, host_term, role,
event_watermark, fenced, fenced_reason. Nothing references it back.

#### `event_log` — model: `EventLog.js`
**id** (PK), seq, host_term, event_type, `entity_type`/`entity_id` (polymorphic),
operation_id, origin_device_id, user_id, critical, payload (json). Unique (shop_id, seq).
- Referenced by: `replica_acks.event_seq` (paired with shop_id).

#### `operation_ledger` — model: `OperationLedger.js`
**operation_id** (PK), operation_type, `entity_type`/`entity_id` (polymorphic), host_term,
result (json), device_id, user_id. Nothing references it back.

#### `audit_events` — model: `AuditEvent.js`
**id** (PK), seq, event_type, `entity_type`/`entity_id` (polymorphic), user_id, device_id,
host_term, action, old_value/new_value (json), reason, previous_hash, hash. Unique (shop_id,
seq). Append-only hash-chain audit; nothing references it back.

#### `replica_acks` — model: `ReplicaAck.js`
**id** (PK), **event_seq** (→ event_log.seq, paired with shop_id), **device_id** (→
devices.id), acked_at. Nothing references it back.

#### `notifications` — model: `Notification.js`
**id** (PK), type, title, message, data (json), is_read, **user_id** (→ users.id). Nothing
references it back.

#### `barcode_stock_check_sessions` — model: `BarcodeStockCheckSession.js`
**id** (PK), status, **created_by** (→ users.id), **device_id** (→ devices.id),
**category_id** (→ categories.id, nullable), category_name (snapshot), started_at,
completed_at, reset_at, reset_count.
- Referenced by: `barcode_stock_check_scans.session_id`.

#### `barcode_stock_check_scans` — model: `BarcodeStockCheckScan.js`
**id** (PK), **session_id** (→ barcode_stock_check_sessions.id, required), barcode,
**product_id** (→ products.id, nullable), item_name (snapshot), result, **scanned_by** (→
users.id), **device_id** (→ devices.id). Nothing references it back.

### Dead / legacy tables (exist in DB via migrations, no live model — verify before assuming safe)

- **`loyalty_transactions`** — customer_id (→ customers.id), points, balance_after, type,
  invoice_id (→ invoices.id, nullable), reason. No live code path outside the migration that
  created it; loyalty points actually live inline on `customers.loyalty_points`.
- **`sync_outbox`** — event_id (unique), origin_device_id, `entity_type`/`entity_id`
  (polymorphic), operation, payload, status, attempt_count.
- **`sync_processed_events`** — event_id (PK), `entity_type`/`entity_id` (polymorphic),
  processed_at, result.
- **`sync_state`** — device_id (→ devices.id), direction, cursor. Unique (shop_id, device_id,
  direction).

### Table that no longer exists

- **`pure_metal_dailies`** — created then dropped (`20260913100001-drop-pure-metal-daily.js`,
  "Pure Metal Daily feature removed"). Ignore references to it elsewhere.

---

## How the app itself classifies tables

`backend/src/services/dbBrowserService.js` maintains its own whitelist for the in-app
"Database Browser" feature — a good proxy for "business data an owner might touch" vs.
"internal replication/plumbing that should never be hand-edited":

- **Shown to shop owners (ERP_TABLES)**: shops, settings, users, employees, categories,
  attributes, catalog_items, hsn_codes, barcode_templates, products, inventory_movements,
  inventory_adjustments, stock_history, product_status_history, metal_issues, pure_products,
  gold_rate_history, customers, customer_advances, customer_advance_applications, campaigns,
  campaign_messages, invoices, invoice_items, payments, quotations, draft_sales, orders,
  credit_notes, old_gold_receipts, schemes, scheme_plans, vendors, purchases, purchase_items,
  chart_of_accounts, journal_entries, journal_lines, cashbook_entries, bank_accounts,
  bank_reconciliation_items, expenses, expense_categories, daily_closings.
  (Note: `incomes` and `old_gold_sales` have live models but aren't in this whitelist —
  looks like an oversight, not evidence they don't exist.)
- **Deliberately hidden (HIDDEN_TABLES)**: cluster_state, replica_acks, event_log,
  operation_ledger, schema_meta, sale_authorities, shop_counters, invoice_sequences,
  barcode_sequences, billing_rate_events, devices, notifications, audit_events.

Treat the hidden list + the dead tables above as system/replication plumbing — don't
hand-edit them. The ERP_TABLES list (plus `incomes`/`old_gold_sales`/
`barcode_stock_check_*`) are the actual business records you'd reason about for manual
cleanup, but remember: **even these have no DB-enforced FK protection.**

---

## Recommended manual-delete order per entity

Since nothing cascades, delete children before (or right after) the parent to avoid leaving
orphaned rows around. Suggested order for the most common "I want to delete X" cases:

**Delete a customer:**
1. `credit_notes`, `old_gold_receipts`, `customer_advance_applications`,
   `customer_advances`, `payments`, `campaign_messages` (rows with this customer_id)
2. `quotations`, `orders`, `schemes` (rows with this customer_id) — or just clear their
   customer_id if you want to keep the sales record
3. `invoices` — usually you do **not** want to delete invoices for GST/audit reasons; consider
   leaving them with a stale customer_id instead of deleting the customer
4. `customers` row itself

**Delete a product:**
1. `barcode_stock_check_scans`, `product_status_history`, `inventory_movements`,
   `inventory_adjustments`, `stock_history` (rows with this product_id)
2. Check `invoice_items.product_id` / `purchase_items.product_id` — these are historical
   billing/purchase records; usually better to leave them pointing at a dead id than delete
   billing history
3. `products` row itself

**Delete an invoice:** (rarely advisable — GST/legal record)
1. `invoice_items`, `payments`, `credit_notes`, `old_gold_receipts`,
   `customer_advance_applications`, `cashbook_entries` (rows with this invoice_id) —
   or clear their invoice_id
2. Clear `quotations.converted_invoice_id` if it points here
3. `invoices` row itself

**Delete a shop:** do not, unless decommissioning the shop entirely — every table above
cascades in practice. Back up first.

**Safe to delete standalone, low blast-radius:** `scheme_plans`, `hsn_codes`,
`barcode_templates`, `expense_categories` (check `expenses.category_id` first), `pure_products`.
