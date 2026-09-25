// ─── Constants ───────────────────────────────────────────────────────────────
export const ROLES = [
  'shop_owner',
  'manager',
  'accountant',
  'cashier',
  'inventory_manager',
  'sales_executive',
  'gold_scheme_manager',
  'repair_manager',
];

export const MODULES = [
  'dashboard',
  'inventory',
  'catalog',
  'pos',
  'customers',
  'gold_schemes',
  'reports',
  'settings',
  'users',
  'vendors',
  'purchases',
  'orders',
  'quotations',
  'barcodes',
  'employees',
  'accounts',
  'promotions',
  'stock',
  'backup',
  'barcode_stock_check',
];

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'import', 'manage'];

/** POS-only mode gates (Settings → Permissions). Not shown as columns on other modules. */
export const POS_MODE_ACTIONS = ['jewellery', 'pure_metal'];

/** All actions that may appear in a permissions object (standard + POS modes). */
export const ALL_KNOWN_ACTIONS = [...ACTIONS, ...POS_MODE_ACTIONS];

// ─── Default permissions per role ────────────────────────────────────────────
const ALL_ACTIONS = [...ACTIONS];

const perm = (modules) => {
  // modules: { moduleName: actionsArray | 'all' }
  const result = {};
  for (const mod of MODULES) {
    result[mod] = {};
    for (const action of ACTIONS) {
      result[mod][action] = false;
    }
    if (mod === 'pos') {
      for (const action of POS_MODE_ACTIONS) {
        result[mod][action] = false;
      }
    }
  }
  for (const [mod, actions] of Object.entries(modules)) {
    const actList = actions === 'all'
      ? (mod === 'pos' ? [...ALL_ACTIONS, ...POS_MODE_ACTIONS] : ALL_ACTIONS)
      : actions;
    for (const action of actList) {
      if (result[mod] !== undefined && (ACTIONS.includes(action) || (mod === 'pos' && POS_MODE_ACTIONS.includes(action)))) {
        result[mod][action] = true;
      }
    }
  }
  return result;
};

export const defaultPermissionsForRole = (role) => {
  switch (role) {
    case 'super_admin':
    case 'shop_owner':
      return perm(Object.fromEntries(MODULES.map((m) => [m, 'all'])));

    case 'manager':
      return perm({
        dashboard: ['view'],
        inventory: ['view', 'create', 'edit', 'export', 'import'],
        catalog: ['view', 'create', 'edit'],
        pos: ['view', 'create', 'edit', ...POS_MODE_ACTIONS],
        customers: ['view', 'create', 'edit', 'export'],
        gold_schemes: ['view', 'create', 'edit'],
        reports: ['view', 'export'],
        settings: ['view', 'edit'],
        users: ['view'],
        vendors: ['view', 'create', 'edit', 'export'],
        purchases: ['view', 'create', 'edit', 'export'],
        orders: ['view', 'create', 'edit'],
        quotations: ['view', 'create', 'edit'],
        barcodes: ['view'],
        employees: ['view'],
        accounts: ['view', 'export'],
        promotions: ['view', 'create'],
        stock: ['view'],
        backup: ['view', 'export'],
        barcode_stock_check: ['view', 'manage'],
      });

    case 'accountant':
      return perm({
        dashboard: ['view'],
        reports: ['view', 'export'],
        customers: ['view'],
        pos: ['view', ...POS_MODE_ACTIONS],
        gold_schemes: ['view'],
        vendors: ['view'],
        purchases: ['view', 'export'],
        employees: ['view'],
        accounts: 'all',
        stock: ['view'],
      });

    case 'cashier':
      return perm({
        dashboard: ['view'],
        pos: ['view', 'create', ...POS_MODE_ACTIONS],
        customers: ['view', 'create'],
        inventory: ['view'],
        orders: ['view', 'create'],
        quotations: ['view', 'create'],
        barcode_stock_check: ['view', 'manage'],
      });

    case 'inventory_manager':
      return perm({
        dashboard: ['view'],
        inventory: 'all',
        catalog: 'all',
        reports: ['view'],
        vendors: ['view', 'create', 'edit'],
        purchases: ['view', 'create', 'edit'],
        orders: ['view'],
        stock: 'all',
        barcodes: 'all',
        barcode_stock_check: ['view', 'manage'],
      });

    case 'sales_executive':
      return perm({
        dashboard: ['view'],
        pos: ['view', 'create', ...POS_MODE_ACTIONS],
        customers: ['view', 'create', 'edit'],
        inventory: ['view'],
        quotations: ['view', 'create', 'edit'],
        orders: ['view', 'create'],
        promotions: ['view'],
      });

    case 'gold_scheme_manager':
      return perm({
        dashboard: ['view'],
        gold_schemes: 'all',
        customers: ['view', 'create', 'edit'],
        promotions: ['view'],
      });

    case 'repair_manager':
      return perm({
        dashboard: ['view'],
        customers: ['view'],
        orders: 'all',
        quotations: ['view'],
      });

    default:
      return perm({});
  }
};

// ─── Application Management (shop-level module licensing) ───────────────────
// Separate from RBAC above: RBAC answers "what can this employee do", this
// answers "what did this shop license". A feature key here may reuse an RBAC
// module name (e.g. `reports`) or diverge from it on purpose — e.g.
// `barcode_management` deliberately does NOT reuse the `inventory` RBAC
// module, because Barcode Manager and Inventory must be independently
// licensable even though they currently share one RBAC module; `gold_schemes`
// intentionally covers BOTH the Gold Schemes and Scheme Management screens,
// since those two already share one RBAC module and are sold as one feature.
export const APPLICATION_FEATURES = [
  { key: 'dashboard', label: 'Dashboard', section: 'Overview' },
  { key: 'pos', label: 'POS Billing', section: 'Commerce' },
  { key: 'inventory', label: 'Inventory', section: 'Commerce' },
  { key: 'barcode_management', label: 'Barcode Management', section: 'Commerce' },
  { key: 'catalog', label: 'Catalog', section: 'Commerce' },
  { key: 'customers', label: 'Customers', section: 'Commerce' },
  { key: 'promotions', label: 'Promotions', section: 'Commerce' },
  { key: 'quotations', label: 'Estimations', section: 'Commerce' },
  { key: 'orders', label: 'Orders', section: 'Commerce' },
  { key: 'barcode_stock_check', label: 'Barcode Stock Check', section: 'Commerce' },
  { key: 'gold_schemes', label: 'Gold Schemes', section: 'Programs' },
  { key: 'vendors', label: 'Vendors', section: 'Purchase' },
  { key: 'purchases', label: 'Purchases', section: 'Purchase' },
  { key: 'accounts', label: 'Accounts', section: 'Finance' },
  { key: 'employees', label: 'Employees', section: 'Finance' },
  { key: 'reports', label: 'Reports', section: 'Insights' },
];

export const APPLICATION_FEATURE_KEYS = APPLICATION_FEATURES.map((f) => f.key);

/**
 * Resolve the effective enabled/disabled state for every known application
 * feature from whatever's actually been stored. Any key never explicitly
 * toggled — including every key on a fresh/legacy install with no
 * `application_features` Setting row at all — defaults to ENABLED, so
 * installing this feature never silently hides existing functionality.
 */
export function resolveApplicationFeatures(stored) {
  const result = {};
  for (const { key } of APPLICATION_FEATURES) {
    const v = stored ? stored[key] : undefined;
    result[key] = v === false ? false : true;
  }
  return result;
}
