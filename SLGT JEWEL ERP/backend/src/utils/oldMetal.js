import { Op } from 'sequelize';

export const METAL_GOLD = 'gold';
export const METAL_SILVER = 'silver';

export function normalizeReceiptMetal(value) {
  return String(value || '').trim().toLowerCase() === METAL_SILVER ? METAL_SILVER : METAL_GOLD;
}

/** Sequelize where fragment so pre-migration NULL rows count as gold. */
export function receiptMetalWhere(metal) {
  const kind = normalizeReceiptMetal(metal);
  if (kind === METAL_SILVER) return { metal: METAL_SILVER };
  return { [Op.or]: [{ metal: METAL_GOLD }, { metal: null }, { metal: '' }] };
}

export function isOgExchangeMode(mode) {
  const m = String(mode || '').toLowerCase().replace(/\s+/g, '_');
  return m === 'old_gold_exchange' || m === 'old_gold' || m === 'exchange';
}

export function isOsExchangeMode(mode) {
  const m = String(mode || '').toLowerCase().replace(/\s+/g, '_');
  return m === 'old_silver_exchange' || m === 'old_silver';
}
