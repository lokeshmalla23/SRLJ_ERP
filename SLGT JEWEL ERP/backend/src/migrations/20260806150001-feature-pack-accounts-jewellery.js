import { DataTypes } from 'sequelize';
import { tableExists, addColumnIfMissing } from './_helpers.js';

/**
 * Feature pack tables: cashbook, metal issues, rate history, commission, old-gold trail.
 */
export async function up({ context: queryInterface }) {
  const qi = queryInterface;
  const sequelize = qi.sequelize;

  if (!(await tableExists(qi, 'cashbook_entries'))) {
    await qi.createTable('cashbook_entries', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: true },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      entry_type: { type: DataTypes.STRING, allowNull: false },
      mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'cash' },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      contra: { type: DataTypes.BOOLEAN, defaultValue: false },
      reference: { type: DataTypes.STRING, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      linked_expense_id: { type: DataTypes.STRING, allowNull: true },
      linked_invoice_id: { type: DataTypes.STRING, allowNull: true },
      created_by: { type: DataTypes.STRING, allowNull: true },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await sequelize.query(`CREATE INDEX IF NOT EXISTS cashbook_shop_date_idx ON cashbook_entries (shop_id, date)`);
  }

  if (!(await tableExists(qi, 'metal_issues'))) {
    await qi.createTable('metal_issues', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: true },
      order_id: { type: DataTypes.STRING, allowNull: true },
      karigar_vendor_id: { type: DataTypes.STRING, allowNull: false },
      movement_type: { type: DataTypes.STRING, allowNull: false },
      metal_type: { type: DataTypes.STRING, allowNull: true },
      purity: { type: DataTypes.STRING, allowNull: true },
      weight: { type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: 0 },
      scrap_weight: { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
      notes: { type: DataTypes.TEXT, allowNull: true },
      created_by: { type: DataTypes.STRING, allowNull: true },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  if (!(await tableExists(qi, 'gold_rate_history'))) {
    await qi.createTable('gold_rate_history', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: true },
      rates: { type: DataTypes.JSONB, defaultValue: {} },
      changed_by: { type: DataTypes.STRING, allowNull: true },
      source: { type: DataTypes.STRING, defaultValue: 'settings' },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  if (!(await tableExists(qi, 'billing_rate_events'))) {
    await qi.createTable('billing_rate_events', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: true },
      event_type: { type: DataTypes.STRING, allowNull: false },
      gold_rate: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      previous_rate: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      invoice_id: { type: DataTypes.STRING, allowNull: true },
      user_id: { type: DataTypes.STRING, allowNull: true },
      meta: { type: DataTypes.JSONB, defaultValue: {} },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  await addColumnIfMissing(qi, 'employees', 'commission_pct', {
    type: DataTypes.DECIMAL(8, 3), defaultValue: 0,
  });
  await addColumnIfMissing(qi, 'employees', 'commission_on', {
    type: DataTypes.STRING, defaultValue: 'making',
  });

  await addColumnIfMissing(qi, 'old_gold_receipts', 'status', {
    type: DataTypes.STRING, defaultValue: 'received',
  });
  await addColumnIfMissing(qi, 'old_gold_receipts', 'trail_notes', {
    type: DataTypes.TEXT, allowNull: true,
  });

  await addColumnIfMissing(qi, 'journal_entries', 'voucher_type', {
    type: DataTypes.STRING, defaultValue: 'auto',
  });
  await addColumnIfMissing(qi, 'journal_entries', 'voucher_no', {
    type: DataTypes.STRING, allowNull: true,
  });
}

export async function down({ context: queryInterface }) {
  for (const t of ['billing_rate_events', 'gold_rate_history', 'metal_issues', 'cashbook_entries']) {
    try { await queryInterface.dropTable(t); } catch { /* */ }
  }
}
