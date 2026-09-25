import { fmtINR, fmtDate } from "./format.js";
import { normalizeIndianMobile } from "./phone.js";

/**
 * Builds the professional WhatsApp quotation message body (plain text with
 * WhatsApp's `*bold*` markup). Every value is read from the actual quotation
 * / item data passed in — nothing here is hardcoded.
 *
 * @param quote  {quote_no, customer_name, customer_mobile, created_at, valid_until,
 *                subtotal, discount, gst_pct, gst_amount, grand_total, notes}
 * @param items  array of {product_name, code, quantity, gross_weight, net_weight,
 *                stone_weight, stone_charges, lineTotal}
 * @param company {name, phone, address}
 */
export function buildWhatsAppQuotationMessage({ quote, items = [], company = {} }) {
  const lines = [];
  const shopName = company.name || "our store";

  lines.push(`Hello ${quote.customer_name || "Customer"},`);
  lines.push("");
  lines.push(`Thank you for visiting ${shopName}.`);
  lines.push("");
  lines.push("Here are your quotation details:");
  lines.push("");
  lines.push(`*Quotation No:* ${quote.quote_no || "—"}`);
  lines.push(`*Date:* ${fmtDate(quote.created_at || new Date().toISOString())}`);
  if (quote.valid_until) lines.push(`*Valid Until:* ${fmtDate(quote.valid_until)}`);
  lines.push("");

  if (items.length) {
    lines.push("*Product Details:*");
    items.forEach((it, idx) => {
      const qty = it.quantity || it.qty || 1;
      lines.push(`${idx + 1}. ${it.product_name}${it.code ? ` (${it.code})` : ""}`);
      if (qty > 1) lines.push(`   Qty: ${qty}`);
      if (it.gross_weight) lines.push(`   Gross Weight: ${Number(it.gross_weight).toFixed(3)} g`);
      if (it.net_weight) lines.push(`   Gold Weight: ${Number(it.net_weight).toFixed(3)} g`);
      if (it.stone_weight) lines.push(`   Stone Weight: ${Number(it.stone_weight).toFixed(3)} g`);
      if (it.stone_charges) lines.push(`   Stone Value: ${fmtINR(it.stone_charges)}`);
      if (it.lineTotal != null) lines.push(`   Amount: ${fmtINR(it.lineTotal)}`);
      lines.push("");
    });
  }

  lines.push(`*Subtotal:* ${fmtINR(quote.subtotal)}`);
  if (quote.discount > 0) lines.push(`*Discount:* − ${fmtINR(quote.discount)}`);
  lines.push(`*GST (${quote.gst_pct ?? 3}%):* ${fmtINR(quote.gst_amount)}`);
  lines.push(`*Total Quotation Amount:* ${fmtINR(quote.grand_total)}`);
  lines.push("");
  if (quote.notes) {
    lines.push(`*Note:* ${quote.notes}`);
    lines.push("");
  }
  lines.push("For any queries, please contact us:");
  lines.push(company.phone || "");
  lines.push("");
  lines.push("Thank you for choosing us.");

  return lines.join("\n");
}

export function buildWhatsAppUrls(rawPhone, message = "") {
  const normalized = normalizeIndianMobile(rawPhone);
  if (!normalized) return null;
  const text = encodeURIComponent(message || "");
  return {
    phone: normalized,
    app: `whatsapp://send?phone=${normalized}&text=${text}`,
    web: `https://wa.me/${normalized}?text=${text}`,
  };
}

/**
 * Opens the installed WhatsApp app to that customer's chat with the message
 * pre-filled. Falls back to wa.me (browser) only if the app protocol fails.
 * The user still has to press Send inside WhatsApp themselves.
 */
export function openWhatsAppChat(rawPhone, message) {
  const urls = buildWhatsAppUrls(rawPhone, message);
  if (!urls) {
    return { ok: false, error: "Customer does not have a valid mobile number for WhatsApp." };
  }
  const open = window.jewelleryCRM?.openExternal;
  if (open) {
    open(urls.app).catch(() => open(urls.web).catch(() => {}));
    return { ok: true };
  }
  const win = window.open(urls.app, "_blank", "noopener,noreferrer");
  if (!win) {
    const fallback = window.open(urls.web, "_blank", "noopener,noreferrer");
    if (!fallback) {
      return { ok: false, error: "Popup blocked — please allow popups to open WhatsApp." };
    }
  }
  return { ok: true };
}
