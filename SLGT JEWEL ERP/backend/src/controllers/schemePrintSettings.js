/**
 * Settings → Scheme (print field checklists). Uses the existing key/value
 * settings store (settingsStore.upsertSetting) and the existing audit trail.
 */
import sequelize from '../db.js';
import { Setting } from '../models/index.js';
import { upsertSetting } from '../services/settingsStore.js';
import { appendAuditEvent } from '../services/auditTrailService.js';
import { appendEventLog } from '../services/eventLogService.js';
import {
  SCHEME_PRINT_SETTING_KEY,
  resolveSchemePrintSettings,
  sanitizeSchemePrintPatch,
  schemePrintCatalog,
} from '../services/schemePrintSettings.js';

async function saveSetting(req, key, value, t, audit) {
  const shopId = req.user?.shop_id || null;
  const existing = await Setting.findOne({ where: { key }, transaction: t });
  // upsertSetting shallow-merges; pass the full sanitized value.
  const stored = await upsertSetting(key, value, shopId, t);
  const setting = existing || await Setting.findOne({ where: { key }, transaction: t });
  if (audit) {
    await appendAuditEvent({
      eventType: 'settings',
      action: 'updated',
      entityType: key,
      entityId: key,
      userId: req.user?.id || null,
      deviceId: req.deviceId || null,
      oldValue: audit.oldValue,
      newValue: audit.newValue,
      transaction: t,
    });
  }
  await appendEventLog({
    eventType: 'SETTING_UPSERTED',
    entityType: 'setting',
    entityId: setting?.id,
    payload: { setting: { id: setting?.id, key, value: stored, shop_id: shopId } },
    originDeviceId: req.deviceId || null,
    userId: req.user?.id || null,
    transaction: t,
  });
  return stored;
}

// GET /api/settings/scheme-print
export const getSchemePrintSettings = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: SCHEME_PRINT_SETTING_KEY } });
    return res.json({
      settings: resolveSchemePrintSettings(setting?.value),
      catalog: schemePrintCatalog(),
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/scheme-print   body: { creation?: {fields, paper}, statement?: …, closure?: … }
export const updateSchemePrintSettings = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const existing = await Setting.findOne({ where: { key: SCHEME_PRINT_SETTING_KEY }, transaction: t });
    const before = resolveSchemePrintSettings(existing?.value);
    const nextValue = sanitizeSchemePrintPatch(existing?.value, req.body);
    const stored = await saveSetting(req, SCHEME_PRINT_SETTING_KEY, nextValue, t, {
      oldValue: before,
      newValue: nextValue,
    });
    await t.commit();
    return res.json({ settings: resolveSchemePrintSettings(stored), catalog: schemePrintCatalog() });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};
