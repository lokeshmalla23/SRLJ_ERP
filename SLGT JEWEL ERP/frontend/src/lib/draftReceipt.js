import { fmtINR } from "@/lib/format";

export function generateDraftReceiptHTML(draft, company = {}) {
  const shopName = company?.name || "Sri Srinivasa Jewellers";
  const items = Array.isArray(draft.items) ? draft.items : [];
  const billDate = draft.created_at ? new Date(draft.created_at) : new Date();
  const dateStr =
    billDate.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    billDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

  const rows = items
    .map((it, i) => {
      const qty = it.quantity || 1;
      return `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${it.name || it.product_id || "Item"}${qty > 1 ? ` × ${qty}` : ""}</td>
      <td class="num">${Number(it.gross_weight || 0).toFixed(3)}</td>
      <td class="num">${Number(it.net_weight || 0).toFixed(3)}</td>
      <td class="num">${fmtINR(it.unit_price || it.line_total || 0)}</td>
    </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Draft Receipt</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #111; }
@page { size: A4; margin: 10mm; }
.draft-banner { border: 3px solid #cc0000; background: #fff8f8; color: #cc0000; text-align: center; padding: 10px; margin-bottom: 12px; }
.draft-title { font-size: 16pt; font-weight: bold; letter-spacing: 0.05em; }
.draft-sub { font-size: 10pt; margin-top: 4px; }
.header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-start; }
.shop-name { font-size: 17pt; font-weight: bold; }
.shop-sub { font-size: 9pt; color: #444; margin-top: 2px; }
.inv-meta { font-size: 9.5pt; color: #333; text-align: right; margin-top: 4px; line-height: 1.6; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th { background: #555; color: #fff; padding: 5px; font-size: 8pt; text-align: left; }
td { padding: 5px; border-bottom: 1px solid #eee; font-size: 9pt; }
td.num, th.num { text-align: right; }
.totals { text-align: right; margin-top: 8px; }
.totals td { border: none; padding: 3px 8px; }
.pending-note { margin-top: 16px; border: 1.5px dashed #cc0000; padding: 10px; color: #cc0000; font-size: 10pt; text-align: center; font-weight: bold; }
.footer { margin-top: 16px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 9pt; color: #555; text-align: center; }
</style>
</head>
<body>
<div class="draft-banner">
  <div class="draft-title">DRAFT RECEIPT – NOT A TAX INVOICE</div>
  <div class="draft-sub">This receipt is provisional. A valid tax invoice will be issued upon synchronisation.</div>
</div>
<div class="header">
  <div>
    <div class="shop-name">${shopName}</div>
    ${company?.address ? `<div class="shop-sub">${company.address}</div>` : ""}
    ${company?.phone ? `<div class="shop-sub">Cell: ${company.phone}</div>` : ""}
  </div>
  <div>
    <div class="inv-meta">
      Draft Ref: <b>PENDING</b><br>
      Date: ${dateStr}<br>
      GST Invoice No: <b>PENDING</b>
    </div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="text-align:center;width:28px">SN</th>
      <th>Description</th>
      <th class="num">G.Wt</th>
      <th class="num">N.Wt</th>
      <th class="num">Amount</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<table class="totals">
  <tr><td>Subtotal</td><td class="num">${fmtINR(draft.subtotal || 0)}</td></tr>
  ${Number(draft.discount_amount) > 0 ? `<tr><td>Discount</td><td class="num" style="color:#16a34a">− ${fmtINR(draft.discount_amount)}</td></tr>` : ""}
  <tr><td><b>Total (Approx)</b></td><td class="num"><b>${fmtINR(draft.total || 0)}</b></td></tr>
</table>

<div class="pending-note">
  Pending synchronisation — Final tax invoice and GST amounts will be confirmed when the shop host reconnects.
</div>

<div class="footer">Thank you for your visit. Please retain this draft receipt.</div>
</body>
</html>`;
}
