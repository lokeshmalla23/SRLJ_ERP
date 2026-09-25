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

// ── KPI surface tones ─────────────────────────────────────────────────────────
// Four differentiated but restrained soft-gradient treatments so metric rows read
// as one system without every card looking identical. Presentation only.
export const kpiTones = {
  gold: {
    surface: "border-[#EADFC4] bg-[linear-gradient(148deg,#FFFCF4_0%,#FBF4E3_54%,#F5E9D2_100%)]",
    glow:    "bg-[radial-gradient(120%_130%_at_88%_6%,rgba(217,164,65,0.16),transparent_62%)]",
    icon:    "border-[#E6D3A6] bg-[linear-gradient(140deg,#FAF0D6,#EFDDB2)]",
    iconFg:  "text-[#9A6C25]",
    label:   "text-[#9A855A]",
    value:   "text-[#2C2A24]",
    detail:  "text-[#8A8172]",
  },
  green: {
    surface: "border-[#D8E7DA] bg-[linear-gradient(148deg,#F9FCF9_0%,#EFF6EF_54%,#E6F1E9_100%)]",
    glow:    "bg-[radial-gradient(120%_130%_at_88%_6%,rgba(47,107,79,0.14),transparent_62%)]",
    icon:    "border-[#CFE2D5] bg-[linear-gradient(140deg,#E9F3EB,#D6E8DC)]",
    iconFg:  "text-[#2F6B4F]",
    label:   "text-[#5E7A68]",
    value:   "text-[#1E2A23]",
    detail:  "text-[#75857B]",
  },
  blue: {
    surface: "border-[#D6E2EB] bg-[linear-gradient(148deg,#F9FCFD_0%,#EFF5F9_54%,#E7EFF5_100%)]",
    glow:    "bg-[radial-gradient(120%_130%_at_88%_6%,rgba(82,103,122,0.14),transparent_62%)]",
    icon:    "border-[#CFDFEA] bg-[linear-gradient(140deg,#E8F0F7,#D6E4EE)]",
    iconFg:  "text-[#3E6474]",
    label:   "text-[#5D7787]",
    value:   "text-[#1D262C]",
    detail:  "text-[#74838D]",
  },
  lavender: {
    surface: "border-[#DFD8EC] bg-[linear-gradient(148deg,#FBFAFD_0%,#F4F1FA_54%,#EDE8F6_100%)]",
    glow:    "bg-[radial-gradient(120%_130%_at_88%_6%,rgba(107,85,122,0.13),transparent_62%)]",
    icon:    "border-[#DCD2EE] bg-[linear-gradient(140deg,#EFEAF7,#E1D9F0)]",
    iconFg:  "text-[#6B557A]",
    label:   "text-[#7A6A8B]",
    value:   "text-[#241E2B]",
    detail:  "text-[#7E7488]",
  },
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
