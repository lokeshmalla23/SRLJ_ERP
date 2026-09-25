import { QueryTypes } from 'sequelize';
import { tableExists } from './_helpers.js';

/**
 * Rename biscuit → pure; stock for bulk pure lives in stock_qty (grams).
 * weight_g becomes 0 sentinel for uniqueness (one Pure Gold / Pure Silver per shop).
 */
export async function up({ context: qi }) {
  if (!(await tableExists(qi, 'pure_products'))) return;
  const sequelize = qi.sequelize;

  // Move biscuit stock: if biscuits used unit weight × qty, collapse into grams
  await sequelize.query(
    `UPDATE pure_products
     SET stock_qty = ROUND(CAST(weight_g AS REAL) * CAST(stock_qty AS REAL), 3),
         weight_g = 0,
         form_type = 'pure',
         name = CASE
           WHEN lower(metal) = 'silver' THEN 'Pure Silver'
           ELSE 'Pure Gold'
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE lower(form_type) = 'biscuit'
       AND deleted_at IS NULL`,
    { type: QueryTypes.UPDATE },
  );

  // Any already-named pure rows: normalize sentinel weight
  await sequelize.query(
    `UPDATE pure_products
     SET weight_g = 0,
         name = CASE
           WHEN lower(metal) = 'silver' THEN 'Pure Silver'
           ELSE 'Pure Gold'
         END,
         form_type = 'pure',
         updated_at = CURRENT_TIMESTAMP
     WHERE lower(form_type) = 'pure'
       AND deleted_at IS NULL`,
    { type: QueryTypes.UPDATE },
  );
}

export async function down() {
  // irreversible data reshape
}
