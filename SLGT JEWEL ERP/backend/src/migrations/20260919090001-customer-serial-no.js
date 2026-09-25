import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * Adds a simple per-shop running S.No ("CUST-001") to customers (display-only,
 * distinct from the internal `id`) so staff can find/refer to a customer
 * quickly, especially now that mobile numbers are no longer unique.
 */
export async function up({ context: qi, sequelize }) {
  const added = await addColumnIfMissing(qi, 'customers', 'serial_no', {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  if (!added) return;

  const [rows] = await sequelize.query(
    'SELECT id, shop_id FROM customers ORDER BY shop_id ASC, created_at ASC'
  );
  const counters = {};
  for (const row of rows) {
    const key = row.shop_id || '';
    counters[key] = (counters[key] || 0) + 1;
    await sequelize.query('UPDATE customers SET serial_no = :serial WHERE id = :id', {
      replacements: { serial: counters[key], id: row.id },
    });
  }
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'customers', 'serial_no');
}
