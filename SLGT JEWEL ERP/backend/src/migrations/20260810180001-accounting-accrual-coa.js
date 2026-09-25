/**
 * Phase 1 accrual CoA: Input GST, UPI, Card, Equity, Suspense;
 * journal_entries.is_opening; rename display labels for Bank / Output GST.
 */
import { DataTypes } from 'sequelize';
import { tableExists, columnExists, addColumnIfMissing } from './_helpers.js';

export async function up({ context: queryInterface }) {
  const qi = queryInterface;

  if (await tableExists(qi, 'journal_entries')) {
    await addColumnIfMissing(qi, 'journal_entries', 'is_opening', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }

  if (!(await tableExists(qi, 'chart_of_accounts'))) return;

  const sequelize = qi.sequelize;
  const now = new Date().toISOString();

  // Rename labels in place (codes unchanged)
  await sequelize.query(
    `UPDATE chart_of_accounts SET name = 'Bank', updated_at = :now
     WHERE code = '1010' AND is_system = true`,
    { replacements: { now } },
  ).catch(() => {});
  await sequelize.query(
    `UPDATE chart_of_accounts SET name = 'Output GST Payable', updated_at = :now
     WHERE code = '2100' AND is_system = true`,
    { replacements: { now } },
  ).catch(() => {});
  await sequelize.query(
    `UPDATE chart_of_accounts SET name = 'COGS', updated_at = :now
     WHERE code = '5000' AND is_system = true`,
    { replacements: { now } },
  ).catch(() => {});

  // Seed new system accounts for every shop that already has a CoA row
  const [shops] = await sequelize.query(
    `SELECT DISTINCT shop_id FROM chart_of_accounts`,
  ).catch(() => [[]]);

  const extras = [
    { code: '1020', name: 'UPI', type: 'asset' },
    { code: '1030', name: 'Card', type: 'asset' },
    { code: '1400', name: 'Input GST', type: 'asset' },
    { code: '2300', name: 'Scheme Liability', type: 'liability' },
    { code: '3000', name: 'Opening Equity', type: 'equity' },
    { code: '3100', name: 'Suspense', type: 'equity' },
  ];

  for (const shop of shops || []) {
    const shopId = shop.shop_id;
    if (!shopId) continue;
    for (const a of extras) {
      const [existing] = await sequelize.query(
        `SELECT id FROM chart_of_accounts WHERE shop_id = :shopId AND code = :code LIMIT 1`,
        { replacements: { shopId, code: a.code } },
      );
      if (existing?.length) continue;
      const id = `coa-${shopId.slice(0, 8)}-${a.code}-${Date.now().toString(36)}`;
      await sequelize.query(
        `INSERT INTO chart_of_accounts
          (id, shop_id, code, name, type, is_system, created_at, updated_at)
         VALUES (:id, :shopId, :code, :name, :type, true, :now, :now)`,
        {
          replacements: {
            id, shopId, code: a.code, name: a.name, type: a.type, now,
          },
        },
      );
    }
  }
}

export async function down({ context: queryInterface }) {
  const qi = queryInterface;
  if (await tableExists(qi, 'journal_entries') && await columnExists(qi, 'journal_entries', 'is_opening')) {
    await qi.removeColumn('journal_entries', 'is_opening').catch(() => {});
  }
}
