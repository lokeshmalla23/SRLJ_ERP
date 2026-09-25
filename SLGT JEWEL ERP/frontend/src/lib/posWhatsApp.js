import api from "./api.js";
import { fmtINR } from "./format.js";
import { normalizeIndianMobile } from "./phone.js";
import { downloadInvoicePdf } from "./invoicePrint.js";
import { openWhatsAppChat } from "./whatsapp.js";

export function invoiceWhatsAppMobile(invoice) {
  return invoice?.customer_mobile || invoice?.customer?.mobile || "";
}

export function buildInvoiceWhatsAppMessage(invoice, company = {}, pdfPath = "") {
  const name = invoice?.customer_name || "Customer";
  const shop = company?.name || "our store";
  const no = invoice?.invoice_no || "invoice";
  const fileHint = pdfPath
    ? pathFileName(pdfPath)
    : `${String(no).replace(/[\\/:*?"<>|]/g, "-")}.pdf`;
  return [
    `Hello ${name},`,
    "",
    `Thank you for visiting ${shop}.`,
    "",
    `Your invoice *${no}* for *${fmtINR(invoice?.grand_total)}* is ready.`,
    `PDF saved as ${fileHint} — please attach it in this chat.`,
    "",
    "Thank you.",
  ].join("\n");
}

function pathFileName(p) {
  const s = String(p || "");
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}

/**
 * Save the invoice PDF (to the Billing WhatsApp folder, or Downloads) then
 * open that customer's WhatsApp chat with a pre-filled message.
 */
export async function sendPosInvoiceOnWhatsApp(invoice, company = {}) {
  const mobile = invoiceWhatsAppMobile(invoice);
  if (!normalizeIndianMobile(mobile)) {
    return { ok: false, error: "This bill has no valid customer mobile for WhatsApp." };
  }

  let saveDir = "";
  try {
    const { data } = await api.get("/settings/invoice");
    saveDir = String(data?.whatsapp_pdf_folder || "").trim();
  } catch {
    saveDir = "";
  }

  const pdf = await downloadInvoicePdf(invoice, company, null, {
    saveDir: saveDir || undefined,
    skipDialog: true,
  });
  if (!pdf?.ok) {
    return { ok: false, error: pdf?.cancelled ? "PDF save was cancelled." : "Could not save the invoice PDF." };
  }

  const message = buildInvoiceWhatsAppMessage(invoice, company, pdf.path);
  const chat = openWhatsAppChat(mobile, message);
  if (!chat.ok) return chat;
  return { ok: true, path: pdf.path };
}
