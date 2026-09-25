import { User, Device } from '../models/index.js';
import { verifyPassword, createToken } from '../utils.js';
import { normalizePermissionsObject } from '../permissions.js';
import { isDeviceApprovedStatus } from './deviceAuthorization.js';

export const verifyPasswordHandler = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ detail: 'User not found' });
    if (!user.password_hash) {
      return res.status(401).json({ detail: 'Password not set for this account' });
    }
    const ok = await verifyPassword(req.body.password, user.password_hash);
    if (!ok) return res.status(401).json({ detail: 'Incorrect password' });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ detail: 'Email and password are required' });
    }

    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!user) {
      return res.status(401).json({ detail: 'Invalid email or password' });
    }
    if (!user.active) {
      return res.status(401).json({ detail: 'Account is inactive' });
    }
    // Synced/imported users can exist without a local hash — bcrypt throws if hash is null
    if (!user.password_hash) {
      return res.status(401).json({
        detail: 'Password not set for this account. Ask an admin to set a password in Users, or use Demo Credentials for the owner account.',
      });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ detail: 'Invalid email or password' });
    }

    // Client PCs must be Host-approved before employee login succeeds.
    // The Main PC (active_host) never needs to approve itself.
    let branchConfig = null;
    try {
      branchConfig = (await import('../config/branchConfig.js')).default;
    } catch { /* */ }
    const isActiveHostNode = branchConfig?.role === 'active_host';
    const hostDeviceId = branchConfig?.device_id ? String(branchConfig.device_id).trim() : '';

    const deviceHeader = String(req.headers['x-device-id'] || req.body?.device_identifier || '').trim();
    if (deviceHeader && !isActiveHostNode) {
      const { Op } = await import('sequelize');
      const device = await Device.findOne({
        where: {
          [Op.or]: [{ id: deviceHeader }, { device_identifier: deviceHeader }],
        },
      });
      if (device) {
        if (device.status === 'revoked') {
          return res.status(403).json({
            detail: 'This device is no longer authorized. Ask the owner or administrator to approve this computer.',
            code: 'DEVICE_REVOKED',
          });
        }
        if (!isDeviceApprovedStatus(device.status) && device.role !== 'active_host') {
          return res.status(403).json({
            detail: 'This computer needs approval from the Main PC before anyone can sign in.',
            code: device.status === 'declined' ? 'DEVICE_DECLINED' : 'DEVICE_PENDING',
          });
        }
        await device.update({ last_seen_at: new Date() });
      } else {
        return res.status(403).json({
          detail: 'This computer needs approval from the Main PC before anyone can sign in.',
          code: 'DEVICE_PENDING',
        });
      }
    } else if (deviceHeader && isActiveHostNode) {
      // Heal host device row / ignore stale pending client ids on the Main PC console
      try {
        const { Op } = await import('sequelize');
        const device = await Device.findOne({
          where: {
            [Op.or]: [
              { id: deviceHeader },
              { device_identifier: deviceHeader },
              ...(hostDeviceId ? [{ id: hostDeviceId }, { device_identifier: hostDeviceId }] : []),
            ],
          },
        });
        if (device && (device.role === 'active_host' || device.device_identifier === hostDeviceId || device.id === hostDeviceId)) {
          if (!isDeviceApprovedStatus(device.status) || device.role !== 'active_host') {
            await device.update({ role: 'active_host', status: 'active', last_seen_at: new Date() });
          } else {
            await device.update({ last_seen_at: new Date() });
          }
        }
      } catch { /* non-fatal */ }
    }

    const deviceId =
      String(req.headers['x-device-id'] || req.body?.device_identifier || '').trim() || null;
    const token = createToken(user.id, user.email, { deviceId });
    const { password_hash, ...userObj } = user.toJSON();
    userObj.permissions = normalizePermissionsObject(userObj.permissions);

    return res.json({
      access_token: token,
      token_type: 'bearer',
      user: userObj,
    });
  } catch (err) {
    next(err);
  }
};

export const getMe = async (req, res, next) => {
  try {
    return res.json(req.user);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/credential
 * Returns the bcrypt hash for the authenticated user so the desktop app can
 * cache it for offline login. This endpoint is authenticated and only returns
 * the hash for the currently-authenticated user — never for other users.
 *
 * The hash is useless without the plaintext password (bcrypt is one-way),
 * so returning it to the authenticated user is safe.
 */
export const getCredential = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, { attributes: ['id', 'password_hash', 'active'] });
    if (!user) return res.status(404).json({ detail: 'User not found' });
    if (!user.active) return res.status(403).json({ detail: 'Account inactive' });
    return res.json({ user_id: user.id, password_hash: user.password_hash });
  } catch (err) {
    next(err);
  }
};
