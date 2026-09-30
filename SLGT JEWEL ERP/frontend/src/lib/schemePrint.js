/**
 * Scheme documents — three separate print templates:
 *   A. Scheme Creation Print      (A5 only)
 *   B. Scheme Statement Print     (A4 default, A5 optional)
 *   C. Scheme Closure Certificate (A5 default, closed schemes only)
 *
 * Data comes from GET /api/schemes/:id/print-data (stored data only); field
 * visibility comes from Settings → Scheme (GET /api/settings/scheme-print).
 * Every field is gated by its checklist key — an unchecked field is not
 * rendered at all.
 *
 * Same print architecture as invoices: company stationery from
 * resolveStationery(), standalone HTML with its own <style>, explicit
 * @page size and data-page-w-in / data-page-h-in (read by the desktop print
 * pipeline and PrintPreviewModal). The application theme never applies here.
 */
import { resolveStationery } from "@/lib/invoicePrint";
import { LETTERHEAD_PAPER } from "@/lib/invoiceLetterhead";
import { fmtINRPlain } from "@/lib/format";

export const SCHEME_DOCS = Object.freeze({ CREATION: "creation", STATEMENT: "statement", CLOSURE: "closure" });

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const money = (n) => (n == null || n === "" ? "—" : `&#8377;${fmtINRPlain(n)}`);
const grams = (n) => (n == null ? "—" : `${Number(n).toFixed(3)} g`);
const fmtCustomerCode = (serialNo) => (serialNo == null ? "—" : `CUST-${String(serialNo).padStart(3, "0")}`);

