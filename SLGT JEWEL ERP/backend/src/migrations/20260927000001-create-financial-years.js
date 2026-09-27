import { DataTypes } from 'sequelize';
import { addColumnIfMissing } from './_helpers.js';

/**
 * Indian Financial Year master + financial_year_id on journal_entries.
 *
 * Idempotent: safe to run on existing installations. Backfills historical FYs
 * from journal entry_date (the authoritative business date) — NEVER from
 * created_at. Does not touch PRE_ACCOUNTS / LIVE financial_mode semantics.
 *
 * PostgreSQL only (Umzug migrations are skipped in SQLite mode — see migrate.js;
 * SQLite gets the schema via sequelize.sync + ensureLocalSqliteSchema).
 */
export async function up({ sequelize, context: qi }) {
  // 1. financial_years table
  const tableExists = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName || t.table_name));
  if (!tableExists.includes('financial_years')) {
    await qi.createTable('financial_years', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      financial_year_code: { type: DataTypes.STRING, allowNull: false },
      display_name: { type: DataTypes.STRING, allowNull: true },
      start_date: { type: DataTypes.DATEONLY, allowNull: false },
      end_date: { type: DataTypes.DATEONLY, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'OPEN' },
      is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      closed_at: { type: DataTypes.DATE, allowNull: true },
      closed_by: { type: DataTypes.STRING, allowNull: true },
      reopened_at: { type: DataTypes.DATE, allowNull: true },
      reopened_by: { type: DataTypes.STRING, allowNull: true },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await qi.addIndex('financial_years', ['shop_id', 'financial_year_code'], { unique: true, name: 'fy_shop_code_uk' });
    await qi.addIndex('financial_years', ['shop_id', 'start_date'], { unique: true, name: 'fy_shop_start_uk' });
    await qi.addIndex('financial_years', ['shop_id', 'is_current']);
    await qi.addIndex('financial_years', ['shop_id', 'status']);
  }

  // 2. financial_year_id on journal_entries
  await addColumnIfMissing(qi, 'journal_entries', 'financial_year_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });
  await qi.addIndex('journal_entries', ['shop_id', 'financial_year_id']).catch(() => {});

  // 3. Backfill FY master rows from the journal entry_date range (business date).
  //    Idempotent: INSERT … ON CONFLICT DO NOTHING.
  await sequelize.query(`
    INSERT INTO financial_years (id, shop_id, financial_year_code, display_name, start_date, end_date, status, is_current, created_at, updated_at)
    SELECT
      gen_random_uuid()::text,
      j.shop_id,
      CASE
        WHEN EXTRACT(MONTH FROM j.entry_date) >= 4
          THEN EXTRACT(YEAR FROM j.entry_date)::int
          ELSE (EXTRACT(YEAR FROM j.entry_date)::int - 1)
      END::text || '-' ||
      LPAD((CASE
        WHEN EXTRACT(MONTH FROM j.entry_date) >= 4
          THEN EXTRACT(YEAR FROM j.entry_date)::int + 1
          ELSE EXTRACT(YEAR FROM j.entry_date)::int
      END % 100)::text, 2, '0'),
      'FY ' ||
      (CASE
        WHEN EXTRACT(MONTH FROM j.entry_date) >= 4
          THEN EXTRACT(YEAR FROM j.entry_date)::int
          ELSE (EXTRACT(YEAR FROM j.entry_date)::int - 1)
      END::text || '-' ||
      LPAD((CASE
        WHEN EXTRACT(MONTH FROM j.entry_date) >= 4
          THEN EXTRACT(YEAR FROM j.entry_date)::int + 1
          ELSE EXTRACT(YEAR FROM j.entry_date)::int
      END % 100)::text, 2, '0')),
      make_date(
        CASE WHEN EXTRACT(MONTH FROM j.entry_date) >= 4 THEN EXTRACT(YEAR FROM j.entry_date)::int
             ELSE EXTRACT(YEAR FROM j.entry_date)::int - 1 END,
        4, 1),
      make_date(
        CASE WHEN EXTRACT(MONTH FROM j.entry_date) >= 4 THEN EXTRACT(YEAR FROM j.entry_date)::int + 1
             ELSE EXTRACT(YEAR FROM j.entry_date)::int END,
        3, 31),
      'OPEN', false, NOW(), NOW()
    FROM journal_entries j
    WHERE j.entry_date IS NOT NULL
    GROUP BY j.shop_id,
      CASE WHEN EXTRACT(MONTH FROM j.entry_date) >= 4 THEN EXTRACT(YEAR FROM j.entry_date)::int
           ELSE EXTRACT(YEAR FROM j.entry_date)::int - 1 END
    ON CONFLICT (shop_id, financial_year_code) DO NOTHING
  `).catch((err) => {
    console.warn('[migration] financial_years backfill deferred:', err?.message);
  });

  // 4. Backfill financial_year_id on journal_entries from entry_date (business date).
  await sequelize.query(`
    UPDATE journal_entries je
    SET financial_year_id = fy.id
    FROM financial_years fy
    WHERE je.financial_year_id IS NULL
      AND fy.shop_id = je.shop_id
      AND je.entry_date >= fy.start_date
      AND je.entry_date <= fy.end_date
  `).catch((err) => {
    console.warn('[migration] journal_entries.financial_year_id backfill deferred:', err?.message);
  });
}

export async function down({ context: qi }) {
  await qi.removeIndex('journal_entries', ['shop_id', 'financial_year_id']).catch(() => {});
  const { removeColumnIfExists } = await import('./_helpers.js');
  await removeColumnIfExists(qi, 'journal_entries', 'financial_year_id');
  await qi.dropTable('financial_years').catch(() => {});
}
