/**
 * Go-live cleanup: remove PRE_ACCOUNTS practice documents so POS / estimations
 * / incomes / expenses start clean. Never deletes catalog products or changes
 * live stock_qty (test POS already writes no-op movements).
 */
import { Op } from 'sequelize';
import sequelize from '../db.js';
import {
  Invoice, InvoiceItem, Payment, CreditNote, OldGoldReceipt, OldGoldSale,
  Quotation, Expense, Income, CustomerAdvance, CustomerAdvanceApplication,
  JournalEntry, JournalLine, InventoryMovement, CashbookEntry, DraftSale,
} from '../models/index.js';
import { FINANCIAL_MODE } from './financialMode.js';
import { resetInvoiceSequencesAfterGoLive } from './invoiceSequence.js';

function shopOrUnscoped(shopId) {
  return shopId
    ? { [Op.or]: [{ shop_id: shopId }, { shop_id: null }] }
    : {};
}

function preAccountsWhere(shopId) {
  return {
    [Op.and]: [
      shopOrUnscoped(shopId),
      { financial_mode: FINANCIAL_MODE.PRE_ACCOUNTS },
    ],
  };
}

function practiceInvoiceWhere(shopId) {
  return {
    [Op.and]: [
      shopOrUnscoped(shopId),
      {
        [Op.or]: [
          { financial_mode: FINANCIAL_MODE.PRE_ACCOUNTS },
          { invoice_no: { [Op.like]: 'TEST-%' } },
        ],
      },
    ],
  };
}

/** Practice estimations: PRE_ACCOUNTS, TEST-* numbers, or live-style QT-* stamped as practice. */
function practiceQuotationWhere(shopId) {
  return {
    [Op.and]: [
      shopOrUnscoped(shopId),
      {
        [Op.or]: [
          { financial_mode: FINANCIAL_MODE.PRE_ACCOUNTS },
          { quote_no: { [Op.like]: 'TEST-%' } },
          {
            [Op.and]: [
              { financial_mode: FINANCIAL_MODE.PRE_ACCOUNTS },
              { quote_no: { [Op.like]: 'QT-%' } },
            ],
          },
        ],
      },
    ],
  };
}

async function idsOf(Model, where, transaction) {
  const rows = await Model.findAll({ where, attributes: ['id'], transaction }).catch(() => []);
  return (rows || []).map((r) => r.id).filter(Boolean);
}

/**
 * @returns {{ invoices: number, quotations: number, incomes: number, expenses: number, sequences: object }}
 */
