import {
  compactStoneNames,
  formatInvoiceDescription,
  isDetailedStoneBill,
  normalizeStoneRows,
  computeVaMetrics,
} from '@crm/domain/invoiceLineMetrics.js';

export { formatInvoiceDescription, normalizeStoneRows, compactStoneNames, isDetailedStoneBill };

function lineQtyMultiplier(item) {
  return item?.tray_weight_sold != null ? 1 : (Number(item?.quantity) || 1);
}

export function lineDescription(item) {
  const stored = String(item?.description || '').trim();
  const fromCat = formatInvoiceDescription(
    item?.category_name || item?.category,
    item?.subcategory_name || item?.subcategory,
    '',
  );
  if (fromCat) return fromCat;
  if (stored && stored !== (item?.name || item?.product_name)) return stored;
  return stored || String(item?.name || item?.product_name || 'Item').trim();
}

export function lineChargedRate(item) {
  const direct = Number(item?.charged_rate ?? item?.rate);
  if (direct > 0) return direct;
  const metal = Number(item?.metal_value ?? item?.gold_value) || 0;
  const net = Number(item?.net_weight) || 0;
  if (metal > 0 && net > 0) return metal / net;
  return 0;
}

export function lineVaGrams(item) {
  if (item?.va_weight_display != null && item.va_weight_display !== '') {
    return Number(item.va_weight_display) || 0;
  }
  if (item?.va_weight != null && item.va_weight !== '') {
    return Number(item.va_weight) || 0;
  }
  const making = Number(item?.making_amount ?? 0);
  const wastage = Number(item?.wastage_amount ?? 0);
  const rate = lineChargedRate(item);
  if (making + wastage > 0 && rate > 0) {
    return computeVaMetrics({ makingAmount: making, wastageAmount: wastage, chargedRate: rate }).va_weight_display;
  }
  return 0;
}

export function lineProductValueExStone(item) {
  const mult = lineQtyMultiplier(item);
  if (item?.product_value_ex_stone != null && item.product_value_ex_stone !== '') {
    return (Number(item.product_value_ex_stone) || 0) * mult;
  }
  const metal = Number(item?.metal_value ?? item?.gold_value) || 0;
  const making = Number(item?.making_amount) || 0;
  const wastage = Number(item?.wastage_amount) || 0;
  if (metal + making + wastage > 0) return (metal + making + wastage) * mult;
  const lineTotal = Number(item?.line_total != null ? item.line_total : item?.unit_price) || 0;
  const stone = Number(item?.stone_charges) || 0;
  if (item?.line_total != null) return Math.max(0, lineTotal - stone * mult);
  return Math.max(0, lineTotal - stone);
}

export function lineStones(item) {
  const fromItem = normalizeStoneRows(item?.stones || item?.stone_details);
  if (fromItem.length) return fromItem;
  return [];
}

export function lineStoneCharges(item) {
  const stored = Number(item?.stone_charges);
  if (stored > 0) return stored;
  return lineStones(item).reduce((s, r) => s + (Number(r.price) || 0), 0);
}

function metalLabel(item) {
  const metal = String(item?.metal_name || item?.metal || '').trim();
  const purity = String(item?.purity || item?.purity_name || '').trim();
  if (metal && purity && !metal.toLowerCase().includes(purity.toLowerCase())) {
    return `${metal} ${purity}`;
  }
  return metal || purity || '';
}

/** Unique Metal + Rate pairs for the header. Does not invent a single rate for mixed bills. */
export function headerMetalRateLines(items = []) {
  const seen = new Map();
  for (const it of items) {
    const label = metalLabel(it);
    const rate = lineChargedRate(it);
    if (!label && !(rate > 0)) continue;
    const key = `${label}|${rate > 0 ? rate.toFixed(2) : ''}`;
    if (seen.has(key)) continue;
    seen.set(key, { metal: label, rate });
  }
  return [...seen.values()];
}

/**
 * True when Old Gold Exchange was recorded as a PAYMENT (current business rule).
 * Legacy invoices created before this change only carry old_gold_value as a
 * grand-total deduction and have no such payment row — callers use this to
 * render those historical invoices with their original (deduction) breakdown
 * instead of retroactively reinterpreting them.
 */
export function hasOldGoldPayment(invoice) {
  const payments = Array.isArray(invoice?.payments) ? invoice.payments : [];
  return payments.some((p) => String(p?.mode || '').toLowerCase() === 'old_gold_exchange');
}

