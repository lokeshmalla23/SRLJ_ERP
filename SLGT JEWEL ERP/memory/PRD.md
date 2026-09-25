# Aurum — Premium Jewellery ERP SaaS

## Original problem statement
Design and architect a premium enterprise-grade Jewellery ERP SaaS for modern jewellery businesses in India. UI should feel like Stripe, Shopify, Notion, Linear — premium, minimal, modern, desktop-first. White background, luxury jewellery theme. Support 8 roles with configurable RBAC. 13 modules originally requested.

## User choices
- Tech stack: web SaaS (React + FastAPI + MongoDB)
- Phase 1 scope: Dashboard, Inventory, POS, Customers, Gold Schemes, Reports, Settings + RBAC
- **Phase 2a scope**: Dynamic inventory (Categories, Sub-categories, Attributes with 10 field types, Collections, Tags, Metal/Stone Types, Purities, Units), refactor Product form, GST PDF invoice with HSN codes
- Auth: JWT-based custom auth with 8 configurable roles
- WhatsApp/SMS: mocked for now
- Offline mode: deferred

## Architecture
- Backend: FastAPI + Motor (MongoDB async). JWT (HS256), bcrypt. RBAC via `require_permission(module, action)`. PDF via reportlab + bundled DejaVu Sans (/app/backend/fonts/) for ₹ glyph.
- Frontend: React 19 + CRACO + Tailwind + Shadcn, Recharts, Sonner, React Router. Bearer token stored in localStorage.
- Fonts: Cabinet Grotesk (display), Manrope (body), JetBrains Mono (numbers). White bg, gold `#B49042`.

## Modules & RBAC
9 modules × 7 actions matrix (view/create/edit/delete/export/import/manage). 8 roles: shop_owner, manager, accountant, cashier, inventory_manager, sales_executive, gold_scheme_manager, repair_manager. All configurable in Settings → Permissions.

## What's implemented

### Phase 1 (2026-02)
- Login + JWT + RBAC
- Dashboard with KPIs, live gold rate, sales trend, recent invoices, low-stock alerts, metal-wise revenue chart (gold gradient)
- Inventory: list/search/filter, create/edit/delete
- POS: barcode scan, product grid, cart, split payments, GST 3%, invoice creation
- Customers: list/search, add, detail with history
- Gold Schemes: enrol, monthly payments, progress
- Reports: date-range, KPI totals, CSV export
- Settings: Company, Live gold rates, Users, Permissions matrix

### Phase 2a (2026-02)
- **Dynamic Catalog module** at `/catalog` with 8 sub-tabs (Categories & Sub-categories, Attributes, Collections, Tags, Metal Types, Stone Types, Purities, Units) — all shop-owner configurable
- **Categories** with `parent_id` for two-level hierarchy; delete guard against child + product references
- **Attributes** with 10 field types (text, number, dropdown, multiselect, date, boolean, image, color, price, weight); attach to specific categories or make global
- **Product form** now dynamic: chooses category → sub-category → auto-loads relevant attributes with proper inputs; supports multi-select collections/tags/stones, metal type & purity from catalog, HSN code, GST slab, making charge type
- **GST Invoice PDF** at `GET /api/invoices/{id}/pdf` — A4, DejaVu Sans, gold TAX INVOICE badge, company header + GSTIN, HSN column, CGST+SGST split, amount in words (num2words INR), payments listing, footer band. Download from POS after checkout + per-row in Reports.
- **Backend seed** wipes old-schema products and reseeds 8 new-schema products, 4 metals, 6 purities, 8 stones, 4 units, 8 collections, 5 tags, 10 attributes

## Deferred (P1/P2 backlog)
- P1: Manufacturing Management (raw materials → jobs → QC → finished)
- P1: Repairs Management (received → in-progress → completed → delivered)
- P1: Purchase Management (suppliers, POs, purchase bills)
- P1: Accounts & Daily Closing (cash/UPI/card reconciliation, expense tracking, shift reports)
- P1: Notifications module (in-app + email)
- P1: Promotions & Marketing (campaigns, templates, customer segmentation) + real WhatsApp/Twilio integration
- P2: Offline-first (IndexedDB caching + background sync) or Electron desktop wrapper
- P2: Thermal printer support, invoice email
- P2: Bulk import/export XLSX, barcode print sheets
- P2: Advanced analytics (customer segmentation, cohorts, LTV)

## Files
- Backend: `/app/backend/server.py`, `/app/backend/fonts/`, `/app/backend/tests/{backend_test.py, test_phase2a.py}` (33/33 tests green)
- Frontend routes: `/app/frontend/src/App.js`
- Pages: `/app/frontend/src/pages/{Login,Dashboard,Inventory,ProductForm,POS,Customers,CustomerDetail,GoldSchemes,Reports,Settings,Catalog}.jsx`
- Auth context: `/app/frontend/src/context/AuthContext.jsx`
- Design blueprint: `/app/design_guidelines.json`

## Credentials
See `/app/memory/test_credentials.md`.
