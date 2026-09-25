/** Shared metal line classification for EOD / pure-metal stock books. */
import { Op } from 'sequelize';
import { Product, CatalogItem, Category } from '../models/index.js';
import { invoiceItemsOf } from '../utils/invoiceRead.js';

export function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

export function classifyMetalLine(item) {
  const purityRaw = String(item.purity || item.purity_name || item.purity_label || '').trim();
  const metalRaw = String(item.metal || item.metal_type || item.metal_name || item.name || '').toLowerCase();
  const purityLow = purityRaw.toLowerCase();
  const isPure = !!(item.is_pure_metal || item.line_type === 'pure_metal');
  const isSilver =
    metalRaw.includes('silver')
    || purityLow.includes('silver')
    || purityLow === 'puresilver'
    || metalRaw.includes('sil');
  const family = isSilver ? 'silver' : 'gold';

  let bucket = 'other';
  if (family === 'gold') {
    if (/24/.test(purityLow) || purityLow.includes('999')) bucket = '24k';
    else if (/22/.test(purityLow) || purityLow.includes('916')) bucket = '22k';
    else if (/18/.test(purityLow) || purityLow.includes('750')) bucket = '18k';
    else bucket = isPure ? '24k' : '22k';
  } else {
    bucket = isPure || purityLow.includes('pure') ? 'pure' : 'jewellery';
  }

  const qty = Number(item.quantity) || 1;
  const rawWt = Number(
    item.net_weight ?? item.weight_g ?? item.gross_weight ?? item.tray_weight_sold ?? 0,
  );
  // Pure metal / tray lines store the sold weight as a line total already.
  const weight = round3(
    isPure || item.tray_weight_sold != null || item.is_tray
      ? rawWt
      : rawWt * (qty > 0 ? qty : 1),
  );

  return { family, kind: isPure ? 'pure' : 'jewellery', bucket, weight, purity: purityRaw || bucket };
}

// ─── Line-level classification shared by Dashboard / Employee Sales ─────────
//
// These live here, not inside a controller, so that "gold sold" agrees across
// the Dashboard cards, the purity pie, the customer metal cards and the
// employee sales cards. Moving them out of controllers/dashboard.js is what
// makes that possible — keep ONE copy of each rule.

