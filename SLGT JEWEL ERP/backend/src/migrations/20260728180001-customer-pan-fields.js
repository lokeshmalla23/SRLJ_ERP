import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';
import { SCHEMA_VERSION_KEY } from '../config/schemaVersion.js';

export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  await addColumnIfMissing(qi, 'customers', 'pan_number', {
    type: DataTypes.STRING,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'customers', 'pan_image', {
    type: DataTypes.TEXT,
    allowNull: true,
  });

  await sequelize.query(
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES (:key, :value::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    {
      replacements: {
        key: SCHEMA_VERSION_KEY,
        value: JSON.stringify({ version: 5, phase: 'customer-pan' }),
      },
    },
  );
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'customers', 'pan_image');
  await removeColumnIfExists(qi, 'customers', 'pan_number');
}