function dateStr(value) {
  if (!value) return "—";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function nowStr() {
  const d = new Date();
  return `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

const MODE_LABELS = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank Transfer", cheque: "Cheque", neft: "NEFT", rtgs: "RTGS" };
const modeLabel = (m) => (m ? MODE_LABELS[String(m).toLowerCase()] || String(m) : "—");

function schemeTypeLabel(scheme) {
  return scheme?.is_gold_scheme ? "Gold (grams at day's rate)" : "Cash savings";
}

/** Resolve {fields, paper} for a document from the scheme_print settings (defaults = all ON except catalog defaults). */
export function schemeDocSettings(settings, doc) {
  const s = settings?.[doc] || {};
  return { fields: s.fields || {}, paper: s.paper };
}

function pageSize(doc, paper) {
  if (doc === SCHEME_DOCS.CREATION) return LETTERHEAD_PAPER.A5; // A5 only
  if (doc === SCHEME_DOCS.STATEMENT) return paper === "A5" ? LETTERHEAD_PAPER.A5 : LETTERHEAD_PAPER.A4;
  return paper === "A4" ? LETTERHEAD_PAPER.A4 : LETTERHEAD_PAPER.A5;
}

function baseCss(page) {
  const small = page.id === "A5";
  return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${page.wIn}in; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: ${small ? 8.5 : 9.5}pt; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: ${page.id} portrait; margin: 0; }
  html { scrollbar-width: none; }
  html::-webkit-scrollbar { display: none; width: 0; height: 0; }
  .page { width: ${page.wIn}in; min-height: ${page.hIn}in; padding: ${small ? "7mm 7mm" : "10mm 12mm"}; display: flex; flex-direction: column; }
  .frame { border: 1.2px solid #000; padding: ${small ? "4mm" : "5mm"}; flex: 1; display: flex; flex-direction: column; }
  .hdr { display: flex; align-items: center; gap: 3mm; border-bottom: 1px solid #000; padding-bottom: 2.5mm; margin-bottom: 3mm; }
  .hdr img { max-height: ${small ? 14 : 18}mm; max-width: ${small ? 24 : 32}mm; object-fit: contain; }
  .hdr .co { flex: 1; text-align: center; }
  .co-name { font-size: ${small ? 13 : 16}pt; font-weight: bold; letter-spacing: 0.02em; }
  .co-line { font-size: ${small ? 7.5 : 8.5}pt; margin-top: 0.6mm; }
  .title { text-align: center; font-weight: bold; font-size: ${small ? 10.5 : 12}pt; letter-spacing: 0.08em; margin: 1mm 0 3mm; }
  .title small { display: block; font-size: ${small ? 7.5 : 8.5}pt; font-weight: normal; letter-spacing: 0; margin-top: 0.8mm; }
  .kv { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
  .kv td { padding: ${small ? "0.7mm 1.3mm" : "1.1mm 1.5mm"}; border: 0.6px solid #000; vertical-align: top; }
  .kv td.k { width: 38%; font-weight: bold; background: #f2f2f2; }
  .kv2 td.k { width: 22%; }
  .kv2 td { width: 28%; }
  .two { display: flex; gap: 3mm; }
  .two > div { flex: 1; }
  .sec { font-weight: bold; font-size: ${small ? 8.5 : 9.5}pt; margin: 1.5mm 0 1.2mm; text-transform: uppercase; letter-spacing: 0.04em; }
  .grid { display: grid; grid-template-columns: repeat(${small ? 2 : 4}, 1fr); border: 0.6px solid #000; margin-bottom: 3mm; }
  .grid > div { padding: 1.4mm 1.8mm; border-right: 0.6px solid #000; border-bottom: 0.6px solid #000; }
  .grid .l { font-size: ${small ? 6.8 : 7.5}pt; text-transform: uppercase; }
  .grid .v { font-weight: bold; font-size: ${small ? 9 : 10}pt; margin-top: 0.4mm; }
  table.tx { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
  table.tx th, table.tx td { border: 0.6px solid #000; padding: 1mm 1.4mm; text-align: left; }
  table.tx th { background: #f2f2f2; font-size: ${small ? 7.2 : 8}pt; text-transform: uppercase; }
  table.tx td.r, table.tx th.r { text-align: right; }
  table.tx tr.pending td { color: #444; }
  .status { display: inline-block; border: 1px solid #000; padding: 0.4mm 2mm; font-weight: bold; text-transform: uppercase; font-size: ${small ? 7.5 : 8.5}pt; }
  .cert { border: 1px solid #000; padding: 3mm; margin-bottom: 3mm; line-height: 1.55; text-align: justify; }
  .spacer { flex: 1; }
  .sign { display: flex; justify-content: space-between; margin-top: ${small ? 8 : 14}mm; }
  .sign div { width: 42%; text-align: center; border-top: 0.8px solid #000; padding-top: 1mm; font-size: ${small ? 7.5 : 8.5}pt; }
  .foot { text-align: center; font-size: ${small ? 7.5 : 8.5}pt; margin-top: 3mm; border-top: 0.6px solid #000; padding-top: 1.5mm; }
  .printed { text-align: right; font-size: ${small ? 6.5 : 7.5}pt; color: #333; margin-top: 1mm; }
  .test { text-align: center; border: 1px dashed #000; font-weight: bold; padding: 1mm; margin-bottom: 2mm; }
  @media print {
    html, body {
      width: ${page.wIn}in;
      min-height: 0;
      height: auto;
      margin: 0;
      padding: 0;
      background: #fff;
    }
    .page {
      width: ${page.wIn}in;
      min-height: ${page.hIn}in;
      page-break-after: always;
      break-after: page;
    }
    .page:last-of-type {
      page-break-after: auto;
      break-after: auto;
    }
    .frame {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .kv tr,
    table.tx tr,
    .grid > div,
    .sec,
    .title,
    .cert,
    .sign,
    .foot,
    .status {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    table.tx thead { display: table-header-group; }
  }
  `;
}

function headerHtml(f, shop) {
  if (f.header === false) return "";
  const lines = [];
  if (f.company_address !== false && shop.address) lines.push(`<div class="co-line">${esc(shop.address)}</div>`);
  const contact = [];
  if (f.company_phone !== false && shop.phone) contact.push(`Ph: ${esc(shop.phone)}`);
  if (f.company_email && shop.email) contact.push(esc(shop.email));
  if (contact.length) lines.push(`<div class="co-line">${contact.join(" &nbsp;|&nbsp; ")}</div>`);
  if (f.company_gst !== false && shop.gstin) lines.push(`<div class="co-line">GSTIN: ${esc(shop.gstin)}</div>`);
  const logo = f.company_logo !== false && shop.logo ? `<img src="${esc(shop.logo)}" alt="">` : "";
  const name = f.company_name !== false ? `<div class="co-name">${esc(shop.name)}</div>` : "";
  if (!logo && !name && !lines.length) return "";
  return `<div class="hdr">${logo}<div class="co">${name}${lines.join("")}</div></div>`;
}

function kvRows(rows) {
  const html = rows.filter(Boolean).map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`).join("");
  return html ? `<table class="kv">${html}</table>` : "";
}

/** Two label/value pairs per row — keeps the one-page A5 certificate compact. */
function kvRows2(rows) {
  const list = rows.filter(Boolean);
  if (!list.length) return "";
  const trs = [];
  for (let i = 0; i < list.length; i += 2) {
    const [a, b] = [list[i], list[i + 1]];
    trs.push(`<tr><td class="k">${esc(a[0])}</td><td>${a[1]}</td>${b ? `<td class="k">${esc(b[0])}</td><td>${b[1]}</td>` : `<td class="k"></td><td></td>`}</tr>`);
  }
  return `<table class="kv kv2">${trs.join("")}</table>`;
}

/** Customer rows gated by checklist keys. */
function customerRows(f, d) {
  const c = d.customer || {};
  return [
    f.customer_name !== false && ["Customer Name", esc(c.name || "—")],
    f.customer_phone !== false && ["Customer Phone", esc(c.mobile || "—")],
    f.customer_address && c.address && ["Address", esc(c.address)],
    f.customer_serial && c.serial_no != null && ["Customer S.No", esc(c.serial_no)],
  ];
}

/** Scheme rows gated by checklist keys. */
function schemeRows(f, d) {
  const s = d.scheme || {};
  const sum = d.summary || {};
  const duration = `${s.duration_months} month${s.duration_months === 1 ? "" : "s"}${s.bonus_months ? ` (+${s.bonus_months} bonus)` : ""}`;
  return [
    f.scheme_number !== false && ["Scheme No.", esc(s.serial_no != null ? s.serial_no : "—")],
    f.scheme_name !== false && ["Scheme Name", esc(s.plan_name || "—")],
    f.scheme_type !== false && ["Scheme Type", esc(schemeTypeLabel(s))],
    f.start_date !== false && ["Start Date", dateStr(s.start_date)],
    f.maturity_date !== false && ["Maturity Date", dateStr(s.maturity_date)],
    f.duration !== false && ["Duration", esc(duration)],
    f.installment_amount !== false && ["Installment Amount", money(s.monthly_amount)],
    f.total_amount !== false && ["Total Amount", money(sum.total_amount)],
    f.maturity_value !== false && !s.is_gold_scheme && ["Maturity Value", money(sum.maturity_value)],
  ];
}

function staffRows(f, d) {
  const e = d.enrolled_by;
  return [
    f.created_by !== false && ["Created By", esc(e?.name || "—")],
    f.employee_phone !== false && ["Employee Phone", esc(e?.mobile || "—")],
  ];
}

function footerHtml(f, shop) {
  const parts = [];
  if (f.signatures !== false) {
    parts.push(`<div class="spacer"></div><div class="sign"><div>Customer Signature</div><div>Authorised Signatory</div></div>`);
  } else {
    parts.push(`<div class="spacer"></div>`);
  }
  if (f.footer !== false && shop.thankYou) parts.push(`<div class="foot">${esc(shop.thankYou)}</div>`);
  if (f.printed_on !== false) parts.push(`<div class="printed">Printed on ${esc(nowStr())}</div>`);
  return parts.join("");
}

function wrap({ page, title, body }) {
  return `<!DOCTYPE html>
<html lang="en" data-paper="${page.id}" data-page-w-in="${page.wIn}" data-page-h-in="${page.hIn}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${baseCss(page)}</style>
</head>
<body><div class="page"><div class="frame">${body}</div></div>
<script>
(function() {
  var pageH = ${page.hIn};
  var pageW = ${page.wIn};
  var small = ${page.id === "A5"};
  var padding = small ? 7 : 10;
  var paddingIn = padding * 2 / 25.4;

  function paginate() {
    var oldPage = document.querySelector(".page");
    if (!oldPage) return;
    var frame = oldPage.querySelector(".frame") || oldPage;
    var children = Array.from(frame.children);
    if (children.length === 0) return;

    var headerEls = [];
    var titleEls = [];
    var testEls = [];
    var contentEls = [];
    var footerEls = [];

    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      if (el.classList.contains("hdr")) headerEls.push(el);
      else if (el.classList.contains("title")) titleEls.push(el);
      else if (el.classList.contains("test")) testEls.push(el);
      else if (el.classList.contains("spacer") || el.classList.contains("sign") || el.classList.contains("foot") || el.classList.contains("printed")) footerEls.push(el);
      else contentEls.push(el);
    }

    var headerHeight = 0;
    for (var i = 0; i < headerEls.length; i++) headerHeight += headerEls[i].offsetHeight;
    for (var i = 0; i < titleEls.length; i++) headerHeight += titleEls[i].offsetHeight;
    for (var i = 0; i < testEls.length; i++) headerHeight += testEls[i].offsetHeight;

    var footerHeight = 0;
    for (var i = 0; i < footerEls.length; i++) footerHeight += footerEls[i].offsetHeight;

    var availableHeight = (pageH - paddingIn * 2) * 96 - headerHeight - footerHeight;

    var contentHeights = [];
    var totalContentHeight = 0;
    for (var i = 0; i < contentEls.length; i++) {
      var h = contentEls[i].offsetHeight;
      contentHeights.push(h);
      totalContentHeight += h;
    }

    if (totalContentHeight <= availableHeight) return;

    var pages = [];
    var currentPage = [];
    var currentHeight = 0;

    for (var i = 0; i < contentEls.length; i++) {
      var h = contentHeights[i];
      if (currentHeight + h > availableHeight && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        currentHeight = 0;
      }
      currentPage.push(i);
      currentHeight += h;
    }
    if (currentPage.length > 0) pages.push(currentPage);

    var body = document.body;
    body.innerHTML = "";

    for (var p = 0; p < pages.length; p++) {
      var pageDiv = document.createElement("div");
      pageDiv.className = "page";
      pageDiv.style.cssText = "width:" + pageW + "in;min-height:" + pageH + "in;padding:" + (small ? "7mm 7mm" : "10mm 12mm") + ";page-break-after:" + (p < pages.length - 1 ? "always" : "auto") + ";";

      var frameDiv = document.createElement("div");
      frameDiv.className = "frame";
      frameDiv.style.cssText = "border:1.2px solid #000;padding:" + (small ? "4mm" : "5mm") + ";";

      for (var i = 0; i < headerEls.length; i++) frameDiv.appendChild(headerEls[i].cloneNode(true));
      for (var i = 0; i < titleEls.length; i++) frameDiv.appendChild(titleEls[i].cloneNode(true));
      for (var i = 0; i < testEls.length; i++) frameDiv.appendChild(testEls[i].cloneNode(true));

      for (var j = 0; j < pages[p].length; j++) {
        frameDiv.appendChild(contentEls[pages[p][j]].cloneNode(true));
      }

      if (p === pages.length - 1) {
        for (var i = 0; i < footerEls.length; i++) frameDiv.appendChild(footerEls[i].cloneNode(true));
      }

      pageDiv.appendChild(frameDiv);
      body.appendChild(pageDiv);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paginate);
  } else {
    paginate();
  }
})();
</script>
</body>
</html>`;
}

function testBanner(d) {
  return String(d?.scheme?.financial_mode || "").toUpperCase() === "PRE_ACCOUNTS"
    ? `<div class="test">TEST / PRE-ACCOUNTS — NOT A LIVE DOCUMENT</div>`
    : "";
}

// ─── A. Scheme Creation Print (A5 only) ──────────────────────────────────────
export function generateSchemeCreationHTML(data, company, settings) {
  const { fields: f } = schemeDocSettings(settings, SCHEME_DOCS.CREATION);
  const shop = resolveStationery(company || {});
  const page = pageSize(SCHEME_DOCS.CREATION);
  const s = data.scheme || {};
  const body = [
    headerHtml(f, shop),
    testBanner(data),
    `<div class="title">SCHEME ENROLMENT<small>${esc(s.plan_name || "")}</small></div>`,
    kvRows([
      ...customerRows(f, data),
      ...schemeRows(f, data),
      f.status !== false && ["Status", `<span class="status">${esc(s.status_label || s.status)}</span>`],
      ...staffRows(f, data),
      f.notes && s.notes && ["Notes", esc(s.notes)],
    ]),
    footerHtml(f, shop),
  ].join("");
  return wrap({ page, title: `Scheme Enrolment — ${s.serial_no ?? ""}`, body });
}

// ─── B. Scheme Statement Print (A4 default, A5 optional) ─────────────────────
export function generateSchemeStatementHTML(data, company, settings, paperOverride) {
  const { fields: f, paper } = schemeDocSettings(settings, SCHEME_DOCS.STATEMENT);
  const shop = resolveStationery(company || {});
  const page = pageSize(SCHEME_DOCS.STATEMENT, paperOverride || paper || "A4");
  const s = data.scheme || {};
  const sum = data.summary || {};
  const gold = s.is_gold_scheme && f.gold_details !== false;

  const details = page.id === "A4"
    ? `<div class="two"><div>${kvRows(customerRows(f, data))}${kvRows(staffRows(f, data))}</div><div>${kvRows([
      ...schemeRows(f, data),
      f.status !== false && ["Status", `<span class="status">${esc(s.status_label || s.status)}</span>`],
    ])}</div></div>`
    : kvRows([
      ...customerRows(f, data),
      ...schemeRows(f, data),
      f.status !== false && ["Status", `<span class="status">${esc(s.status_label || s.status)}</span>`],
      ...staffRows(f, data),
    ]);

  const summary = f.payment_summary !== false
    ? `<div class="sec">Payment Summary</div><div class="grid">${[
      ["Total Installments", esc(sum.total_installments)],
      ["Paid Installments", esc(sum.paid_installments)],
      ["Pending Installments", esc(sum.pending_installments)],
      ["Last Payment Date", dateStr(sum.last_payment_date)],
      ["Total Amount", money(sum.total_amount)],
      ["Amount Paid", money(sum.amount_paid)],
      ["Amount Pending", money(sum.amount_pending)],
      gold ? ["Gold Accumulated", grams(sum.total_grams)] : ["Maturity Value", money(sum.maturity_value)],
    ].map(([l, v]) => `<div><div class="l">${esc(l)}</div><div class="v">${v}</div></div>`).join("")}</div>`
    : "";

  let table = "";
  if (f.transaction_table !== false) {
    const rows = (data.installments || []).filter((r) => r.status === "Paid" || f.pending_installments_rows !== false);
    const head = `<tr><th>#</th><th>Payment Date</th><th>Receipt / Ref</th><th class="r">Amount</th><th>Mode</th>${gold ? `<th class="r">Gold Rate</th><th class="r">Grams</th>` : ""}<th>Status</th></tr>`;
    const body = rows.length
      ? rows.map((r) => {
        const paid = r.status === "Paid";
        const ref = paid ? esc(r.reference || (r.payment_id ? `#${String(r.payment_id).slice(0, 8).toUpperCase()}` : "—")) : "—";
        const dt = paid ? dateStr(r.payment_date) : `Due ${dateStr(r.due_date)}`;
        return `<tr class="${paid ? "" : "pending"}"><td>${r.installment_no}</td><td>${dt}</td><td>${ref}</td><td class="r">${money(r.amount)}</td><td>${paid ? esc(modeLabel(r.mode)) : "—"}</td>${gold ? `<td class="r">${r.gold_rate ? money(r.gold_rate) : "—"}</td><td class="r">${r.grams != null ? grams(r.grams) : "—"}</td>` : ""}<td>${esc(r.status)}</td></tr>`;
      }).join("")
      : `<tr><td colspan="${gold ? 8 : 6}" style="text-align:center">No installments recorded</td></tr>`;
    table = `<div class="sec">Transactions</div><table class="tx">${head}${body}</table>`;
  }

  let redemption = "";
  if (f.redemption_details !== false) {
    const r = data.redemption;
    const lc = data.lifecycle || {};
    redemption = `<div class="sec">Maturity / Redemption</div>${kvRows([
      ["Maturity Date", dateStr(s.maturity_date)],
      !gold && ["Maturity Value", money(sum.maturity_value)],
      ["Current Redeemable Value", `${money(sum.redeemable_amount)}${sum.redeemable_label ? ` <span style="font-size:7pt">(${esc(sum.redeemable_label)})</span>` : ""}`],
      r && ["Redeemed On", dateStr(r.redeemed_on)],
      r && r.invoice_no && ["Redemption Invoice", esc(r.invoice_no)],
      r && r.scheme_credit != null && ["Scheme Credit Used", money(r.scheme_credit)],
      lc.is_closed && ["Closed On", dateStr(lc.closure_date)],
    ])}`;
  }

  const body = [
    headerHtml(f, shop),
    testBanner(data),
    `<div class="title">SCHEME STATEMENT<small>${esc(s.plan_name || "")} — as on ${esc(dateStr(new Date()))}</small></div>`,
    details,
    summary,
    table,
    redemption,
    f.notes && s.notes ? kvRows([["Notes", esc(s.notes)]]) : "",
    footerHtml(f, shop),
  ].join("");
  return wrap({ page, title: `Scheme Statement — ${s.serial_no ?? ""}`, body });
}

