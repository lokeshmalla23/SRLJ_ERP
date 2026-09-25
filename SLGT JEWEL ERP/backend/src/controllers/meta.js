import { ROLES, MODULES, ACTIONS, POS_MODE_ACTIONS, defaultPermissionsForRole } from '../constants.js';

// GET /api/meta/roles
export const getRoles = async (req, res, next) => {
  try {
    return res.json({
      roles: ROLES,
      modules: MODULES,
      actions: ACTIONS,
      pos_mode_actions: POS_MODE_ACTIONS,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/meta/default-permissions/:role
export const getDefaultPermissions = async (req, res, next) => {
  try {
    const { role } = req.params;
    if (!ROLES.includes(role)) {
      return res.status(400).json({ detail: `Unknown role: ${role}` });
    }
    return res.json(defaultPermissionsForRole(role));
  } catch (err) {
    next(err);
  }
};
