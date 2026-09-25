import { Setting } from '../models/index.js';
import { asObject } from './settingsStore.js';

export const PROFIT_LOSS_SETTING_KEY = 'profit_loss';

/**
 * Profit & Loss mode — an ERP Administrator toggle (Settings → Application
 * Management). When ON, every new product must carry a purchase price so
 * P&L / COGS valuations are exact. Defaults to OFF so existing shops keep
 * today's product form (no purchase price field) until an admin opts in.
 */
export function resolveProfitLossMode(stored) {
  const v = asObject(stored);
  return { enabled: v.enabled === true };
}

export async function getProfitLossMode(transaction) {
  const setting = await Setting.findOne({ where: { key: PROFIT_LOSS_SETTING_KEY }, transaction });
  return resolveProfitLossMode(setting?.value);
}
