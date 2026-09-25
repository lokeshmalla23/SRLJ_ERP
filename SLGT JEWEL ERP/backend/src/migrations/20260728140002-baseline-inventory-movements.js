import { randomUUID } from 'crypto';
import { tableExists } from './_helpers.js';

/**
 * Baseline OPENING movements from current product stock (no invented sales/purchases).
 * Also backfill prior inventory_adjustments / stock_history where present.
 */
export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  if (!(await tableExists(qi, 'inventory_movements'))) return;
  if (!(await tableExists(qi, 'products'))) return;

  // Skip if already baselined
  const [existingOpening] = await sequelize.query(
    `SELECT COUNT(*)::int AS c FROM inventory_movements WHERE movement_type = 'OPENING'`
  );
  if (existingOpening[0].c > 0) {
    console.log('  = OPENING movements already present — skip baseline');
  } else {
    const [products] = await sequelize.query(`
      SELECT id, shop_id, stock_qty, gross_weight, net_weight, stone_weight, status, inventory_mode
      FROM products
      WHERE shop_id IS NOT NULL
    `);

    for (const p of products) {
      const qty = parseFloat(p.stock_qty) || 0;
      await sequelize.query(
        `INSERT INTO inventory_movements (
          id, shop_id, product_id, movement_type, quantity,
          gross_weight, net_weight, stone_weight,
          qty_before, qty_after, reference_type, notes, meta, created_at
        ) VALUES (
          :id, :shop_id, :product_id, 'OPENING', :quantity,
          :gross_weight, :net_weight, :stone_weight,
          0, :qty_after, 'ledger_migration',
          :notes, :meta::jsonb, NOW()
        )`,
        {
          replacements: {
            id: randomUUID(),
            shop_id: p.shop_id,
            product_id: p.id,
            quantity: qty,
            gross_weight: p.gross_weight || 0,
            net_weight: p.net_weight || 0,
            stone_weight: p.stone_weight || 0,
            qty_after: qty,
            notes: 'Inventory balance at ledger migration',
            meta: JSON.stringify({
              baseline: true,
              status_at_baseline: p.status,
              inventory_mode_at_baseline: p.inventory_mode,
            }),
          },
        }
      );
    }
    console.log(`  ✓ Created OPENING baseline for ${products.length} product(s)`);
  }

  // Backfill adjustments → movements (idempotent via reference_id)
  if (await tableExists(qi, 'inventory_adjustments')) {
    const [adjs] = await sequelize.query(`
      SELECT a.*, p.shop_id AS product_shop_id, p.gross_weight, p.net_weight, p.stone_weight
      FROM inventory_adjustments a
      LEFT JOIN products p ON p.id = a.product_id
      WHERE a.id NOT IN (
        SELECT reference_id FROM inventory_movements
        WHERE reference_type = 'inventory_adjustment' AND reference_id IS NOT NULL
      )
    `);

    const typeMap = {
      add: 'ADJUSTMENT_ADD',
      return: 'ADJUSTMENT_ADD',
      remove: 'ADJUSTMENT_REMOVE',
      damage: 'DAMAGE',
    };

    for (const a of adjs) {
      const shopId = a.shop_id || a.product_shop_id;
      if (!shopId) continue;
      const mt = typeMap[a.adjustment_type] || 'ADJUSTMENT_ADD';
      const isOut = mt === 'ADJUSTMENT_REMOVE' || mt === 'DAMAGE';
      const qty = parseFloat(a.qty_change) || 0;
      await sequelize.query(
        `INSERT INTO inventory_movements (
          id, shop_id, product_id, movement_type, quantity,
          gross_weight, net_weight, stone_weight,
          qty_before, qty_after, reference_type, reference_id,
          created_by, notes, meta, created_at
        ) VALUES (
          :id, :shop_id, :product_id, :movement_type, :quantity,
          :gw, :nw, :sw,
          :qty_before, :qty_after, 'inventory_adjustment', :reference_id,
          :created_by, :notes, '{}'::jsonb, COALESCE(:created_at, NOW())
        )`,
        {
          replacements: {
            id: randomUUID(),
            shop_id: shopId,
            product_id: a.product_id,
            movement_type: mt,
            quantity: isOut ? -Math.abs(qty) : Math.abs(qty),
            gw: a.gross_weight || 0,
            nw: a.net_weight || 0,
            sw: a.stone_weight || 0,
            qty_before: a.qty_before,
            qty_after: a.qty_after,
            reference_id: a.id,
            created_by: a.created_by,
            notes: a.notes || a.reason,
            created_at: a.created_at,
          },
        }
      );
    }
    console.log(`  ✓ Backfilled ${adjs.length} adjustment movement(s)`);
  }
}

export async function down({ context: qi }) {
  const sequelize = qi.sequelize;
  await sequelize.query(
    `DELETE FROM inventory_movements WHERE movement_type = 'OPENING' AND reference_type = 'ledger_migration'`
  );
  await sequelize.query(
    `DELETE FROM inventory_movements WHERE reference_type = 'inventory_adjustment'`
  );
}
