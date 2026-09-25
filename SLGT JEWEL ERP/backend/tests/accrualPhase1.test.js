/**
 * Phase 1 full-accrual accounting matrix.
 * Run: node backend/tests/accrualPhase1.test.js
 */
import 'dotenv/config';
import sequelize from '../src/db.js';
import {
  Shop, Product, Setting, Invoice, Payment, Customer, CustomerAdvance,
  JournalEntry, JournalLine, ChartOfAccount, Expense, Purchase, Vendor,
} from '../src/models/index.js';
import { createInvoice, cancelInvoice } from '../src/services/billingService.js';
import { receiveAdvance } from '../src/services/advanceService.js';
import { createPartialReturn } from '../src/services/returnService.js';
import { calcLineAmounts, calcInvoiceTotals } from '../src/services/billingCalc.js';
import { INVENTORY_MODES, MOVEMENT_TYPES } from '../src/constants/inventory.js';
import { newId } from '../src/utils.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';
import { recordMovement } from '../src/services/inventoryService.js';
import {
  ensureDefaultAccounts,
  __testForceNextJournalFail,
  accountBalances,
  postOpeningBalanceVoucher,
} from '../src/services/ledgerService.js';
import { accountingIntegrityCheck } from '../src/services/accountingControlsService.js';
import { assessHistoricalAccounting } from '../src/services/accountingCutoverService.js';
import { toMoneyNumber } from '../src/utils/money.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function linePreview(overrides = {}) {
  return calcLineAmounts({
    net_weight: 10,
    gross_weight: 11,
    wastage_pct: 0,
    making_charges: 500,
    making_charge_type: 'fixed',
    ...overrides,
  }, 6400);
}

async function ensureGold() {
  const s = await Setting.findOne({ where: { key: 'gold_rate' } });
  if (!s) {
    await Setting.create({
      id: newId(),
      key: 'gold_rate',
      value: { gold_24k: 7000, gold_22k: 6400 },
    });
  }
}

async function makeUnique(shopId, { purchasePrice = 50000 } = {}) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: `Accrual UQ ${Date.now()}`,
    barcode: `AU-${newId().slice(0, 8)}`,
    stock_qty: 1,
    inventory_mode: INVENTORY_MODES.UNIQUE_TAG,
    status: 'available',
    net_weight: 10,
    gross_weight: 11,
    making_charges: 500,
    making_charge_type: 'fixed',
    purchase_price: purchasePrice,
    hsn_code: '7113',
  });
  await sequelize.transaction(async (t) => {
    await recordMovement({
      shopId, product: p, movementType: MOVEMENT_TYPES.OPENING,
      quantity: 1, qtyBefore: 0, qtyAfter: 1,
      referenceType: 'test', transaction: t,
    });
  });
  return p;
}

async function journalLines(sourceType, sourceId) {
  const je = await JournalEntry.findOne({ where: { source_type: sourceType, source_id: sourceId } });
  if (!je) return { found: false, lines: [], debit: 0, credit: 0, balanced: false, byCode: {} };
  const lines = await JournalLine.findAll({ where: { journal_entry_id: je.id } });
  const accounts = await ChartOfAccount.findAll({ where: { shop_id: je.shop_id } });
  const byId = new Map(accounts.map((a) => [a.id, a.code]));
  let debit = 0;
  let credit = 0;
  const byCode = {};
  for (const l of lines) {
    const code = byId.get(l.account_id) || '?';
    const d = (Number(l.debit_paise) || 0) / 100;
    const c = (Number(l.credit_paise) || 0) / 100;
    debit += d;
    credit += c;
    byCode[code] = byCode[code] || { debit: 0, credit: 0 };
    byCode[code].debit += d;
    byCode[code].credit += c;
  }
  return {
    found: true,
    je,
    lines,
    debit: toMoneyNumber(debit),
    credit: toMoneyNumber(credit),
    balanced: Math.abs(debit - credit) < 0.02,
    byCode,
  };
}