export async function purgePreAccountsPracticeData(shopId, { transaction: outer } = {}) {
  if (!shopId) return { invoices: 0, quotations: 0, incomes: 0, expenses: 0 };

  const run = async (transaction) => {
    const invoiceIds = await idsOf(Invoice, practiceInvoiceWhere(shopId), transaction);
    const quotationIds = await idsOf(Quotation, practiceQuotationWhere(shopId), transaction);
    const incomeIds = await idsOf(Income, preAccountsWhere(shopId), transaction);
    const expenseIds = await idsOf(Expense, preAccountsWhere(shopId), transaction);

    const journalWhere = {
      [Op.and]: [
        shopOrUnscoped(shopId),
        { financial_mode: FINANCIAL_MODE.PRE_ACCOUNTS },
        { [Op.or]: [{ is_opening: false }, { is_opening: { [Op.is]: null } }] },
        { source_type: { [Op.ne]: 'opening_balance' } },
      ],
    };
    const journalIds = await idsOf(JournalEntry, journalWhere, transaction);

    if (journalIds.length) {
      await JournalLine.destroy({ where: { journal_entry_id: { [Op.in]: journalIds } }, transaction });
      await JournalEntry.destroy({ where: { id: { [Op.in]: journalIds } }, transaction });
    }

    if (invoiceIds.length) {
      const [practiceOnly] = await sequelize.query(
        `SELECT DISTINCT ii.product_id AS id
         FROM invoice_items ii
         WHERE ii.invoice_id IN (:ids)
           AND ii.product_id IS NOT NULL
           AND ii.product_id NOT IN (
             SELECT DISTINCT ii2.product_id
             FROM invoice_items ii2
             INNER JOIN invoices i2 ON i2.id = ii2.invoice_id
             WHERE (i2.financial_mode IS NULL OR i2.financial_mode != :pre)
               AND ii2.product_id IS NOT NULL
           )`,
        { replacements: { ids: invoiceIds, pre: FINANCIAL_MODE.PRE_ACCOUNTS }, transaction },
      );
      const restoreIds = (practiceOnly || []).map((r) => r.id || r.ID).filter(Boolean);
      if (restoreIds.length) {
        const { Product } = await import('../models/index.js');
        await Product.update(
          { status: 'available' },
          {
            where: {
              id: { [Op.in]: restoreIds },
              status: { [Op.in]: ['sold', 'deleted_p', 'estimation', 'reserved'] },
              stock_qty: { [Op.gt]: 0 },
            },
            transaction,
          },
        );
      }

      await InvoiceItem.destroy({ where: { invoice_id: { [Op.in]: invoiceIds } }, transaction }).catch(() => 0);
      await CustomerAdvanceApplication.destroy({
        where: { invoice_id: { [Op.in]: invoiceIds } },
        transaction,
      }).catch(() => 0);
      await Payment.destroy({ where: { invoice_id: { [Op.in]: invoiceIds } }, transaction }).catch(() => 0);
      await CreditNote.destroy({ where: { invoice_id: { [Op.in]: invoiceIds } }, transaction }).catch(() => 0);
      await OldGoldReceipt.destroy({ where: { invoice_id: { [Op.in]: invoiceIds } }, transaction }).catch(() => 0);
      await InventoryMovement.destroy({
        where: { reference_id: { [Op.in]: invoiceIds } },
        transaction,
      }).catch(() => 0);
      await Invoice.destroy({ where: { id: { [Op.in]: invoiceIds } }, transaction });
    }

    await Payment.destroy({ where: preAccountsWhere(shopId), transaction }).catch(() => 0);
    const advanceIds = await idsOf(CustomerAdvance, preAccountsWhere(shopId), transaction);
    if (advanceIds.length) {
      await CustomerAdvanceApplication.destroy({
        where: { advance_id: { [Op.in]: advanceIds } },
        transaction,
      }).catch(() => 0);
      await CustomerAdvance.destroy({ where: { id: { [Op.in]: advanceIds } }, transaction }).catch(() => 0);
    }
    await OldGoldSale.destroy({ where: preAccountsWhere(shopId), transaction }).catch(() => 0);
    await CashbookEntry.destroy({ where: preAccountsWhere(shopId), transaction }).catch(() => 0);

    if (quotationIds.length) {
      const { releaseQuotationBookingReserves } = await import('./inventoryService.js');
      const quotes = await Quotation.findAll({
        where: { id: { [Op.in]: quotationIds } },
        attributes: ['id', 'items'],
        transaction,
      }).catch(() => []);
      for (const q of quotes || []) {
        let items = q.items;
        if (typeof items === 'string') {
          try { items = JSON.parse(items); } catch { items = []; }
        }
        const productIds = [...new Set((Array.isArray(items) ? items : []).map((it) => it?.product_id).filter(Boolean))];
        if (productIds.length) {
          await releaseQuotationBookingReserves({
            shopId,
            quotationId: q.id,
            productIds,
            transaction,
          }).catch(() => 0);
        }
      }
      await Quotation.destroy({ where: { id: { [Op.in]: quotationIds } }, transaction });
    }
    if (incomeIds.length) {
      await Income.destroy({ where: { id: { [Op.in]: incomeIds } }, transaction });
    }
    if (expenseIds.length) {
      await Expense.destroy({ where: { id: { [Op.in]: expenseIds } }, transaction });
    }

    await DraftSale.destroy({ where: shopOrUnscoped(shopId), transaction }).catch(() => 0);

    const sequences = await resetInvoiceSequencesAfterGoLive(shopId, { transaction });
    return {
      invoices: invoiceIds.length,
      quotations: quotationIds.length,
      incomes: incomeIds.length,
      expenses: expenseIds.length,
      sequences,
    };
  };

  if (outer) return run(outer);
  return sequelize.transaction((t) => run(t));
}