// ─── C. Scheme Closure Certificate (A5 default, closed schemes only) ─────────
export function canPrintClosureCertificate(data) {
  if (data?.lifecycle) {
    return Boolean(data.lifecycle.is_closed || data.lifecycle.is_matured);
  }
  // Raw scheme row (list API) — check status directly
  const status = String(data?.status || "").toLowerCase();
  return ["completed", "breaked", "cancelled", "matured"].includes(status);
}

export function generateSchemeClosureHTML(data, company, settings, paperOverride) {
  if (!canPrintClosureCertificate(data)) {
    throw new Error("Closure certificate is available only for closed schemes");
  }
  const { fields: f, paper } = schemeDocSettings(settings, SCHEME_DOCS.CLOSURE);
  const shop = resolveStationery(company || {});
  const page = pageSize(SCHEME_DOCS.CLOSURE, paperOverride || paper || "A5");
  const s = data.scheme || {};
  const sum = data.summary || {};
  const lc = data.lifecycle || {};
  const r = data.redemption;
  const gold = s.is_gold_scheme;

  const certText = `This is to certify that the scheme <b>${esc(s.plan_name || "")}</b>${
    f.scheme_number !== false && s.serial_no != null ? ` (Scheme No. <b>${esc(s.serial_no)}</b>)` : ""
  }${f.customer_name !== false ? ` held by <b>${esc(data.customer?.name || "")}</b>` : ""} ${
    lc.is_closed ? "has been closed" : "has matured"
  }${
    f.closure_date !== false && lc.closure_date ? ` on <b>${esc(dateStr(lc.closure_date))}</b>` : ""
  }.`;

  const totals = f.final_totals !== false
    ? `<div class="sec">Final Totals</div>${kvRows2([
      ["Installments Paid", `${esc(sum.paid_installments)} of ${esc(sum.total_installments)}`],
      ["Total Amount Paid", money(sum.amount_paid)],
      gold && ["Gold Accumulated", grams(sum.total_grams)],
      !gold && sum.bonus_amount ? ["Bonus", money(sum.bonus_amount)] : null,
      sum.unpaid_at_closure ? ["Unpaid at Closure", money(sum.unpaid_at_closure)] : null,
      ["Last Payment Date", dateStr(sum.last_payment_date)],
    ])}`
    : "";

  const closure = kvRows([
    f.status !== false && ["Final Status", `<span class="status">${esc(lc.label || s.status)}</span>`],
    f.closure_date !== false && ["Closure Date", dateStr(lc.closure_date)],
    f.closure_reason !== false && lc.closure_reason && ["Closure Reason", esc(lc.closure_reason)],
  ]);

  const redemption = f.redemption_details !== false && r
    ? `<div class="sec">Redemption</div>${kvRows2([
      ["Redeemed On", dateStr(r.redeemed_on)],
      ["Method", r.method === "invoice" ? "Adjusted against jewellery bill" : "Marked redeemed"],
      r.invoice_no && ["Invoice No.", esc(r.invoice_no)],
      r.invoice_date && ["Invoice Date", dateStr(r.invoice_date)],
      r.scheme_credit != null && ["Scheme Credit Used", money(r.scheme_credit)],
    ])}`
    : "";

  const body = [
    headerHtml(f, shop),
    testBanner(data),
    `<div class="title">SCHEME CLOSURE CERTIFICATE</div>`,
    `<div class="cert">${certText}</div>`,
    kvRows2([...customerRows(f, data), ...schemeRows(f, data)]),
    totals,
    closure,
    redemption,
    kvRows2(staffRows(f, data)),
    footerHtml(f, shop),
  ].join("");
  return wrap({ page, title: `Scheme Closure Certificate — ${s.serial_no ?? ""}`, body });
}