async function run() {
  await sequelize.authenticate();
  clearDefaultShopCache();
  await ensureGold();
  try {
    await JournalEntry.sync({ alter: false });
    await ChartOfAccount.sync({ alter: false });
  } catch { /* */ }

  const shop = await Shop.findOne({ order: [['created_at', 'ASC']] });
  assert(shop, 'shop required');
  await ensureDefaultAccounts(shop.id);

  console.log('1) Cash sale → Sales + Output GST + Cash');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const { invoice } = await createInvoice({
      request_id: `acc-cash-${newId()}`,
      items: [{ product_id: p.id, quantity: 1 }],
      gold_rate: 6400,
      payments: [{ mode: 'cash', amount: totals.grand_total }],
    });
    const j = await journalLines('sale_invoice', invoice.id);
    assert(j.found, 'sale_invoice journal');
    assert(j.balanced, `balanced ${j.debit} vs ${j.credit}`);
    assert((j.byCode['4000']?.credit || 0) > 0, 'Sales credited');
    assert((j.byCode['2100']?.credit || 0) > 0, 'Output GST credited');
    assert((j.byCode['1000']?.debit || 0) > 0, 'Cash debited');
    const cogs = await journalLines('sale_cogs', invoice.id);
    assert(cogs.found, 'COGS journal when purchase_price set');
    assert(cogs.balanced, 'COGS balanced');
    assert((cogs.byCode['5000']?.debit || 0) > 0, 'COGS debit');
    assert((cogs.byCode['1200']?.credit || 0) > 0, 'Inventory credit');
  }

  console.log('2) Credit sale → AR + Sales + GST; collect clears AR');
  {
    const cust = await Customer.create({
      id: newId(),
      shop_id: shop.id,
      name: 'Credit Cust',
      mobile: `9${String(Date.now()).slice(-9)}`,
    });
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const payAmt = toMoneyNumber(totals.grand_total / 2);
    const { invoice } = await createInvoice({
      request_id: `acc-cr-${newId()}`,
      customer_id: cust.id,
      allow_partial: true,
      items: [{ product_id: p.id, quantity: 1 }],
      gold_rate: 6400,
      payments: [{ mode: 'upi', amount: payAmt }],
    });
    assert(Number(invoice.balance_due) > 0, 'balance_due');
    const j = await journalLines('sale_invoice', invoice.id);
    assert(j.found && j.balanced, 'credit sale journal');
    assert((j.byCode['1100']?.debit || 0) > 0, 'AR debited');
    assert((j.byCode['1020']?.debit || 0) > 0, 'UPI debited');

    const due = Number(invoice.balance_due);
    const { postCreditPaymentJournal } = await import('../src/services/ledgerService.js');
    await sequelize.transaction(async (t) => {
      await Payment.create({
        id: newId(),
        shop_id: shop.id,
        invoice_id: invoice.id,
        customer_id: cust.id,
        mode: 'cash',
        amount: due,
        amount_paise: Math.round(due * 100),
        status: 'posted',
        paid_at: new Date(),
      }, { transaction: t });
      await postCreditPaymentJournal({
        shopId: shop.id,
        invoiceId: invoice.id,
        amount: due,
        mode: 'cash',
        requestId: `acc-collect-${invoice.id}`,
        transaction: t,
      });
      await invoice.update({ balance_due: 0, status: 'paid' }, { transaction: t });
    });
    const collect = await JournalEntry.findOne({
      where: { source_type: 'credit_payment', source_id: invoice.id },
    });
    assert(collect, 'credit_payment journal');
  }

  console.log('3) Advance receive + apply on invoice');
  {
    const cust = await Customer.create({
      id: newId(),
      shop_id: shop.id,
      name: 'Adv Cust',
      mobile: `9${String(Date.now() + 1).slice(-9)}`,
    });
    const adv = await receiveAdvance({
      customerId: cust.id,
      amount: 5000,
      mode: 'cash',
      requestId: `acc-adv-${newId()}`,
      shopId: shop.id,
    });
    const advJ = await journalLines('customer_advance', adv.id);
    assert(advJ.found && advJ.balanced, 'advance receive journal');
    assert((advJ.byCode['2000']?.credit || 0) === 5000, 'advance liability');

    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const advAmt = Math.min(5000, totals.grand_total);
    const cash = toMoneyNumber(totals.grand_total - advAmt);
    const { invoice } = await createInvoice({
      request_id: `acc-adv-inv-${newId()}`,
      customer_id: cust.id,
      items: [{ product_id: p.id, quantity: 1 }],
      gold_rate: 6400,
      payments: [
        { mode: 'advance', amount: advAmt },
        ...(cash > 0 ? [{ mode: 'cash', amount: cash }] : []),
      ],
    });
    const j = await journalLines('sale_invoice', invoice.id);
    assert(j.found && j.balanced, 'sale with advance');
    assert((j.byCode['2000']?.debit || 0) > 0, 'advance applied debit');
  }

  console.log('4) Old gold on invoice (settled as a payment, not a deduction)');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const og = 200;
    // Old Gold no longer reduces grand_total — cash only needs to cover what's left.
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const cash = Math.max(0, Math.round((totals.grand_total - og) * 100) / 100);
    const { invoice } = await createInvoice({
      request_id: `acc-og-${newId()}`,
      items: [{ product_id: p.id, quantity: 1 }],
      old_gold_value: og,
      gold_rate: 6400,
      payments: cash > 0 ? [{ mode: 'cash', amount: cash }] : [],
    });
    const j = await journalLines('sale_invoice', invoice.id);
    assert(j.found && j.balanced, 'OG sale journal');
    assert((j.byCode['1300']?.debit || 0) === og, 'OG stock debit');
    assert(Number(invoice.grand_total) === totals.grand_total, 'grand_total unaffected by old gold');
  }

  console.log('5) Purchase + supplier payment (ITC + AP clear)');
  {
    const vendor = await Vendor.create({
      id: newId(),
      shop_id: shop.id,
      name: `Vendor ${Date.now()}`,
      outstanding_balance: 0,
      total_purchases: 0,
    });
    const purchaseId = newId();
    const subtotal = 10000;
    const gst = 300;
    const grand = 10300;
    await sequelize.transaction(async (t) => {
      await Purchase.create({
        id: purchaseId,
        shop_id: shop.id,
        po_number: `PO-${Date.now()}`,
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        purchase_date: new Date().toISOString().slice(0, 10),
        purchase_type: 'finished_goods',
        items: [],
        subtotal,
        gst_pct: 3,
        gst_amount: gst,
        grand_total: grand,
        paid_amount: 0,
        balance: grand,
        payments: [],
        status: 'pending',
      }, { transaction: t });
      const { postPurchaseJournal, postPurchasePaymentJournal } = await import('../src/services/ledgerService.js');
      await postPurchaseJournal({
        shopId: shop.id,
        purchaseId,
        inventoryAmount: subtotal,
        gstAmount: gst,
        paidAmount: 0,
        requestId: `acc-pur-${purchaseId}`,
        transaction: t,
      });
      await postPurchasePaymentJournal({
        shopId: shop.id,
        purchaseId,
        amount: grand,
        mode: 'bank_transfer',
        requestId: `acc-pur-pay-${purchaseId}`,
        transaction: t,
      });
    });
    const pj = await journalLines('purchase', purchaseId);
    assert(pj.found && pj.balanced, 'purchase journal');
    assert((pj.byCode['1400']?.debit || 0) === gst, 'Input GST');
    assert((pj.byCode['1200']?.debit || 0) === subtotal, 'Inventory');
    assert((pj.byCode['2200']?.credit || 0) === grand, 'AP');
    const payJ = await journalLines('purchase_payment', purchaseId);
    assert(payJ.found && payJ.balanced, 'purchase payment');
    assert((payJ.byCode['2200']?.debit || 0) === grand, 'AP cleared');
  }

  console.log('6) Expense posts to GL');
  {
    const expenseId = newId();
    await sequelize.transaction(async (t) => {
      await Expense.create({
        id: expenseId,
        shop_id: shop.id,
        description: 'Test rent',
        amount: 1000,
        payment_mode: 'cash',
        date: new Date().toISOString().slice(0, 10),
      }, { transaction: t });
      const { postExpenseJournal } = await import('../src/services/ledgerService.js');
      await postExpenseJournal({
        shopId: shop.id,
        expenseId,
        amount: 1000,
        mode: 'cash',
        requestId: `acc-exp-${expenseId}`,
        transaction: t,
      });
    });
    const j = await journalLines('expense', expenseId);
    assert(j.found && j.balanced, 'expense journal');
    assert((j.byCode['5100']?.debit || 0) === 1000, 'expense debit');
  }

  console.log('7) Return posts Sales Returns + GST reverse');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const { invoice } = await createInvoice({
      request_id: `acc-ret-inv-${newId()}`,
      items: [{ product_id: p.id, quantity: 1 }],
      gold_rate: 6400,
      payments: [{ mode: 'cash', amount: totals.grand_total }],
    });
    const { credit_note: cn } = await createPartialReturn(invoice.id, {
      lines: [{ product_id: p.id, quantity: 1 }],
      reason: 'accrual test return',
      request_id: `acc-ret-${newId()}`,
    });
    const j = await journalLines('credit_note', cn.id);
    assert(j.found && j.balanced, 'credit note journal');
    assert((j.byCode['4100']?.debit || 0) > 0, 'sales returns');
  }

  console.log('8) Cancel reverses sale journals');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const { invoice } = await createInvoice({
      request_id: `acc-can-${newId()}`,
      items: [{ product_id: p.id, quantity: 1 }],
      gold_rate: 6400,
      payments: [{ mode: 'cash', amount: totals.grand_total }],
    });
    await cancelInvoice(invoice.id, { user: { id: 'test' }, reason: 'accrual cancel' });
    const rev = await JournalEntry.findOne({
      where: { source_type: 'reverse_sale_invoice', source_id: invoice.id },
    });
    assert(rev, 'reverse_sale_invoice present');
    const cancelled = await Invoice.findByPk(invoice.id);
    assert(cancelled.status === 'cancelled', 'cancelled');
  }

  console.log('9) Journal failure rolls back invoice');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    __testForceNextJournalFail();
    const before = await Invoice.count();
    let failed = false;
    try {
      await createInvoice({
        request_id: `acc-fail-${newId()}`,
        items: [{ product_id: p.id, quantity: 1 }],
        gold_rate: 6400,
        payments: [{ mode: 'cash', amount: totals.grand_total }],
      });
    } catch (err) {
      failed = /INJECTED_JOURNAL_FAIL/.test(String(err.message));
    }
    assert(failed, 'journal fail propagated');
    assert(await Invoice.count() === before, 'invoice rolled back');
    const refreshed = await Product.findByPk(p.id);
    assert(refreshed.status === 'available', 'tag unsold');
  }

  console.log('10) Opening voucher balances + assessment');
  {
    const assessment = await assessHistoricalAccounting(shop.id);
    assert(assessment.strategy === 'cutover_opening_balances', 'cutover strategy');
    assert(assessment.classification.some((c) => c.status === 'not_safe'), 'not_safe class present');

    await sequelize.transaction(async (t) => {
      await postOpeningBalanceVoucher({
        shopId: shop.id,
        entryDate: '2099-01-01',
        lines: [
          { accountCode: '1000', debit: 1000, credit: 0 },
          { accountCode: '1100', debit: 500, credit: 0 },
        ],
        requestId: `acc-ob-${newId()}`,
        transaction: t,
      });
    });
    const ob = await JournalEntry.findOne({
      where: { source_type: 'opening_balance', source_id: 'opening:2099-01-01' },
    });
    assert(ob?.is_opening, 'is_opening flag');
    const lines = await journalLines('opening_balance', 'opening:2099-01-01');
    assert(lines.balanced, 'opening balanced via equity plug');
  }

  console.log('11) Integrity / TB');
  {
    const integrity = await accountingIntegrityCheck({ shopId: shop.id });
    assert(integrity.trial_balance, 'tb present');
    // May warn on AR/AP controls due to mixed legacy data — TB should still be math-balanced
    assert(typeof integrity.trial_balance.balanced === 'boolean', 'balanced flag');
    const bals = await accountBalances({ shopId: shop.id });
    let dr = 0;
    let cr = 0;
    for (const r of bals) {
      dr += r.debit;
      cr += r.credit;
    }
    assert(Math.abs(dr - cr) < 0.05, `accountBalances Dr≈Cr (${dr} vs ${cr})`);
  }

  console.log('All Phase 1 accrual checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
}).then(() => process.exit(0));
