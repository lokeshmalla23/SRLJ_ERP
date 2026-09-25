import sequelize from './src/db.js';
import { QueryTypes } from 'sequelize';

const OLD = '2d8e55bb-2c37-4e86-861a-a70c866b5ccf';
const NEW = 'b86c0633-ebb3-4a9a-aabb-b6623b39a7d6';

const tables = await sequelize.query(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  { type: QueryTypes.SELECT },
);

const report = [];
for (const { name } of tables) {
  const cols = await sequelize.query(`PRAGMA table_info(${name})`, { type: QueryTypes.SELECT });
  const hasShopId = cols.some((c) => c.name === 'shop_id');
  if (!hasShopId) continue;
  const [{ cnt: oldCnt }] = await sequelize.query(
    `SELECT COUNT(*) as cnt FROM ${name} WHERE shop_id = :old`,
    { replacements: { old: OLD }, type: QueryTypes.SELECT },
  );
  const [{ cnt: newCnt }] = await sequelize.query(
    `SELECT COUNT(*) as cnt FROM ${name} WHERE shop_id = :new`,
    { replacements: { new: NEW }, type: QueryTypes.SELECT },
  );
  if (oldCnt > 0 || newCnt > 0) {
    report.push({ table: name, oldShopRows: oldCnt, newShopRows: newCnt });
  }
}
console.log('SHOP_SCOPE_REPORT:', JSON.stringify(report, null, 2));

// Also check Product model's barcode uniqueness constraint + product details
const productCols = await sequelize.query(`PRAGMA index_list(products)`, { type: QueryTypes.SELECT });
console.log('PRODUCTS_INDEXES:', JSON.stringify(productCols));

const prods = await sequelize.query(
  `SELECT id, name, barcode, code, inventory_mode, stock_qty, shop_id, created_at FROM products WHERE deleted_at IS NULL ORDER BY created_at ASC`,
  { type: QueryTypes.SELECT },
);
console.log('PRODUCT_DETAILS:', JSON.stringify(prods, null, 2));

await sequelize.close();
