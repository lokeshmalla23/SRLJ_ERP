import { asArray } from "@/lib/jsonFields";
import { mergeInvoiceLayout, getCachedInvoiceLayout } from "@/lib/invoiceLayout";
import { fmtINRPlain } from "@/lib/format";
import {
  letterheadBackgroundHtml,
  letterheadPageCss,
  resolveInvoicePageSize,
} from "@/lib/invoiceLetterhead";
import {
  buildInvoiceTableRows,
  headerHallmark,
  headerMetalRateLines,
  isDetailedStoneBill,
  hasOldGoldPayment,
  hasOldSilverPayment,
  exchangePaymentSnap,
  exchangeSnapShowsRate,
} from "@/lib/invoiceBillDisplay";

/** DD-MM-YYYY for the receipt — prefers the pinned business_date (kept exactly
 *  in sync with what's stored in the DB) over created_at, so a bill made
 *  while a prior day was still open prints that day's date, not today's. */
function invoiceDateStr(invoice) {
  if (invoice.business_date) {
    const [y, m, d] = String(invoice.business_date).slice(0, 10).split("-");
    if (y && m && d) return `${d}-${m}-${y}`;
  }
  const billDate = new Date(invoice.created_at || invoice.createdAt || Date.now());
  return `${String(billDate.getDate()).padStart(2, "0")}-${String(billDate.getMonth() + 1).padStart(2, "0")}-${billDate.getFullYear()}`;
}

function isTestFinancialDoc(row) {
  return String(row?.financial_mode || "").toUpperCase() === "PRE_ACCOUNTS";
}

function balanceDuePaymentRow(invoice, symbol) {
  const due = Number(invoice.balance_due) || 0;
  if (!(due > 0.5)) return "";
  return `<tr><td class="pl">BALANCE DUE</td><td class="pr">${symbol}${fmtMoney(due)}</td></tr>`;
}

function testInvoiceBannerHtml() {
  return `<div class="test-mode-banner">TEST / PRE-ACCOUNTS — not a live tax invoice. Does not affect Live Accounts or GL.</div>`;
}

function testInvoiceCss() {
  return `
.test-mode-banner {
  background: #FEF3C7;
  border: 1px solid #F59E0B;
  color: #78350F;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: center;
  padding: 4px 8px;
  margin: 0 0 6px;
  text-transform: uppercase;
}
.test-mode-watermark {
  position: absolute;
  top: 42%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-28deg);
  z-index: 40;
  pointer-events: none;
  white-space: nowrap;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 36pt;
  font-weight: 800;
  letter-spacing: 0.14em;
  color: rgba(180, 83, 9, 0.14);
  text-transform: uppercase;
}
`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function numberToWordsIndian(num) {
  if (!num || isNaN(num)) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
  const three = (n) => (n < 100 ? two(n) : ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + two(n % 100) : ""));
  let n = Math.floor(Math.abs(num));
  if (n === 0) return "Zero";
  const cr = Math.floor(n / 10000000); n %= 10000000;
  const la = Math.floor(n / 100000);   n %= 100000;
  const th = Math.floor(n / 1000);     n %= 1000;
  const parts = [];
  if (cr) parts.push(three(cr) + " Crore");
  if (la) parts.push(three(la) + " Lakh");
  if (th) parts.push(three(th) + " Thousand");
  if (n)  parts.push(three(n));
  return parts.join(" ");
}

function fmtMoney(n, digits = 2) {
  return fmtINRPlain(n, { decimals: digits === 0 ? 0 : 2 });
}

function resolveStationery(company = {}) {
  return {
    name:      company.name        || "Jewellery Shop",
    gstin:     company.gst_number  || company.gstin || "",
    phone:     company.phone       || "",
    address:   company.address     || "",
    email:     company.email       || "",
    cin:       company.cin         || "",
    pan:       company.pan_number  || company.pan   || "",
    fax:       company.fax         || "",
    state:     company.state       || "",
    logo:      company.logo        || company.logo_url || "",
    teluguNote: company.telugu_note || "గమనిక : ఒకసారి అమ్మకం జరిగిన వస్తువులు ఒక వారం వ్యవధిలో వాడకుండా మార్చుకోవచ్చు.",
    thankYou:  company.thank_you   || "Thank you · Visit Again",
  };
}

function buildInvoiceParts(invoice) {
  const items = asArray(invoice.items);
  const gstCgst = Number(invoice.cgst_amount ?? (invoice.gst_amount || 0) / 2);
  const gstSgst = Number(invoice.sgst_amount ?? (invoice.gst_amount || 0) - gstCgst);
  const tableRows = buildInvoiceTableRows(items, { detailed: isDetailedStoneBill(invoice) });

  const totals = tableRows.reduce(
    (acc, row) => {
      if (row.kind === "product") {
        acc.gross += Number(row.gross) || 0;
        acc.net += Number(row.net) || 0;
        acc.va += Number(row.va) || 0;
        acc.qty += Number(row.qty) || 0;
      }
      acc.amount += Number(row.amount) || 0;
      return acc;
    },
    { gross: 0, stoneWt: 0, net: 0, va: 0, amount: 0, qty: 0 },
  );

  return { items, gstCgst, gstSgst, totals, tableRows };
}

function metalRateHeaderHtml(items, I) {
  if (!I.show_gold_rate) return "";
  const lines = headerMetalRateLines(items);
  if (!lines.length) return "";
  const size = I.gold_pt || I.font_pt;
  return lines.map(({ metal, rate }) => {
    const label = metal ? esc(metal) : "";
    const rateText = rate > 0 ? `&#8377;${fmtMoney(rate, 0)}/g` : "";
    const combined = label && rateText ? `${label} : ${rateText}` : (label || rateText);
    if (!combined) return "";
    return `<div class="gold-info" style="font-size:${size}pt">${combined}</div>`;
  }).join("");
}

