import { Setting } from '../models/index.js';
import { asObject } from './settingsStore.js';

export const OLD_METAL_MANUAL_SETTING_KEY = 'old_metal_exchange';

/**
 * Old Gold / Old Silver Exchange manual-mode flags — an ERP Administrator
 * toggle (Settings → Application Management). Defaults to OFF for both
 * metals so every existing shop keeps today's automatic weight × rate
 * calculation until an admin explicitly opts in.
 */
export function resolveOldMetalManualMode(stored) {
  const v = asObject(stored);
  return { gold: v.gold === true, silver: v.silver === true };
}

export async function getOldMetalManualMode(transaction) {
  const setting = await Setting.findOne({ where: { key: OLD_METAL_MANUAL_SETTING_KEY }, transaction });
  return resolveOldMetalManualMode(setting?.value);
}
