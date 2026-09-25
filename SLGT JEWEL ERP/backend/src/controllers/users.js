import { Op } from 'sequelize';
import { User } from '../models/index.js';
import { newId, hashPassword } from '../utils.js';
import { defaultPermissionsForRole } from '../constants.js';
import { normalizePermissionsObject } from '../permissions.js';
import sequelize from '../db.js';
import { withBusyRetry } from '../utils/sqliteBusy.js';
import { isReservedAdminEmail } from '../services/permanentAdmin.js';

const safeUser = (u) => {
  const obj = u.toJSON ? u.toJSON() : u;
  const { password_hash, ...rest } = obj;
  rest.permissions = normalizePermissionsObject(rest.permissions);
  return rest;
};

export const listUsers = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.email) {
      where.email = req.query.email.toLowerCase().trim();
    }
    const users = await User.findAll({ where, order: [['created_at', 'DESC']] });
    return res.json(users.filter((u) => !isReservedAdminEmail(u.email)).map(safeUser));
  } catch (err) {
    next(err);
  }
};

export const createUser = async (req, res, next) => {
  return withBusyRetry(() => _createUserOnce(req, res, next)).catch(next);
};

async function _createUserOnce(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const { email, name, password, role, permissions, active } = req.body;
    if (!email || !name || !password || !role) {
      await t.rollback();
      return res.status(400).json({ detail: 'email, name, password, role are required' });
    }

    const emailNorm = email.toLowerCase().trim();
    if (isReservedAdminEmail(emailNorm)) {
      await t.rollback();
      return res.status(403).json({ detail: 'This username is reserved' });
    }
    const existing = await User.findOne({
      where: { email: emailNorm },
      transaction: t,
    });

    // Synced users often arrive without password_hash — set password instead of 409
    if (existing) {
      const hasHash = Boolean(existing.password_hash && String(existing.password_hash).length > 10);
      if (hasHash) {
        await t.rollback();
        return res.status(409).json({ detail: 'Email already in use', existing_id: existing.id });
      }
      await existing.update({
        name: name || existing.name,
        role: role || existing.role,
        password_hash: await hashPassword(password),
        permissions: permissions !== undefined
          ? normalizePermissionsObject(permissions)
          : (existing.permissions || defaultPermissionsForRole(role || existing.role)),
        active: active !== undefined ? active : true,
        shop_id: existing.shop_id || req.user?.shop_id || null,
      }, { transaction: t });
      await existing.reload({ transaction: t });

      await t.commit();
      return res.status(200).json(safeUser(existing));
    }

    const user = await User.create({
      id: newId(),
      shop_id: req.user?.shop_id || null,
      email: emailNorm,
      name,
      password_hash: await hashPassword(password),
      role,
      permissions: normalizePermissionsObject(permissions || defaultPermissionsForRole(role)),
      active: active !== undefined ? active : true,
    }, { transaction: t });

    await t.commit();
    return res.status(201).json(safeUser(user));
  } catch (err) {
    await t.rollback().catch(() => {});
    throw err;
  }
}

export const updateUser = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const user = await User.findByPk(req.params.id, { transaction: t });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ detail: 'User not found' });
    }
    if (isReservedAdminEmail(user.email)) {
      await t.rollback();
      return res.status(403).json({ detail: 'This account is protected and cannot be modified' });
    }

    const { password, email, permissions, ...rest } = req.body;
    const updates = { ...rest };

    // Password reset is deliberately narrower than users.edit — this bypasses
    // the old password entirely, so only the reserved ERP Administrator login
    // may use it (not even the shop owner). Permissions/other fields below are
    // still governed by the normal users.edit permission the route requires.
    if (password) {
      if (String(req.user?.role || '') !== 'super_admin') {
        await t.rollback();
        return res.status(403).json({ detail: 'Only the ERP Administrator can reset a login\'s password' });
      }
      updates.password_hash = await hashPassword(password);
    }
    if (email) updates.email = email.toLowerCase().trim();
    if (permissions !== undefined) {
      updates.permissions = normalizePermissionsObject(permissions);
    }

    await user.update(updates, { transaction: t });
    await user.reload({ transaction: t });

    await t.commit();
    return res.json(safeUser(user));
  } catch (err) {
    await t.rollback().catch(() => {});
    next(err);
  }
};

export const deleteUser = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const user = await User.findByPk(req.params.id, { transaction: t });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ detail: 'User not found' });
    }

    if (user.id === req.user.id) {
      await t.rollback();
      return res.status(400).json({ detail: 'Cannot delete your own account' });
    }
    if (isReservedAdminEmail(user.email)) {
      await t.rollback();
      return res.status(403).json({ detail: 'This account is protected and cannot be deleted' });
    }

    await user.destroy({ transaction: t });
    await t.commit();
    return res.json({ message: 'User deleted' });
  } catch (err) {
    await t.rollback().catch(() => {});
    next(err);
  }
};

/**
 * DELETE /api/users/orphans
 * Removes user accounts that have no linked employee record.
 * Keeps the Shop Owner (role=owner) and the currently logged-in user safe.
 */
export const deleteOrphanUsers = async (req, res, next) => {
  try {
    const { Employee } = await import('../models/index.js');
    const allUsers = await User.findAll({
      where: { role: { [Op.notIn]: ['owner'] } },
    });
    const linkedUserIds = new Set(
      (await Employee.findAll({ attributes: ['user_id'], where: { user_id: { [Op.not]: null } } }))
        .map((e) => e.user_id)
    );

    let removed = 0;
    for (const u of allUsers) {
      if (u.id === req.user?.id) continue; // never delete self
      if (u.role === 'owner') continue;
      if (isReservedAdminEmail(u.email)) continue; // never delete the permanent admin login
      if (!linkedUserIds.has(u.id)) {
        await u.destroy();
        removed++;
      }
    }
    return res.json({ removed, message: `Removed ${removed} orphaned user account(s)` });
  } catch (err) {
    next(err);
  }
};
