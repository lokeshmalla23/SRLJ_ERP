import { Op } from 'sequelize';
import { OldGoldReceipt } from '../models/index.js';
import { toMoneyNumber } from '../utils/money.js';
import { invoiceOccurredAt, invoicePaymentsOf } from '../utils/invoiceRead.js';
import { isOgExchangeMode, isOsExchangeMode, normalizeReceiptMetal } from '../utils/oldMetal.js';

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function isOgMode(mode) {
  return isOgExchangeMode(mode);
}

function sortPurityRows(a, b) {
  const na = Number(String(a.purity).match(/(\d+(?:\.\d+)?)/)?.[1] || -1);
  const nb = Number(String(b.purity).match(/(\d+(?:\.\d+)?)/)?.[1] || -1);
  if (na !== nb) return nb - na;
  return String(a.purity).localeCompare(String(b.purity));
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

/**
 * Weight / purity / bill list for hidden POS old-gold exchange.
 * Prefers OldGoldReceipt rows, then payment.old_gold, then invoice.old_gold_value.
 */
export async function buildHiddenOldGoldSummary(invoices = [], { metal = 'gold' } = {}) {
  const kind = normalizeReceiptMetal(metal);
  const list = Array.isArray(invoices) ? invoices : [];
  const ids = [...new Set(list.map((i) => i.id).filter(Boolean))];
  const receipts = ids.length
    ? await OldGoldReceipt.findAll({ where: { invoice_id: { [Op.in]: ids } } })
    : [];
  const byInv = new Map();
  for (const r of receipts) {
    if (!r.invoice_id) continue;
    if (normalizeReceiptMetal(r.metal) !== kind) continue;
    if (!byInv.has(r.invoice_id)) byInv.set(r.invoice_id, []);
    byInv.get(r.invoice_id).push(r);
  }

  const bills = [];
  const purityMap = new Map();
  let weight = 0;
  let value = 0;

  const bumpPurity = (purity, w, v) => {
    const key = String(purity || '').trim() || 'Unknown';
    const cur = purityMap.get(key) || { purity: key, weight_g: 0, value: 0 };
    cur.weight_g = round3(cur.weight_g + (Number(w) || 0));
    cur.value = toMoneyNumber(cur.value + (Number(v) || 0));
    purityMap.set(key, cur);
  };

  const pushBill = ({ invoice_id, invoice_no, date, customer_name, weight_g, purity, rate, value: amt }) => {
    bills.push({
      invoice_id,
      invoice_no: invoice_no || '—',
      date: date || null,
      customer_name: customer_name || 'Walk-in',
      weight_g: round3(weight_g),
      purity: purity || '—',
      rate: toMoneyNumber(rate),
      value: toMoneyNumber(amt),
    });
  };

  for (const inv of list) {
    const date = dateKeyOf(inv);
    const recs = (byInv.get(inv.id) || []).filter((r) => {
      const st = String(r.status || '').toLowerCase();
      return st !== 'returned';
    });
    if (recs.length) {
      for (const r of recs) {
        const w = Number(r.weight_g) || 0;
        const v = Number(r.value) || 0;
        weight = round3(weight + w);
        value += v;
        bumpPurity(r.purity, w, v);
        pushBill({
          invoice_id: inv.id,
          invoice_no: r.invoice_no || inv.invoice_no,
          date,
          customer_name: r.customer_name || inv.customer_name,
          weight_g: w,
          purity: r.purity,
          rate: r.rate,
          value: v,
        });
      }
      continue;
    }

    const pays = invoicePaymentsOf(inv).filter((p) => {
      const ok = kind === 'silver' ? isOsExchangeMode(p.mode) : isOgMode(p.mode);
      return ok && (Number(p.amount) || 0) > 0;
    });
    if (pays.length) {
      for (const p of pays) {
        const meta = kind === 'silver'
          ? (p.old_silver && typeof p.old_silver === 'object' ? p.old_silver : {})
          : (p.old_gold && typeof p.old_gold === 'object' ? p.old_gold : {});
        const w = Number(meta.weight ?? meta.weight_g) || 0;
        const v = Number(p.amount) || 0;
        weight = round3(weight + w);
        value += v;
        bumpPurity(meta.purity, w, v);
        pushBill({
          invoice_id: inv.id,
          invoice_no: inv.invoice_no,
          date,
          customer_name: inv.customer_name,
          weight_g: w,
          purity: meta.purity,
          rate: meta.rate,
          value: v,
        });
      }
      continue;
    }

    const fallback = Number(kind === 'silver' ? inv.old_silver_value : inv.old_gold_value) || 0;
    if (fallback > 0) {
      value += fallback;
      pushBill({
        invoice_id: inv.id,
        invoice_no: inv.invoice_no,
        date,
        customer_name: inv.customer_name,
        weight_g: 0,
        purity: '—',
        rate: 0,
        value: fallback,
      });
    }
  }

  return {
    bill_count: bills.length,
    weight_g: round3(weight),
    value: toMoneyNumber(value),
    by_purity: [...purityMap.values()]
      .filter((x) => x.weight_g > 0 || x.value > 0)
      .sort(sortPurityRows),
    bills,
  };
}
