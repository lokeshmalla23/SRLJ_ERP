import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';
import { SCHEMA_VERSION, SCHEMA_VERSION_KEY } from '../config/schemaVersion.js';

/**
 * Adds salesperson_id to quotations and invoices so the salesperson picked in
 * POS Billing / Quotations is actually persisted (both are nullable — existing
 * rows and walk-in bills with no salesperson selected are unaffected).
 */
export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  await addColumnIfMissing(qi, 'quotations', 'salesperson_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'invoices', 'salesperson_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });

  await sequelize.query(
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES (:key, :value::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    {
      replacements: {
        key: SCHEMA_VERSION_KEY,
        value: JSON.stringify({ version: SCHEMA_VERSION, phase: 'salesperson-id' }),
      },
    },
  );
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'quotations', 'salesperson_id');
  await removeColumnIfExists(qi, 'invoices', 'salesperson_id');
}
