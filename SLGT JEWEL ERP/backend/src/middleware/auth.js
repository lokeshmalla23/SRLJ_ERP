import { verifyToken } from '../utils.js';
import { User, Device } from '../models/index.js';
import { hasPermission, normalizePermissionsObject } from '../permissions.js';
import { Op } from 'sequelize';

async function findRevokedDevice(deviceKey) {
  if (!deviceKey) return null;
  return Device.findOne({
    where: {
      status: 'revoked',
      [Op.or]: [{ id: deviceKey }, { device_identifier: deviceKey }],
    },
  });
}

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ detail: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ detail: 'Invalid or expired token' });
    }

    const user = await User.findByPk(payload.sub);
    if (!user || !user.active) {
      return res.status(401).json({ detail: 'User not found or inactive' });
    }

    // Device identity: prefer JWT-bound device_id (cannot omit to bypass revoke),
    // fall back to X-Device-Id header for host/local sessions.
    const headerDevice = String(req.headers['x-device-id'] || '').trim();
    const jwtDevice = payload.device_id ? String(payload.device_id).trim() : '';
    const deviceKey = jwtDevice || headerDevice;

    // Mutating requests: JWT-bound device must agree with header when both present
    const method = String(req.method || 'GET').toUpperCase();
    const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (isMutating && jwtDevice && headerDevice && jwtDevice !== headerDevice) {
      const bound = await Device.findOne({
        where: {
          [Op.or]: [{ id: jwtDevice }, { device_identifier: jwtDevice }],
        },
      });
      const headerMatchesBound =
        bound
        && (bound.id === headerDevice || bound.device_identifier === headerDevice);
      if (!headerMatchesBound) {
        return res.status(403).json({
          detail: 'Device identity mismatch',
          code: 'DEVICE_MISMATCH',
        });
      }
    }

    if (deviceKey) {
      const revoked = await findRevokedDevice(deviceKey);
      if (revoked) {
        return res.status(403).json({
          detail: 'This device has been removed from the shop. Pair again to continue.',
          code: 'DEVICE_REVOKED',
        });
      }
    }

    // Client sessions issued with device_id cannot drop the header to skip revoke —
    // JWT claim alone is enough to enforce DEVICE_REVOKED above.
    // For sessions without JWT device binding, require header on mutating API calls
    // when any paired devices exist for this shop (host login without device is allowed).
    if (isMutating && !deviceKey && process.env.REQUIRE_DEVICE_HEADER === '1') {
      return res.status(403).json({
        detail: 'X-Device-Id required',
        code: 'DEVICE_REQUIRED',
      });
    }

    const { password_hash, ...userObj } = user.toJSON();
    userObj.permissions = normalizePermissionsObject(userObj.permissions);
    userObj.device_id = deviceKey || null;
    req.user = userObj;
    req.deviceId = deviceKey || null;
    next();
  } catch (err) {
    next(err);
  }
};

export const requirePermission = (module, action) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }
  // Shop owner always has full access (matches frontend AuthContext.can).
  const role = String(req.user.role || '').toLowerCase();
  if (role === 'shop_owner' || role === 'owner' || role === 'super_admin') {
    return next();
  }
  // hasPermission expects the permissions map, not the whole user row.
  if (!hasPermission(req.user.permissions, module, action)) {
    return res.status(403).json({ detail: `Missing permission: ${module}.${action}` });
  }
  next();
};

// Allow if user has ANY of the listed [module, action] pairs.
// Used for shared lookup endpoints that multiple modules need (e.g. POS needs /employees and /products).
export const requireAnyPermission = (...checks) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }
  const role = String(req.user.role || '').toLowerCase();
  if (role === 'shop_owner' || role === 'owner' || role === 'super_admin') {
    return next();
  }
  const allowed = checks.some(([mod, act]) => hasPermission(req.user.permissions, mod, act));
  if (!allowed) {
    const label = checks.map(([m, a]) => `${m}.${a}`).join(' or ');
    return res.status(403).json({ detail: `Missing permission: ${label}` });
  }
  next();
};