// ─── D. Payment Receipt (A5, for post-payment preview + WhatsApp) ────────────

export function generateSchemePaymentReceiptHTML(data, company, settings) {
  const shop = resolveStationery(company || {});
  const s = data.scheme || {};
  const c = data.customer || {};
  const e = data.enrolled_by;
  const gold = s.is_gold_scheme || s.scheme_type === "swarnakala" || s.plan_type === "weight";
  const page = LETTERHEAD_PAPER.A5;
  const f = settings?.fields || {};

  // Handle both raw payment data (from payment API) and formatted installment data
  const rawPayments = data.installments || data.payments || [];
  const showGold = gold && f.gold_details !== false;
  const rows = rawPayments.map((r, i) => {
    const installmentNo = r.installment_no || (i + 1);
    const paymentDate = r.payment_date || r.paid_at || r.business_date;
    const status = r.status || "Paid";
    const mode = r.mode ? esc(modeLabel(r.mode)) : "—";
    const goldRate = r.gold_rate || r.gold_rate_at_payment;
    const gramsVal = r.grams != null ? r.grams : r.grams_credited;
    return `<tr>
      <td>${installmentNo}</td>
      <td>${dateStr(paymentDate)}</td>
      <td class="r">${money(r.amount)}</td>
      <td>${mode}</td>
      ${showGold ? `<td class="r">${goldRate ? money(goldRate) : "—"}</td>` : ""}
      ${showGold ? `<td class="r">${gramsVal != null ? grams(gramsVal) : "—"}</td>` : ""}
      <td>${esc(status)}</td>
    </tr>`;
  }).join("");

  const head = `<tr>
    <th>#</th><th>Payment Date</th><th class="r">Amount</th><th>Mode</th>
    ${showGold ? `<th class="r">Gold Rate</th><th class="r">Grams</th>` : ""}
    <th>Status</th>
  </tr>`;

  const body = [
    headerHtml({}, shop),
    `<div class="title">PAYMENT RECEIPT<small>${esc(s.plan_name || "")}</small></div>`,
    `<table class="kv kv2">
      <tr>
        <td class="k">Customer Name</td><td>${esc(c.name || s.customer_name || "—")}</td>
        <td class="k">Customer ID</td><td>${esc(c.serial_no != null ? fmtCustomerCode(c.serial_no) : (s.customer_id || "—"))}</td>
      </tr>
      <tr>
        <td class="k">Scheme No.</td><td>${esc(s.serial_no != null ? s.serial_no : "—")}</td>
        <td class="k">Scheme Name</td><td>${esc(s.plan_name || "—")}</td>
      </tr>
      <tr>
        <td class="k">Mobile Number</td><td>${esc(c.mobile || s.customer_mobile || "—")}</td>
        <td class="k">Enrolled Date</td><td>${dateStr(s.start_date)}</td>
      </tr>
      <tr>
        <td class="k">Employee Name</td><td>${esc(e?.name || s.enrolled_by_name || "—")}</td>
        <td class="k">Employee Ph.</td><td>${esc(e?.mobile || s.enrolled_by_mobile || "—")}</td>
      </tr>
    </table>`,
    `<div class="sec">Payment History</div>
    <table class="tx">${head}${rows || `<tr><td colspan="${showGold ? 7 : 5}" style="text-align:center">No installments recorded</td></tr>`}</table>`,
    footerHtml({}, shop),
  ].join("");

  return wrap({ page, title: `Payment Receipt — ${s.serial_no ?? ""}`, body });
}

