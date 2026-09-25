import 'dotenv/config';
import sequelize from '../src/db.js';
import { allocateInvoiceNumber } from '../src/services/invoiceSequence.js';
import { Shop } from '../src/models/index.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';

/**
 * Concurrency test: many parallel allocations inside separate transactions
 * must never produce duplicate invoice numbers.
 *
 * Requires DATABASE_URL and a migrated schema with at least one shop.
 */
async function run() {
  await sequelize.authenticate();
  clearDefaultShopCache();

  const shop = await Shop.findOne({ where: { status: 'active' }, order: [['created_at', 'ASC']] });
  if (!shop) {
    throw new Error('No shop found — run migrations first');
  }

  const PARALLEL = Number(process.env.SEQ_TEST_PARALLEL || 40);
  const at = new Date('2099-01-15T12:00:00Z'); // isolated test day

  const results = await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      const t = await sequelize.transaction();
      try {
        const allocated = await allocateInvoiceNumber({
          shopId: shop.id,
          prefix: 'TEST',
          at,
          transaction: t,
        });
        await t.commit();
        return allocated.invoiceNo;
      } catch (err) {
        await t.rollback();
        throw err;
      }
    })
  );

  const unique = new Set(results);
  if (unique.size !== results.length) {
    const counts = {};
    for (const n of results) counts[n] = (counts[n] || 0) + 1;
    const dupes = Object.entries(counts).filter(([, c]) => c > 1);
    console.error('FAIL: duplicate invoice numbers', dupes);
    process.exit(1);
  }

  console.log(`PASS: ${PARALLEL} concurrent allocations produced ${unique.size} unique numbers`);
  console.log(`  sample: ${results.slice(0, 5).join(', ')} …`);
  await sequelize.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
