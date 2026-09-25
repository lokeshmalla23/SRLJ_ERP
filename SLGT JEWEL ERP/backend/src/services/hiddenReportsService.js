/**
 * Owner-only hidden POS report: every hidden bill in the period with sales,
 * tenders, items, GST, and breakdowns — never mixed into locked reports.
 */
import { Op } from 'sequelize';
import { Invoice, Employee } from '../models/index.js';
import { toMoneyNumber, sumMoney } from '../utils/money.js';
import { getDefaultShopId } from './defaultShop.js';
import { excludePreAccountsWhere } from './financialMode.js';
import {
  hydrateInvoiceItems,
  invoiceItemsOf,
  invoiceOccurredAt,
  invoicePaymentsOf,
  shopScope,
} from '../utils/invoiceRead.js';
import {
  HIDDEN_INVOICE,
  NOT_VOID_OR_RETURNED,
  wantsHiddenBills,
} from '../utils/invoiceVisibility.js';
import { invoiceDateRangeWhere } from '../utils/reportQuery.js';
import { buildHiddenOldGoldSummary } from './hiddenOldGoldSummary.js';

function tenderSplit(payments = []) {
  const out = { cash: 0, upi: 0, card: 0, bank: 0, old_gold: 0, old_silver: 0, other: 0 };
  for (const p of payments || []) {
    const mode = String(p?.mode || '').toLowerCase().replace(/\s+/g, '_');
    const amt = Number(p?.amount) || 0;
    if (!(amt > 0)) continue;
    if (mode === 'cash') out.cash += amt;
    else if (mode === 'upi') out.upi += amt;
    else if (mode === 'card') out.card += amt;
    else if (mode === 'bank' || mode === 'bank_transfer' || mode === 'cheque' || mode === 'neft' || mode === 'rtgs') {
      out.bank += amt;
    }     else if (mode === 'old_gold_exchange' || mode === 'old_gold' || mode === 'exchange') {
      out.old_gold += amt;
    } else if (mode === 'old_silver_exchange' || mode === 'old_silver') {
      out.old_silver += amt;
    } else out.other += amt;
  }
  return {
    cash: toMoneyNumber(out.cash),
    upi: toMoneyNumber(out.upi),
    card: toMoneyNumber(out.card),
    bank: toMoneyNumber(out.bank),
    old_gold: toMoneyNumber(out.old_gold),
    old_silver: toMoneyNumber(out.old_silver),
    other: toMoneyNumber(out.other),
  };
}

function bumpMap(map, key, patch) {
  const label = key || '—';
  const cur = map.get(label) || { name: label, invoice_count: 0, sales: 0, collections: 0, qty: 0, weight: 0 };
  for (const [k, v] of Object.entries(patch)) cur[k] = (Number(cur[k]) || 0) + (Number(v) || 0);
  map.set(label, cur);
}

