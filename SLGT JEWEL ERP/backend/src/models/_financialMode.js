import { DataTypes } from 'sequelize';
import { stampOnTransactionDate } from '../utils/invoiceRead.js';

export const FINANCIAL_MODE = Object.freeze({
  PRE_ACCOUNTS: 'PRE_ACCOUNTS',
  LIVE: 'LIVE',
});

/** Added to financial models only — never inventory/product masters. */
export const financialModeField = {
  financial_mode: { type: DataTypes.STRING(32), allowNull: true },
};

function pinCreatedAtToTransactionDate(instance) {
  const fields = ['business_date', 'date', 'purchase_date', 'entry_date'];
  let ymd = null;
  for (const f of fields) {
    let v;
    try {
      v = typeof instance.get === 'function' ? instance.get(f) : instance[f];
    } catch {
      v = instance[f];
    }
    if (v != null && v !== '') {
      ymd = v;
      break;
    }
  }
  if (!ymd) return;
  let clock = new Date();
  try {
    clock = instance.paid_at || instance.booked_at || instance.created_at || instance.createdAt || clock;
  } catch {
    /* keep now */
  }
  const stamped = stampOnTransactionDate(ymd, clock);
  try {
    instance.set('createdAt', stamped);
  } catch {
    instance.createdAt = stamped;
    instance.created_at = stamped;
  }
  if (instance.paid_at) {
    try { instance.set('paid_at', stampOnTransactionDate(ymd, instance.paid_at)); } catch { /* */ }
  }
  if (instance.booked_at) {
    try { instance.set('booked_at', stampOnTransactionDate(ymd, instance.booked_at)); } catch { /* */ }
  }
}

/**
 * Stamp new financial rows with the current shop mode unless the caller
 * already set financial_mode (e.g. inherit from a parent invoice, or LIVE opening voucher).
 *
 * options.inheritInvoiceIdField / inheritAdvanceIdField: child rows (payments,
 * credit notes, applications) keep the parent's TEST/LIVE classification so a
 * later go-live cannot turn a test refund into a LIVE journal.
 */
export function attachFinancialModeHook(Model, options = {}) {
  Model.addHook('beforeCreate', async (instance, hookOptions) => {
    pinCreatedAtToTransactionDate(instance);
    if (instance.financial_mode) return;
    const tx = hookOptions?.transaction;

    const invoiceIdField = options.inheritInvoiceIdField;
    if (invoiceIdField && instance[invoiceIdField]) {
      const { Invoice } = await import('./Invoice.js');
      const parent = await Invoice.findByPk(instance[invoiceIdField], {
        attributes: ['financial_mode'],
        transaction: tx,
      });
      if (parent?.financial_mode) {
        instance.financial_mode = parent.financial_mode;
        return;
      }
    }

    const advanceIdField = options.inheritAdvanceIdField;
    if (advanceIdField && instance[advanceIdField]) {
      const { CustomerAdvance } = await import('./CustomerAdvance.js');
      const parent = await CustomerAdvance.findByPk(instance[advanceIdField], {
        attributes: ['financial_mode'],
        transaction: tx,
      });
      if (parent?.financial_mode) {
        instance.financial_mode = parent.financial_mode;
        return;
      }
    }

    const { resolveFinancialMode } = await import('../services/financialMode.js');
    instance.financial_mode = await resolveFinancialMode(instance.shop_id || null, {
      transaction: tx,
    });
  });
}
