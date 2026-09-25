import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { fmtINR, fmtSummaryKpi, fmtDate, fmtCustomerCode } from "@/lib/format";
import {
  inferColumnsFromRow,
  renderReportCell,
  sanitizeReportColumns,
  sumNumericKeys,
  currencyParticulars,
} from "@/lib/reportColumns";
import ReportViewModal from "./ReportViewModal";
import { sortByInvoiceNoDesc } from "@/lib/occurredAt";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function flattenResponse(data, endpoint) {
  if (!data) return { rows: [], kpis: [], columns: [] };

  // Trial balance
  if (endpoint.includes("trial-balance") && data.rows) {
    return {
      rows: data.rows,
      kpis: [
        { label: "Total Debit", value: fmtINR(data.totals?.debit) },
        { label: "Total Credit", value: fmtINR(data.totals?.credit) },
      ],
      columns: [
        { key: "code", label: "Code" },
        { key: "name", label: "Account" },
        { key: "debit", label: "Debit", format: "currency" },
        { key: "credit", label: "Credit", format: "currency" },
      ],
    };
  }

  // P&L
  if (endpoint.includes("/pnl")) {
    const income = (data.income || []).map((r) => ({ ...r, side: "Income", amount: r.amount }));
    const expense = (data.expense || []).map((r) => ({ ...r, side: "Expense", amount: r.amount }));
    return {
      rows: [...income, ...expense],
      kpis: [
        { label: "Income", value: fmtINR(data.totals?.income) },
        { label: "Expense", value: fmtINR(data.totals?.expense) },
        { label: "Net Profit", value: fmtINR(data.totals?.net_profit) },
        { label: "Gross Margin %", value: data.margins?.gross_margin_pct != null ? `${data.margins.gross_margin_pct}%` : "—" },
      ],
      columns: [
        { key: "side", label: "Type" },
        { key: "code", label: "Code" },
        { key: "name", label: "Account" },
        { key: "amount", label: "Amount", format: "currency" },
      ],
    };
  }

  // Balance sheet
  if (endpoint.includes("balance-sheet")) {
    const assets = (data.assets || []).map((r) => ({ ...r, section: "Asset" }));
    const liabilities = (data.liabilities || []).map((r) => ({ ...r, section: "Liability" }));
    const equity = (data.equity || []).map((r) => ({ ...r, section: "Equity" }));
    return {
      rows: [...assets, ...liabilities, ...equity],
      kpis: [
        { label: "Assets", value: fmtINR(data.totals?.assets) },
        { label: "Liabilities", value: fmtINR(data.totals?.liabilities) },
        { label: "Equity", value: fmtINR(data.totals?.equity) },
      ],
      columns: [
        { key: "section", label: "Section" },
        { key: "code", label: "Code" },
        { key: "name", label: "Account" },
        { key: "amount", label: "Amount", format: "currency" },
      ],
    };
  }

  // Dashboard KPIs
  if (endpoint.includes("/dashboard") && data.kpis) {
    const rows = Object.entries(data.kpis).map(([k, v]) => ({
      metric: k.replace(/_/g, " "),
      value: typeof v === "number" ? fmtSummaryKpi(k, v) : String(v ?? "—"),
    }));
    return {
      rows,
      kpis: [
        { label: "Sales", value: fmtINR(data.kpis.total_sales) },
        { label: "Net Profit", value: fmtINR(data.kpis.net_profit) },
        { label: "Cash", value: fmtINR(data.kpis.cash_in_hand) },
        { label: "Receivables", value: fmtINR(data.kpis.customer_receivables) },
      ],
      columns: [
        { key: "metric", label: "Metric" },
        // `value` is already a rendered display string (fmtSummaryKpi/String
        // above) — an explicit non-currency format stops sanitizeReportColumns
        // from auto-inferring "currency" purely because the key is named
        // "value" and re-running it through fmtINR, which would try to parse
        // an already-formatted string like "₹48,596.00" as a number and
        // silently collapse it to ₹0.00.
        { key: "value", label: "Value", format: "text" },
      ],
    };
  }

  // Integrity
  if (endpoint.includes("/integrity")) {
    const warnings = (data.warnings || []).map((w) => ({
      code: w.code,
      message: w.message,
      gl: w.gl,
      ops: w.ops,
    }));
    return {
      rows: warnings.length ? warnings : [{ code: "OK", message: "No warnings", gl: "", ops: "" }],
      kpis: [
        { label: "TB Balanced", value: data.trial_balance?.balanced ? "Yes" : "No" },
        { label: "Cutover", value: data.cutover_date || "—" },
      ],
      columns: [
        { key: "code", label: "Code" },
        { key: "message", label: "Message" },
        { key: "gl", label: "GL" },
        { key: "ops", label: "Ops" },
      ],
    };
  }

  // GST accounts object
  if (endpoint === "/accounts/gst" || endpoint.endsWith("/accounts/gst")) {
    const rows = Object.entries(data)
      .filter(([k]) => !["from", "to", "note"].includes(k))
      .map(([k, v]) => ({ metric: k.replace(/_/g, " "), value: v }));
    return {
      rows,
      kpis: [
        { label: "Output GST", value: fmtINR(data.output_gst) },
        { label: "Input GST", value: fmtINR(data.input_gst) },
        { label: "Net Liability", value: fmtINR(data.net_gst_payable) },
        { label: "IGST Out", value: fmtINR(data.output_igst) },
      ],
      columns: [
        { key: "metric", label: "Metric" },
        { key: "value", label: "Value", format: "currency" },
      ],
    };
  }

  // Metal
  if (endpoint.includes("/metal") && data.metals) {
    return {
      rows: data.metals,
      kpis: [
        { label: "Inventory GL", value: fmtINR(data.inventory_gl) },
        { label: "Old Gold", value: fmtINR(data.old_gold?.value) },
      ],
      columns: [
        { key: "metal", label: "Metal" },
        { key: "pieces", label: "Pieces" },
        { key: "net_weight", label: "Net Wt" },
        { key: "gross_weight", label: "Gross Wt" },
        { key: "value", label: "Value", format: "currency" },
      ],
    };
  }

  // Hallmark report (feature pack shape: summary + missing/duplicates, no rows)
  if (endpoint.includes("/hallmark")) {
    const missing = (data.missing || []).map((p) => ({
      section: "Missing HUID",
      name: p.name,
      barcode: p.barcode || p.code,
      hallmark: p.hallmark || "—",
      status: p.status,
      net_weight: p.net_weight,
    }));
    const soldWithout = (data.sold_without_huid || []).map((p) => ({
      section: "Sold without HUID",
      name: p.name,
      barcode: p.barcode || p.code,
      hallmark: "—",
      status: p.status,
      net_weight: p.net_weight,
    }));
    const dupRows = [];
    for (const g of data.duplicates || []) {
      for (const p of g.products || []) {
        dupRows.push({
          section: "Duplicate HUID",
          name: p.name,
          barcode: p.barcode || p.code,
          hallmark: g.huid,
          status: p.status,
          net_weight: p.net_weight,
        });
      }
    }
    const searchRows = (data.search || []).map((p) => ({
      section: "Search",
      name: p.name,
      barcode: p.barcode || p.code,
      hallmark: p.hallmark || "—",
      status: p.status,
      net_weight: p.net_weight,
    }));
    const rows = searchRows.length
      ? searchRows
      : [...missing, ...soldWithout, ...dupRows];
    const s = data.summary || {};
    return {
      rows,
      kpis: [
        { label: "Total", value: String(s.total ?? 0) },
        { label: "With HUID", value: String(s.with_huid ?? 0) },
        { label: "Missing", value: String(s.missing ?? 0) },
        { label: "Duplicate groups", value: String(s.duplicate_groups ?? 0) },
      ],
      columns: [
        { key: "section", label: "Section" },
        { key: "name", label: "Product" },
        { key: "barcode", label: "Barcode" },
        { key: "hallmark", label: "HUID" },
        { key: "status", label: "Status" },
        { key: "net_weight", label: "Net Wt" },
      ],
    };
  }

  // Schemes accounts
  if (endpoint.includes("/accounts/schemes") && data.rows) {
    return {
      rows: data.rows,
      kpis: Object.entries(data.summary || {}).slice(0, 8).map(([k, v]) => ({
        label: k.replace(/_/g, " "),
        value: fmtSummaryKpi(k, v),
      })),
      columns: [
        { key: "member", label: "Member" },
        { key: "plan_name", label: "Plan" },
        { key: "monthly_amount", label: "Monthly", format: "currency" },
        { key: "total_collected", label: "Collected", format: "currency" },
        { key: "status", label: "Status" },
      ],
    };
  }

  // Sales by employee
  if (endpoint.includes("/sales/by-employee")) {
    const rows = data.data || data.rows || [];
    return {
      rows,
      kpis: [
        { label: "Employees", value: String(rows.length) },
        { label: "Invoices", value: String(rows.reduce((s, r) => s + (Number(r.invoice_count) || 0), 0)) },
        { label: "Total Sales", value: fmtINR(rows.reduce((s, r) => s + (Number(r.grand_total) || 0), 0)) },
      ],
      columns: [
        { key: "salesperson_name", label: "Employee" },
        { key: "invoice_count", label: "Invoices" },
        { key: "grand_total", label: "Grand Total", format: "currency" },
        { key: "gst_amount", label: "GST Amount", format: "currency" },
      ],
    };
  }

  // Purchase frequency
  if (endpoint.includes("purchase-frequency")) {
    const rows = data.data || data.rows || [];
    return {
      rows,
      kpis: [
        { label: "Customers", value: String(rows.length) },
        { label: "Invoices", value: String(rows.reduce((s, r) => s + (Number(r.invoice_count) || 0), 0)) },
        { label: "Total Spent", value: fmtINR(rows.reduce((s, r) => s + (Number(r.total_spent) || 0), 0)) },
      ],
      columns: [
        { key: "customer_id", label: "Customer ID", forceShow: true, exportValue: (r) => fmtCustomerCode(r.serial_no) },
        { key: "customer_name", label: "Customer" },
        { key: "invoice_count", label: "Invoices" },
        { key: "total_spent", label: "Total Spent", format: "currency" },
        { key: "first_purchase", label: "First Purchase", format: "datetime" },
        { key: "last_purchase", label: "Last Purchase", format: "datetime" },
      ],
    };
  }

  // Gold Rate History — split JSON rates into readable columns
  if (endpoint.includes("/gold-rate-history")) {
    const rows = data.data || data.rows || [];
    return {
      rows,
      kpis: [{ label: "Changes", value: String(rows.length) }],
      columns: [
        { key: "occurred_at", label: "Date & Time", format: "datetime", printWidth: "14%" },
        { key: "gold_24k", label: "24K", format: "currency", align: "right", printWidth: "8%" },
        { key: "gold_22k", label: "22K", format: "currency", align: "right", printWidth: "8%" },
        { key: "gold_18k", label: "18K", format: "currency", align: "right", printWidth: "8%" },
        { key: "pure_silver", label: "Pure Silver", format: "currency", align: "right", printWidth: "10%" },
        { key: "silver", label: "Silver", format: "currency", align: "right", printWidth: "8%" },
        { key: "changed_by", label: "Changed by", printWidth: "14%" },
        { key: "source", label: "Source", printWidth: "10%" },
      ],
      totals: {},
      defaultOrientation: "landscape",
    };
  }

  // Customer Outstanding / Receivables Ageing
  if (endpoint.includes("/receivables")) {
    const rows = data.rows || data.data || [];
    return {
      rows,
      kpis: [
        { label: "Total Outstanding", value: fmtINR(data.summary?.total_receivables) },
        { label: "Overdue", value: fmtINR(data.summary?.overdue) },
        { label: "Bills", value: String(rows.length) },
      ],
      columns: [
        { key: "customer_name", label: "Customer", printWidth: "16%" },
        { key: "source", label: "Type", printWidth: "8%" },
        { key: "invoice_no", label: "Invoice / Order", printWidth: "12%" },
        { key: "invoice_date", label: "Date", format: "date", printWidth: "10%" },
        { key: "total_amount", label: "Total", format: "currency", align: "right", printWidth: "10%" },
        { key: "paid_amount", label: "Paid", format: "currency", align: "right", printWidth: "10%" },
        { key: "outstanding", label: "Outstanding", format: "currency", align: "right", printWidth: "12%" },
        { key: "days_outstanding", label: "Days", align: "right", printWidth: "8%" },
        { key: "status", label: "Status", printWidth: "10%" },
      ],
      totals: { outstanding: data.summary?.total_receivables },
      defaultOrientation: "landscape",
    };
  }

  // Supplier Outstanding / Payables Ageing
  if (endpoint.includes("/payables")) {
    const rows = data.rows || data.data || [];
    return {
      rows,
      kpis: [
        { label: "Total Outstanding", value: fmtINR(data.summary?.total_payables) },
        { label: "Overdue", value: fmtINR(data.summary?.overdue) },
        { label: "Bills", value: String(rows.length) },
      ],
      columns: [
        { key: "vendor_name", label: "Vendor", printWidth: "18%" },
        { key: "po_number", label: "PO", printWidth: "12%" },
        { key: "purchase_date", label: "Date", format: "date", printWidth: "10%" },
        { key: "total_amount", label: "Total", format: "currency", align: "right", printWidth: "12%" },
        { key: "paid_amount", label: "Paid", format: "currency", align: "right", printWidth: "12%" },
        { key: "outstanding", label: "Outstanding", format: "currency", align: "right", printWidth: "12%" },
        { key: "days_outstanding", label: "Days", align: "right", printWidth: "8%" },
        { key: "status", label: "Status", printWidth: "10%" },
      ],
      totals: { outstanding: data.summary?.total_payables },
      defaultOrientation: "landscape",
    };
  }

  // Receipts — invoice number first, then payment details
  if (endpoint.includes("/accounts/receipts")) {
    const rows = data.rows || data.data || [];
    return {
      rows,
      kpis: [{ label: "Receipts", value: String(rows.length) }],
      columns: [
        { key: "invoice_no", label: "Invoice No", printWidth: "14%" },
        { key: "date", label: "Date", format: "date", printWidth: "12%" },
        { key: "type", label: "Type", printWidth: "14%" },
        { key: "mode", label: "Mode", printWidth: "12%" },
        { key: "amount", label: "Amount", format: "currency", align: "right", printWidth: "12%" },
        { key: "receipt_no", label: "Receipt #", printWidth: "12%" },
        { key: "reference", label: "Reference", printWidth: "14%" },
      ],
      defaultOrientation: "landscape",
    };
  }

  // Sales Accounts Register — payment modes from POS invoice payments, not tax fields
  if (endpoint.includes("/accounts/sales") && !endpoint.includes("employee")) {
    const rows = sortByInvoiceNoDesc(data.rows || data.data || []);
    const moneyKeys = ["taxable", "discount", "cash", "upi", "bank", "old_metal", "old_silver", "grand_total"];
    const totals = data.totals && typeof data.totals === "object"
      ? data.totals
      : sumNumericKeys(rows, moneyKeys);
    return {
      rows,
      kpis: [
        { label: "Taxable", value: fmtINR(totals.taxable) },
        { label: "Cash", value: fmtINR(totals.cash) },
        { label: "UPI", value: fmtINR(totals.upi) },
        { label: "Bank", value: fmtINR(totals.bank) },
        { label: "Old Gold", value: fmtINR(totals.old_metal) },
        { label: "Old Silver", value: fmtINR(totals.old_silver) },
        { label: "Grand Total", value: fmtINR(totals.grand_total) },
      ],
      columns: [
        { key: "invoice_no", label: "Invoice No", printWidth: "12%" },
        { key: "date", label: "Date", format: "date", printWidth: "11%" },
        { key: "customer_name", label: "Customer Name", printWidth: "16%" },
        { key: "taxable", label: "Taxable", format: "currency", align: "right", printWidth: "9%" },
        { key: "discount", label: "Discount", format: "currency", align: "right", printWidth: "8%" },
        { key: "cash", label: "Cash", format: "currency", align: "right", printWidth: "8%" },
        { key: "upi", label: "UPI", format: "currency", align: "right", printWidth: "8%" },
        { key: "bank", label: "Bank", format: "currency", align: "right", printWidth: "8%" },
        { key: "old_metal", label: "Old Gold", format: "currency", align: "right", printWidth: "8%" },
        { key: "old_silver", label: "Old Silver", format: "currency", align: "right", printWidth: "8%" },
        { key: "grand_total", label: "Grand Total", format: "currency", align: "right", printWidth: "11%" },
      ],
      totals,
      defaultOrientation: "landscape",
      summaryKeys: [
        { key: "taxable", label: "Taxable" },
        { key: "discount", label: "Discount" },
        { key: "cash", label: "Cash" },
        { key: "upi", label: "UPI" },
        { key: "bank", label: "Bank" },
        { key: "old_metal", label: "Old Gold" },
        { key: "old_silver", label: "Old Silver" },
        { key: "grand_total", label: "Grand Total" },
      ],
    };
  }
  // Customer List Report — explicit columns so the internal `version` field
  // doesn't leak in and the id shows as the friendly "CUST-001" code.
  if (endpoint.includes("/customers/list")) {
    const rows = data.data || data.rows || [];
    return {
      rows,
      kpis: [
        { label: "Customers", value: String(data.total ?? rows.length) },
      ],
      columns: [
        { key: "id", label: "Customer ID", forceShow: true, exportValue: (r) => fmtCustomerCode(r.serial_no) },
        { key: "name", label: "Name" },
        { key: "mobile", label: "Mobile" },
        { key: "email", label: "Email" },
        { key: "address", label: "Address" },
        { key: "tag", label: "Tag" },
        { key: "total_purchases", label: "Total Purchases", format: "currency" },
        { key: "loyalty_points", label: "Loyalty Points" },
        { key: "created_at", label: "Created At", format: "datetime" },
      ],
    };
  }
  if (endpoint.includes("/customers/birthday") || endpoint.includes("/customers/anniversary")) {
    const rows = data.data || data.rows || [];
    const dateKey = endpoint.includes("anniversary") ? "anniversary" : "dob";
    const todayCount = Number(data.today_count || rows.filter((r) => r.is_today).length);
    return {
      rows,
      kpis: [
        { label: "This month", value: String(rows.length) },
        { label: "Today", value: String(todayCount) },
      ],
      columns: [
        { key: "id", label: "Customer ID", forceShow: true, exportValue: (r) => fmtCustomerCode(r.serial_no) },
        { key: "name", label: "Customer" },
        { key: "mobile", label: "Mobile" },
        { key: dateKey, label: dateKey === "anniversary" ? "Anniversary" : "Date of Birth", format: "date" },
        { key: "tag", label: "Tag" },
      ],
    };
  }

  let rows = data.rows || data.data || (Array.isArray(data) ? data : []);
  if (!Array.isArray(rows)) rows = [];
  if (endpoint.includes("/sales/list")) rows = sortByInvoiceNoDesc(rows);

  // summary cards
  const kpis = [];
  if (data.summary) {
    for (const [k, v] of Object.entries(data.summary).slice(0, 6)) {
      kpis.push({
        label: k.replace(/_/g, " "),
        value: fmtSummaryKpi(k, v),
      });
    }
  }
  if (data.opening_balance != null) {
    kpis.push(
      { label: "Opening", value: fmtINR(data.opening_balance) },
      { label: "Closing", value: fmtINR(data.closing_balance) },
    );
  }
  if (data.totals && typeof data.totals === "object" && !Array.isArray(data.totals)) {
    for (const [k, v] of Object.entries(data.totals).slice(0, 4)) {
      if (typeof v === "number") kpis.push({ label: k.replace(/_/g, " "), value: fmtSummaryKpi(k, v) });
    }
  }

  // Infer columns from first row
  const sample = rows[0] || {};
  const columns = inferColumnsFromRow(sample, { max: 10 });

  return { rows, kpis, columns };
}

