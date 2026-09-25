import 'dotenv/config';
import sequelize from '../db.js';
import { User, Product, Customer, Invoice, Shop, SchemaMeta } from '../models/index.js';
import { SCHEMA_VERSION } from '../config/schemaVersion.js';

await sequelize.authenticate();
const shop = await Shop.findOne({ order: [['created_at', 'ASC']] });
const counts = {
  users: await User.count(),
  products: await Product.count(),
  customers: await Customer.count(),
  invoices: await Invoice.count(),
};
const [nullRows] = await sequelize.query(
  'SELECT COUNT(*)::int AS c FROM products WHERE shop_id IS NULL'
);
const meta = await SchemaMeta.findByPk('schema_version');
const owner = await User.findOne({ where: { role: 'shop_owner' } });

console.log(JSON.stringify({
  shop: shop ? { id: shop.id, name: shop.name, prefix: shop.invoice_prefix } : null,
  counts,
  nullShopProducts: nullRows[0].c,
  schema: meta?.value,
  expectedSchema: SCHEMA_VERSION,
  ownerRole: owner?.role,
  posCreate: owner?.permissions?.pos?.create,
}, null, 2));

await sequelize.close();
