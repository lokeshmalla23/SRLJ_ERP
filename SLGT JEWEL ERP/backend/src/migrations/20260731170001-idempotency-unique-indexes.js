/**
 * Idempotency unique indexes + payment/advance request_id uniqueness.
 * SQLite: CREATE UNIQUE INDEX IF NOT EXISTS (NULLs allowed multiple times in SQLite unique).
 */
import { tableExists } from './_helpers.js';

export async function up({ context: queryInterface }) {
  const qi = queryInterface;
  const sequelize = qi.sequelize;

  const tryIndex = async (sql) => {
    try {
      await sequelize.query(sql);
    } catch (err) {
      console.warn('[migration] index skipped:', err.message);
    }
  };

  if (await tableExists(qi, 'payments')) {
    await tryIndex(`CREATE UNIQUE INDEX IF NOT EXISTS payments_request_id_uk ON payments (request_id) WHERE request_id IS NOT NULL AND request_id <> ''`);
  }
  if (await tableExists(qi, 'customer_advance_applications')) {
    await tryIndex(`CREATE UNIQUE INDEX IF NOT EXISTS advance_app_request_id_uk ON customer_advance_applications (request_id) WHERE request_id IS NOT NULL AND request_id <> ''`);
  }
  if (await tableExists(qi, 'customer_advances')) {
    await tryIndex(`CREATE UNIQUE INDEX IF NOT EXISTS customer_advances_request_id_uk ON customer_advances (request_id) WHERE request_id IS NOT NULL AND request_id <> ''`);
  }
  if (await tableExists(qi, 'journal_entries')) {
    await tryIndex(`CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_request_id_uk ON journal_entries (request_id) WHERE request_id IS NOT NULL AND request_id <> ''`);
  }
  if (await tableExists(qi, 'credit_notes')) {
    await tryIndex(`CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_request_id_uk ON credit_notes (request_id) WHERE request_id IS NOT NULL AND request_id <> ''`);
  }
  if (await tableExists(qi, 'loyalty_transactions')) {
    await tryIndex(`CREATE UNIQUE INDEX IF NOT EXISTS loyalty_tx_request_id_uk ON loyalty_transactions (request_id) WHERE request_id IS NOT NULL AND request_id <> ''`);
  }
}

export async function down() {
  // no-op — keep indexes
}
