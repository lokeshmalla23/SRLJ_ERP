// ── Global Design Tokens ──────────────────────────────────────────────────────
// Single source of truth for colors, typography, spacing, and breakpoints.
// Import from here instead of hardcoding values in components.

export const colors = {
  // Brand
  forest:      "#214F3A",
  forestDark:  "#17382A",
  champagne:   "#D9A441",
  gold:        "#D9A441", // Backward-compatible alias; use champagne for new code.
  goldLight:   "#F7E8BC",
  goldBorder:  "#E8D6A6",
  goldMuted:   "#C89434",

  // Neutrals and surfaces
  ink:         "#17201C",
  subtle:      "#4E5A53",
  muted:       "#6F7772",
  faint:       "#89928C",
  border:      "#E2E7E2",
  surface:     "#F7F9F6",
  cream:       "#FAF7EF",
  silver:      "#EEF3F7",
  slate:       "#64748B",
  white:       "#FFFFFF",

  // Semantic
  success:     "#2F6B4F",
  successBg:   "#EAF2ED",
  successLine: "#CBDED2",
  warning:     "#8A651E",
  warningBg:   "#FBF4E3",
  warningLine: "#EAD8B2",
  error:       "#9D4B47",
  errorBg:     "#F9ECEA",
  errorLine:   "#E8C9C5",
  info:        "#52677A",
  infoBg:      "#EEF3F7",
  infoLine:    "#D5E0E8",

  /** Owner hidden-bills unlocked page wash */
  hiddenUnlockBg:   "#F6F4FB",
  hiddenUnlockEdge: "#DDD6FE",
};

export const typography = {
  fontDisplay: "'Cabinet Grotesk', 'Manrope', ui-sans-serif, system-ui, sans-serif",
  fontBody:    "'Manrope', ui-sans-serif, system-ui, -apple-system, sans-serif",
  fontMono:    "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace",

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
  active:    { bg: "bg-[#EAF2ED]", text: "text-[#2F6B4F]" },
  inactive:  { bg: "bg-[#F1F4F0]", text: "text-[#6F7772]" },
  draft:     { bg: "bg-[#F1F4F0]", text: "text-[#52677A]" },
  pending:   { bg: "bg-[#FBF4E3]", text: "text-[#8A651E]" },
  confirmed: { bg: "bg-[#EEF3F7]", text: "text-[#52677A]" },
  completed: { bg: "bg-[#EAF2ED]", text: "text-[#2F6B4F]" },
  cancelled: { bg: "bg-[#F9ECEA]", text: "text-[#9D4B47]" },
  sent:      { bg: "bg-[#EEF3F7]", text: "text-[#52677A]" },
  accepted:  { bg: "bg-[#EAF2ED]", text: "text-[#2F6B4F]" },
  expired:   { bg: "bg-[#F9ECEA]", text: "text-[#9D4B47]" },
  paid:      { bg: "bg-[#EAF2ED]", text: "text-[#2F6B4F]" },
  unpaid:    { bg: "bg-[#F9ECEA]", text: "text-[#9D4B47]" },
  partial:   { bg: "bg-[#FBF4E3]", text: "text-[#8A651E]" },
};

// Helper: get badge classes for a status string
export function getStatusClasses(status) {
  const s = statusColors[status?.toLowerCase()] || statusColors.inactive;
  return `${s.bg} ${s.text}`;
}