function customerDetailsHtml(invoice, shop, I) {
  if (!I.show_customer) return "";
  const size = I.customer_pt || I.font_pt;
  const phoneSize = I.phone_pt || I.font_pt;
  const placeSize = I.place_pt || I.font_pt;
  const name = invoice.customer_name || "Walk-in Customer";
  const address = String(invoice.customer_address || asArray(invoice.items)[0]?.customer_address || "").trim();
  const mobile = String(invoice.customer_mobile || "").trim();
  const pan = String(invoice.pan_number || "").trim();
  const aadhaar = String(invoice.aadhaar_number || "").trim();
  return `
          <div style="font-size:${size}pt">Customer : <strong>${esc(name)}</strong></div>
          ${address ? `<div style="font-size:${placeSize}pt">Address : ${esc(address)}</div>` : ""}
          ${I.show_phone && mobile ? `<div style="font-size:${phoneSize}pt">Mobile : ${esc(mobile)}</div>` : ""}
          ${pan ? `<div style="font-size:${placeSize}pt">PAN No : ${esc(pan)}</div>` : ""}
          ${aadhaar ? `<div style="font-size:${placeSize}pt">Aadhaar No : ${esc(aadhaar)}</div>` : ""}`;
}

function padCss(box) {
  return `${box.pad_t ?? 0}px ${box.pad_r ?? 0}px ${box.pad_b ?? 0}px ${box.pad_l ?? 0}px`;
}

function borderCss(L, box, fallback = "both") {
  const mode = box?.border && box.border !== "inherit"
    ? box.border
    : (L.show_lines ? fallback : "none");
  if (mode === "none") return "";
  const w = L.border_pt || 1;
  if (mode === "double") return `border-top:${w}px double #000;border-bottom:${w}px double #000;`;
  if (mode === "bottom") return `border-bottom:${w}px solid #000;`;
  if (mode === "top") return `border-top:${w}px solid #000;`;
  return `border-top:${w}px solid #000;border-bottom:${w}px solid #000;`;
}

function alignClass(align) {
  if (align === "right") return "r";
  if (align === "center") return "c";
  return "l";
}

function visibleColumns(L) {
  return (L.items?.columns || []).filter((c) => c.show);
}

function colCell(col, ctx) {
  switch (col.id) {
    case "qty": return ctx.qty === "" || ctx.qty == null ? "" : String(ctx.qty);
    case "desc": return ctx.desc || "";
    case "hsn": return esc(ctx.hsn);
    case "purity": return esc(ctx.purity);
    case "gross": return ctx.gross == null ? "" : Number(ctx.gross).toFixed(3);
    case "net": return ctx.net == null ? "" : Number(ctx.net).toFixed(3);
    case "va": return ctx.va == null ? "" : Number(ctx.va).toFixed(3);
    case "value": return ctx.amount == null || ctx.amount === "" ? "" : `&#8377;${fmtMoney(ctx.amount)}`;
    default: return "";
  }
}

function colFooter(col, ctx) {
  switch (col.id) {
    case "qty": return String(ctx.totalQty);
    case "gross": return ctx.totals.gross.toFixed(3);
    case "net": return ctx.totals.net.toFixed(3);
    case "va": return ctx.totals.va.toFixed(3);
    case "value": return `&#8377;${fmtMoney(ctx.totals.amount)}`;
    default: return "";
  }
}

