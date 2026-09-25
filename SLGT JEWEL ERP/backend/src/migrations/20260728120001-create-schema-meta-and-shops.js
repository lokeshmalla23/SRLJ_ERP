import { DataTypes } from 'sequelize';
import { SCHEMA_VERSION, SCHEMA_VERSION_KEY } from '../config/schemaVersion.js';
import { tableExists } from './_helpers.js';

/** Create schema_meta + shops tables. */
export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  if (!(await tableExists(qi, 'schema_meta'))) {
    await qi.createTable('schema_meta', {
      key: { type: DataTypes.STRING, primaryKey: true },
      value: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
  }

  if (!(await tableExists(qi, 'shops'))) {
    await qi.createTable('shops', {
      id: { type: DataTypes.STRING, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      code: { type: DataTypes.STRING, allowNull: true },
      gstin: { type: DataTypes.STRING, allowNull: true },
      phone: { type: DataTypes.STRING, allowNull: true },
      email: { type: DataTypes.STRING, allowNull: true },
      address: { type: DataTypes.TEXT, allowNull: true },
      invoice_prefix: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  await sequelize.query(
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES (:key, :value::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    {
      replacements: {
        key: SCHEMA_VERSION_KEY,
        value: JSON.stringify({ version: SCHEMA_VERSION, phase: 2 }),
      },
    }
  );
}

export async function down({ context: qi }) {
  await qi.dropTable('shops');
  await qi.dropTable('schema_meta');
}
