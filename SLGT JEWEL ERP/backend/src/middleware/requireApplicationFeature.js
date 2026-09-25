/**
 * Application Management enforcement — shop-level module licensing, separate
 * from RBAC (`requirePermission`). A disabled feature blocks access
 * regardless of the user's role or permissions, including owners.
 *
 * Missing/unconfigured features default to ENABLED (see
 * `resolveApplicationFeatures` in constants.js) so installs with no
 * `application_features` Setting row keep working exactly as before.
 */
import { Setting } from '../models/index.js';
import { asObject } from '../services/settingsStore.js';
import { resolveApplicationFeatures } from '../constants.js';

export function requireApplicationFeature(featureKey) {
  return async (req, res, next) => {
    try {
      const setting = await Setting.findOne({ where: { key: 'application_features' } });
      const features = resolveApplicationFeatures(asObject(setting?.value));
      if (features[featureKey] === false) {
        return res.status(403).json({
          detail: 'This application module is disabled for this shop.',
          code: 'APPLICATION_FEATURE_DISABLED',
          feature: featureKey,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
