/**
 * Gold Scheme print documents — three separate, settings-driven documents:
 *   A. Scheme Creation Receipt (A5 only)
 *   B. Scheme Statement (A4 / A5)
 *   C. Scheme Closure Certificate (A5 only)
 *
 * All field visibility is controlled by the scheme print settings
 * (scheme_creation_print_settings / scheme_statement_print_settings /
 * scheme_closure_print_settings). Unchecked fields never appear.
 *
 * Reuses the existing company/invoice print philosophy: company logo, name,
 * address, phone, GST — sourced from the `company` setting via useCompany().
 */

const IN_DATE = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const INR = (n) => {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

function isGoldScheme(scheme) {
  const type = String(scheme?.scheme_type || "").toLowerCase();
  const planType = String(scheme?.plan_type || "").toLowerCase();
  return type === "swarnakala" || planType === "weight";
}

function paymentRows(scheme) {
  const payments = Array.isArray(scheme?.payments) ? scheme.payments : [];
  return payments;
}

function schemeTotals(scheme) {
  const payments = paymentRows(scheme);
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const totalGrams = payments.reduce((s, p) => s + (Number(p.grams_credited) || 0), 0);
  const duration = Number(scheme?.duration_months) || 0;
  const monthly = Number(scheme?.monthly_amount) || 0;
  const target = monthly * duration;
  const pending = Math.max(0, target - totalPaid);
  const lastPaymentDate = payments.length
    ? payments[payments.length - 1]?.paid_at || payments[payments.length - 1]?.date
    : null;
  return {
    totalPaid,
    totalGrams,
    duration,
    monthly,
    target,
    pending,
    paidCount: payments.length,
    pendingCount: Math.max(0, duration - payments.length),
    lastPaymentDate,
  };
}

function companyBlock(company, settings, { showGst = true } = {}) {
  const s = settings || {};
  const show = (key) => s[key] !== false;
  const parts = [];
  if (show("company_logo") && company?.logo) {
    parts.push(`<img src="${esc(company.logo)}" alt="logo" style="max-height:56px;max-width:160px;" />`);
  }
  if (show("company_name") && company?.name) {
    parts.push(`<div class="shop-name">${esc(company.name)}</div>`);
  }
  if (show("company_address") && company?.address) {
    parts.push(`<div class="shop-sub">${esc(company.address)}</div>`);
  }
  if (show("company_phone") && company?.phone) {
    parts.push(`<div class="shop-sub">Ph: ${esc(company.phone)}</div>`);
  }
  if (showGst && show("company_gst") && company?.gst_number) {
    parts.push(`<div class="shop-sub">GSTIN: ${esc(company.gst_number)}</div>`);
  }
  return parts.join("");
}

function customerBlock(scheme, settings) {
  const s = settings || {};
  const show = (key) => s[key] !== false;
  const parts = [];
  if (show("customer_name") && scheme?.customer_name) {
    parts.push(`<div class="cust-name">${esc(scheme.customer_name)}</div>`);
  }
  if (show("customer_mobile") && scheme?.customer_mobile) {
    parts.push(`<div class="cust-mobile">${esc(scheme.customer_mobile)}</div>`);
  }
  return parts.join("");
}

function signatureBlock(settings) {
  const s = settings || {};
  if (s.signature === false) return "";
  return `<div class="sign">
    <div>Customer Signature</div>
    <div>Authorised Signatory</div>
  </div>`;
}

function headerFooter(company, settings, title) {
  return {
    header: companyBlock(company, settings),
    title: title || "",
    footer: "",
  };
}

// ─── A. Scheme Creation Receipt (A5 only) ────────────────────────────────────
export function generateSchemeCreationReceipt(scheme, company, settings) {
  const s = settings || {};
  const show = (key) => s[key] !== false;
  const gold = isGoldScheme(scheme);
  const t = schemeTotals(scheme);
  const { header } = headerFooter(company, s, "Scheme Creation Receipt");

  const rows = [];
  if (show("scheme_number") && scheme?.serial_no != null) rows.push(["Scheme No.", esc(scheme.serial_no)]);
  if (show("scheme_name") && scheme?.plan_name) rows.push(["Plan Name", esc(scheme.plan_name)]);
  if (show("scheme_type")) rows.push(["Scheme Type", gold ? "Gold Saving (grams)" : "Cash Saving"]);
  if (show("start_date")) rows.push(["Start Date", IN_DATE(scheme?.start_date)]);
  if (show("duration")) rows.push(["Duration", `${t.duration} months`]);
  if (show("monthly_amount")) rows.push(["Monthly Installment", INR(t.monthly)]);
  if (show("bonus_months") && Number(scheme?.bonus_months) > 0) rows.push(["Bonus Months", esc(scheme.bonus_months)]);
  if (show("total_target_amount")) rows.push(["Total Target", INR(t.target)]);
  if (show("created_by") && scheme?.salesperson_name) rows.push(["Registered By", esc(scheme.salesperson_name)]);
  if (show("employee_phone") && scheme?.salesperson_phone) rows.push(["Employee Phone", esc(scheme.salesperson_phone)]);

  const rowHtml = rows.map(([k, v]) => `<tr><td class="lbl">${k}</td><td class="val">${v}</td></tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Scheme Creation Receipt — ${esc(scheme?.customer_name || "")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, "Times New Roman", serif; color: #111; background: #fff; }
  @page { size: A5; margin: 12mm; }
  .frame { width: 100%; padding: 18px 20px; border: 2px solid #B49042; }
  .shop-name { font-size: 16pt; font-weight: bold; text-align: center; }
  .shop-sub { font-size: 9pt; color: #555; text-align: center; margin-top: 2px; }
  .title { font-size: 14pt; color: #B49042; font-weight: bold; text-align: center; margin: 14px 0 4px; letter-spacing: 0.04em; }
  .subtitle { font-size: 9pt; color: #777; text-align: center; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  table td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  table td.lbl { color: #666; width: 45%; }
  table td.val { font-weight: 600; }
  .cust-block { text-align: center; margin: 10px 0; }
  .cust-name { font-size: 13pt; font-weight: bold; }
  .cust-mobile { font-size: 9.5pt; color: #555; }
  .sign { margin-top: 24px; display: flex; justify-content: space-between; font-size: 9pt; }
  .sign div { width: 130px; border-top: 1px solid #999; padding-top: 4px; text-align: center; }
  .issued { margin-top: 12px; font-size: 8pt; color: #999; text-align: center; }
</style>
</head>
<body>
  <div class="frame">
    ${header}
    <div class="title">SCHEME CREATION RECEIPT</div>
    <div class="subtitle">${gold ? "Gold Gram Accumulation Scheme" : "Cash Saving Scheme"}</div>
    <div class="cust-block">${customerBlock(scheme, s)}</div>
    <table>${rowHtml}</table>
    ${signatureBlock(s)}
    <div class="issued">Issued on ${IN_DATE(new Date().toISOString())}</div>
  </div>
</body>
</html>`;
}

// ─── B. Scheme Statement (A4 / A5) ───────────────────────────────────────────
export function generateSchemeStatement(scheme, company, settings, paperSize = "A4") {
  const s = settings || {};
  const show = (key) => s[key] !== false;
  const gold = isGoldScheme(scheme);
  const t = schemeTotals(scheme);
  const payments = paymentRows(scheme);
  const { header } = headerFooter(company, s, "Scheme Statement");

  const summaryRows = [];
  if (show("scheme_number") && scheme?.serial_no != null) summaryRows.push(["Scheme No.", esc(scheme.serial_no)]);
  if (show("scheme_name") && scheme?.plan_name) summaryRows.push(["Plan Name", esc(scheme.plan_name)]);
  if (show("start_date")) summaryRows.push(["Start Date", IN_DATE(scheme?.start_date)]);
  if (show("duration")) summaryRows.push(["Duration", `${t.duration} months`]);
  if (show("status")) summaryRows.push(["Status", esc(scheme?.status || "active")]);
  if (show("maturity_date")) summaryRows.push(["Maturity Date", IN_DATE(scheme?.maturity_date)]);

  const paySummaryRows = [];
  if (show("total_installments")) paySummaryRows.push(["Total Installments", String(t.duration)]);
  if (show("paid_installments")) paySummaryRows.push(["Paid Installments", String(t.paidCount)]);
  if (show("pending_installments")) paySummaryRows.push(["Pending Installments", String(t.pendingCount)]);
  if (show("total_scheme_amount")) paySummaryRows.push(["Total Scheme Amount", INR(t.target)]);
  if (show("amount_paid")) paySummaryRows.push(["Amount Paid", INR(t.totalPaid)]);
  if (show("amount_pending")) paySummaryRows.push(["Amount Pending", INR(t.pending)]);
  if (show("last_payment_date")) paySummaryRows.push(["Last Payment Date", IN_DATE(t.lastPaymentDate)]);

  const txRows = payments.map((p, i) => {
    const date = IN_DATE(p.paid_at || p.date);
    const ref = esc(p.reference || "—");
    const amt = INR(p.amount);
    const mode = esc(p.mode || "—");
    const status = esc(p.status || "paid");
    const rate = p.gold_rate_at_payment ? INR(p.gold_rate_at_payment) : "—";
    const grams = p.grams_credited ? `${Number(p.grams_credited).toFixed(3)}g` : "—";
    return `<tr>
      <td style="text-align:center;">${i + 1}</td>
      <td>${date}</td>
      <td>${ref}</td>
      <td style="text-align:right;">${amt}</td>
      <td>${mode}</td>
      <td>${status}</td>
      ${gold ? `<td style="text-align:right;">${rate}</td>` : ""}
      ${gold ? `<td style="text-align:right;">${grams}</td>` : ""}
    </tr>`;
  }).join("");

  const totalRow = `<tr>
    <td colspan="3" style="text-align:right;font-weight:bold;">Total</td>
    <td style="text-align:right;font-weight:bold;">${INR(t.totalPaid)}</td>
    <td colspan="2"></td>
    ${gold ? `<td colspan="2" style="text-align:right;font-weight:bold;">${t.totalGrams.toFixed(3)}g</td>` : ""}
  </tr>`;

  const page = paperSize === "A5" ? "A5" : "A4";
  const fontSize = paperSize === "A5" ? "8.5pt" : "10pt";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Scheme Statement — ${esc(scheme?.customer_name || "")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, "Times New Roman", serif; color: #111; background: #fff; }
  @page { size: ${page}; margin: ${paperSize === "A5" ? "8mm" : "14mm"}; }
  .frame { width: 100%; padding: ${paperSize === "A5" ? "10px" : "20px"}; }
  .shop-name { font-size: ${paperSize === "A5" ? "13pt" : "16pt"}; font-weight: bold; text-align: center; }
  .shop-sub { font-size: ${paperSize === "A5" ? "8pt" : "9pt"}; color: #555; text-align: center; margin-top: 2px; }
  .title { font-size: ${paperSize === "A5" ? "12pt" : "14pt"}; color: #B49042; font-weight: bold; text-align: center; margin: 10px 0 2px; }
  .subtitle { font-size: ${paperSize === "A5" ? "8pt" : "9pt"}; color: #777; text-align: center; margin-bottom: 10px; }
  .section-label { font-size: ${paperSize === "A5" ? "7.5pt" : "8.5pt"}; text-transform: uppercase; letter-spacing: 0.1em; font-weight: bold; color: #B49042; margin: 12px 0 4px; }
  table { width: 100%; border-collapse: collapse; font-size: ${fontSize}; }
  table th { background: #FDFBF7; border-bottom: 2px solid #EADFBF; padding: 5px 6px; text-align: left; color: #8A6D2F; font-size: ${paperSize === "A5" ? "7.5pt" : "8.5pt"}; }
  table td { padding: 4px 6px; border-bottom: 1px solid #f0e9d8; }
  .summary-table td.lbl { color: #666; width: 40%; }
  .summary-table td.val { font-weight: 600; }
  .cust-block { text-align: center; margin: 8px 0; }
  .cust-name { font-size: ${paperSize === "A5" ? "11pt" : "13pt"}; font-weight: bold; }
  .cust-mobile { font-size: ${paperSize === "A5" ? "8.5pt" : "9.5pt"}; color: #555; }
  .sign { margin-top: 20px; display: flex; justify-content: space-between; font-size: ${paperSize === "A5" ? "8pt" : "9pt"}; }
  .sign div { width: 120px; border-top: 1px solid #999; padding-top: 4px; text-align: center; }
  .issued { margin-top: 10px; font-size: ${paperSize === "A5" ? "7pt" : "8pt"}; color: #999; text-align: center; }
</style>
</head>
<body>
  <div class="frame">
    ${header}
    <div class="title">SCHEME STATEMENT</div>
    <div class="subtitle">${gold ? "Gold Gram Accumulation Scheme" : "Cash Saving Scheme"}</div>
    <div class="cust-block">${customerBlock(scheme, s)}</div>
    ${show("payment_summary") ? `<div class="section-label">Payment Summary</div>
    <table class="summary-table">${paySummaryRows.map(([k, v]) => `<tr><td class="lbl">${k}</td><td class="val">${v}</td></tr>`).join("")}</table>` : ""}
    <div class="section-label">Transaction Details</div>
    <table>
      <thead><tr>
        <th style="text-align:center;">#</th><th>Date</th><th>Reference</th><th style="text-align:right;">Amount</th><th>Mode</th><th>Status</th>
        ${gold ? '<th style="text-align:right;">Gold Rate</th><th style="text-align:right;">Grams</th>' : ""}
      </tr></thead>
      <tbody>${txRows}</tbody>
      <tfoot>${totalRow}</tfoot>
    </table>
    ${signatureBlock(s)}
    <div class="issued">Generated on ${IN_DATE(new Date().toISOString())}</div>
  </div>
</body>
</html>`;
}

// ─── C. Scheme Closure Certificate (A5 only) ──────────────────────────────────
export function generateSchemeClosureCertificate(scheme, company, settings) {
  const s = settings || {};
  const show = (key) => s[key] !== false;
  const gold = isGoldScheme(scheme);
  const t = schemeTotals(scheme);
  const { header } = headerFooter(company, s, "Scheme Closure Certificate");

  const rows = [];
  if (show("scheme_number") && scheme?.serial_no != null) rows.push(["Scheme No.", esc(scheme.serial_no)]);
  if (show("scheme_name") && scheme?.plan_name) rows.push(["Plan Name", esc(scheme.plan_name)]);
  if (show("start_date")) rows.push(["Start Date", IN_DATE(scheme?.start_date)]);
  if (show("closure_date")) rows.push(["Closure Date", IN_DATE(scheme?.redeemed_at || scheme?.closed_at)]);
  if (show("duration")) rows.push(["Duration", `${t.duration} months`]);
  if (show("installments_required")) rows.push(["Installments Required", String(t.duration)]);
  if (show("installments_paid")) rows.push(["Installments Paid", String(t.paidCount)]);
  if (show("amount_paid")) rows.push(["Amount Paid", INR(t.totalPaid)]);
  if (show("amount_pending")) rows.push(["Amount Pending", INR(t.pending)]);
  if (show("scheme_status")) rows.push(["Scheme Status", esc(scheme?.status || "completed")]);
  if (show("closure_reason") && scheme?.closure_reason) rows.push(["Closure Reason", esc(scheme.closure_reason)]);
  if (show("redemption_info") && scheme?.redeemed_at) rows.push(["Redeemed On", IN_DATE(scheme.redeemed_at)]);
  if (show("created_by") && scheme?.salesperson_name) rows.push(["Registered By", esc(scheme.salesperson_name)]);
  if (show("closed_by") && scheme?.closed_by) rows.push(["Closed By", esc(scheme.closed_by)]);

  const rowHtml = rows.map(([k, v]) => `<tr><td class="lbl">${k}</td><td class="val">${v}</td></tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Scheme Closure Certificate — ${esc(scheme?.customer_name || "")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, "Times New Roman", serif; color: #111; background: #fff; }
  @page { size: A5; margin: 12mm; }
  .frame { width: 100%; min-height: 180mm; border: 10px solid #B49042; outline: 2px solid #111; outline-offset: -16px; padding: 30px 28px; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .shop-name { font-size: 15pt; font-weight: bold; }
  .shop-sub { font-size: 8.5pt; color: #737373; margin-top: 2px; }
  .title { font-size: 18pt; color: #B49042; font-weight: bold; margin-top: 20px; letter-spacing: 0.04em; }
  .subtitle { font-size: 9pt; color: #555; margin-top: 4px; }
  .body-text { font-size: 10.5pt; margin-top: 20px; line-height: 1.7; max-width: 320px; }
  .cust-name { font-size: 14pt; font-weight: bold; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 16px; }
  table td { padding: 4px 8px; border-bottom: 1px solid #eee; text-align: left; }
  table td.lbl { color: #666; width: 50%; }
  table td.val { font-weight: 600; }
  .sign { margin-top: auto; padding-top: 30px; width: 100%; display: flex; justify-content: space-between; font-size: 8.5pt; }
  .sign div { width: 120px; border-top: 1px solid #999; padding-top: 4px; }
  .issued { margin-top: 12px; font-size: 7.5pt; color: #999; }
</style>
</head>
<body>
  <div class="frame">
    ${header}
    <div class="title">SCHEME CLOSURE CERTIFICATE</div>
    <div class="subtitle">${gold ? "Gold Gram Accumulation Scheme" : "Cash Saving Scheme"}</div>
    <div class="body-text">
      This is to certify that
      <div class="cust-name">${esc(scheme?.customer_name || "")}</div>
      ${scheme?.customer_mobile ? `<div style="font-size:9pt;color:#777;">(${esc(scheme.customer_mobile)})</div>` : ""}
      has completed the <b>${esc(scheme?.plan_name || "")}</b> scheme.
    </div>
    <table>${rowHtml}</table>
    ${signatureBlock(s)}
    <div class="issued">Issued on ${IN_DATE(new Date().toISOString())}</div>
  </div>
</body>
</html>`;
}

// ─── Validity check: is a scheme eligible for a closure certificate? ─────────
// Only available when the scheme has reached a valid final/closed state.
// Preserves the existing lifecycle: active | matured | completed | breaked | cancelled.
export function isSchemeClosable(scheme) {
  const status = String(scheme?.status || "").toLowerCase();
  return status === "completed" || status === "breaked" || status === "cancelled";
}

export { isGoldScheme, schemeTotals, paymentRows };
