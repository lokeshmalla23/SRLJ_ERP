import { Op } from 'sequelize';
import { Invoice, Customer } from '../../models/index.js';
import { toMoneyNumber } from '../../utils/money.js';
import { hydrateInvoiceItems, invoiceItemsOf, invoicePaymentsOf } from '../../utils/invoiceRead.js';
import { invoiceDateRangeWhere } from '../../utils/reportQuery.js';
import { NOT_VOID_OR_RETURNED, wantsHiddenBills, NOT_HIDDEN_INVOICE } from '../../utils/invoiceVisibility.js';
import { excludePreAccountsWhere } from '../../services/financialMode.js';
import { buildDaySnapshot } from '../../services/dailyClosingService.js';
import { round3 } from '../../services/metalClassify.js';

function normalizePayMode(mode) {
  const m = String(mode || '').toLowerCase().trim();
  if (m === 'bank_transfer' || m === 'neft' || m === 'rtgs' || m === 'imps' || m === 'bank') return 'bank';
  if (m === 'cheque' || m === 'check') return 'cheque';
  if (m === 'upi' || m === 'gpay' || m === 'phonepe' || m === 'paytm') return 'upi';
  if (m === 'cash') return 'cash';
  if (m === 'old_gold_exchange' || m === 'old_gold' || m === 'exchange') return 'old_gold';
  if (m === 'old_silver_exchange' || m === 'old_silver') return 'old_silver';
  return m;
}

function emptyPays() {
  return { cash: 0, upi: 0, bank: 0, cheque: 0, old_gold: 0, old_silver: 0 };
}

function paysFromInvoice(inv) {
  const out = emptyPays();
  for (const p of invoicePaymentsOf(inv)) {
    const mode = normalizePayMode(p.mode || p.payment_mode);
    const amt = toMoneyNumber(p.amount);
    if (!(amt > 0)) continue;
    if (out[mode] != null) out[mode] = toMoneyNumber(out[mode] + amt);
  }
  const og = toMoneyNumber(inv.old_gold_value);
  const os = toMoneyNumber(inv.old_silver_value);
  if (og > out.old_gold) out.old_gold = og;
  if (os > out.old_silver) out.old_silver = os;
  return out;
}

function lineWeight(item, field) {
  const qty = Number(item?.quantity) || 1;
  const raw = Number(item?.[field] ?? 0) || 0;
  const isTray = item?.tray_weight_sold != null || item?.is_tray;
  const isPure = item?.is_pure_metal || item?.line_type === 'pure_metal';
  return round3(isTray || isPure ? raw : raw * (qty > 0 ? qty : 1));
}

function tagOf(item) {
  return String(
    item?.barcode
    || item?.tag_number
    || item?.tag_no
    || item?.code
    || '',
  ).trim();
}

function metalOf(item) {
  return String(item?.metal_name || item?.metal || item?.metal_type || '').trim() || 'Other';
}

function customerCode(serialNo) {
  if (serialNo == null || serialNo === '') return null;
  return `CUST-${String(serialNo).padStart(3, '0')}`;
}

function pocketRow(finalCheck, type) {
  const p = finalCheck?.[type] || {};
  const opening = toMoneyNumber(p.opening);
  const closing = p.counted != null && p.counted !== ''
    ? toMoneyNumber(p.counted)
    : toMoneyNumber(p.expected);
  return { type, opening, closing };
}

