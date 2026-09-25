/**
 * Invoice/Purchase POS context columns + normalized line tables (dual-write).
 * Keeps JSON items blob until proven migration; does not delete original JSON.
 */
import { tableExists, columnExists } from './_helpers.js';

export async function up({ context: queryInterface }) {
  const qi = queryInterface;
  const sequelize = qi.sequelize;
  const dialect = sequelize.getDialect();

  const addCol = async (table, col, defSql) => {
    if (!(await tableExists(qi, table))) return;
    if (await columnExists(qi, table, col)) return;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${defSql}`);
  };

  await addCol('invoices', 'counter_id', 'TEXT');
  await addCol('invoices', 'device_id', 'TEXT');
  await addCol('invoices', 'branch_id', 'TEXT');

  if (!(await tableExists(qi, 'invoice_items'))) {
    if (dialect === 'sqlite') {
      await sequelize.query(`
        CREATE TABLE invoice_items (
          id TEXT PRIMARY KEY,
          shop_id TEXT,
          invoice_id TEXT NOT NULL,
          line_no INTEGER NOT NULL DEFAULT 0,
          product_id TEXT,
          barcode TEXT,
          description TEXT,
          quantity REAL DEFAULT 1,
          gross_weight REAL,
          net_weight REAL,
          rate REAL,
          making REAL,
          wastage REAL,
          tax_pct REAL,
          tax_amount REAL,
          amount REAL,
          hsn_code TEXT,
          snapshot_json TEXT,
          created_at TEXT,
          updated_at TEXT
        )
      `);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS invoice_items_invoice_id_idx ON invoice_items (invoice_id)`);
    } else {
      await qi.createTable('invoice_items', {
        id: { type: 'TEXT', primaryKey: true },
        shop_id: { type: 'TEXT' },
        invoice_id: { type: 'TEXT', allowNull: false },
        line_no: { type: 'INTEGER', allowNull: false, defaultValue: 0 },
        product_id: { type: 'TEXT' },
        barcode: { type: 'TEXT' },
        description: { type: 'TEXT' },
        quantity: { type: 'DECIMAL(14,4)', defaultValue: 1 },
        gross_weight: { type: 'DECIMAL(14,4)' },
        net_weight: { type: 'DECIMAL(14,4)' },
        rate: { type: 'DECIMAL(14,4)' },
        making: { type: 'DECIMAL(14,4)' },
        wastage: { type: 'DECIMAL(14,4)' },
        tax_pct: { type: 'DECIMAL(8,4)' },
        tax_amount: { type: 'DECIMAL(14,2)' },
        amount: { type: 'DECIMAL(14,2)' },
        hsn_code: { type: 'TEXT' },
        snapshot_json: { type: 'JSONB' },
        created_at: { type: 'TIMESTAMPTZ' },
        updated_at: { type: 'TIMESTAMPTZ' },
      });
    }
  }

  if (!(await tableExists(qi, 'purchase_items'))) {
    if (dialect === 'sqlite') {
      await sequelize.query(`
        CREATE TABLE purchase_items (
          id TEXT PRIMARY KEY,
          shop_id TEXT,
          purchase_id TEXT NOT NULL,
          line_no INTEGER NOT NULL DEFAULT 0,
          product_id TEXT,
          barcode TEXT,
          description TEXT,
          quantity REAL DEFAULT 1,
          weight_g REAL,
          rate REAL,
          tax_pct REAL,
          tax_amount REAL,
          amount REAL,
          snapshot_json TEXT,
          created_at TEXT,
          updated_at TEXT
        )
      `);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS purchase_items_purchase_id_idx ON purchase_items (purchase_id)`);
    } else {
      await qi.createTable('purchase_items', {
        id: { type: 'TEXT', primaryKey: true },
        shop_id: { type: 'TEXT' },
        purchase_id: { type: 'TEXT', allowNull: false },
        line_no: { type: 'INTEGER', allowNull: false, defaultValue: 0 },
        product_id: { type: 'TEXT' },
        barcode: { type: 'TEXT' },
        description: { type: 'TEXT' },
        quantity: { type: 'DECIMAL(14,4)', defaultValue: 1 },
        weight_g: { type: 'DECIMAL(14,4)' },
        rate: { type: 'DECIMAL(14,4)' },
        tax_pct: { type: 'DECIMAL(8,4)' },
        tax_amount: { type: 'DECIMAL(14,2)' },
        amount: { type: 'DECIMAL(14,2)' },
        snapshot_json: { type: 'JSONB' },
        created_at: { type: 'TIMESTAMPTZ' },
        updated_at: { type: 'TIMESTAMPTZ' },
      });
    }
  }
}

export async function down() {
  // keep tables
}
