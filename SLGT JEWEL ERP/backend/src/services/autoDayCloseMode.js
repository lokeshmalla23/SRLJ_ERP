import { Setting } from '../models/index.js';
import { asObject } from './settingsStore.js';

export const AUTO_DAY_CLOSE_SETTING_KEY = 'auto_day_close';

/**
 * Auto Day Close — an ERP Administrator toggle (Settings → Application
 * Management → "Close Day"). Stored as { enabled } where enabled=true means
 * Close Day is turned OFF: every transaction uses the real calendar date and
 * each day is closed automatically after midnight (autoDayCloseService).
 * Defaults to OFF (enabled=false) so existing shops keep manual Day Close.
 */
export function resolveAutoDayCloseMode(stored) {
  const v = asObject(stored);
  return { enabled: v.enabled === true };
}

export async function getAutoDayCloseMode(transaction) {
  const setting = await Setting.findOne({ where: { key: AUTO_DAY_CLOSE_SETTING_KEY }, transaction });
  return resolveAutoDayCloseMode(setting?.value);
}
