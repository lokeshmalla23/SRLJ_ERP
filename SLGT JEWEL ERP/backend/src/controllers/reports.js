import { Op } from 'sequelize';
import { Invoice, Product, CreditNote } from '../models/index.js';
import { toMoneyNumber, sumMoney } from '../utils/money.js';
import { parseJsonField } from '../utils.js';
import { withNotHidden, wantsHiddenBills, NOT_VOID_OR_RETURNED } from '../utils/invoiceVisibility.js';
import { hydrateInvoiceItems, invoiceItemsOf } from '../utils/invoiceRead.js';
import { invoiceDateRangeWhere } from '../utils/reportQuery.js';
import { NOT_IN_STOCK_STATUSES } from '../constants/inventory.js';
import { excludePreAccountsWhere } from '../services/financialMode.js';
import { getHiddenReportsData } from '../services/hiddenReportsService.js';
import { stockCostValue } from '../services/productCost.js';

// GET /api/reports/sales
export const getSalesReport = async (req, res, next) => {
  try {
    // Filter by the invoice's active business day (Transaction date), not its
    // real created_at timestamp — a sale entered under a backdated/held-open
    // transaction date must show up when that date is selected, not whatever
    // day the real clock said it was typed in. See invoiceDateRangeWhere.
    const where = {
      ...invoiceDateRangeWhere(req.query),
      status: NOT_VOID_OR_RETURNED,
      ...excludePreAccountsWhere(),
    };
    const includeHidden = wantsHiddenBills({ ...req.query, _role: req.user?.role });

    const invoices = await Invoice.findAll({
      where: includeHidden ? where : withNotHidden(where),
      order: [['created_at', 'DESC']],
    });
    await hydrateInvoiceItems(invoices);
    const invoiceList = invoices.map((i) => {
      const json = i.toJSON();
      json.items = invoiceItemsOf(i);
      json.payments = parseJsonField(json.payments ?? i.payments, []);
      json.created_at = json.created_at || json.createdAt;
      return json;
    });

    const subtotal = toMoneyNumber(sumMoney(invoiceList.map((i) => i.subtotal)));
    const discount = toMoneyNumber(sumMoney(invoiceList.map((i) => i.discount)));
    const gstAmount = toMoneyNumber(sumMoney(invoiceList.map((i) => i.gst_amount)));
    const cgstAmount = toMoneyNumber(sumMoney(invoiceList.map((i) => i.cgst_amount)));
    const sgstAmount = toMoneyNumber(sumMoney(invoiceList.map((i) => i.sgst_amount)));
    const grandTotal = toMoneyNumber(sumMoney(invoiceList.map((i) => i.grand_total)));

    const totals = {
      count: invoiceList.length,
      subtotal,
      discount,
      gst_amount: gstAmount,
      gst_collected: gstAmount,
      cgst_amount: cgstAmount,
      sgst_amount: sgstAmount,
      grand_total: grandTotal,
    };

    return res.json({ invoices: invoiceList, totals });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/gst — HSN-wise using invoice tax snapshots + credit note offsets
export const getGstReport = async (req, res, next) => {
  try {
    // See getSalesReport above — filter by the invoice's business day, not its
    // real created_at timestamp.
    const where = { ...invoiceDateRangeWhere(req.query), status: NOT_VOID_OR_RETURNED };
    const includeHidden = wantsHiddenBills({ ...req.query, _role: req.user?.role });
    const invoices = await Invoice.findAll({ where: includeHidden ? where : withNotHidden(where) });
    await hydrateInvoiceItems(invoices);
    const byHsn = {};
    const bump = (hsn, taxable, gst, sign = 1) => {
      if (!byHsn[hsn]) byHsn[hsn] = { hsn_code: hsn, taxable: 0, gst: 0, cgst: 0, sgst: 0, lines: 0 };
      byHsn[hsn].taxable += sign * taxable;
      byHsn[hsn].gst += sign * gst;
      byHsn[hsn].cgst += sign * (gst / 2);
      byHsn[hsn].sgst += sign * (gst / 2);
      byHsn[hsn].lines += 1;
    };

    for (const inv of invoices) {
      const items = invoiceItemsOf(inv);
      const invGstPct = inv.gst_pct != null ? Number(inv.gst_pct) : null;
      for (const it of items) {
        const hsn = it.hsn_code || '7113';
        const lineGst = it.gst_amount != null ? Number(it.gst_amount) : null;
        const lineTotal = Number(it.line_total) || 0;
        const gstPct = it.gst_pct != null ? Number(it.gst_pct) : invGstPct;
        let taxable;
        let gst;
        if (lineGst != null && Number.isFinite(lineGst)) {
          gst = lineGst;
          taxable = lineTotal - gst;
        } else if (gstPct != null && Number.isFinite(gstPct) && gstPct > 0) {
          taxable = lineTotal / (1 + gstPct / 100);
          gst = lineTotal - taxable;
        } else {
          taxable = lineTotal;
          gst = items.indexOf(it) === 0 ? (Number(inv.gst_amount) || 0) : 0;
        }
        bump(hsn, taxable, gst, 1);
      }
    }

    const cnWhere = invoiceDateRangeWhere(req.query);
    let creditNotes = [];
    try {
      creditNotes = await CreditNote.findAll({ where: cnWhere });
    } catch {
      creditNotes = [];
    }
    for (const cn of creditNotes) {
      const hsn = cn.hsn_code || '7113';
      const gst = Number(cn.gst_amount) || 0;
      const taxBase = cn.subtotal != null
        ? Number(cn.subtotal)
        : ((Number(cn.grand_total) || 0) - gst);
      bump(hsn, taxBase, gst, -1);
    }

    const rows = Object.values(byHsn).map((r) => ({
      ...r,
      taxable: toMoneyNumber(r.taxable),
      gst: toMoneyNumber(r.gst),
      cgst: toMoneyNumber(r.cgst),
      sgst: toMoneyNumber(r.sgst),
    }));
    return res.json({
      rows,
      totals: {
        taxable: toMoneyNumber(sumMoney(rows.map((r) => r.taxable))),
        gst: toMoneyNumber(sumMoney(rows.map((r) => r.gst))),
      },
      credit_notes_count: creditNotes.length,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/inventory — valuation snapshot
export const getInventoryReport = async (req, res, next) => {
  try {
    const products = await Product.findAll({
      where: {
        deleted_at: null,
        status: { [Op.notIn]: [...NOT_IN_STOCK_STATUSES] },
      },
    });
    let pieces = 0;
    let qty = 0;
    let purchaseValue = 0;
    let weightG = 0;
    for (const p of products) {
      const q = Number(p.stock_qty) || 0;
      const isTray = Number(p.tray_total_weight) > 0;
      pieces += p.inventory_mode === 'unique_tag' && (p.status === 'available' || p.status === 'reserved' || p.status === 'estimation') ? 1 : 0;
      qty += q;
      purchaseValue += stockCostValue(p, q);
      // Tray unit: net_weight already holds the tray's own pooled weight (not
      // a per-piece figure) — use it as-is instead of multiplying by pieces.
      weightG += isTray
        ? (Number(p.tray_total_weight) || 0)
        : (Number(p.net_weight) || 0) * (p.inventory_mode === 'unique_tag' ? 1 : Math.max(q, 0));
    }
    return res.json({
      totals: {
        skus: products.length,
        unique_available: pieces,
        quantity: qty,
        purchase_value: toMoneyNumber(purchaseValue),
        net_weight_g: Number(weightG.toFixed(3)),
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/hidden-data — owner unlock only
export const getHiddenDataReport = async (req, res, next) => {
  try {
    const query = { ...req.query, _shop_id: req.user?.shop_id, _role: req.user?.role };
    return res.json(await getHiddenReportsData(query));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ detail: err.message });
    next(err);
  }
};
