'use strict';
/**
 * Migration 023 — biscuit → pure (bulk grams stock).
 */
module.exports = {
  id: 23,
  name: 'pure_form_type_bulk',
  up(db) {
    try {
      db.exec(`
        UPDATE pure_products
        SET stock_qty = ROUND(weight_g * stock_qty, 3),
            weight_g = 0,
            form_type = 'pure',
            name = CASE WHEN lower(metal) = 'silver' THEN 'Pure Silver' ELSE 'Pure Gold' END,
            updated_at = datetime('now')
        WHERE lower(form_type) = 'biscuit'
          AND deleted_at IS NULL;
      `);
    } catch { /* table may not exist yet */ }
    try {
      db.exec(`
        UPDATE pure_products
        SET weight_g = 0,
            form_type = 'pure',
            name = CASE WHEN lower(metal) = 'silver' THEN 'Pure Silver' ELSE 'Pure Gold' END,
            updated_at = datetime('now')
        WHERE lower(form_type) = 'pure'
          AND deleted_at IS NULL;
      `);
    } catch { /* */ }
  },
};