function dateKeyOf(inv) {
  const biz = String(inv.business_date || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(biz)) return biz;
  const when = invoiceOccurredAt(inv);
  if (!when) return null;
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function itemAmount(item) {
  return Number(item?.line_total ?? item?.total_price ?? item?.price ?? 0) || 0;
}

function itemWeight(item) {
  return Number(item?.net_weight ?? item?.weight ?? item?.gross_weight ?? 0) || 0;
}

function itemQty(item) {
  const q = Number(item?.quantity ?? item?.qty ?? 1);
  return q > 0 ? q : 1;
}

export async function getHiddenReportsData(query = {}) {
  if (!wantsHiddenBills(query)) {
    throw Object.assign(new Error('Not found'), { status: 404 });
  }

  const shopId = query._shop_id || await getDefaultShopId();
  const from = query.from || query.from_date || null;
  const to = query.to || query.to_date || null;

  const invoices = await Invoice.findAll({
    where: {
      [Op.and]: [
        shopScope(shopId),
        HIDDEN_INVOICE,
        invoiceDateRangeWhere({ from, to, from_date: from, to_date: to }),
        { status: NOT_VOID_OR_RETURNED },
        { cancelled_at: null },
        excludePreAccountsWhere(),
      ],
    },
    order: [['created_at', 'DESC']],
    limit: 2000,
  });
  await hydrateInvoiceItems(invoices);

  const employees = await Employee.findAll({
    attributes: ['id', 'name', 'user_id'],
  }).catch(() => []);
  const empName = new Map();
  for (const e of employees || []) {
    empName.set(e.id, e.name);
    if (e.user_id) empName.set(e.user_id, e.name);
  }

  const receipts = { cash: 0, upi: 0, card: 0, bank: 0, old_gold: 0, old_silver: 0, other: 0 };
  const byEmployee = new Map();
  const byCustomer = new Map();
  const byCategory = new Map();
  const byMetal = new Map();
  const byDay = new Map();
  const items = [];
  const rows = [];

  let collections = 0;
  let outstanding = 0;
  let itemCount = 0;
  let weightTotal = 0;

  for (const inv of invoices) {
    const pays = invoicePaymentsOf(inv);
    const split = tenderSplit(pays);
    if (!split.old_gold && Number(inv.old_gold_value) > 0) {
      split.old_gold = toMoneyNumber(inv.old_gold_value);
    }
    if (!split.old_silver && Number(inv.old_silver_value) > 0) {
      split.old_silver = toMoneyNumber(inv.old_silver_value);
    }
    const collected = toMoneyNumber(
      split.cash + split.upi + split.card + split.bank + split.other,
    );
    collections += collected;
    outstanding += Number(inv.balance_due) || 0;
    receipts.cash += split.cash;
    receipts.upi += split.upi;
    receipts.card += split.card;
    receipts.bank += split.bank;
    receipts.old_gold += split.old_gold;
    receipts.old_silver += split.old_silver || 0;
    receipts.other += split.other;

    const salesperson = empName.get(inv.salesperson_id) || 'Unassigned';
    bumpMap(byEmployee, salesperson, {
      invoice_count: 1,
      sales: Number(inv.grand_total) || 0,
      collections: collected,
    });

    const customerKey = `${inv.customer_name || 'Walk-in'}|${inv.customer_mobile || ''}`;
    const cust = byCustomer.get(customerKey) || {
      name: inv.customer_name || 'Walk-in',
      mobile: inv.customer_mobile || null,
      invoice_count: 0,
      sales: 0,
    };
    cust.invoice_count += 1;
    cust.sales += Number(inv.grand_total) || 0;
    byCustomer.set(customerKey, cust);

    const day = dateKeyOf(inv) || '—';
    bumpMap(byDay, day, {
      invoice_count: 1,
      sales: Number(inv.grand_total) || 0,
    });

    const lineItems = invoiceItemsOf(inv);
    for (const it of lineItems) {
      const amt = itemAmount(it);
      const wt = itemWeight(it);
      const qty = itemQty(it);
      itemCount += qty;
      weightTotal += wt;
      const cat = it.category_name || it.category || it.product_category || 'Other';
      const metal = it.metal_name || it.metal || it.metal_type || 'Other';
      bumpMap(byCategory, cat, { sales: amt, qty, weight: wt });
      bumpMap(byMetal, metal, { sales: amt, qty, weight: wt });
      items.push({
        invoice_id: inv.id,
        invoice_no: inv.invoice_no,
        date: dateKeyOf(inv),
        tag_number: it.tag_number || it.barcode || it.sku || null,
        name: it.product_name || it.name || it.item_name || 'Item',
        category: cat,
        metal,
        quantity: qty,
        net_weight: toMoneyNumber(wt),
        amount: toMoneyNumber(amt),
      });
    }

    rows.push({
      id: inv.id,
      invoice_no: inv.invoice_no,
      date: dateKeyOf(inv),
      occurred_at: invoiceOccurredAt(inv),
      customer_name: inv.customer_name || 'Walk-in',
      customer_mobile: inv.customer_mobile || null,
      salesperson,
      item_count: lineItems.length,
      subtotal: toMoneyNumber(inv.subtotal),
      discount: toMoneyNumber(inv.discount),
      gst_amount: toMoneyNumber(inv.gst_amount),
      grand_total: toMoneyNumber(inv.grand_total),
      balance_due: toMoneyNumber(inv.balance_due),
      cash: split.cash,
      upi: split.upi,
      card: split.card,
      bank: split.bank,
      old_gold: split.old_gold,
      old_silver: split.old_silver || 0,
      collected,
      status: inv.status,
      is_hidden: true,
    });
  }

  const oldGold = await buildHiddenOldGoldSummary(invoices, { metal: 'gold' });
  const oldSilver = await buildHiddenOldGoldSummary(invoices, { metal: 'silver' });
  if (!(Number(receipts.old_gold) > 0) && Number(oldGold.value) > 0) {
    receipts.old_gold = oldGold.value;
  }
  if (!(Number(receipts.old_silver) > 0) && Number(oldSilver.value) > 0) {
    receipts.old_silver = oldSilver.value;
  }

  const money = toMoneyNumber(
    receipts.cash + receipts.upi + receipts.card + receipts.bank + receipts.other,
  );
  const count = rows.length;
  const grandTotal = toMoneyNumber(sumMoney(invoices.map((i) => i.grand_total)));
  const gstAmount = toMoneyNumber(sumMoney(invoices.map((i) => i.gst_amount)));

  const finishGroup = (map, extra = []) => [...map.values()]
    .map((r) => {
      const out = { ...r };
      for (const k of ['sales', 'collections', 'weight', ...extra]) {
        if (out[k] != null) out[k] = toMoneyNumber(out[k]);
      }
      return out;
    })
    .sort((a, b) => (Number(b.sales) || 0) - (Number(a.sales) || 0));

  return {
    from,
    to,
    totals: {
      count,
      subtotal: toMoneyNumber(sumMoney(invoices.map((i) => i.subtotal))),
      discount: toMoneyNumber(sumMoney(invoices.map((i) => i.discount))),
      gst_amount: gstAmount,
      cgst_amount: toMoneyNumber(sumMoney(invoices.map((i) => i.cgst_amount))),
      sgst_amount: toMoneyNumber(sumMoney(invoices.map((i) => i.sgst_amount))),
      grand_total: grandTotal,
      collections: toMoneyNumber(collections),
      outstanding: toMoneyNumber(outstanding),
      avg_invoice: count ? toMoneyNumber(grandTotal / count) : 0,
      items_sold: itemCount,
      net_weight: toMoneyNumber(weightTotal),
    },
    receipts: {
      cash: toMoneyNumber(receipts.cash),
      upi: toMoneyNumber(receipts.upi),
      card: toMoneyNumber(receipts.card),
      bank: toMoneyNumber(receipts.bank),
      old_gold: toMoneyNumber(receipts.old_gold),
      old_silver: toMoneyNumber(receipts.old_silver),
      other: toMoneyNumber(receipts.other),
      money,
    },
    by_employee: finishGroup(byEmployee),
    by_customer: finishGroup(byCustomer).slice(0, 50),
    by_category: finishGroup(byCategory),
    by_metal: finishGroup(byMetal),
    daily: finishGroup(byDay).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    invoices: rows,
    items,
    old_gold: oldGold,
    old_silver: oldSilver,
  };
}
