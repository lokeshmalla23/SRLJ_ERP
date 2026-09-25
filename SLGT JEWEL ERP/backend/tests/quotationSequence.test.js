/**
 * node tests/quotationSequence.test.js
 *
 * Next-free LIVE / TEST estimation numbers. Uses year 2099 so it does not
 * touch the shop's real QT-2026-* series. Rows are tagged QT-SEQ-TEST and
 * destroyed at the end.
 */
import 'dotenv/config';
import assert from 'assert';
import sequelize from '../src/db.js';
import { Quotation, Shop } from '../src/models/index.js';
import { newId } from '../src/utils.js';
import { FINANCIAL_MODE } from '../src/services/financialMode.js';
import branchConfig from '../src/config/branchConfig.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';
import {
  quoteNoPrefix,
  parseQuoteSeq,
  formatQuoteNo,
  nextFreeQuoteSeq,
  isQuoteNoUniqueError,
  allocateQuoteNumber,
} from '../src/services/quotationSequence.js';

const YEAR = 2099;
const MARKER = 'QT-SEQ-TEST';

function assertEqual(a, b, msg) {
  assert.strictEqual(a, b, msg || `${a} !== ${b}`);
}

assertEqual(quoteNoPrefix({ year: YEAR }), 'QT-2099-');
assertEqual(quoteNoPrefix({ year: YEAR, testMode: true }), 'TEST-QT-2099-');
assertEqual(parseQuoteSeq('QT-2099-010', 'QT-2099-'), 10);
assertEqual(parseQuoteSeq('TEST-QT-2099-010', 'QT-2099-'), null);
assertEqual(parseQuoteSeq('TEST-QT-2099-010', 'TEST-QT-2099-'), 10);
assertEqual(formatQuoteNo('QT-2099-', 12), 'QT-2099-012');

assertEqual(nextFreeQuoteSeq(9, [10, 11]), 12, 'skip leftover 10 and 11');
assertEqual(nextFreeQuoteSeq(9, [9, 10, 11]), 12);
assertEqual(nextFreeQuoteSeq(0, [10, 11]), 1, 'empty live series starts at 001');
assertEqual(nextFreeQuoteSeq(9, []), 10);
assertEqual(nextFreeQuoteSeq(0, []), 1);

assert.ok(isQuoteNoUniqueError({
  name: 'SequelizeUniqueConstraintError',
  fields: { quote_no: 'QT-2099-010' },
}));
assert.ok(isQuoteNoUniqueError({
  name: 'SequelizeUniqueConstraintError',
  parent: { message: 'UNIQUE constraint failed: quotations.quote_no' },
}));
assert.ok(!isQuoteNoUniqueError({ name: 'SequelizeUniqueConstraintError', fields: { id: 'x' } }));

async function seed({ quote_no, financial_mode = FINANCIAL_MODE.LIVE, deleted_at = null, shop_id = null }) {
  return Quotation.create({
    id: newId(),
    shop_id,
    quote_no,
    customer_name: MARKER,
    financial_mode,
    status: 'draft',
    items: [],
    deleted_at,
  });
}

async function cleanup() {
  await Quotation.destroy({ where: { customer_name: MARKER }, force: true }).catch(() => 0);
}

async function run() {
  await sequelize.authenticate();
  if (sequelize.getDialect() === 'sqlite') {
    const { ensureLocalSqliteSchema } = await import('../src/services/ensureLocalSqliteSchema.js');
    await ensureLocalSqliteSchema();
  }
  await Shop.sync();
  await Quotation.sync();
  clearDefaultShopCache();
  const shopId = branchConfig.shop_id || newId();
  const existingShop = await Shop.findByPk(shopId).catch(() => null);
  if (!existingShop) {
    await Shop.create({
      id: shopId,
      name: 'Quote Seq Test Shop',
      code: `QSEQ-${Date.now().toString(36)}`,
      status: 'active',
    });
  }

  await cleanup();

  try {
    for (let n = 1; n <= 9; n++) {
      await seed({
        shop_id: shopId,
        quote_no: formatQuoteNo(quoteNoPrefix({ year: YEAR }), n),
        financial_mode: FINANCIAL_MODE.LIVE,
      });
    }
    await seed({ shop_id: shopId, quote_no: 'QT-2099-010', financial_mode: FINANCIAL_MODE.PRE_ACCOUNTS });
    await seed({ shop_id: shopId, quote_no: 'QT-2099-011', financial_mode: FINANCIAL_MODE.PRE_ACCOUNTS });

    const skipped = await sequelize.transaction(async (t) => (
      allocateQuoteNumber({ year: YEAR, testMode: false, transaction: t })
    ));
    assertEqual(skipped, 'QT-2099-012', `expected skip to 012, got ${skipped}`);

    const testNo = await sequelize.transaction(async (t) => (
      allocateQuoteNumber({ year: YEAR, testMode: true, transaction: t })
    ));
    assertEqual(testNo, 'TEST-QT-2099-001', `TEST series must stay off LIVE QT- numbers, got ${testNo}`);

    await seed({ shop_id: shopId, quote_no: 'TEST-QT-2099-001', financial_mode: FINANCIAL_MODE.PRE_ACCOUNTS });
    const testNext = await sequelize.transaction(async (t) => (
      allocateQuoteNumber({ year: YEAR, testMode: true, transaction: t })
    ));
    assertEqual(testNext, 'TEST-QT-2099-002', `expected TEST-QT-2099-002, got ${testNext}`);

    await cleanup();
    await seed({ shop_id: shopId, quote_no: 'QT-2099-003', financial_mode: FINANCIAL_MODE.LIVE });
    const fromMax = await sequelize.transaction(async (t) => (
      allocateQuoteNumber({ year: YEAR, testMode: false, transaction: t })
    ));
    assertEqual(fromMax, 'QT-2099-004', `max live 003 → next 004, got ${fromMax}`);

    await seed({
      shop_id: shopId,
      quote_no: 'QT-2099-004',
      financial_mode: FINANCIAL_MODE.LIVE,
      deleted_at: new Date().toISOString(),
    });
    const afterDeleted = await sequelize.transaction(async (t) => (
      allocateQuoteNumber({ year: YEAR, testMode: false, transaction: t })
    ));
    assertEqual(afterDeleted, 'QT-2099-005', `soft-deleted 004 must not be reused, got ${afterDeleted}`);

    console.log('quotationSequence.test.js: ok');
  } finally {
    await cleanup();
    await sequelize.close();
  }
}

run().catch((err) => {
  console.error('quotationSequence.test.js FAILED', err);
  process.exit(1);
});