// ── A5 Letterhead Invoice (prints in the white centre of pre-printed stationery) ─
function generateA5LetterheadHtml(invoice, company, layoutInput, preview = null, letterheadChannel = "print") {
  const shop = resolveStationery(company);
  const L = mergeInvoiceLayout(layoutInput || company?.print_layout || getCachedInvoiceLayout());
  const { items, gstCgst, gstSgst, totals, tableRows } = buildInvoiceParts(invoice);
  let cols = visibleColumns(L);
  if (!cols.length) cols = (L.items?.columns || []).slice(0, 3);
  const selected = preview?.selected || "";

  const dateStr = invoiceDateStr(invoice);

  const gstPct     = Number(invoice.gst_pct) || 3;
  const discount   = Number(invoice.discount) || 0;
  const oldGoldIsPayment = hasOldGoldPayment(invoice);
  const oldSilverIsPayment = hasOldSilverPayment(invoice);
  // Legacy invoices (pre Old-Gold-as-payment) deducted it from grand total —
  // show that deduction so the breakdown still reconciles with grand_total.
  // New invoices carry Old Gold as a payment instead (never a deduction here).
  const oldGoldDeduction = oldGoldIsPayment ? 0 : (Number(invoice.old_gold_value) || 0);
  const oldSilverDeduction = oldSilverIsPayment ? 0 : (Number(invoice.old_silver_value) || 0);
  const schemeCredit = Number(invoice.scheme_credit) || 0;
  const subtotal   = Number(invoice.subtotal) || 0;
  const grandTotal = Number(invoice.grand_total) || 0;
  // Scheme credit settles the bill like Old Gold Exchange — it never reduces
  // the taxable value GST was actually charged on (see calcInvoiceTotals).
  const taxableAmt = subtotal - discount;
  // Unlike Old Gold Exchange, grand_total is stored *after* scheme credit is
  // netted off — reconstruct the pre-settlement (tax-inclusive) total so the
  // printed Net Amount matches what the payment rows below it sum to.
  const displayNet = grandTotal + schemeCredit;
  const totalQty   = totals.qty || items.reduce((s, it) => s + (it.quantity || 1), 0);
  const T = L.title;
  const M = L.meta;
  const I = L.info;
  const IT = L.items;
  const B = L.breakdown;
  const N = L.net;
  const P = L.payments;
  const W = L.words;
  const NT = L.note;
  const S = L.signatures;
  const pageSize = resolveInvoicePageSize(L, company, { channel: letterheadChannel });
  const pageW = pageSize.pageW;
  const pageH = pageSize.pageH;
  const paperName = pageSize.paper;
  const letterheadHtml = letterheadBackgroundHtml(company, pageH, { channel: letterheadChannel });
  const letterheadCss = letterheadHtml ? letterheadPageCss() : "";
  const isCancelled = Boolean(invoice.cancelled_at);
  const isTest = isTestFinancialDoc(invoice);
  const titleText = isTest ? "TEST / PRE-ACCOUNTS INVOICE" : (T.text || "TAX INVOICE");

  const itemRows = tableRows.map((row) => {
    const snoCell = `<td class="c" style="width:6%">${row.sno}</td>`;
    return `<tr>${snoCell}${cols.map((col) => `<td class="${alignClass(col.align)}" style="width:${col.width}%">${colCell(col, row)}</td>`).join("")}</tr>`;
  }).join("");

  const footCtx = { totalQty, totals };
  const schemePaymentRow = schemeCredit > 0
    ? `<tr><td class="pl">SCHEME REDEMPTION</td><td class="pr">&#8377;${fmtMoney(schemeCredit)}</td></tr>`
    : "";
  const paymentRows = P.show ? (schemePaymentRow + asArray(invoice.payments)
    .filter((p) => Number(p.amount) > 0)
    .map((p) => {
      const label = esc((p.mode || "cash").replace(/_/g, " ").toUpperCase());
      const snap = exchangePaymentSnap(p);
      const subRow = snap
        ? `<tr><td class="pl" colspan="2" style="font-size:0.82em;color:#666;padding-top:0">${esc(Number(snap.weight || 0).toFixed(3))} g | ${esc(snap.purity || "")}${exchangeSnapShowsRate(p) ? ` | &#8377;${fmtMoney(snap.rate || 0, 0)}/g` : ""}</td></tr>`
        : "";
      return `<tr><td class="pl">${label}</td><td class="pr">&#8377;${fmtMoney(p.amount)}</td></tr>${subRow}`;
    }).join("") + balanceDuePaymentRow(invoice, "&#8377;")) : "";

  const sections = {
    title: () => {
      if (!T.show && !M.show_invoice_no && !M.show_date) return "";
      const metaAlign = M.align === "left" ? "left" : M.align === "center" ? "center" : "right";
      return `<div class="title-bar" data-widget="title">
        ${T.show ? `<div class="title-txt">${esc(titleText)}</div>` : "<div></div>"}
        <div class="title-right" style="text-align:${metaAlign}">
          ${M.show_invoice_no ? `<div style="font-size:${M.invoice_font_pt || M.font_pt}pt">${esc(M.invoice_label)}&nbsp;<strong>${esc(invoice.invoice_no || "—")}</strong></div>` : ""}
          ${M.show_date ? `<div style="font-size:${M.date_font_pt || M.font_pt}pt">${esc(M.date_label)}&nbsp;${dateStr}</div>` : ""}
        </div>
      </div>`;
    },
    info: () => {
      if (!I.show) return "";
      const leftPct = I.left_width;
      return `<div class="cust-row" data-widget="info" style="grid-template-columns:${leftPct}% ${100 - leftPct}%; gap:${I.line_gap || 1}px">
        <div style="display:flex;flex-direction:column;gap:${I.line_gap || 1}px">
          ${metalRateHeaderHtml(items, I)}
          ${(() => { const mark = headerHallmark(items); return mark ? `<div style="font-size:${I.gold_pt || I.font_pt}pt">Hallmark No : ${esc(mark)}</div>` : ""; })()}
          ${I.show_gstin && shop.gstin ? `<div style="font-size:${I.gstin_pt || I.font_pt}pt">GSTIN : ${esc(shop.gstin)}</div>` : ""}
        </div>
        <div style="display:flex;flex-direction:column;gap:${I.line_gap || 1}px">
          ${customerDetailsHtml(invoice, shop, I)}
        </div>
      </div>`;
    },
    items: () => {
      if (!IT.show) return "";
      return `<table class="items-table" data-widget="items">
        <colgroup><col style="width:6%">${cols.map((c) => `<col style="width:${c.width}%">`).join("")}</colgroup>
        <thead>
          <tr><th class="c">S.No</th>${cols.map((c) => `<th class="${alignClass(c.align)}">${esc(c.label).replace(/ \(/g, "<br>(")}</th>`).join("")}</tr>
        </thead>
        <tbody>${itemRows || `<tr><td colspan="${cols.length + 1}" class="c" style="padding:8px;color:#888">No items</td></tr>`}</tbody>
        <tfoot>
          <tr><td></td>${cols.map((c) => `<td class="${alignClass(c.align)}">${colFooter(c, footCtx)}</td>`).join("")}</tr>
        </tfoot>
      </table>`;
    },
    breakdown: () => {
      if (!B.show) return "";
      return `<div class="breakdown-wrap" data-widget="breakdown">
        <table class="breakdown-tbl">
          ${discount > 0 ? `<tr><td class="bl">Discount</td><td class="br">${fmtMoney(discount)}</td></tr>` : ""}
          ${oldGoldDeduction > 0 ? `<tr><td class="bl">Old Gold Exchange</td><td class="br">${fmtMoney(oldGoldDeduction)}</td></tr>` : ""}
          ${oldSilverDeduction > 0 ? `<tr><td class="bl">Old Silver Exchange</td><td class="br">${fmtMoney(oldSilverDeduction)}</td></tr>` : ""}
          <tr><td class="bl">${esc(B.taxable_label)}</td><td class="br">${fmtMoney(taxableAmt)}</td></tr>
          <tr><td class="bl">CGST ${(gstPct / 2).toFixed(1)}%</td><td class="br">${fmtMoney(gstCgst)}</td></tr>
          <tr><td class="bl">SGST ${(gstPct / 2).toFixed(1)}%</td><td class="br">${fmtMoney(gstSgst)}</td></tr>
        </table>
      </div>`;
    },
    net: () => {
      if (!N.show) return "";
      return `<div class="net-row" data-widget="net">
        <span class="spacer"></span>
        <span>${esc(N.label)}&nbsp;&nbsp;${fmtMoney(displayNet)}</span>
      </div>`;
    },
    payments: () => paymentRows ? `<div class="payment-section" data-widget="payments"><table class="payment-tbl">${paymentRows}</table></div>` : "",
    words: () => W.show ? `<div class="words" data-widget="words">${esc(W.prefix)} <strong>${esc(numberToWordsIndian(displayNet))} ${esc(W.suffix)}</strong></div>` : "",
    note: () => (NT.show && NT.text) ? `<div class="note" data-widget="note">${esc(NT.text)}</div>` : "",
    signatures: () => S.show ? `<div class="sig-row" data-widget="signatures">
      <div class="sig-block" style="font-size:${S.left_font_pt || S.font_pt}pt">${esc(S.left_text)}<br>${"_".repeat(Math.max(8, Math.round(S.line_w / 8)))}</div>
      <div class="sig-block" style="font-size:${S.right_font_pt || S.font_pt}pt">For ${esc(shop.name)}<br>${"_".repeat(Math.max(8, Math.round(S.line_w / 8)))}<br><span style="font-size:6.5pt;color:#555">${esc(S.right_label)}</span></div>
    </div>` : "",
  };

  const bodyHtml = (L.section_order || []).map((id) => (sections[id] ? sections[id]() : "")).join("\n");

  return `<!DOCTYPE html>
<html lang="en" data-paper="${esc(paperName)}" data-page-w-in="${pageW}" data-page-h-in="${pageH}">
<head>
<meta charset="utf-8">
<title>${isTest ? "Test Invoice" : "Tax Invoice"} &#8212; ${esc(invoice.invoice_no)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: ${L.font_pt}pt;
  line-height: ${L.line_h};
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
@page { size: ${pageW}in ${pageH}in; margin: 0; }
html, body {
  width: ${pageW}in;
  min-height: ${pageH}in;
  margin: 0;
  padding: 0;
  background: #fff;
}
/* This is captured as a raw screenshot, never actually scrolled by a human —
   if the print helper window ever ends up taller/wider than the content
   (leftover sizing from a previous print job, a rounding edge), a native
   scrollbar must never be visible in that screenshot. Hiding it costs
   nothing: content stays fully reachable/paintable, only the scrollbar's
   own visual chrome is suppressed. */
html {
  scrollbar-width: none;
}
html::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.page {
  position: relative;
  width: ${pageW}in;
  min-height: ${pageH}in;
  box-sizing: border-box;
  padding: ${L.header_in}in ${L.side_in}in ${L.footer_in}in ${L.side_in}in;
}
/* printToPDF (POS bills) uses this — one CSS page per .page box, never a
   screenshot. Screen/preview and the old GDI capture path ignore @media print. */
@media print {
  html, body {
    width: ${pageW}in;
    min-height: 0;
    height: auto;
    margin: 0;
    padding: 0;
    background: #fff;
  }
  .page {
    width: ${pageW}in;
    height: ${pageH}in;
    min-height: ${pageH}in;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .page:last-of-type {
    page-break-after: auto;
    break-after: auto;
  }
}
/* Long bills must flow onto additional physical pages, not overwrite the
   footer's reserved blank zone — never re-add overflow:hidden / a fixed
   height here. See desktop/main.js captureHtmlToNativeImage for how the
   print pipeline slices this grown page into multiple physical pages. */
.items-table thead { display: table-header-group; }
.items-table tr,
.payment-tbl tr,
.net-row,
.sig-row,
.words,
.breakdown-wrap {
  page-break-inside: avoid;
  break-inside: avoid;
}
${letterheadCss}
${testInvoiceCss()}
.cancelled-watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-35deg);
  z-index: 50;
  pointer-events: none;
  white-space: nowrap;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 50pt;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(200, 0, 0, 0.32);
  border: 5px solid rgba(200, 0, 0, 0.32);
  padding: 6px 26px;
  border-radius: 10px;
}
.title-bar {
  position: relative;
  ${borderCss(L, T)}
  padding: ${padCss(T)};
  margin-bottom: ${T.mb}px;
  min-height: 1.6em;
}
.title-txt {
  font-size: ${T.font_pt}pt;
  font-weight: ${T.bold ? "bold" : "normal"};
  letter-spacing: ${T.letter_spacing}em;
  text-align: ${T.align};
  padding-right: ${(M.show_invoice_no || M.show_date) ? "7.5em" : "0"};
}
.title-right {
  position: absolute;
  right: ${T.pad_r}px;
  top: 50%;
  transform: translateY(-50%);
  font-size: ${M.font_pt}pt;
  line-height: 1.55;
}
.cust-row {
  display: grid;
  ${borderCss(L, I, "bottom")}
  padding: ${padCss(I)};
  margin-bottom: ${I.mb}px;
  font-size: ${I.font_pt}pt;
  line-height: ${I.line_h};
}
.cust-label { font-weight: bold; text-decoration: underline; margin-bottom: 1px; }
.gold-info { color: #333; }
.items-table { width: 100%; border-collapse: collapse; margin-bottom: ${IT.mb}px; table-layout: fixed; }
.items-table th {
  background: ${IT.header_bg}; color: ${IT.header_fg};
  padding: ${IT.head_pad_y}px ${IT.cell_pad_x}px;
  font-size: ${IT.header_pt}pt;
  border-right: 1px solid #555;
  white-space: normal;
  word-break: break-word;
}
.items-table td {
  padding: ${IT.cell_pad_y}px ${IT.cell_pad_x}px;
  ${L.show_lines ? "border-bottom: 1px dotted #bbb; border-right: 1px dotted #ccc;" : ""}
  font-size: ${IT.body_pt}pt;
  vertical-align: top;
  word-break: break-word;
}
.items-table td:last-child, .items-table th:last-child { border-right: none; }
.items-table tfoot td {
  font-weight: bold;
  ${L.show_lines ? "border-top: 1.5px solid #000; border-bottom: 1px solid #000;" : ""}
  background: ${IT.footer_bg};
  font-size: ${IT.footer_pt}pt;
}
.r { text-align: right; white-space: nowrap; }
.c { text-align: center; }
.l { text-align: left; }
.stone-name { color: #666; font-size: 0.85em; }
.breakdown-wrap {
  display: flex;
  justify-content: ${B.align === "left" ? "flex-start" : "flex-end"};
  padding: ${padCss(B)};
  margin-bottom: ${B.mb}px;
  ${borderCss(L, B, "bottom")}
}
.breakdown-tbl { border-collapse: collapse; font-size: ${B.font_pt}pt; width: ${B.width_pct}%; }
.breakdown-tbl td { padding: 1px 5px; }
.bl { text-align: left; }
.br { text-align: right; font-family: monospace; min-width: 80px; ${L.show_lines ? "border-left: 1px solid #ccc;" : ""} white-space: nowrap; }
.net-row {
  display: flex; align-items: center;
  ${borderCss(L, N)}
  font-size: ${N.font_pt}pt;
  font-weight: ${N.bold ? "bold" : "normal"};
  padding: ${padCss(N)};
  margin-bottom: ${N.mb}px;
  gap: 14px;
  background: ${N.bg};
}
.net-row .spacer { flex: 1; }
.payment-section { padding: ${padCss(P)}; margin-bottom: ${P.mb}px; ${borderCss(L, P, "bottom")} }
.payment-tbl { border-collapse: collapse; font-size: ${P.font_pt}pt; }
.payment-tbl .pl { padding: 1px 6px 1px 0; text-transform: capitalize; }
.payment-tbl .pr { text-align: right; font-family: monospace; min-width: 80px; }
.words { padding: ${padCss(W)}; margin-bottom: ${W.mb}px; font-size: ${W.font_pt}pt; ${borderCss(L, W, "bottom")} }
.note { padding: ${padCss(NT)}; margin-bottom: ${NT.mb}px; font-size: ${NT.font_pt}pt; text-align: ${NT.align}; ${borderCss(L, NT, "none")} }
.sig-row { display: flex; justify-content: space-between; padding: ${padCss(S)}; margin-bottom: ${S.mb}px; font-size: ${S.font_pt}pt; line-height: 1.7; ${borderCss(L, S, "none")} }
.sig-block { text-align: center; }
${preview ? `[data-widget] { cursor: pointer; } [data-widget="${esc(selected)}"] { outline: 2px solid #C08E2D; outline-offset: -1px; background: rgba(192,142,45,0.07); }` : ""}
</style>
</head>
<body>
<div class="page">
${letterheadHtml ? `${letterheadHtml}\n<div class="page-body">\n${isTest ? testInvoiceBannerHtml() : ""}${bodyHtml}\n</div>\n` : `${isTest ? testInvoiceBannerHtml() : ""}${bodyHtml}\n`}${isTest ? '<div class="test-mode-watermark">TEST</div>\n' : ""}${isCancelled ? '<div class="cancelled-watermark">Cancelled</div>\n' : ""}</div>
<script>
(function () {
  // Real pagination: a long bill must be split into genuinely separate
  // .page boxes, each with its own header/footer padding — NOT one tall
  // flowing box sliced into equal pixel chunks afterward. Padding only
  // reserves blank space once, at the true end of a box; slicing a single
  // continuous flow does not re-create that blank gap at each page boundary,
  // which is why an earlier version of this script still overlapped the
  // footer on longer bills. Runs unconditionally (with or without an
  // uploaded letterhead image) since the blank-margin requirement applies
  // either way. On any failure, leaves the single original .page in place —
  // a safer fallback than a half-rebuilt DOM.
  try {
    var pageWIn = ${pageW};
    var pageHIn = ${pageH};
    var headerIn = ${L.header_in};
    var footerIn = ${L.footer_in};
    var oldPage = document.querySelector(".page");
    if (!oldPage) return;
    var bgTemplate = oldPage.querySelector("img.letterhead-bg");
    var watermark = oldPage.querySelector(".cancelled-watermark");

    function run() {
      var pxPerIn = oldPage.getBoundingClientRect().width / pageWIn;
      if (!(pxPerIn > 0)) return;
      var contentBudgetPx = (pageHIn - headerIn - footerIn) * pxPerIn;
      if (!(contentBudgetPx > 0)) return;

      var contentRoot = oldPage.querySelector(".page-body") || oldPage;
      var units = [];

      Array.from(contentRoot.children).forEach(function (child) {
        if (child === watermark) return;
        if (child.tagName === "TABLE" && child.classList.contains("items-table")) {
          var thead = child.querySelector("thead");
          var tfoot = child.querySelector("tfoot");
          var colgroup = child.querySelector("colgroup");
          var rows = Array.from(child.querySelectorAll("tbody > tr"));
          if (!rows.length) {
            units.push({ type: "atomic", node: child, height: child.getBoundingClientRect().height });
            return;
          }
          var theadHeight = thead ? thead.getBoundingClientRect().height : 0;
          var tfootHeight = tfoot ? tfoot.getBoundingClientRect().height : 0;
          rows.forEach(function (tr, idx) {
            units.push({
              type: "item-row",
              node: tr,
              height: tr.getBoundingClientRect().height,
              isLastRow: idx === rows.length - 1,
              colgroup: colgroup,
              thead: thead,
              tfoot: tfoot,
              theadHeight: theadHeight,
              tfootHeight: tfootHeight,
            });
          });
        } else if (child.classList && child.classList.contains("payment-section")) {
          var table = child.querySelector("table.payment-tbl");
          if (!table) {
            units.push({ type: "atomic", node: child, height: child.getBoundingClientRect().height });
            return;
          }
          var prows = Array.from(table.querySelectorAll("tr"));
          var i = 0;
          while (i < prows.length) {
            var group = [prows[i]];
            var next = prows[i + 1];
            if (next) {
              var cells = next.querySelectorAll("td");
              if (cells.length === 1 && cells[0].getAttribute("colspan") === "2") {
                group.push(next);
                i += 1;
              }
            }
            var gh = group.reduce(function (s, r) { return s + r.getBoundingClientRect().height; }, 0);
            units.push({ type: "payment-rows", rows: group, height: gh });
            i += 1;
          }
        } else {
          units.push({ type: "atomic", node: child, height: child.getBoundingClientRect().height });
        }
      });

      if (!units.length) return;

      // Greedy bin-pack: close the current page and start a new one once the
      // next unit would overflow it (never on an empty page — a single unit
      // taller than a full page still goes somewhere rather than looping).
      // Item rows carry extra "cost" for the thead that must be (re)printed
      // wherever a table starts (page 1 or any continuation), and for the
      // tfoot that must be printed once, wherever the true last row lands —
      // otherwise a row could be accepted onto a page that then doesn't
      // actually have room left for its table's header/totals row.
      var buckets = [[]];
      var running = 0;
      var prevWasItemRow = false;
      units.forEach(function (u) {
        var isItemRow = u.type === "item-row";
        var tfootCost = (isItemRow && u.isLastRow && u.tfoot) ? u.tfootHeight : 0;
        var startsNewTable = isItemRow && !prevWasItemRow;
        var cost = u.height + tfootCost + (startsNewTable ? u.theadHeight : 0);
        if (running > 0 && running + cost > contentBudgetPx) {
          buckets.push([]);
          running = 0;
          startsNewTable = isItemRow; // definitely the first row of a fresh table now
          cost = u.height + tfootCost + (startsNewTable ? u.theadHeight : 0);
        }
        buckets[buckets.length - 1].push(u);
        running += cost;
        prevWasItemRow = isItemRow;
      });

      if (buckets.length <= 1) return; // fits on one page — nothing to rebuild

      var frag = document.createDocumentFragment();
      buckets.forEach(function (bucket, pageIdx) {
        var pageDiv = document.createElement("div");
        pageDiv.className = "page";
        if (pageIdx < buckets.length - 1) {
          pageDiv.style.pageBreakAfter = "always";
          pageDiv.style.breakAfter = "page";
        }
        var body = pageDiv;
        if (bgTemplate) {
          var bg = bgTemplate.cloneNode(true);
          bg.style.top = "0";
          pageDiv.appendChild(bg);
          body = document.createElement("div");
          body.className = "page-body";
          pageDiv.appendChild(body);
        }
        if (watermark) body.appendChild(watermark.cloneNode(true));

        var currentTable = null;
        var currentTbody = null;
        bucket.forEach(function (u) {
          if (u.type === "item-row") {
            if (!currentTable) {
              currentTable = document.createElement("table");
              currentTable.className = "items-table";
              if (u.colgroup) currentTable.appendChild(u.colgroup.cloneNode(true));
              if (u.thead) currentTable.appendChild(u.thead.cloneNode(true));
              currentTbody = document.createElement("tbody");
              currentTable.appendChild(currentTbody);
              body.appendChild(currentTable);
            }
            currentTbody.appendChild(u.node);
            if (u.isLastRow && u.tfoot) currentTable.appendChild(u.tfoot.cloneNode(true));
          } else {
            currentTable = null;
            currentTbody = null;
            if (u.type === "payment-rows") {
              var last = body.lastElementChild;
              var section, tbl;
              if (last && last.dataset && last.dataset.continuedPayments === "1") {
                section = last;
                tbl = section.querySelector("table.payment-tbl");
              } else {
                section = document.createElement("div");
                section.className = "payment-section";
                section.dataset.continuedPayments = "1";
                tbl = document.createElement("table");
                tbl.className = "payment-tbl";
                section.appendChild(tbl);
                body.appendChild(section);
              }
              u.rows.forEach(function (r) { tbl.appendChild(r); });
            } else {
              body.appendChild(u.node);
            }
          }
        });

        frag.appendChild(pageDiv);
      });

      oldPage.parentNode.replaceChild(frag, oldPage);
    }

    // Run immediately — no need to wait for the letterhead image to finish
    // loading first. It's always position:absolute (out of normal flow), so
    // it can never affect the surrounding content's layout/height, which is
    // all this measures. (An earlier version waited for the image's "load"
    // event before running, with no "error" listener — if that event never
    // fired for any reason, pagination silently never ran at all. The
    // desktop capture step already waits for every image, including the
    // ones this script clones per page, before taking any screenshot.)
    run();
  } catch (e) { /* leave the single original .page in place */ }
})();
<\/script>
</body>
</html>`;
}

// ── A4 Tax Invoice (matching physical "Khazana" style format) ─────────────────
function generateA4InvoiceHtml(invoice, company) {
  const shop = resolveStationery(company);
  const { items, gstCgst, gstSgst, totals, tableRows } = buildInvoiceParts(invoice);

  const dateStr = invoiceDateStr(invoice);

  const gstPct       = Number(invoice.gst_pct) || 3;
  const discount     = Number(invoice.discount) || 0;
  const oldGoldIsPayment = hasOldGoldPayment(invoice);
  const oldSilverIsPayment = hasOldSilverPayment(invoice);
  // Legacy invoices (pre Old-Gold-as-payment) deducted it from grand total —
  // show that deduction so the breakdown still reconciles with grand_total.
  const oldGoldDeduction = oldGoldIsPayment ? 0 : (Number(invoice.old_gold_value) || 0);
  const oldSilverDeduction = oldSilverIsPayment ? 0 : (Number(invoice.old_silver_value) || 0);
  const schemeCredit = Number(invoice.scheme_credit) || 0;
  const subtotal     = Number(invoice.subtotal) || 0;
  const grandTotal   = Number(invoice.grand_total) || 0;
  // Scheme credit settles the bill like Old Gold Exchange — it never reduces
  // the taxable value GST was actually charged on (see calcInvoiceTotals).
  const taxableAmt   = subtotal - discount;
  // Unlike Old Gold Exchange, grand_total is stored *after* scheme credit is
  // netted off — reconstruct the pre-settlement (tax-inclusive) total so the
  // printed Net Amount matches what the payment rows below it sum to.
  const displayNet   = grandTotal + schemeCredit;
  const totalQty     = totals.qty || items.reduce((s, it) => s + (it.quantity || 1), 0);
  const metalI = { show_gold_rate: true, gold_pt: 8.5, font_pt: 8.5 };
  const custI = { show_customer: true, show_phone: true, show_place_of_supply: Boolean(shop.state), customer_pt: 8.5, phone_pt: 8.5, place_pt: 8.5, place_label: "Place of Supply" };
  const headerMark = headerHallmark(items);
  const isCancelled = Boolean(invoice.cancelled_at);
  const isTest = isTestFinancialDoc(invoice);

  const itemRows = tableRows.map((row) => `<tr>
      <td class="c">${row.sno}</td>
      <td class="c">${row.qty === "" || row.qty == null ? "" : row.qty}</td>
      <td>${row.desc || ""}</td>
      <td class="c">${esc(row.hsn)}</td>
      <td class="c">${esc(row.purity)}</td>
      <td class="r">${row.gross == null ? "" : Number(row.gross).toFixed(3)}</td>
      <td class="r">${row.net == null ? "" : Number(row.net).toFixed(3)}</td>
      <td class="r">${row.va == null ? "" : Number(row.va).toFixed(3)}</td>
      <td class="r">${row.amount == null || row.amount === "" ? "" : `₹${fmtMoney(row.amount)}`}</td>
    </tr>`).join("");

  const schemePaymentRow = schemeCredit > 0
    ? `<tr><td class="pl">SCHEME REDEMPTION</td><td class="pr">₹${fmtMoney(schemeCredit)}</td></tr>`
    : "";
  const paymentRows = schemePaymentRow + asArray(invoice.payments)
    .filter((p) => Number(p.amount) > 0)
    .map((p) => {
      const label = esc((p.mode || "cash").replace(/_/g, " ").toUpperCase());
      const snap = exchangePaymentSnap(p);
      const subRow = snap
        ? `<tr><td class="pl" colspan="2" style="font-size:0.82em;color:#666;padding-top:0">${esc(Number(snap.weight || 0).toFixed(3))} g | ${esc(snap.purity || "")}${exchangeSnapShowsRate(p) ? ` | ₹${fmtMoney(snap.rate || 0, 0)}/g` : ""}</td></tr>`
        : "";
      return `<tr><td class="pl">${label}</td><td class="pr">₹${fmtMoney(p.amount)}</td></tr>${subRow}`;
    }).join("") + balanceDuePaymentRow(invoice, "₹");

  return `<!DOCTYPE html>
<html lang="en" data-paper="A4" data-page-w-in="8.27" data-page-h-in="11.69">
<head>
<meta charset="utf-8">
<title>${isTest ? "Test Invoice" : "Tax Invoice"} — ${esc(invoice.invoice_no)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
/* data-page-w-in/h-in above (and the matching explicit width below) are what
   the desktop app's screenshot-based print pipeline reads to size its capture
   window correctly — without them it fell back to the A5 layout's default
   (5.7in), squeezing this wider A4 table into too narrow a capture and
   clipping the rightmost column(s). The A5 letterhead template already
   declares these; this format never did. */
html, body { width: 8.27in; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@page { size: A4 portrait; margin: 8mm 10mm; }

/* Captured as a raw screenshot, never scrolled by a human — never let a
   native scrollbar show up in that image (see generateA5LetterheadHtml). */
html {
  scrollbar-width: none;
}
html::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.outer { position: relative; border: 1.5px solid #000; }
${testInvoiceCss()}
.cancelled-watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-35deg);
  z-index: 50;
  pointer-events: none;
  white-space: nowrap;
  font-size: 60pt;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(200, 0, 0, 0.32);
  border: 5px solid rgba(200, 0, 0, 0.32);
  padding: 6px 26px;
  border-radius: 10px;
}

.top-bar { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; border-bottom: 1.5px solid #000; }
.top-title { font-size: 13pt; font-weight: bold; letter-spacing: 0.06em; }
.top-right { text-align: right; font-size: 9pt; line-height: 1.6; }

.info-row { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1.5px solid #000; }
.info-col { padding: 5px 8px; font-size: 8.5pt; line-height: 1.65; }
.info-col:first-child { border-right: 1px solid #000; }
.shop-name { font-size: 11pt; font-weight: bold; margin-bottom: 3px; }
.cust-label { font-size: 9pt; font-weight: bold; text-decoration: underline; margin-bottom: 3px; }

/* table-layout: fixed makes the declared column widths below authoritative —
   without it (the state this was in before), a browser's automatic table
   layout can widen the whole table past the page edge to fit a long product
   name or a large rupee amount, and whichever machine's font rendering
   happens to need slightly more room clips the rightmost column(s). Also
   widened the value column, since jewelry invoice amounts routinely run into
   lakhs (e.g. "₹4,04,049.60") and 80px was tight even without this bug. */
.items-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.items-table th { background: #1a1a1a; color: #fff; padding: 3px 4px; font-size: 8pt; text-align: center; border-right: 1px solid #555; white-space: normal; word-break: break-word; }
.items-table td { padding: 3px 4px; border-bottom: 1px dotted #ccc; border-right: 1px dotted #ddd; font-size: 8.5pt; vertical-align: top; word-break: break-word; }
.items-table td:last-child, .items-table th:last-child { border-right: none; }
.items-table tfoot td { font-weight: bold; border-top: 1.5px solid #000; border-bottom: 2px solid #000; background: #f5f5f5; border-right: 1px dotted #ccc; }
.r { text-align: right; white-space: nowrap; }
.c { text-align: center; }
.stone-name { color: #666; font-size: 0.85em; }

.breakdown-wrap { padding: 3px 8px; display: flex; justify-content: flex-end; border-bottom: 1px solid #ddd; }
.breakdown-tbl { border-collapse: collapse; font-size: 8.5pt; }
.breakdown-tbl td { padding: 1.5px 6px; }
.bl { text-align: left; }
.br { text-align: right; font-family: monospace; white-space: nowrap; min-width: 100px; border-left: 1px solid #ddd; }

.net-row { display: flex; align-items: center; border-top: 2px solid #000; border-bottom: 2px solid #000; font-size: 9pt; font-weight: bold; padding: 4px 8px; gap: 20px; background: #f9f9f9; }
.net-row .spacer { flex: 1; }

.payment-section { padding: 4px 8px; border-bottom: 1px solid #ddd; }
.payment-tbl { border-collapse: collapse; font-size: 8.5pt; }
.payment-tbl .pl { padding: 1.5px 8px 1.5px 0; text-transform: capitalize; }
.payment-tbl .pr { text-align: right; font-family: monospace; min-width: 100px; padding: 1.5px 0; }

.words { padding: 3px 8px; font-size: 8pt; border-bottom: 1px solid #ddd; }

.sig-row { display: flex; justify-content: space-between; padding: 10px 20px 6px; font-size: 8pt; line-height: 1.7; }
.sig-block { text-align: center; }
</style>
</head>
<body>
<div class="outer">

  <div class="top-bar">
    <div class="top-title">${isTest ? "TEST / PRE-ACCOUNTS INVOICE" : "TAX INVOICE"}</div>
    <div class="top-right">
      <div>No :&nbsp;<strong>${esc(invoice.invoice_no || "—")}</strong></div>
      <div>Date :&nbsp;${dateStr}</div>
    </div>
  </div>

  <div class="info-row">
    <div class="info-col">
      ${shop.logo ? `<div style="margin-bottom:6px"><img src="${esc(shop.logo)}" alt="" style="max-height:48px;max-width:160px;object-fit:contain" /></div>` : ""}
      <div class="shop-name">${esc(shop.name)}</div>
      ${shop.cin     ? `<div>CIN : ${esc(shop.cin)}</div>` : ""}
      ${shop.address ? `<div>${esc(shop.address)}</div>` : ""}
      ${shop.phone   ? `<div>Tel : ${esc(shop.phone)}</div>` : ""}
      ${shop.gstin   ? `<div>GSTIN : ${esc(shop.gstin)}</div>` : ""}
      ${shop.fax     ? `<div>Fax : ${esc(shop.fax)}</div>` : ""}
      ${metalRateHeaderHtml(items, metalI)}
      ${headerMark ? `<div>Hallmark No : ${esc(headerMark)}</div>` : ""}
      ${shop.pan     ? `<div>PANNO : ${esc(shop.pan)}</div>` : ""}
    </div>
    <div class="info-col">
      ${customerDetailsHtml(invoice, shop, custI)}
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th style="width:24px">S.No</th>
        <th style="width:24px">QTY</th>
        <th style="text-align:left">DESCRIPTION</th>
        <th style="width:50px">HSN Code</th>
        <th style="width:54px">PURITY</th>
        <th style="width:68px">GROSS WT<br>(Grams)</th>
        <th style="width:64px">NET WT<br>(Grams)</th>
        <th style="width:54px">VA<br>(Gms)</th>
        <th style="width:98px">PRODUCT<br>VALUE</th>
      </tr>
    </thead>
    <tbody>${itemRows || `<tr><td colspan="9" class="c" style="padding:10px;color:#888">No items</td></tr>`}</tbody>
    <tfoot>
      <tr>
        <td></td>
        <td class="c">${totalQty}</td>
        <td></td>
        <td></td>
        <td></td>
        <td class="r">${totals.gross.toFixed(3)}</td>
        <td class="r">${totals.net.toFixed(3)}</td>
        <td class="r">${totals.va.toFixed(3)}</td>
        <td class="r">₹${fmtMoney(totals.amount)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="breakdown-wrap">
    <table class="breakdown-tbl">
      ${discount > 0 ? `<tr><td class="bl">Discount</td><td class="br">${fmtMoney(discount)}</td></tr>` : ""}
      ${oldGoldDeduction > 0 ? `<tr><td class="bl">Old Gold Exchange</td><td class="br">${fmtMoney(oldGoldDeduction)}</td></tr>` : ""}
      ${oldSilverDeduction > 0 ? `<tr><td class="bl">Old Silver Exchange</td><td class="br">${fmtMoney(oldSilverDeduction)}</td></tr>` : ""}
      <tr><td class="bl">Taxable Amount</td><td class="br">${fmtMoney(taxableAmt)}</td></tr>
      <tr><td class="bl">CGST ${(gstPct / 2).toFixed(1)}%</td><td class="br">${fmtMoney(gstCgst)}</td></tr>
      <tr><td class="bl">SGST ${(gstPct / 2).toFixed(1)}%</td><td class="br">${fmtMoney(gstSgst)}</td></tr>
    </table>
  </div>

  <div class="net-row">
    <span class="spacer"></span>
    <span>Net Amount&nbsp;&nbsp;${fmtMoney(displayNet)}</span>
  </div>

  ${paymentRows ? `
  <div class="payment-section">
    <table class="payment-tbl">${paymentRows}</table>
  </div>` : ""}

  <div class="words">
    In Words: <strong>${esc(numberToWordsIndian(displayNet))} Rupees Only</strong>
  </div>

  <div class="sig-row">
    <div class="sig-block">Customer Signature<br>________________________</div>
    <div class="sig-block">For ${esc(shop.name)}<br>________________________<br><span style="font-size:7pt;color:#555">Authorised Signatory</span></div>
  </div>

${isTest ? testInvoiceBannerHtml() : ""}
${isTest ? '<div class="test-mode-watermark">TEST</div>' : ""}
${isCancelled ? '<div class="cancelled-watermark">Cancelled</div>' : ""}
</div>
</body>
</html>`;
}

/**
 * Generate invoice HTML for printing or download.
 * Print preview / printer use mode='print'. PDF/HTML download uses mode='download'.
 * Each mode respects its own letterhead toggle from Settings → Billing.
 * Pass mode='a4' to get the full A4 format (plain paper / no letterhead image).
 */
export function generateInvoicePrintHTML(invoice, company = {}, mode = "print", layout = null, preview = null) {
  if (mode === "a4") return generateA4InvoiceHtml(invoice, company || {});
  const channel = mode === "download" ? "download" : "print";
  return generateA5LetterheadHtml(invoice, company || {}, layout, preview, channel);
}

export async function generateInvoicePrintHTMLAsync(invoice, company = {}, mode = "print") {
  const { loadInvoiceLayout } = await import("@/lib/invoiceLayout");
  const layout = await loadInvoiceLayout();
  return generateInvoicePrintHTML(invoice, company, mode, layout);
}

/** Download the invoice as an HTML file (A5 letterhead format). */
export async function downloadInvoiceHtml(invoice, company = {}, layout = null) {
  const html = layout
    ? generateInvoicePrintHTML(invoice, company, "download", layout)
    : await generateInvoicePrintHTMLAsync(invoice, company, "download");
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${invoice.invoice_no || "invoice"}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true };
}

/** Download the invoice as a real PDF file (A5 letterhead format). */
export async function downloadInvoicePdf(invoice, company = {}, layout = null, options = {}) {
  const html = layout
    ? generateInvoicePrintHTML(invoice, company, "download", layout)
    : await generateInvoicePrintHTMLAsync(invoice, company, "download");
  const { downloadPdf } = await import("@/lib/printHtml");
  const fileName = String(invoice.invoice_no || "invoice").replace(/[\\/:*?"<>|]/g, "-");
  const next = { ...options };
  if (next.useInvoiceDownloadFolder && !next.saveDir) {
    try {
      const { default: api } = await import("@/lib/api");
      const { data } = await api.get("/settings/invoice");
      const folder = String(data?.invoice_pdf_folder || "").trim();
      if (folder) next.saveDir = folder;
    } catch {
      /* keep Save As dialog if settings cannot be read */
    }
    delete next.useInvoiceDownloadFolder;
  }
  return downloadPdf(html, { fileName, ...next });
}
