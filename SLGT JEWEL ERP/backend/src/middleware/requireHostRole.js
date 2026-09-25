import { branchConfig } from '../config/branchConfig.js';

export function requireHostRole(req, res, next) {
  if (branchConfig.role !== 'active_host') {
    return res.status(403).json({
      error: 'HOST_ONLY',
      message: 'This operation is only available on the main PC.',
    });
  }
  next();
}
