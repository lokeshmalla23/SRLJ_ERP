import { Shop } from '../models/Shop.js';
import branchConfig from '../config/branchConfig.js';

let cachedShopId = null;

/** V1: single active shop. Prefers the shop_id from branchConfig if set. */
export async function getDefaultShopId({ transaction, forceRefresh = false } = {}) {
  if (cachedShopId && !forceRefresh) return cachedShopId;

  // If a specific shop_id is configured, use it directly (avoids picking stale seed shops).
  const configuredId = branchConfig.shop_id;
  if (configuredId) {
    const shop = await Shop.findByPk(configuredId, { transaction });
    if (shop) {
      cachedShopId = shop.id;
      return cachedShopId;
    }
  }

  const shop = await Shop.findOne({
    where: { status: 'active' },
    order: [['created_at', 'ASC']],
    transaction,
  });

  if (!shop) {
    throw new Error('No active shop found. Run migrations to create the default shop.');
  }

  cachedShopId = shop.id;
  return cachedShopId;
}

export function clearDefaultShopCache() {
  cachedShopId = null;
}

/**
 * Attach beforeCreate / beforeBulkCreate hooks so shop_id is filled when missing.
 */
export function attachDefaultShopHooks(models) {
  for (const Model of models) {
    if (!Model?.rawAttributes?.shop_id) continue;

    Model.addHook('beforeCreate', async (instance, options) => {
      if (!instance.shop_id) {
        instance.shop_id = await getDefaultShopId({ transaction: options.transaction });
      }
    });

    Model.addHook('beforeBulkCreate', async (instances, options) => {
      const need = instances.some((i) => !i.shop_id);
      if (!need) return;
      const shopId = await getDefaultShopId({ transaction: options.transaction });
      for (const instance of instances) {
        if (!instance.shop_id) instance.shop_id = shopId;
      }
    });
  }
}