/** Sample print-data used by the Settings → Scheme live preview. */
export const SAMPLE_SCHEME_PRINT_DATA = {
  scheme: {
    id: "sample", serial_no: 12, plan_name: "Swarna Lakshmi Cash Savings 11+1", scheme_type: "fixed_amount",
    is_gold_scheme: false, monthly_amount: 2000, duration_months: 11, bonus_months: 1,
    start_date: "2026-04-10", maturity_date: "2027-03-10", status: "completed", status_label: "Completed",
    notes: "Customer prefers SMS reminders", financial_mode: "LIVE",
  },
  customer: { name: "Sample Customer", mobile: "9876543210", address: "Main Road, Town", serial_no: 104 },
  enrolled_by: { name: "Sample Employee", mobile: "9000000000" },
  summary: {
    total_installments: 11, paid_installments: 11, pending_installments: 0, total_amount: 22000,
    maturity_value: 24000, amount_paid: 22000, amount_pending: 0, unpaid_at_closure: 0,
    last_payment_date: "2027-02-10", total_grams: null, redeemable_amount: 24000,
    redeemable_label: "Cash savings + 1 mo bonus", bonus_amount: 2000,
  },
  installments: Array.from({ length: 11 }, (_, i) => ({
    installment_no: i + 1,
    payment_date: new Date(Date.UTC(2026, 3 + i, 10)).toISOString().slice(0, 10),
    reference: i % 3 === 0 ? `UPI${4400 + i}` : null, payment_id: `sample${i}`, amount: 2000,
    mode: i % 3 === 0 ? "upi" : "cash", status: "Paid",
  })),
  redemption: { redeemed_on: "2027-03-12", method: "invoice", invoice_no: "SSJ-0412", invoice_date: "2027-03-12", scheme_credit: 24000 },
  lifecycle: { status: "completed", label: "Completed", is_closed: true, closure_date: "2027-03-12", closure_reason: "All installments paid — scheme value redeemed on invoice SSJ-0412" },
};
