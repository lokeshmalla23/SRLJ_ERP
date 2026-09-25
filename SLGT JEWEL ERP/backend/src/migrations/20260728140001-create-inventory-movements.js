import { DataTypes } from 'sequelize';
import { tableExists, indexExists } from './_helpers.js';
import { SCHEMA_VERSION_KEY } from '../config/schemaVersion.js';

export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  if (!(await tableExists(qi, 'inventory_movements'))) {
    await qi.createTable('inventory_movements', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      product_id: { type: DataTypes.STRING, allowNull: false },
      movement_type: { type: DataTypes.STRING, allowNull: false },
      quantity: { type: DataTypes.FLOAT, allowNull: false },
      gross_weight: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      net_weight: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      stone_weight: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      qty_before: { type: DataTypes.FLOAT, allowNull: true },
      qty_after: { type: DataTypes.FLOAT, allowNull: true },
      reference_type: { type: DataTypes.STRING, allowNull: true },
      reference_id: { type: DataTypes.STRING, allowNull: true },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      created_by: { type: DataTypes.STRING, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  if (!(await indexExists(sequelize, 'inventory_movements_shop_product_created_idx'))) {
    await qi.addIndex('inventory_movements', ['shop_id', 'product_id', 'created_at'], {
      name: 'inventory_movements_shop_product_created_idx',
    });
  }
  if (!(await indexExists(sequelize, 'inventory_movements_shop_type_created_idx'))) {
    await qi.addIndex('inventory_movements', ['shop_id', 'movement_type', 'created_at'], {
      name: 'inventory_movements_shop_type_created_idx',
    });
  }
  if (!(await indexExists(sequelize, 'inventory_movements_reference_idx'))) {
    await qi.addIndex('inventory_movements', ['reference_type', 'reference_id'], {
      name: 'inventory_movements_reference_idx',
    });
  }

  // Help concurrent unique-sale detection at ledger level for SALE rows that are not returned.
  // SALE_RETURN does not remove SALE rows (append-only); uniqueness of "active sale" is enforced
  // primarily via products.status conditional UPDATE. This index speeds lookups by product+type.
  if (!(await indexExists(sequelize, 'inventory_movements_product_type_idx'))) {
    await qi.addIndex('inventory_movements', ['product_id', 'movement_type'], {
      name: 'inventory_movements_product_type_idx',
    });
  }

  await sequelize.query(
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES (:key, :value::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    {
      replacements: {
        key: SCHEMA_VERSION_KEY,
        value: JSON.stringify({ version: 3, phase: 3 }),
      },
    }
  );
}

export async function down({ context: qi }) {
  await qi.dropTable('inventory_movements');
  await qi.sequelize.query(
    `UPDATE schema_meta SET value = :value::jsonb, updated_at = NOW() WHERE key = :key`,
    {
      replacements: {
        key: SCHEMA_VERSION_KEY,
        value: JSON.stringify({ version: 2, phase: 2 }),
      },
    }
  );
}