function cell(col, row) {
  return renderReportCell(col, row);
}

export default function UnifiedReportView({ report, onBack, embedded = false, includeHidden = false }) {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!report?.endpoint) return;
    setLoading(true);
    try {
      const params = {
        from, to, from_date: from, to_date: to, limit: 500, offset: 0,
        include_hidden: includeHidden ? 1 : undefined,
      };
      if (String(report.endpoint).includes("gstr")) {
        params.month = String(to || from || "").slice(0, 7);
      }
      if (
        String(report.endpoint).includes("/customers/birthday")
        || String(report.endpoint).includes("/customers/anniversary")
      ) {
        params.month = new Date().getMonth() + 1;
      }
      const { data } = await api.get(report.endpoint, { params });
      setRaw(data);
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to load report");
      setRaw(null);
    } finally {
      setLoading(false);
    }
  }, [report, from, to, includeHidden]);

  useEffect(() => {
    load();
  }, [load]);

  const parsed = useMemo(
    () => flattenResponse(raw, report?.endpoint || ""),
    [raw, report],
  );
  const visibleColumns = useMemo(
    () => sanitizeReportColumns(parsed.columns),
    [parsed.columns],
  );

  const tableTotals = useMemo(() => {
    if (parsed.summaryKeys?.length && parsed.rows?.length) {
      return sumNumericKeys(parsed.rows, parsed.summaryKeys.map((s) => s.key));
    }
    if (parsed.totals) return parsed.totals;
    const moneyKeys = (parsed.columns || []).filter((c) => c.format === "currency").map((c) => c.key);
    if (!moneyKeys.length || !parsed.rows?.length) return null;
    return sumNumericKeys(parsed.rows, moneyKeys);
  }, [parsed.rows, parsed.summaryKeys, parsed.totals, parsed.columns]);

  const summaryParticulars = useMemo(() => {
    if (parsed.summaryKeys?.length && tableTotals) {
      const extra = [];
      if ((tableTotals.advance || 0) > 0.005) extra.push({ key: "advance", label: "Advance" });
      if ((tableTotals.other || 0) > 0.005) extra.push({ key: "other", label: "Other" });
      return [...parsed.summaryKeys, ...extra].map((s) => ({
        particular: s.label,
        total: tableTotals[s.key],
      }));
    }
    return currencyParticulars(parsed.columns, tableTotals);
  }, [parsed.summaryKeys, parsed.columns, tableTotals]);

  const showSno = Boolean(parsed.summaryKeys?.length);
  const printOrientation = parsed.defaultOrientation || "portrait";
  const isOccasionReport = String(report?.endpoint || "").includes("/customers/birthday")
    || String(report?.endpoint || "").includes("/customers/anniversary");
  const occasionDateKey = String(report?.endpoint || "").includes("anniversary") ? "anniversary" : "dob";
  const todayRows = (raw?.today || parsed.rows.filter((r) => r.is_today));

  const sourceBadge = report?.source === "accounts"
    ? "Accounting (journals)"
    : report?.source === "reports"
      ? "Operational"
      : "UI";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] px-3.5 py-3 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
        <div className="flex items-center gap-3">
          {!embedded && onBack ? (
            <button type="button" onClick={onBack} className="text-[#737373] hover:text-[#0A0A0A]">
              <ArrowLeft size={16} />
            </button>
          ) : null}
          {!embedded ? (
            <div>
              <div className="text-[15px] font-semibold text-[#0A0A0A]">{report.name}</div>
              <div className="text-[11px] text-[#737373]">
                {report.description || report.endpoint} · {sourceBadge}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-[#737373]">{sourceBadge}</div>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {!isOccasionReport ? (
            <>
              <label className="text-[10.5px] font-medium uppercase tracking-[0.05em] text-[#707973]">
                From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-1 rounded-[9px] border border-[#CFC8BB] bg-white px-2.5 py-1.5 text-xs text-[#24332B] outline-none focus:border-[#3D6B5B] focus:ring-2 focus:ring-[#DDE8E0]" />
              </label>
              <label className="text-[10.5px] font-medium uppercase tracking-[0.05em] text-[#707973]">
                To
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ml-1 rounded-[9px] border border-[#CFC8BB] bg-white px-2.5 py-1.5 text-xs text-[#24332B] outline-none focus:border-[#3D6B5B] focus:ring-2 focus:ring-[#DDE8E0]" />
              </label>
            </>
          ) : (
            <div className="text-[11px] text-[#737373]">This calendar month · today's matches pinned at the top</div>
          )}
          <button type="button" onClick={load} className="rounded-[9px] border border-[#315C4A] bg-[#315C4A] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#244A3A]">
            {loading ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : "Refresh"}
          </button>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1 rounded-[9px] border border-[#D2CCBF] bg-[#FFFDF9] px-3 py-1.5 text-xs hover:border-[#9EB2A6] hover:bg-[#F1F5F1]"
            onClick={() => setModalOpen(true)}
            disabled={!parsed.rows.length}
          >
            <FileText size={13} /> Print Summary
          </button>
        </div>
      </div>

      {isOccasionReport && todayRows.length ? (
        <div className="mb-4 rounded-xl border border-[#DDD7CA] bg-[#FBF8F1] p-4 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
          <div className="mb-3 text-[12px] font-semibold uppercase tracking-widest text-[#B49042]">
            {occasionDateKey === "anniversary" ? "Today's anniversaries" : "Today's birthdays"}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {todayRows.map((row) => (
              <div key={row.id || `${row.mobile}-${row[occasionDateKey]}`} className="rounded-[9px] border border-[#D8D2C6] bg-[#FFFDF9] px-3 py-2.5">
                <div className="text-[13px] font-semibold text-[#0A0A0A]">{row.name || "—"}</div>
                <div className="mt-0.5 text-[12px] text-[#525252]">{row.mobile || "—"} · {fmtDate(row[occasionDateKey])}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {parsed.kpis?.length ? (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {parsed.kpis.map((k) => (
            <div key={k.label} className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-3.5 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#707973]">{k.label}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-[#24332B]">{k.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-auto rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]">
        {loading ? (
          <div className="p-8 text-center text-sm text-[#737373]">Loading…</div>
        ) : !parsed.rows.length ? (
          <div className="p-8 text-center text-sm text-[#737373]">No data for this period</div>
        ) : (
          <table className="min-w-full text-left text-xs">
            <thead className="bg-[#F1EEE7] text-[11px] uppercase tracking-[0.06em] text-[#68716B] shadow-[0_1px_0_#DDD7CA]">
              <tr>
                {showSno ? <th className="px-3 py-2 font-medium">S.No</th> : null}
                {visibleColumns.map((c) => (
                  <th key={c.key} className={`px-3 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.rows.map((r, i) => (
                <tr key={r.id || i} className={`border-t transition-colors hover:bg-[#F7F5EF] ${r.is_today ? "border-[#D8C28C] bg-[#FBF8F1] font-medium" : "border-[#E6E1D7]"}`}>
                  {showSno ? <td className="px-3 py-2 tabular-nums text-[#737373]">{i + 1}</td> : null}
                  {visibleColumns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 tabular-nums ${c.align === "right" ? "text-right" : ""}`}>{cell(c, r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            {parsed.summaryKeys?.length && tableTotals ? (
              <tfoot>
                <tr className="border-t-2 border-[#315C4A] bg-[#EEF3EF] font-semibold text-[#24332B]">
                  {showSno ? <td className="px-3 py-2">TOTAL</td> : null}
                  {visibleColumns.map((c, i) => (
                    <td key={c.key} className={`px-3 py-2 tabular-nums ${c.align === "right" ? "text-right" : ""}`}>
                      {!showSno && i === 0 && tableTotals[c.key] == null
                        ? "TOTAL"
                        : (tableTotals[c.key] != null ? cell(c, tableTotals) : "")}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        )}
      </div>

      <ReportViewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        reportName={report.name}
        columns={visibleColumns}
        rows={parsed.rows}
        totals={tableTotals}
        filtersSummary={`${from} → ${to}`}
        defaultOrientation={printOrientation}
        summaryParticulars={summaryParticulars}
      />
    </div>
  );
}
