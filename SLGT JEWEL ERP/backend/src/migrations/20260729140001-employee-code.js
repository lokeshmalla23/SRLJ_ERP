import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';
import { SCHEMA_VERSION_KEY } from '../config/schemaVersion.js';

export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  await addColumnIfMissing(qi, 'employees', 'employee_code', {
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
        value: JSON.stringify({ version: 6, phase: 'employee-code' }),
      },
    },
  );
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'employees', 'employee_code');
}
