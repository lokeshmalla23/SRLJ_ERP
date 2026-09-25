import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';
import { SCHEMA_VERSION, SCHEMA_VERSION_KEY } from '../config/schemaVersion.js';

/**
 * Adds invoices.round_off — nearest-rupee rounding delta applied to grand_total.
 * Existing rows default to 0 (their grand_total was never rounded, so no
 * historical invoice is affected).
 */
export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  await addColumnIfMissing(qi, 'invoices', 'round_off', {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0,
  });

  await sequelize.query(
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES (:key, :value::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    {
      replacements: {
        key: SCHEMA_VERSION_KEY,
        value: JSON.stringify({ version: SCHEMA_VERSION, phase: 'invoice-round-off' }),
      },
    },
  );
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'invoices', 'round_off');
}
