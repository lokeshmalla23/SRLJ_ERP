import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * Adds a simple per-shop running S.No to schemes (display-only, distinct from
 * the internal `id`) so staff can find/refer to a scheme quickly.
 */
export async function up({ context: qi, sequelize }) {
  const added = await addColumnIfMissing(qi, 'schemes', 'serial_no', {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  if (!added) return;

  const [rows] = await sequelize.query(
    'SELECT id, shop_id FROM schemes ORDER BY shop_id ASC, created_at ASC'
  );
  const counters = {};
  for (const row of rows) {
    const key = row.shop_id || '';
    counters[key] = (counters[key] || 0) + 1;
    await sequelize.query('UPDATE schemes SET serial_no = :serial WHERE id = :id', {
      replacements: { serial: counters[key], id: row.id },
    });
  }
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'schemes', 'serial_no');
}
