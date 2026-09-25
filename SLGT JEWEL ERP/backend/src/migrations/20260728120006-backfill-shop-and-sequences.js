import { randomUUID } from 'crypto';
import { columnExists, tableExists } from './_helpers.js';

const SHOP_SCOPED = [
  'users',
  'settings',
  'categories',
  'attributes',
  'catalog_items',
  'products',
  'customers',
  'invoices',
  'quotations',
  'orders',
  'schemes',
  'scheme_plans',
  'vendors',
  'purchases',
  'stock_history',
  'inventory_adjustments',
  'barcode_templates',
  'employees',
  'expenses',
  'expense_categories',
  'daily_closings',
  'campaigns',
  'campaign_messages',
  'notifications',
];

/**
 * Create the default shop from settings.company (or env defaults),
 * backfill shop_id on all scoped rows, seed invoice_sequences from existing invoices.
 */
export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  // Load company settings if present
  let company = {};
  if (await tableExists(qi, 'settings')) {
    const [rows] = await sequelize.query(
      `SELECT value FROM settings WHERE key = 'company' LIMIT 1`
    );
    if (rows[0]?.value) {
      company = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
    }
  }

  const shopId = randomUUID();
  const name = company.name || process.env.SHOP_NAME || 'My Jewellery Shop';
  const prefix = company.prefix || process.env.SHOP_INVOICE_PREFIX || null;

  // Idempotent: reuse existing shop if any
  const [existing] = await sequelize.query(`SELECT id FROM shops ORDER BY created_at ASC LIMIT 1`);
  let resolvedShopId = existing[0]?.id;

  if (!resolvedShopId) {
    await sequelize.query(
      `INSERT INTO shops (id, name, code, gstin, phone, email, address, invoice_prefix, status, settings, created_at, updated_at)
       VALUES (:id, :name, :code, :gstin, :phone, :email, :address, :prefix, 'active', '{}'::jsonb, NOW(), NOW())`,
      {
        replacements: {
          id: shopId,
          name,
          code: prefix,
          gstin: company.gstin || company.gst_number || null,
          phone: company.phone || null,
          email: company.email || null,
          address: company.address || null,
          prefix,
        },
      }
    );
    resolvedShopId = shopId;
  }

  for (const table of SHOP_SCOPED) {
    if (!(await tableExists(qi, table))) continue;
    if (!(await columnExists(qi, table, 'shop_id'))) continue;
    await sequelize.query(
      `UPDATE ${table} SET shop_id = :shopId WHERE shop_id IS NULL`,
      { replacements: { shopId: resolvedShopId } }
    );
  }

  // Initialize invoice sequences from max existing invoice numbers per day+prefix
  if (await tableExists(qi, 'invoices')) {
    const [invoiceRows] = await sequelize.query(
      `SELECT invoice_no FROM invoices WHERE invoice_no IS NOT NULL`
    );

    /** @type {Map<string, number>} */
    const maxima = new Map();
    for (const row of invoiceRows) {
      const no = row.invoice_no;
      // PREFIX-YYMMDD-####
      const m = String(no).match(/^([A-Za-z0-9]+)-(\d{6})-(\d+)$/);
      if (!m) continue;
      const [, invPrefix, yymmdd, seqStr] = m;
      const seq = parseInt(seqStr, 10);
      if (Number.isNaN(seq)) continue;
      const yyyy = `20${yymmdd.slice(0, 2)}`; // assume 20xx
      const sequenceDate = `${yyyy}${yymmdd.slice(2)}`;
      const key = `${invPrefix}|${sequenceDate}`;
      maxima.set(key, Math.max(maxima.get(key) || 0, seq));
    }

    for (const [key, maxSeq] of maxima.entries()) {
      const [invPrefix, sequenceDate] = key.split('|');
      await sequelize.query(
        `INSERT INTO invoice_sequences (id, shop_id, sequence_date, prefix, next_value, created_at, updated_at)
         VALUES (:id, :shopId, :sequenceDate, :prefix, :nextValue, NOW(), NOW())
         ON CONFLICT (shop_id, sequence_date, prefix)
         DO UPDATE SET next_value = GREATEST(invoice_sequences.next_value, EXCLUDED.next_value),
                       updated_at = NOW()`,
        {
          replacements: {
            id: randomUUID(),
            shopId: resolvedShopId,
            sequenceDate,
            prefix: invPrefix,
            nextValue: maxSeq + 1,
          },
        }
      );
    }
  }

  // Link settings.company value with shop_id reference (non-breaking)
  if (await tableExists(qi, 'settings')) {
    await sequelize.query(
      `UPDATE settings
       SET value = COALESCE(value, '{}'::jsonb) || jsonb_build_object('shop_id', :shopId::text)
       WHERE key = 'company'`,
      { replacements: { shopId: resolvedShopId } }
    );
  }
}

export async function down({ context: qi }) {
  const sequelize = qi.sequelize;
  // Clear backfilled shop_ids but keep shops row (safer than deleting shop with FKs)
  for (const table of SHOP_SCOPED) {
    if (!(await tableExists(qi, table))) continue;
    if (!(await columnExists(qi, table, 'shop_id'))) continue;
    await sequelize.query(`UPDATE ${table} SET shop_id = NULL`);
  }
  await sequelize.query(`DELETE FROM invoice_sequences`);
  // Do not delete shops automatically — may be referenced; leave row
}
