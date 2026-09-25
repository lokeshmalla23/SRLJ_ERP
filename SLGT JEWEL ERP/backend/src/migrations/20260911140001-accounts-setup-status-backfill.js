import { tableExists } from './_helpers.js';

const SETUP_KEY = 'erp_opening_setup_complete';

/**
 * Stamp Accounts Setup COMPLETED for shops that already posted an opening
 * cutover voucher or have a closed business day. Does not invent balances
 * and does not treat invoice history alone as setup (those bills may predate
 * Accounts initialization).
 *
 * SQLite desktop skips Umzug — openingSetupService.maybeBackfillAccountsSetupCompleted
 * applies the same rule at runtime.
 */
export async function up({ sequelize, context: qi }) {
  if (!(await tableExists(qi, 'settings'))) return;

  const dialect = sequelize.getDialect();
  const now = new Date().toISOString();

  if (dialect === 'postgres') {
    await sequelize.query(
      `
      UPDATE settings
      SET value = jsonb_set(COALESCE(value, '{}'::jsonb), '{status}', '"COMPLETED"', true),
          updated_at = NOW()
      WHERE key = :key
        AND COALESCE(value->>'status', '') <> 'COMPLETED'
        AND (
          (value->>'completed_at') IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM journal_entries je
            WHERE je.source_type = 'opening_balance'
              AND (je.shop_id = settings.shop_id OR settings.shop_id IS NULL)
            LIMIT 1
          )
          OR EXISTS (
            SELECT 1 FROM daily_closings dc
            WHERE dc.status = 'closed'
              AND (dc.shop_id = settings.shop_id OR settings.shop_id IS NULL)
            LIMIT 1
          )
        )
      `,
      { replacements: { key: SETUP_KEY } },
    );

    await sequelize.query(
      `
      INSERT INTO settings (id, shop_id, key, value, version, created_at, updated_at)
      SELECT
        md5(random()::text || clock_timestamp()::text),
        (SELECT id FROM shops ORDER BY created_at ASC NULLS LAST LIMIT 1),
        :key,
        jsonb_build_object(
          'status', 'COMPLETED',
          'completed_at', :now::text,
          'inferred', true,
          'reason', 'migration_backfill'
        ),
        1,
        NOW(),
        NOW()
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = :key)
        AND (
          EXISTS (SELECT 1 FROM journal_entries WHERE source_type = 'opening_balance' LIMIT 1)
          OR EXISTS (SELECT 1 FROM daily_closings WHERE status = 'closed' LIMIT 1)
        )
      `,
      { replacements: { key: SETUP_KEY, now } },
    );
    return;
  }

  // Non-Postgres: runtime backfill in openingSetupService covers SQLite.
}

export async function down() {}
