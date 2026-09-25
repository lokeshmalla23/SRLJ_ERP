/**
 * Human-readable role label. Shop owners show company owner_name when set.
 * Reserved ERP admin (slgt@erp) always shows as Super Admin.
 */
export const RESERVED_ADMIN_EMAIL = "slgt@erp";

export function isReservedAdminEmail(email) {
  return String(email || "").toLowerCase().trim() === RESERVED_ADMIN_EMAIL;
}

export function formatRoleLabel(role, ownerName = "", email = "") {
  const r = String(role || "").trim().toLowerCase();
  if (r === "super_admin" || isReservedAdminEmail(email)) return "Super Admin";
  if (r === "shop_owner" || r === "owner") {
    const name = String(ownerName || "").trim();
    return name || "Shop Owner";
  }
  return String(role || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Staff";
}

export function isShopOwnerRole(role) {
  const r = String(role || "").trim().toLowerCase();
  return r === "shop_owner" || r === "owner";
}

export function isSuperAdminRole(role) {
  return String(role || "").trim().toLowerCase() === "super_admin";
}

export function hasFullAccessRole(role) {
  return isShopOwnerRole(role) || isSuperAdminRole(role);
}