export function hasOldSilverPayment(invoice) {
  const payments = Array.isArray(invoice?.payments) ? invoice.payments : [];
  return payments.some((p) => String(p?.mode || '').toLowerCase() === 'old_silver_exchange');
}

/** Weight / purity / rate snapshot stored on an exchange payment row. */
export function exchangePaymentSnap(p) {
  const mode = String(p?.mode || '').toLowerCase();
  if (mode === 'old_silver_exchange' && p?.old_silver) return p.old_silver;
  if (mode === 'old_gold_exchange' && p?.old_gold) return p.old_gold;
  return null;
}

/**
 * Whether an old gold/silver payment line should print its "₹X/g" rate.
 * In manual mode the stored "rate" is the exchange amount itself, not a
 * per-gram rate, so it is hidden. Bills saved before the `manual` flag
 * existed are detected by rate == amount (with a weight other than 1 g).
 */
export function exchangeSnapShowsRate(p) {
  const snap = exchangePaymentSnap(p);
  if (!snap) return false;
  if (snap.manual) return false;
  const rate = Number(snap.rate) || 0;
  if (!(rate > 0)) return false;
  const weight = Number(snap.weight) || 0;
  const amount = Number(p?.amount) || 0;
  if (Math.abs(rate - amount) < 0.01 && Math.abs(weight - 1) > 0.0005) return false;
  return true;
}

/** One unique hallmark → header; several different hallmarks → none (shown per line). */
export function headerHallmark(items = []) {
  const marks = [...new Set(items.map((it) => String(it?.hallmark || '').trim()).filter(Boolean))];
  return marks.length === 1 ? marks[0] : '';
}

export function lineHallmark(item, headerMark) {
  const mark = String(item?.hallmark || '').trim();
  if (!mark) return '';
  if (headerMark && mark === headerMark) return '';
  return mark;
}

function escText(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stoneDetailText(stone) {
  const bits = [];
  if (stone.count > 0) bits.push(`Qty: ${stone.count}`);
  if (stone.total_carat > 0) bits.push(`Weight: ${Number(stone.total_carat).toFixed(2)} ct`);
  const name = escText(stone.stone_type || 'Stone');
  return bits.length ? `${name}<br><span class="stone-name">${escText(bits.join(' · '))}</span>` : name;
}

/**
 * Table body rows: product line (value excluding stones) + stone line(s).
 */
export function buildInvoiceTableRows(items = [], { detailed = false } = {}) {
  const headerMark = headerHallmark(items);
  const rows = [];
  items.forEach((it, idx) => {
    const qty = it.quantity || 1;
    const isTray = it.tray_weight_sold != null;
    const mult = isTray ? 1 : qty;
    const stones = lineStones(it);
    const stoneAmt = lineStoneCharges(it) * mult;
    const names = compactStoneNames(stones) || it.stone_names || it.stoneNames || '';
    const hallmark = lineHallmark(it, headerMark);
    let desc = escText(lineDescription(it));
    if (hallmark) desc = `${desc}<br><span class="stone-name">Hallmark No : ${escText(hallmark)}</span>`;

    rows.push({
      kind: 'product',
      sno: idx + 1,
      qty,
      desc,
      hsn: it.hsn_code || '7113',
      purity: it.purity || it.purity_name || '',
      gross: (Number(it.gross_weight) || 0) * mult,
      net: (Number(it.net_weight) || 0) * mult,
      va: lineVaGrams(it) * mult,
      amount: lineProductValueExStone(it),
    });

    if (stoneAmt > 0 || names) {
      if (detailed && stones.length) {
        stones.forEach((st) => {
          rows.push({
            kind: 'stone',
            sno: '',
            qty: '',
            desc: stoneDetailText(st),
            hsn: '',
            purity: '',
            gross: null,
            net: null,
            va: null,
            amount: (Number(st.price) || 0) * (isTray ? 1 : qty),
          });
        });
      } else if (names || stoneAmt > 0) {
        rows.push({
          kind: 'stone',
          sno: '',
          qty: '',
          desc: names ? escText(names) : 'Stones',
          hsn: '',
          purity: '',
          gross: null,
          net: null,
          va: null,
          amount: stoneAmt,
        });
      }
    }
  });
  return rows;
}
