import { Setting } from '../models/index.js';
import { newId } from '../utils.js';

/** SQLite stores JSONB as TEXT — parse string values so callers always get objects. */
export function asObject(value) {
  if (value == null) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function upsertSetting(key, body, shopId, t) {
  let setting = await Setting.findOne({ where: { key }, transaction: t });
  const value = { ...asObject(setting?.value), ...body };
  if (setting) {
    await setting.update({ value }, { transaction: t });
  } else {
    setting = await Setting.create({ id: newId(), key, shop_id: shopId, value }, { transaction: t });
  }
  return asObject(setting.value);
}
