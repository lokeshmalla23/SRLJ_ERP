import { tableExists, columnExists } from './_helpers.js';

/**
 * One-time correction: tray products whose net_weight/gross_weight are still
 * frozen at their original creation value (billing/inventory decrement code
 * only started keeping them in sync with tray_total_weight going forward —
 * see billingService.js and inventoryService.js tray weight updates). Every
 * tray already sold from before that fix needs its stored weight snapped to
 * the live tray_total_weight once, here.
 */
export async function up({ context: qi }) {
  if (!(await tableExists(qi, 'products'))) return;
  if (!(await columnExists(qi, 'products', 'tray_total_weight'))) return;

  await qi.sequelize.query(`
    UPDATE products
    SET gross_weight = tray_total_weight,
        net_weight = tray_total_weight,
        updated_at = CURRENT_TIMESTAMP
    WHERE tray_total_weight IS NOT NULL
      AND (gross_weight IS DISTINCT FROM tray_total_weight OR net_weight IS DISTINCT FROM tray_total_weight)
  `);
}

// Irreversible: the pre-backfill gross/net weight values weren't the live
// figure anyway (that's the bug being fixed), so there's nothing meaningful
// to restore them to.
export async function down() {}
