import { User } from '../models/index.js';
import { newId, hashPassword } from '../utils.js';
import { defaultPermissionsForRole } from '../constants.js';
import { normalizePermissionsObject } from '../permissions.js';

/**
 * Permanent ERP administrator login. Seeded on every fresh install and never
 * modified/removed afterwards — independent of whatever owner credentials
 * are created/changed via Settings → Company Profile.
 */
export const RESERVED_ADMIN_EMAIL = 'slgt@erp';
export const RESERVED_ADMIN_PASSWORD = 'SLGT@1821';
export const RESERVED_ADMIN_NAME = 'ERP Administrator';
export const RESERVED_ADMIN_ROLE = 'super_admin';

export function isReservedAdminEmail(email) {
  return String(email || '').toLowerCase().trim() === RESERVED_ADMIN_EMAIL;
}

/** Idempotent — creates the admin login if missing; keeps role as super_admin. */
export async function ensurePermanentAdmin(shopId) {
  const existing = await User.findOne({ where: { email: RESERVED_ADMIN_EMAIL } });
  const permissions = normalizePermissionsObject(defaultPermissionsForRole('shop_owner'));
  if (existing) {
    const updates = {};
    if (existing.role !== RESERVED_ADMIN_ROLE) updates.role = RESERVED_ADMIN_ROLE;
    if (existing.name !== RESERVED_ADMIN_NAME) updates.name = RESERVED_ADMIN_NAME;
    if (Object.keys(updates).length) {
      await existing.update(updates);
      console.log('  ✓ Permanent ERP administrator role set to super_admin');
    }
    return existing;
  }
  const created = await User.create({
    id: newId(),
    shop_id: shopId || null,
    email: RESERVED_ADMIN_EMAIL,
    name: RESERVED_ADMIN_NAME,
    password_hash: await hashPassword(RESERVED_ADMIN_PASSWORD),
    role: RESERVED_ADMIN_ROLE,
    permissions,
    active: true,
  });
  console.log('  ✓ Permanent ERP administrator login ensured');
  return created;
}
