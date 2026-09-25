// ── Global Design Tokens ──────────────────────────────────────────────────────
// Single source of truth for colors, typography, spacing, and breakpoints.
// Import from here instead of hardcoding values in components.

export const colors = {
  // Brand
  gold:       "#B49042",
  goldLight:  "#FDFBF7",
  goldBorder: "#EADFBF",
  goldMuted:  "#F5D87A",

  // Neutrals
  ink:        "#0A0A0A",
  subtle:     "#525252",
  muted:      "#737373",
  faint:      "#a3a3a3",
  border:     "#E5E7EB",
  surface:    "#F9FAFB",
  white:      "#FFFFFF",

  // Semantic
  success:    "#16a34a",
  successBg:  "#f0fdf4",
  warning:    "#d97706",
  warningBg:  "#fffbeb",
  error:      "#dc2626",
  errorBg:    "#fef2f2",
  info:       "#2563eb",
  infoBg:     "#eff6ff",

  /** Owner hidden-bills unlocked page wash */
  hiddenUnlockBg:   "#F6F4FB",
  hiddenUnlockEdge: "#DDD6FE",
};

export const typography = {
  fontDisplay: "'Playfair Display', Georgia, serif",
  fontBody:    "'Inter', system-ui, -apple-system, sans-serif",
  fontMono:    "'JetBrains Mono', 'Fira Code', monospace",

  // Scale (rem)
  xs:   "0.6875rem", // 11px
  sm:   "0.75rem",   // 12px
  base: "0.8125rem", // 13px
  md:   "0.875rem",  // 14px
  lg:   "0.9375rem", // 15px
  xl:   "1rem",      // 16px
  "2xl":"1.125rem",  // 18px
  "3xl":"1.25rem",   // 20px
};

// CSS media query breakpoints (match Tailwind defaults)
export const breakpoints = {
  sm:  "(min-width: 640px)",
  md:  "(min-width: 768px)",
  lg:  "(min-width: 1024px)",
  xl:  "(min-width: 1280px)",
  "2xl": "(min-width: 1536px)",
};

// Responsive grid columns helper
export const responsiveGrid = {
  cards:  "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  cards3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  kpi:    "grid-cols-2 sm:grid-cols-2 lg:grid-cols-4",
  kpi2:   "grid-cols-1 sm:grid-cols-2",
  form:   "grid-cols-1 sm:grid-cols-2",
};

// ── API Config ────────────────────────────────────────────────────────────────
export const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";

export const endpoints = {
  // Auth
  login:         "/api/auth/login",
  logout:        "/api/auth/logout",
  me:            "/api/auth/me",

  // Core
  products:      "/api/products",
  customers:     "/api/customers",
  invoices:      "/api/invoices",
  orders:        "/api/orders",
  purchases:     "/api/purchases",
  quotations:    "/api/quotations",

  // Catalog
  categories:    "/api/categories",
  attributes:    "/api/attributes",
  catalog:       (kind) => `/api/catalog/${kind}`,

  // Business
  schemes:       "/api/schemes",
  promotions:    "/api/promotions",
  vendors:       "/api/vendors",
  employees:     "/api/employees",
  accounts:      "/api/accounts",
  reports:       "/api/reports",
  dashboard:     "/api/dashboard",
  settings:      "/api/settings",
  barcodes:      "/api/barcodes",
  notifications: "/api/notifications",
  search:        "/api/search",
  demo:          "/api/demo",
};

// ── Status badge presets ──────────────────────────────────────────────────────
export const statusColors = {
  // Generic
  active:    { bg: "bg-green-100",   text: "text-green-700" },
  inactive:  { bg: "bg-gray-100",    text: "text-gray-500"  },
  draft:     { bg: "bg-gray-100",    text: "text-gray-600"  },
  pending:   { bg: "bg-amber-100",   text: "text-amber-700" },
  confirmed: { bg: "bg-blue-100",    text: "text-blue-700"  },
  completed: { bg: "bg-green-100",   text: "text-green-700" },
  cancelled: { bg: "bg-red-100",     text: "text-red-600"   },
  sent:      { bg: "bg-blue-100",    text: "text-blue-700"  },
  accepted:  { bg: "bg-green-100",   text: "text-green-700" },
  expired:   { bg: "bg-red-100",     text: "text-red-600"   },
  paid:      { bg: "bg-emerald-100", text: "text-emerald-700" },
  unpaid:    { bg: "bg-red-100",     text: "text-red-600"   },
  partial:   { bg: "bg-amber-100",   text: "text-amber-700" },
};

// Helper: get badge classes for a status string
export function getStatusClasses(status) {
  const s = statusColors[status?.toLowerCase()] || statusColors.inactive;
  return `${s.bg} ${s.text}`;
}
