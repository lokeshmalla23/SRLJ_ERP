import 'dotenv/config';
import sequelize from '../db.js';

await sequelize.authenticate();
await sequelize.query(`
  DELETE FROM inventory_movements
  WHERE product_id IN (
    SELECT id FROM products
    WHERE name LIKE 'Qty Test%' OR name LIKE 'Unique Test%'
  )
`);
const [, meta] = await sequelize.query(`
  DELETE FROM products
  WHERE name LIKE 'Qty Test%' OR name LIKE 'Unique Test%'
`);
console.log('Cleaned orphan test products');
await sequelize.close();