export function lineQty(item) {
  const q = item.quantity ?? item.qty;
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Infer metal family from line fields / purity / product catalog / name. */
export function classifyMetal(item, productMeta = null) {
  const raw = (
    item.metal
    || item.metal_name
    || item.metal_type
    || productMeta?.metal_name
    || ''
  ).toString().toLowerCase();

  if (raw.includes('gold') || raw === 'au') return 'gold';
  if (raw.includes('silver') || raw === 'ag' || raw.includes('sterling')) return 'silver';

  const purity = (item.purity || productMeta?.purity_name || '').toString().toLowerCase();
  if (
    purity.includes('gold')
    || /\b(24k|22k|18k|14k|916|750|585)\b/.test(purity)
    || purity.includes('bis')
  ) {
    return 'gold';
  }
  if (
    purity.includes('silver')
    || /\b(925|s925|sterling)\b/.test(purity)
  ) {
    return 'silver';
  }

  // Fallback: product / line name (common when catalog metal/purity IDs were never set)
  const name = (
    item.product_name
    || item.name
    || item.description
    || productMeta?.name
    || ''
  ).toString().toLowerCase();
  if (name.includes('gold') || /\b(24k|22k|18k|14k)\b/.test(name)) return 'gold';
  if (name.includes('silver') || name.includes('sterling') || /\b(925|s925)\b/.test(name)) return 'silver';

  if (item.is_pure_metal || item.line_type === 'pure_metal') {
    if (raw.includes('silver') || String(item.purity || '').toLowerCase().includes('silver')) return 'silver';
    return 'gold';
  }

  // HSN jewellery / bullion heuristics (common India codes)
  const hsn = String(item.hsn_code || productMeta?.hsn_code || '');
  if (/^7106/.test(hsn)) return 'silver';
  if (/^7108/.test(hsn) || /^7113/.test(hsn)) return 'gold';

  return null;
}

/** Best-effort purity label for charts when purity field is blank. */
export function resolvePurityLabel(item, metal, productMeta = null) {
  const explicit = item.purity || productMeta?.purity_name;
  if (explicit) return String(explicit);

  const name = (
    item.product_name || item.name || productMeta?.name || ''
  ).toString();
  const m = name.match(/\b(24K|22K|18K|14K)\b/i);
  if (m) {
    return metal === 'silver' ? m[0].toUpperCase() : `${m[0].toUpperCase()} Gold`;
  }
  if (/\b(925|S925|Sterling)\b/i.test(name)) return 'Silver 925';
  return metal === 'gold' ? 'Gold' : metal === 'silver' ? 'Silver' : 'Other';
}

/**
 * Invoice snapshots store GROSS/NET as the billed line weight (what the tax
 * invoice prints). Pure/tray lines must not be multiplied by qty; jewellery
 * qty-mode lines still scale unit weight × pieces. Used by Gold Sales cards
 * and the purity pie so they cannot drift.
 */
export function soldLineWeights(item, productMeta = null) {
  const merged = {
    ...item,
    metal: item.metal || item.metal_name || item.metal_type || productMeta?.metal_name,
    purity: item.purity || item.purity_name || productMeta?.purity_name,
    name: item.name || item.product_name || item.description || productMeta?.name,
  };
  const line = classifyMetalLine(merged);
  const classified = classifyMetal(merged, productMeta) || line.family;
  const qty = lineQty(item);
  let gw = Number(item.gross_weight) || 0;
  let nw = Number(item.net_weight) || Number(item.weight_g) || 0;
  if (line.kind === 'pure' || item.tray_weight_sold != null || item.is_tray) {
    const tray = Number(item.tray_weight_sold) || 0;
    gw = gw || nw || tray;
    nw = nw || gw || tray;
  } else {
    gw *= qty;
    nw *= qty;
  }
  if (!(gw > 0 || nw > 0) && line.weight > 0) {
    gw = line.weight;
    nw = line.weight;
  }
  return { classified, family: line.family, qty, gw, nw, merged };
}

/** product_id -> { name, metal_name, purity_name, category_name, hsn_code } */
export async function buildProductLookup(invoices) {
  const ids = new Set();
  for (const inv of invoices) {
    const items = invoiceItemsOf(inv);
    if (!items.length) continue;
    for (const item of items) {
      if (!item.product_id) continue;
      // Always resolve product meta for legacy lines missing metal/purity/category
      ids.add(item.product_id);
    }
  }
  if (ids.size === 0) return new Map();

  const products = await Product.findAll({
    where: { id: { [Op.in]: [...ids] } },
  });

  const metalIds = [...new Set(products.map((p) => p.metal_type_id).filter(Boolean))];
  const purityIds = [...new Set(products.map((p) => p.purity_id).filter(Boolean))];
  const catIds = [...new Set(products.map((p) => p.category_id).filter(Boolean))];

  const [metals, purities, categories] = await Promise.all([
    metalIds.length
      ? CatalogItem.findAll({ where: { id: { [Op.in]: metalIds } } })
      : [],
    purityIds.length
      ? CatalogItem.findAll({ where: { id: { [Op.in]: purityIds } } })
      : [],
    catIds.length
      ? Category.findAll({ where: { id: { [Op.in]: catIds } } })
      : [],
  ]);

  const metalById = Object.fromEntries(metals.map((m) => [m.id, m.name || m.code]));
  const purityById = Object.fromEntries(purities.map((p) => [p.id, p.name || p.code]));
  const catById = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const map = new Map();
  for (const p of products) {
    map.set(p.id, {
      name: p.name || null,
      metal_name: metalById[p.metal_type_id] || null,
      purity_name: purityById[p.purity_id] || null,
      category_name: catById[p.category_id] || null,
      hsn_code: p.hsn_code || null,
    });
  }
  return map;
}

/** Higher purity first: 24K, 22K, 18K, then 925, then everything else. */
function purityRank(label) {
  const n = Number(String(label).match(/(\d+(?:\.\d+)?)/)?.[1]);
  return Number.isFinite(n) ? n : -1;
}

/**
 * Gold / silver sold weights for a set of invoices, grouped by purity.
 *
 * @returns {{
 *   byInvoice: Map<string, {gold:{gross:number,net:number,pieces:number}, silver:{gross:number,net:number,pieces:number}}>,
 *   metals: Array<{metal:string, total_gross_weight:number, total_net_weight:number, rows:Array<{purity:string, gross_weight:number, net_weight:number}>}>,
 *   unclassified: {gross:number, net:number},
 * }}
 *
 * `byInvoice` lets a caller attribute weights to whoever sold the bill;
 * `metals` is shaped for a purity table. Lines whose metal cannot be
 * determined are reported in `unclassified` rather than silently counted as
 * gold.
 */
export function metalPurityBreakdown(invoices, productLookup = new Map()) {
  const byInvoice = new Map();
  const buckets = new Map();
  const unclassified = { gross: 0, net: 0 };
  const METAL_LABEL = { gold: 'Gold', silver: 'Silver' };

  for (const inv of invoices) {
    const items = invoiceItemsOf(inv);
    const per = {
      gold: { gross: 0, net: 0, pieces: 0 },
      silver: { gross: 0, net: 0, pieces: 0 },
    };
    for (const item of items) {
      const meta = item.product_id ? productLookup.get(item.product_id) : null;
      const sold = soldLineWeights(item, meta);
      if (!(sold.gw > 0 || sold.nw > 0)) continue;

      // soldLineWeights falls back to classifyMetalLine's family when the
      // metal/purity fields are blank, which would label an unknown line as
      // gold. Only trust a family the explicit classifier confirmed.
      const family = classifyMetal(sold.merged, meta);
      if (!family) {
        unclassified.gross = round3(unclassified.gross + sold.gw);
        unclassified.net = round3(unclassified.net + sold.nw);
        continue;
      }

      per[family].gross = round3(per[family].gross + sold.gw);
      per[family].net = round3(per[family].net + sold.nw);
      per[family].pieces = round3(per[family].pieces + sold.qty);

      const purity = resolvePurityLabel(sold.merged, family, meta);
      const key = `${family}||${purity}`;
      if (!buckets.has(key)) {
        buckets.set(key, { family, purity, gross: 0, net: 0 });
      }
      const b = buckets.get(key);
      b.gross = round3(b.gross + sold.gw);
      b.net = round3(b.net + sold.nw);
    }
    if (inv?.id) byInvoice.set(inv.id, per);
  }

  const byMetal = new Map();
  for (const b of buckets.values()) {
    if (!(b.gross > 0 || b.net > 0)) continue;
    if (!byMetal.has(b.family)) byMetal.set(b.family, []);
    byMetal.get(b.family).push({
      purity: b.purity,
      gross_weight: round3(b.gross),
      net_weight: round3(b.net),
    });
  }

  const metals = [...byMetal.entries()]
    .map(([family, rows]) => {
      rows.sort((a, b) => purityRank(b.purity) - purityRank(a.purity) || a.purity.localeCompare(b.purity));
      return {
        metal: METAL_LABEL[family] || family,
        rows,
        total_gross_weight: round3(rows.reduce((s, r) => s + r.gross_weight, 0)),
        total_net_weight: round3(rows.reduce((s, r) => s + r.net_weight, 0)),
      };
    })
    // Gold first, then silver — matches how these are read on screen.
    .sort((a, b) => (a.metal === 'Gold' ? 0 : 1) - (b.metal === 'Gold' ? 0 : 1));

  return { byInvoice, metals, unclassified };
}
