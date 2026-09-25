import 'dotenv/config';
import sequelize from '../src/db.js';

await sequelize.authenticate();
for (const col of ['counter_id', 'device_id', 'branch_id']) {
  try {
    await sequelize.query(`ALTER TABLE invoices ADD COLUMN ${col} TEXT`);
    console.log('added', col);
  } catch (e) {
    console.log(col, String(e.message).slice(0, 80));
  }
}
await sequelize.query(`
  CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY, shop_id TEXT, invoice_id TEXT NOT NULL, line_no INTEGER NOT NULL DEFAULT 0,
    product_id TEXT, barcode TEXT, description TEXT, quantity REAL DEFAULT 1,
    gross_weight REAL, net_weight REAL, rate REAL, making REAL, wastage REAL,
    tax_pct REAL, tax_amount REAL, amount REAL, hsn_code TEXT, snapshot_json TEXT,
    created_at TEXT, updated_at TEXT
  )
`);
console.log('invoice_items ok');
process.exit(0);
