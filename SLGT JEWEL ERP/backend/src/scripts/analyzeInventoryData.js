import 'dotenv/config';
import sequelize from '../db.js';

await sequelize.authenticate();

const [stats] = await sequelize.query(`
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE barcode IS NOT NULL AND BTRIM(barcode) <> '')::int AS with_barcode,
    COUNT(*) FILTER (WHERE barcode IS NULL OR BTRIM(barcode) = '')::int AS missing_barcode,
    COUNT(*) FILTER (WHERE stock_qty = 1)::int AS qty1,
    COUNT(*) FILTER (WHERE stock_qty = 0)::int AS qty0,
    COUNT(*) FILTER (WHERE stock_qty > 1)::int AS qty_gt1,
    COUNT(*) FILTER (WHERE inventory_mode = 'unique_tag')::int AS unique_mode,
    COUNT(*) FILTER (WHERE inventory_mode = 'quantity' OR inventory_mode IS NULL)::int AS qty_mode,
    ROUND(AVG(stock_qty)::numeric, 2) AS avg_qty
  FROM products
`);

const [byStatus] = await sequelize.query(
  `SELECT status, COUNT(*)::int AS c FROM products GROUP BY status ORDER BY c DESC`
);

const [hist] = await sequelize.query(
  `SELECT change_type, COUNT(*)::int AS c FROM stock_history GROUP BY change_type ORDER BY c DESC`
);

const [adj] = await sequelize.query(
  `SELECT adjustment_type, COUNT(*)::int AS c FROM inventory_adjustments GROUP BY adjustment_type`
);

console.log(JSON.stringify({ stats: stats[0], byStatus, hist, adj }, null, 2));
await sequelize.close();
