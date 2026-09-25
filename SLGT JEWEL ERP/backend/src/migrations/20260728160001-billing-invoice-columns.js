import { DataTypes } from 'sequelize';
import { columnExists, tableExists, indexExists } from './_helpers.js';
import { SCHEMA_VERSION_KEY } from '../config/schemaVersion.js';

export async function up({ context: qi }) {
  const sequelize = qi.sequelize;
  if (!(await tableExists(qi, 'invoices'))) return;

  const cols = [
    ['discount_type', { type: DataTypes.STRING, allowNull: true, defaultValue: 'flat' }],
    ['cgst_amount', { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }],
    ['sgst_amount', { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }],
    ['old_gold_value', { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }],
    ['gold_rate', { type: DataTypes.DECIMAL(14, 2), allowNull: true }],
    ['request_id', { type: DataTypes.STRING, allowNull: true }],
    ['created_by', { type: DataTypes.STRING, allowNull: true }],
    ['cancelled_at', { type: DataTypes.DATE, allowNull: true }],
    ['cancelled_by', { type: DataTypes.STRING, allowNull: true }],
    ['cancel_reason', { type: DataTypes.TEXT, allowNull: true }],
  ];

  for (const [name, spec] of cols) {
    if (!(await columnExists(qi, 'invoices', name))) {
      await qi.addColumn('invoices', name, spec);
    }
  }

  // Soften money columns to DECIMAL where still FLOAT (additive cast)
  await sequelize.query(`
    ALTER TABLE invoices
      ALTER COLUMN subtotal TYPE NUMERIC(14,2) USING ROUND(subtotal::numeric, 2),
      ALTER COLUMN discount TYPE NUMERIC(14,2) USING ROUND(discount::numeric, 2),
      ALTER COLUMN gst_pct TYPE NUMERIC(8,4) USING gst_pct::numeric,
      ALTER COLUMN gst_amount TYPE NUMERIC(14,2) USING ROUND(gst_amount::numeric, 2),
      ALTER COLUMN grand_total TYPE NUMERIC(14,2) USING ROUND(grand_total::numeric, 2)
  `).catch((err) => {
    console.warn('  ! DECIMAL alter skipped/partial:', err.message);
  });

  // Backfill CGST/SGST from gst_amount
  await sequelize.query(`
    UPDATE invoices
    SET cgst_amount = ROUND((COALESCE(gst_amount,0) / 2)::numeric, 2),
        sgst_amount = ROUND((COALESCE(gst_amount,0) - ROUND((COALESCE(gst_amount,0) / 2)::numeric, 2))::numeric, 2)
    WHERE cgst_amount = 0 AND sgst_amount = 0 AND COALESCE(gst_amount,0) <> 0
  `);

  if (!(await indexExists(sequelize, 'invoices_request_id_uk'))) {
    await sequelize.query(`
      CREATE UNIQUE INDEX invoices_request_id_uk
      ON invoices (request_id)
      WHERE request_id IS NOT NULL AND BTRIM(request_id) <> ''
    `);
  }

  await sequelize.query(
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES (:key, :value::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    {
      replacements: {
        key: SCHEMA_VERSION_KEY,
        value: JSON.stringify({ version: 4, phase: 4 }),
      },
    }
  );
}

export async function down({ context: qi }) {
  const sequelize = qi.sequelize;
  await sequelize.query(`DROP INDEX IF EXISTS invoices_request_id_uk`);
  for (const col of [
    'discount_type', 'cgst_amount', 'sgst_amount', 'old_gold_value', 'gold_rate',
    'request_id', 'created_by', 'cancelled_at', 'cancelled_by', 'cancel_reason',
  ]) {
    if (await columnExists(qi, 'invoices', col)) {
      await qi.removeColumn('invoices', col);
    }
  }
}