// GET /api/reports/day-closing?date=YYYY-MM-DD
export const getDayClosingReport = async (req, res, next) => {
  try {
    const dateStr = String(req.query.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ detail: 'date must be YYYY-MM-DD' });
    }

    const includeHidden = wantsHiddenBills({ ...req.query, _role: req.user?.role });
    const dateWhere = invoiceDateRangeWhere({ from: dateStr, to: dateStr });
    const and = [
      dateWhere,
      { status: NOT_VOID_OR_RETURNED },
      excludePreAccountsWhere(),
    ];
    if (!includeHidden) and.push(NOT_HIDDEN_INVOICE);
    const where = { [Op.and]: and };

    const invoices = await Invoice.findAll({
      where,
      order: [['created_at', 'ASC'], ['invoice_no', 'ASC']],
    });
    await hydrateInvoiceItems(invoices);

    const customerIds = [...new Set(invoices.map((i) => i.customer_id).filter(Boolean))];
    const customers = customerIds.length
      ? await Customer.findAll({
        where: { id: { [Op.in]: customerIds } },
        attributes: ['id', 'serial_no', 'name'],
      })
      : [];
    const customerById = new Map(customers.map((c) => [c.id, c]));

    const rows = [];
    const metalMap = new Map();
    const uniquePays = emptyPays();
    let invoiceAmountTotal = 0;
    let grossTotal = 0;
    let netTotal = 0;

    for (const inv of invoices) {
      const json = typeof inv.toJSON === 'function' ? inv.toJSON() : inv;
      const items = invoiceItemsOf(inv);
      const pays = paysFromInvoice(inv);
      const cust = customerById.get(inv.customer_id);
      const invoiceAmount = toMoneyNumber(json.grand_total);
      invoiceAmountTotal = toMoneyNumber(invoiceAmountTotal + invoiceAmount);
      for (const k of Object.keys(uniquePays)) {
        uniquePays[k] = toMoneyNumber(uniquePays[k] + pays[k]);
      }

      const lines = items.length ? items : [{}];
      lines.forEach((item, idx) => {
        const isFirst = idx === 0;
        const gross = lineWeight(item, 'gross_weight');
        const net = lineWeight(item, 'net_weight');
        grossTotal = round3(grossTotal + gross);
        netTotal = round3(netTotal + net);
        const metal = metalOf(item);
        const bucket = metalMap.get(metal) || { metal_type: metal, gross_weight: 0, net_weight: 0 };
        bucket.gross_weight = round3(bucket.gross_weight + gross);
        bucket.net_weight = round3(bucket.net_weight + net);
        metalMap.set(metal, bucket);

        rows.push({
          id: `${inv.id}:${idx}`,
          invoice_id: inv.id,
          invoice_no: json.invoice_no || '',
          customer_id: customerCode(cust?.serial_no) || '—',
          customer_name: cust?.name || json.customer_name || '',
          status: json.status || '',
          tag_no: tagOf(item),
          metal_type: metal === 'Other' && !item?.metal_name && !item?.metal ? '' : metal,
          category: item?.category_name || item?.category || '',
          subcategory: item?.subcategory_name || item?.subcategory || '',
          gross_weight: gross,
          net_weight: net,
          invoice_amount: isFirst ? invoiceAmount : 0,
          by_cash: isFirst ? pays.cash : 0,
          by_upi: isFirst ? pays.upi : 0,
          by_bank: isFirst ? pays.bank : 0,
          by_cheque: isFirst ? pays.cheque : 0,
          by_old_gold: isFirst ? pays.old_gold : 0,
          by_old_silver: isFirst ? pays.old_silver : 0,
        });
      });
    }

    const snapshot = await buildDaySnapshot(dateStr, { includeHidden, skipFrozen: true });
    const fc = snapshot?.final_check || {};

    const totals = {
      invoice_amount: toMoneyNumber(invoiceAmountTotal),
      gross_weight: round3(grossTotal),
      net_weight: round3(netTotal),
      by_cash: uniquePays.cash,
      by_upi: uniquePays.upi,
      by_bank: uniquePays.bank,
      by_cheque: uniquePays.cheque,
      by_old_gold: uniquePays.old_gold,
      by_old_silver: uniquePays.old_silver,
    };

    return res.json({
      date: dateStr,
      include_hidden: includeHidden,
      data: rows,
      totals,
      day_close: {
        cash: pocketRow(fc, 'cash'),
        upi: pocketRow(fc, 'upi'),
        bank: pocketRow(fc, 'bank'),
        cheque: pocketRow(fc, 'cheque'),
      },
      sales_by_metal: [...metalMap.values()].sort((a, b) => a.metal_type.localeCompare(b.metal_type)),
      invoice_count: invoices.length,
      line_count: rows.length,
    });
  } catch (err) {
    next(err);
  }
};
