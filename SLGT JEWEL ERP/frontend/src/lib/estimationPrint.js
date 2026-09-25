import { calcLineAmounts, calcInvoiceTotals, resolvePurityKey, resolveLineRate } from "@/lib/billingCalc";
import {
  mergeEstimationLayout, getCachedEstimationLayout,
  mergeThermalEstimationLayout, getCachedThermalEstimationLayout,
  getCachedEstimationPrinterType, fontFamilyCss,
} from "@/lib/estimationLayout";
import { fmtINRPlain } from "@/lib/format";

function isTestEstimation(quote) {
  return String(quote?.financial_mode || "").toUpperCase() === "PRE_ACCOUNTS"
    || /^TEST-/i.test(String(quote?.quote_no || ""));
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Tray: price the entered weight once (qty=1), never the product's stored
// per-unit weight — same substitution rule used by POS and Estimation's live total.
function trayAdjust(it) {
  if (!it.is_tray) return it;
  return { ...it, net_weight: Number(it.tray_weight_sold) || 0, gross_weight: Number(it.tray_weight_sold) || 0, quantity: 1 };
}

function displayGoldRateLabel(items, goldRate24k, rateMap = {}) {
  const first = Array.isArray(items) && items.length ? items[0] : null;
  if (first) {
    const rate = resolveLineRate(trayAdjust(first), goldRate24k, rateMap);
    const kind = String(first.metal || first.metal_name || "").toLowerCase().includes("silver")
      ? "Silver"
      : (first.purity || first.purity_name || "Gold");
    if (rate != null) return { label: kind, rate };
  }
  const purity = first?.purity || first?.purity_name || "22K";
  const key = resolvePurityKey(purity, first?.metal || first?.metal_name) || "22K";
  if (key === "Silver" || key === "PureSilver") {
    const r = rateMap[key] ?? rateMap.Silver ?? 90;
    return { label: key === "PureSilver" ? "Pure Silver" : "Silver", rate: Number(r) || 90 };
  }
  if (rateMap[key] != null && Number(rateMap[key]) > 0) {
    return { label: key, rate: Number(rateMap[key]) };
  }
  const basis = Number(goldRate24k) || 0;
  if (key === "22K" && basis > 0) {
    return { label: "22K", rate: Math.round(basis * 0.9167 * 100) / 100 };
  }
  if (key === "18K" && basis > 0) {
    return { label: "18K", rate: Math.round(basis * 0.75 * 100) / 100 };
  }
  if (key === "24K" && basis > 0) return { label: "24K", rate: basis };
  return { label: key || "22K", rate: basis };
}

/**
 * Shared row-building + totals logic for the estimation slip (per-item Gross
 * / Stone / Cost / Wastage / Making). Both the A5 "old detailed slip" and the
 * thermal receipt layout render the exact same rows — only the outer page
 * size/CSS differs between them (see the two generators below) — so the GST
 * and weight math lives in exactly one place.
 */
function buildEstimationRows(quote, items, company, goldRate, rateMap, L) {
  const shopName = (company?.name || "Sri Srinivasa Jewellers").toUpperCase();
  const shopCity = (company?.city || company?.address?.split(",")[0] || "").toUpperCase();
  const shopPhone = company?.phone || "";
  const shopAbbr = shopName.split(/\s+/).map((w) => w[0]).join("").slice(0, 4);

  const now = quote.created_at ? new Date(quote.created_at) : new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(2);
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const dateStr = `${dd}/${mm}/${yy}`;
  const timeStr = `${hh}:${min}`;

  const quoteNo = quote.quote_no || "DRAFT";
  const isTest = isTestEstimation(quote);
  const titleText = isTest ? "TEST / PRE-ACCOUNTS ESTIMATION" : (L.title_text || "ESTIMATION");
  const employeeName = (quote.salesperson_name || "").toUpperCase();
  // Existing GST logic (calcInvoiceTotals) is reused as-is — just wired to the
  // estimation's own gst_pct instead of the previous hardcoded 0.
  const gstPct = quote.gst_pct != null ? Number(quote.gst_pct) : 3;

  const bill = calcInvoiceTotals({
    lineTotals: items.map((it) => {
      const adj = trayAdjust(it);
      const rateForCalc = adj.metal === "Silver" ? (rateMap.Silver ?? 90) : goldRate;
      return calcLineAmounts({
        ...adj,
        purity: adj.purity || (adj.metal === "Silver" ? "Silver" : adj.purity),
        quantity: adj.is_tray ? 1 : (adj.qty || adj.quantity || 1),
      }, rateForCalc, rateMap).line_total;
    }),
    discount: quote.discount || 0,
    discountType: "flat",
    gstPct,
  });
  const grandAmt = bill.grand_total;
  const disc = Math.round(bill.discount);
  const shown = displayGoldRateLabel(items, goldRate || quote.gold_rate, rateMap);
  const firstPurity = (items[0]?.purity || "22K").replace(/[^0-9]/g, "").slice(0, 3) || "916";

  // Aggregated across all items for the "STONE DETAILS" footer section.
  const stoneDetailEntries = [];

  const itemBlocks = items.map((it) => {
    const I = L.items || {};
    const adj = trayAdjust(it);
    const grossWt = Number(adj.gross_weight || 0);
    // Net Weight is the same value already used for gold_value below (Gross -
    // Stone by construction: either entered directly on the product, or — when
    // not set — stoneWt itself falls back to gross-net so the identity holds).
    const netWt = Number(adj.net_weight || grossWt);
    const stoneWt = Number(it.stone_weight) > 0
      ? Number(it.stone_weight)
      : Math.max(0, grossWt - netWt);
    const rateForCalc = adj.metal === "Silver" ? (rateMap.Silver ?? 90) : goldRate;
    const amounts = calcLineAmounts({
      ...adj,
      purity: adj.purity || (adj.metal === "Silver" ? "Silver" : adj.purity),
      quantity: adj.is_tray ? 1 : (adj.qty || adj.quantity || 1),
    }, rateForCalc, rateMap);
    // This item's own applicable per-gram rate (purity/override already
    // resolved by calcLineAmounts) — never the flat header rate.
    const chargedRate = Number(amounts.charged_rate) || 0;
    const wastageAmt = Number(amounts.wastage_amount) || 0;
    const makingAmt = Number(amounts.making_amount) || 0;
    const stoneAmt = Number(amounts.stone_charges) || Number(it.stone_charges) || 0;
    // Estimation-specific Value Add: wastage converted to grams at the item's
    // own rate (kept at full precision — only rounded for the printed weight
    // line). Cost is derived from goldValue + wastageAmt directly (both already
    // money-rounded) rather than re-multiplying the rounded display weight by
    // the rate, so the 3-decimal rounding below never leaks into the total.
    const valueAddGrams = chargedRate > 0 ? parseFloat((wastageAmt / chargedRate).toFixed(3)) : 0;
    const totalWeight = parseFloat((netWt + valueAddGrams).toFixed(3));
    const cost = Number(amounts.gold_value) + wastageAmt;
    const itemTotal = Number(amounts.line_total) || (cost + makingAmt + stoneAmt);
    const name = (it.product_name || it.name || "").toUpperCase();
    const code = it.code || it.barcode || "";
    const qty = it.is_tray ? (it.tray_pieces_sold || 1) : (it.qty || it.quantity || 1);
    const stoneLabel = (
      it.stone_names
      || (Array.isArray(it.stones) ? it.stones.map((s) => s?.stone_type).filter(Boolean).join(", ") : "")
      || "STONE"
    ).toUpperCase();
    if (stoneWt > 0) stoneDetailEntries.push({ name: stoneLabel, weight: stoneWt });
    const hdrParts = [
      I.show_tno !== false && code ? `TNO- ${esc(code)}` : "",
      I.show_name !== false ? esc(name) : "",
      I.show_pcs !== false ? `PCS- ${qty}` : "",
      shopAbbr ? `() ${esc(shopAbbr)}` : "",
    ].filter(Boolean).join(" ");

    const sep = `<tr><td colspan="2" class="sep-eq"></td></tr>`;
    return `
${sep}
${hdrParts ? `<tr><td colspan="2" class="item-hdr">${hdrParts}</td></tr>` : ""}
${I.show_gross !== false ? `<tr><td>Gross Weight</td><td class="r">${grossWt.toFixed(3)}</td></tr>` : ""}
${I.show_stone_wt !== false && stoneWt > 0 ? `<tr><td>LESS: Stone Weight</td><td class="r">(-) ${stoneWt.toFixed(3)}</td></tr>
<tr><td colspan="2" class="sep-dash"></td></tr>` : ""}
<tr><td>Net Weight</td><td class="r">${netWt.toFixed(3)}</td></tr>
<tr><td colspan="2" style="padding:2px 0;"></td></tr>
${I.show_value_add !== false ? `<tr><td>Value Add (Wastage) in Gms</td><td class="r">${valueAddGrams.toFixed(3)}</td></tr>
<tr><td colspan="2" class="sep-dash"></td></tr>
<tr><td colspan="2" style="padding:2px 0;"></td></tr>` : ""}
${I.show_total_wt !== false ? `<tr><td>Total Weight</td><td class="r">${totalWeight.toFixed(3)}</td></tr>
<tr><td colspan="2" style="padding:2px 0;"></td></tr>` : ""}
${I.show_cost !== false ? `<tr><td>Cost (${totalWeight.toFixed(3)} X ${fmtINRPlain(chargedRate)})</td><td class="r">${fmtINRPlain(cost)}</td></tr>` : ""}
${I.show_making !== false ? `<tr><td>Making Charges</td><td class="r">${fmtINRPlain(makingAmt)}</td></tr>` : ""}
${I.show_stone_price !== false && stoneAmt > 0 ? `<tr><td>Stone Price</td><td class="r">${fmtINRPlain(stoneAmt)}</td></tr>` : ""}
<tr><td colspan="2" class="sep-dash"></td></tr>
${I.show_item_total !== false ? `<tr><td class="bold">TOTAL</td><td class="r bold">${fmtINRPlain(itemTotal)}</td></tr>` : ""}`;
  }).join("\n");

  const gstPctLabel = gstPct % 1 === 0 ? String(gstPct) : gstPct.toFixed(2);
  const gstLine = gstPct > 0
    ? `<tr><td>GST (${gstPctLabel}%)</td><td class="r">${fmtINRPlain(bill.gst_amount)}</td></tr>`
    : "";

  const stoneDetailsBlock = stoneDetailEntries.length ? `
<tr><td class="bold">STONE DETAILS</td><td class="r bold">WEIGHT (GMS)</td></tr>
${stoneDetailEntries.map((s) => `<tr><td>${esc(s.name)}</td><td class="r">${s.weight.toFixed(3)}</td></tr>`).join("\n")}
<tr><td colspan="2" class="sep-dash"></td></tr>` : "";

  const remaining = Number(quote.remaining_amount != null
    ? quote.remaining_amount
    : (grandAmt - Number(quote.advance_paid || 0)));

  // Old Metal Exchange is informational only at the estimation stage — it
  // never reduces TOTAL AMOUNT and posts nothing to accounts; it only carries
  // forward so POS can settle it as a real payment if this estimate is billed.
  // Still worth showing here so the customer sees what they'd owe net of it.
  const oldGold = quote.old_gold && typeof quote.old_gold === "object" && quote.old_gold.active
    ? quote.old_gold
    : null;
  const oldGoldVal = oldGold ? (Number(oldGold.value) || 0) : 0;
  const oldSilver = quote.old_silver && typeof quote.old_silver === "object" && quote.old_silver.active
    ? quote.old_silver
    : null;
  const oldSilverVal = oldSilver ? (Number(oldSilver.value) || 0) : 0;
  const payableAfterExchange = Math.max(0, remaining - oldGoldVal - oldSilverVal);

  const rowsHtml = `
${L.show_shop !== false ? `<tr><td colspan="2" class="shop-hdr">${esc(shopName)}</td></tr>` : ""}
${L.show_city !== false && shopCity ? `<tr><td colspan="2" class="c">${esc(shopCity)}</td></tr>` : ""}
${L.show_phone !== false && shopPhone ? `<tr><td colspan="2" class="c">PH : ${esc(shopPhone)}</td></tr>` : ""}
<tr><td colspan="2" style="padding:6px 0;"></td></tr>
${L.title_show !== false ? `<tr><td colspan="2" class="c bold" style="font-size:${L.title_pt}pt;letter-spacing:1px;">${esc(titleText)}</td></tr>` : ""}
${isTest ? `<tr><td colspan="2" class="c" style="font-size:8pt;color:#78350F;padding:4px 0;">TEST — will not affect Live Accounts or GL</td></tr>` : ""}
<tr><td colspan="2" class="sep-dash"></td></tr>
<tr><td colspan="2" style="padding:6px 0;"></td></tr>
${L.show_rate !== false ? `<tr><td colspan="2" class="c">${esc(shown.label)} Rate Per Gm.${quote.price_locked ? " (LOCKED)" : ""}</td></tr>
<tr><td colspan="2" class="c bold">${fmtINRPlain(shown.rate || 0)}</td></tr>` : ""}
<tr><td colspan="2" style="padding:6px 0;"></td></tr>
<tr>
  <td>${L.show_quote_no !== false ? `${esc(quoteNo)}${L.show_kv !== false ? " / K.V." : ""}` : ""}</td>
  <td class="r">${L.show_customer !== false ? esc(employeeName) : ""}</td>
</tr>
<tr>
  <td>${L.show_purity_line !== false ? `No : 1  ( ${esc(firstPurity)} )` : ""}</td>
  <td class="r">${L.show_date !== false ? `${dateStr}&nbsp;&nbsp;${timeStr}` : ""}</td>
</tr>
${itemBlocks}
<tr><td colspan="2" class="sep-eq"></td></tr>
${L.show_discount !== false && disc > 0 ? `<tr><td>Discount</td><td class="r">-${fmtINRPlain(disc)}</td></tr>
<tr><td colspan="2" class="sep-eq"></td></tr>` : ""}
${gstLine}
${L.show_total !== false ? `<tr><td class="bold">TOTAL AMOUNT</td><td class="r bold">₹${fmtINRPlain(grandAmt)}</td></tr>` : ""}
${L.show_balance !== false ? `<tr><td>BAL. AMOUNT</td><td class="r">${fmtINRPlain(grandAmt)}</td></tr>` : ""}
${L.show_advance !== false && Number(quote.advance_paid) > 0 ? `
<tr><td>ADVANCE PAID</td><td class="r">${fmtINRPlain(quote.advance_paid)}</td></tr>
<tr><td class="bold">REMAINING</td><td class="r bold">${fmtINRPlain(remaining)}</td></tr>
` : ""}
${oldGoldVal > 0 ? `
<tr><td colspan="2" class="sep-dash"></td></tr>
<tr><td>Old Gold Exchange (${esc(oldGold.weight)}g ${esc(oldGold.purity || "")} @ ${fmtINRPlain(oldGold.rate)}/g)</td><td class="r">-${fmtINRPlain(oldGoldVal)}</td></tr>
` : ""}
${oldSilverVal > 0 ? `
${oldGoldVal > 0 ? "" : `<tr><td colspan="2" class="sep-dash"></td></tr>`}
<tr><td>Old Silver Exchange (${esc(oldSilver.weight)}g ${esc(oldSilver.purity || "")} @ ${fmtINRPlain(oldSilver.rate)}/g)</td><td class="r">-${fmtINRPlain(oldSilverVal)}</td></tr>
` : ""}
${(oldGoldVal > 0 || oldSilverVal > 0) ? `
<tr><td class="bold">BALANCE PAYABLE</td><td class="r bold">${fmtINRPlain(payableAfterExchange)}</td></tr>
` : ""}
${quote.price_locked ? `<tr><td colspan="2" class="c" style="padding-top:4px;font-size:${Math.max(7.5, L.font_pt - 2)}pt;">PRICES LOCKED${quote.valid_until ? ` UNTIL ${esc(quote.valid_until)}` : ""}</td></tr>` : ""}
<tr><td colspan="2" class="sep-eq"></td></tr>
${stoneDetailsBlock}
<tr><td colspan="2" style="padding:8px 0;"></td></tr>
${L.show_thanking !== false ? `<tr><td colspan="2">THANKING YOU</td></tr>` : ""}
<tr><td colspan="2" style="padding:8px 0;"></td></tr>
${L.show_customer_fields !== false ? (
  quote.customer_name
    ? `<tr><td colspan="2">NAME    : ${esc(quote.customer_name)}</td></tr>`
    : `<tr><td colspan="2">NAME    :</td></tr><tr><td colspan="2">ADDRESS :</td></tr><tr><td colspan="2">PHONE   :</td></tr>`
) : ""}
${L.show_customer_fields !== false && quote.customer_mobile ? `<tr><td colspan="2">PHONE   : ${esc(quote.customer_mobile)}</td></tr>` : ""}
${L.show_notes !== false && quote.notes ? `<tr><td colspan="2" style="padding-top:6px;font-size:${Math.max(7.5, L.font_pt - 2)}pt;">Note: ${esc(quote.notes)}</td></tr>` : ""}`;

  return { rowsHtml, quoteNo };
}

/**
 * Old estimation slip (per-item Gross / Stone / Cost / Wastage / Making) on A5
 * — for a normal letterhead/inkjet/laser printer.
 */
export function generateEstimationPrintHTML(quote, items, company, goldRate, rateMap = {}, layoutInput = null) {
  const L = mergeEstimationLayout(layoutInput || getCachedEstimationLayout());
  const pageW = L.page_w_in || 5.7;
  const pageH = L.page_h_in || 8.27;
  const { rowsHtml, quoteNo } = buildEstimationRows(quote, items, company, goldRate, rateMap, L);

  return `<!DOCTYPE html>
<html lang="en" data-paper="A5" data-page-w-in="${pageW}" data-page-h-in="${pageH}">
<head>
<meta charset="utf-8">
<title>Estimation — ${esc(quoteNo)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: ${pageW}in ${pageH}in; margin: 0; }
html, body {
  width: ${pageW}in;
  min-height: ${pageH}in;
  margin: 0;
  padding: 0;
  background: #fff;
  font-family: ${fontFamilyCss(L.font_family)};
  font-size: ${L.font_pt}pt;
  font-weight: ${L.bold ? "bold" : "normal"};
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
/* Same defensive fix as the thermal layout — never let a capture-window
 * scrollbar render (and get screenshotted) if content ever runs long. */
::-webkit-scrollbar { display: none; width: 0; height: 0; }
.page {
  width: ${pageW}in;
  min-height: ${pageH}in;
  box-sizing: border-box;
  padding: ${L.pad_t}px ${L.pad_r}px ${L.pad_b}px ${L.pad_l}px;
}
table { width: 100%; border-collapse: collapse; }
td { padding: 3px 6px; font-size: ${L.font_pt}pt; font-weight: ${L.bold ? "bold" : "normal"}; vertical-align: top; }
.r    { text-align: right; white-space: nowrap; }
.c    { text-align: center; }
.bold { font-weight: bold; }
.sep-eq   { border-top: 2px double #000; padding: 0; height: 2px; }
.sep-dash { border-top: 1px dashed #000; padding: 0; height: 1px; }
.item-hdr { font-weight: bold; font-size: ${Math.max(8, L.font_pt - 0.5)}pt; word-break: break-word; padding: 5px 6px; }
.shop-hdr { font-size: ${L.shop_pt}pt; font-weight: bold; text-align: center; text-transform: uppercase; padding: 2px 4px; }
</style>
</head>
<body>
<div class="page">
<table>
${rowsHtml}
</table>
</div>
</body>
</html>`;
}

/**
 * Same estimation slip, formatted for a narrow continuous-feed thermal
 * receipt printer (58mm/80mm rolls) instead of a fixed A5 sheet — no fixed
 * page height (the roll feeds/cuts to the content length), tighter padding,
 * smaller default type.
 */
export function generateThermalEstimationPrintHTML(quote, items, company, goldRate, rateMap = {}, layoutInput = null) {
  const L = mergeThermalEstimationLayout(layoutInput || getCachedThermalEstimationLayout());
  const widthMm = L.paper_width_mm || 80;
  const { rowsHtml, quoteNo } = buildEstimationRows(quote, items, company, goldRate, rateMap, L);

  return `<!DOCTYPE html>
<html lang="en" data-paper="thermal" data-paper-width-mm="${widthMm}">
<head>
<meta charset="utf-8">
<title>Estimation — ${esc(quoteNo)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: ${widthMm}mm auto; margin: 0; }
html, body {
  width: ${widthMm}mm;
  max-width: ${widthMm}mm;
  margin: 0;
  padding: 0;
  background: #fff;
  font-family: ${fontFamilyCss(L.font_family)};
  font-size: ${L.font_pt}pt;
  font-weight: ${L.bold ? "bold" : "normal"};
  color: #000;
  overflow-x: hidden;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
/* A vertical scrollbar rendered by the invisible capture window (even a
 * sub-pixel content/height mismatch is enough to trigger one) gets
 * screenshotted as part of the receipt — showing up as a solid line down
 * the right edge, especially stark once ESC/POS thresholds it to pure
 * black/white. Hide the scrollbar's rendering only — content stays
 * scrollable (nothing gets clipped), it just never paints visually. */
::-webkit-scrollbar { display: none; width: 0; height: 0; }
.page {
  width: ${widthMm}mm;
  max-width: ${widthMm}mm;
  box-sizing: border-box;
  padding: 3mm ${L.pad_x}mm;
  overflow-x: hidden;
}
table { width: 100%; max-width: 100%; border-collapse: collapse; }
td { padding: 1.5px 3px; font-size: ${L.font_pt}pt; font-weight: ${L.bold ? "bold" : "normal"}; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
.r    { text-align: right; white-space: normal; }
.c    { text-align: center; }
.bold { font-weight: bold; }
.sep-eq   { border-top: 1.5px double #000; padding: 0; height: 2px; }
.sep-dash { border-top: 1px dashed #000; padding: 0; height: 1px; }
.item-hdr { font-weight: bold; font-size: ${Math.max(7, L.font_pt - 0.5)}pt; word-break: break-word; padding: 3px; }
.shop-hdr { font-size: ${L.shop_pt}pt; font-weight: bold; text-align: center; text-transform: uppercase; padding: 2px; }
</style>
</head>
<body>
<div class="page">
<table>
${rowsHtml}
</table>
</div>
</body>
</html>`;
}

/**
 * Picks the normal (A5) or thermal generator based on which printer type is
 * currently active in Settings → Estimation Print — so call sites (POS /
 * Quotations) don't need to know which format the shop is using this week.
 * `config` optionally overrides `{ type, layout }` (Settings preview panes
 * pass their own tab's layout explicitly rather than the cached "active" one).
 */
export function generateActiveEstimationPrintHTML(quote, items, company, goldRate, rateMap = {}, config = null) {
  const type = config?.type || getCachedEstimationPrinterType();
  if (type === "thermal") {
    return generateThermalEstimationPrintHTML(quote, items, company, goldRate, rateMap, config?.layout || null);
  }
  return generateEstimationPrintHTML(quote, items, company, goldRate, rateMap, config?.layout || null);
}
