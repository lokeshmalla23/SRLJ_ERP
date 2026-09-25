import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Download,
  Filter,
  TrendingUp,
  Package,
  Users,
  Receipt,
  ShoppingCart,
  Gem,
  AlertTriangle,
  ChevronDown,
  Clock,
  X,
  Eye,
  User2,
  CreditCard,
  Percent,
} from "lucide-react";
import { toast } from "sonner";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { hasFullAccessRole } from "@/lib/roleLabel";
import HiddenBillPasswordDialog from "@/components/pos/HiddenBillPasswordDialog";
import { hiddenUnlockBleedClass } from "@/lib/hiddenUnlockSurface";
import PageHeader from "@/components/common/PageHeader";
import { fmtINR, fmtDate, fmtDateTime, fmtWeight, fmtCustomerCode } from "@/lib/format";
import { weightContribution } from "@/lib/trayWeight";
import { asArray } from "@/lib/jsonFields";
import { hasOldGoldPayment, hasOldSilverPayment, exchangePaymentSnap } from "@/lib/invoiceBillDisplay";
import QuickReportsGrid from "@/pages/reports/QuickReportsGrid";
import { useFilterOptions } from "@/pages/reports/useFilterOptions";
import { FilterBar, FilterSelect, FilterMultiSelect, FilterField } from "@/pages/reports/FilterBar";
import SubReportTable from "@/pages/reports/SubReportTable";
import OccasionReportTable from "@/pages/reports/OccasionReportTable";
import ReportViewModal from "@/pages/reports/ReportViewModal";
import UnifiedReportView from "@/pages/reports/UnifiedReportView";
import PrintSummaryButton from "@/pages/reports/PrintSummaryButton";
import { SimplePieChart, SimpleBarChart } from "@/components/charts/SimpleCharts";
import {
  REPORT_CATEGORIES,
  reportsInCategory,
  findReport,
  defaultReportForCategory,
  categoryForReport,
  visibleReportCategories,
  visibleReportsInCategory,
} from "@/pages/reports/reportCatalog";
import { useSectionVisibility } from "@/context/SectionVisibilityContext";
import StockDetailsReport from "@/pages/reports/quickReports/StockDetailsReport";
import CategoryStockReport from "@/pages/reports/quickReports/CategoryStockReport";
import CounterStockReport from "@/pages/reports/quickReports/CounterStockReport";
import TodaysStockAddedReport from "@/pages/reports/quickReports/TodaysStockAddedReport";
import DeadStockReport from "@/pages/reports/quickReports/DeadStockReport";
import FastMovingStockReport from "@/pages/reports/quickReports/FastMovingStockReport";
import StockAgeingReport from "@/pages/reports/quickReports/StockAgeingReport";
import TagHistoryReport from "@/pages/reports/quickReports/TagHistoryReport";
import StockCheckReport from "@/pages/reports/quickReports/StockCheckReport";
import MoreReportsTab from "@/pages/reports/MoreReportsTab";
import HiddenDataReportsTab from "@/pages/reports/HiddenDataReportsTab";
import DayClosingReportTab from "@/pages/reports/DayClosingReportTab";
import ItemMovementReport from "@/pages/reports/quickReports/ItemMovementReport";
import SoldItemsReport from "@/pages/reports/quickReports/SoldItemsReport";
import EstimationsToSaleTab from "@/pages/reports/EstimationsToSaleTab";

// ─── Payment mode helpers — always derived from the real `payments` array ────
// saved on the invoice (never a nonexistent `payment_mode` field), so this
// reflects exactly what was selected and saved during POS checkout.
const PAYMENT_MODE_LABELS = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  old_gold_exchange: "Old Gold Exchange",
  old_silver_exchange: "Old Silver Exchange",
};
const PAYMENT_MODE_COLORS = {
  cash: "green",
  upi: "blue",
  card: "blue",
  bank_transfer: "gray",
  cheque: "amber",
};
const paymentModeLabel = (mode) => PAYMENT_MODE_LABELS[mode] || mode;
const invoicePaymentSummary = (invoice) => {
  const list = asArray(invoice?.payments);
  if (list.length === 0) return "—";
  return list.map((p) => paymentModeLabel(p.mode)).join(" + ");
};
const invoicePaymentColor = (invoice) => {
  const list = asArray(invoice?.payments);
  if (list.length !== 1) return "gold";
  return PAYMENT_MODE_COLORS[list[0].mode] || "gray";
};
const invoiceAmountPaid = (invoice) =>
  asArray(invoice?.payments).reduce((s, p) => s + (Number(p.amount) || 0), 0);

// ─── Helpers ────────────────────────────────────────────────────────────────

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

const yearStart = () => `${new Date().getFullYear()}-01-01`;

const ymdLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const lastMonthRange = () => {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return {
    from: ymdLocal(first),
    to: ymdLocal(last),
  };
};

const GOLD_ACCENT = "#B49042";
const PIE_COLORS = ["#B49042", "#D4AF70", "#8B6914", "#E8D4A0", "#6B4F10", "#F0E68C"];

const downloadCsv = (rows, filename) => {
  const blob = new Blob([rows], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ─── Shared UI primitives ───────────────────────────────────────────────────

function StatCard({ label, value, accent = false, icon: Icon, sub }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#737373]">
          {label}
        </div>
        {Icon && (
          <div
            className={`h-7 w-7 rounded-md flex items-center justify-center border ${
              accent ? "bg-[#FDFBF7] border-[#EADFBF]" : "bg-[#F9FAFB] border-[#E5E7EB]"
            }`}
          >
            <Icon
              size={14}
              strokeWidth={1.5}
              className={accent ? "text-[#B49042]" : "text-[#525252]"}
            />
          </div>
        )}
      </div>
      <div
        className={`mt-4 font-display text-[26px] font-semibold leading-none tracking-tight ${
          accent ? "text-[#B49042]" : "text-[#0A0A0A]"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] text-[#a3a3a3]">{sub}</div>}
    </div>
  );
}

function TableShell({ headers, children, empty }) {
  return (
    <div className="table-shell overflow-x-auto">
      <table className="w-full min-w-[700px]">
        <thead>
          <tr className="table-head-row">
            {headers.map((h) => (
              <th
                key={h.key}
                className={`table-th ${h.right ? "text-right" : ""}`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td colSpan={headers.length} className="table-td text-center text-[#737373] py-10">
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 className="text-[13px] font-semibold text-[#0A0A0A] mb-3 mt-6">{children}</h3>
  );
}

/** Alert-style product grid (Low Stock / Zero Stock) — collapsed by default so
 * a shop with many flagged items doesn't turn the report into a long scroll. */
function CollapsibleAlertSection({ icon, title, count, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 mt-6 mb-1 text-[13px] font-semibold text-[#0A0A0A] hover:opacity-80"
        aria-expanded={open}
      >
        {icon}
        {title}
        <span
          className="text-[11px] font-medium px-1.5 py-0.5 rounded-full"
          style={{ background: "#F3F4F6", color: "#525252" }}
        >
          {count}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className="transition-transform"
          style={{ color: "#737373", transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
          {children}
        </div>
      )}
    </div>
  );
}

function Badge({ children, color = "gray" }) {
  const colors = {
    gray: "bg-[#F3F4F6] text-[#374151]",
    gold: "bg-[#FDFBF7] text-[#B49042] border border-[#EADFBF]",
    green: "bg-[#F0FDF4] text-[#166534]",
    red: "bg-[#FEF2F2] text-[#991B1B]",
    blue: "bg-[#EFF6FF] text-[#1D4ED8]",
    amber: "bg-[#FFFBEB] text-[#92400E]",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
}

// ─── Bill Details Modal ─────────────────────────────────────────────────────
// Full breakdown for a single invoice — customer, product, price, and payment
// sections, all sourced directly from the saved invoice record (no recomputation).

function BillDetailsSection({ title, icon: Icon, children }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-center gap-1.5 mb-2.5 pb-1.5 border-b border-[#E5E7EB]">
        {Icon && <Icon size={13} strokeWidth={1.5} className="text-[#B49042]" />}
        <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#737373]">
          {title}
        </div>
      </div>
      {children}
    </div>
  );
}

function InfoField({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.06em] text-[#a3a3a3]">{label}</div>
      <div className="text-[13px] text-[#0A0A0A] font-medium mt-0.5">{value ?? "—"}</div>
    </div>
  );
}

function BillDetailsModal({ invoice, onClose }) {
  if (!invoice) return null;
  const items = asArray(invoice.items);
  const amountPaid = invoiceAmountPaid(invoice);
  const balanceDue = +((invoice.grand_total || 0) - amountPaid).toFixed(2);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mt-8 mb-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#E5E7EB]">
          <div>
            <div className="text-[16px] font-display font-semibold text-[#0A0A0A]">
              Invoice {invoice.invoice_no}
            </div>
            <div className="text-[12px] text-[#737373] mt-0.5">
              {fmtDateTime(invoice.created_at)}
            </div>
          </div>
          <button onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-5 max-h-[75vh] overflow-y-auto">
          {/* Customer Information */}
          <BillDetailsSection title="Customer Information" icon={User2}>
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Customer Name" value={invoice.customer_name || "Walk-in Customer"} />
              <InfoField label="Contact Number" value={invoice.customer_mobile} />
              {invoice.pan_number && <InfoField label="PAN Number" value={invoice.pan_number} />}
            </div>
          </BillDetailsSection>

          {/* Product Information */}
          <BillDetailsSection title="Product Information" icon={Package}>
            {items.length === 0 ? (
              <div className="text-[12.5px] text-[#a3a3a3]">No items recorded.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[#E5E7EB] text-left">
                      <th className="py-1.5 pr-2 font-medium text-[10.5px] uppercase tracking-wider text-[#737373]">Product</th>
                      <th className="py-1.5 pr-2 font-medium text-[10.5px] uppercase tracking-wider text-[#737373]">Code</th>
                      <th className="py-1.5 pr-2 font-medium text-[10.5px] uppercase tracking-wider text-[#737373] text-right">Qty</th>
                      <th className="py-1.5 pr-2 font-medium text-[10.5px] uppercase tracking-wider text-[#737373] text-right">Gross Wt</th>
                      <th className="py-1.5 pr-2 font-medium text-[10.5px] uppercase tracking-wider text-[#737373] text-right">Gold Wt</th>
                      <th className="py-1.5 pr-2 font-medium text-[10.5px] uppercase tracking-wider text-[#737373] text-right">Stone Wt</th>
                      <th className="py-1.5 pr-2 font-medium text-[10.5px] uppercase tracking-wider text-[#737373] text-right">Stone Value</th>
                      <th className="py-1.5 font-medium text-[10.5px] uppercase tracking-wider text-[#737373] text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-b border-[#F3F4F6] last:border-0">
                        <td className="py-1.5 pr-2">
                          <div className="font-medium text-[#0A0A0A]">{it.name}</div>
                          <div className="text-[10.5px] text-[#a3a3a3]">{it.metal} {it.purity}</div>
                        </td>
                        <td className="py-1.5 pr-2 font-mono text-[#525252]">{it.code || "—"}</td>
                        <td className="py-1.5 pr-2 text-right">{it.quantity || 1}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{it.gross_weight ? `${it.gross_weight}g` : "—"}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{it.net_weight ? `${it.net_weight}g` : "—"}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{it.stone_weight ? `${it.stone_weight}g` : "—"}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{it.stone_charges ? fmtINR(it.stone_charges) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">
                          {fmtINR((it.unit_price || 0) * (it.quantity || 1))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BillDetailsSection>

          {/* Price Breakdown */}
          <BillDetailsSection title="Price Breakdown" icon={Percent}>
            <div className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><span className="text-[#737373]">Subtotal</span><span className="tabular-nums">{fmtINR(invoice.subtotal)}</span></div>
              {invoice.discount > 0 && (
                <div className="flex justify-between"><span className="text-[#737373]">Discount</span><span className="tabular-nums text-[#166534]">− {fmtINR(invoice.discount)}</span></div>
              )}
              {/* Legacy invoices deducted Old Gold from grand total directly — keep showing that
                  so this breakdown still reconciles with grand_total. New invoices carry Old
                  Gold as a payment instead (shown in Payment Information below). */}
              {!hasOldGoldPayment(invoice) && invoice.old_gold_value > 0 && (
                <div className="flex justify-between"><span className="text-[#737373]">Old Gold Exchange</span><span className="tabular-nums text-[#166534]">− {fmtINR(invoice.old_gold_value)}</span></div>
              )}
              {!hasOldSilverPayment(invoice) && Number(invoice.old_silver_value) > 0 && (
                <div className="flex justify-between"><span className="text-[#737373]">Old Silver Exchange</span><span className="tabular-nums text-[#166534]">− {fmtINR(invoice.old_silver_value)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-[#737373]">GST ({invoice.gst_pct || 3}%)</span><span className="tabular-nums">{fmtINR(invoice.gst_amount)}</span></div>
              <div className="flex justify-between pt-1.5 border-t border-[#E5E7EB] font-semibold text-[14px]">
                <span>Grand Total</span><span className="tabular-nums text-[#B49042]">{fmtINR(invoice.grand_total)}</span>
              </div>
            </div>
          </BillDetailsSection>

          {/* Payment Information */}
          <BillDetailsSection title="Payment Information" icon={CreditCard}>
            {asArray(invoice.payments).length === 0 ? (
              <div className="text-[12.5px] text-[#a3a3a3]">No payment records.</div>
            ) : (
              <div className="space-y-1.5">
                {asArray(invoice.payments).map((p, idx) => (
                  <div key={idx}>
                    <div className="flex items-center justify-between text-[12.5px]">
                      <div className="flex items-center gap-2">
                        <Badge color={PAYMENT_MODE_COLORS[p.mode] || "gray"}>{paymentModeLabel(p.mode)}</Badge>
                        {p.description && <span className="text-[11px] text-[#a3a3a3] italic">{p.description}</span>}
                      </div>
                      <span className="tabular-nums font-medium">{fmtINR(p.amount)}</span>
                    </div>
                    {exchangePaymentSnap(p) && (
                      <div className="text-[11px] text-[#a3a3a3] font-mono mt-0.5">
                        {Number(exchangePaymentSnap(p).weight).toFixed(3)} g | {exchangePaymentSnap(p).purity} | {fmtINR(exchangePaymentSnap(p).rate, { decimals: 0 })}/g
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </BillDetailsSection>

          {/* Final Transaction Summary */}
          <BillDetailsSection title="Final Transaction Summary">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#FDFBF7] border border-[#EADFBF] rounded-lg p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-[#a3a3a3]">Grand Total</div>
                <div className="text-[16px] font-display font-semibold text-[#B49042] mt-1">{fmtINR(invoice.grand_total)}</div>
              </div>
              <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-[#a3a3a3]">Amount Paid</div>
                <div className="text-[16px] font-display font-semibold text-[#166534] mt-1">{fmtINR(amountPaid)}</div>
              </div>
              <div className={`rounded-lg p-3 text-center border ${Math.abs(balanceDue) < 0.5 ? "bg-[#F9FAFB] border-[#E5E7EB]" : "bg-[#FEF2F2] border-[#FECACA]"}`}>
                <div className="text-[10px] uppercase tracking-wider text-[#a3a3a3]">Balance Due</div>
                <div className={`text-[16px] font-display font-semibold mt-1 ${Math.abs(balanceDue) < 0.5 ? "text-[#0A0A0A]" : "text-[#991B1B]"}`}>
                  {fmtINR(Math.max(0, balanceDue))}
                </div>
              </div>
            </div>
          </BillDetailsSection>
        </div>
      </div>
    </div>
  );
}

// ─── Date Range Picker ───────────────────────────────────────────────────────

function DateRangePicker({ from, to, setFrom, setTo, presets = "sales" }) {
  const salesPresets = [
    { label: "Today", action: () => { setFrom(todayStr()); setTo(todayStr()); } },
    { label: "This Week", action: () => { setFrom(daysAgo(6)); setTo(todayStr()); } },
    { label: "This Month", action: () => { setFrom(monthStart()); setTo(todayStr()); } },
    {
      label: "Last Month",
      action: () => {
        const r = lastMonthRange();
        setFrom(r.from);
        setTo(r.to);
      },
    },
    { label: "This Year", action: () => { setFrom(yearStart()); setTo(todayStr()); } },
  ];

  const quickPresets = presets === "sales" ? salesPresets : salesPresets;

  return (
    <div className="card mb-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[#525252]">
          <Filter size={13} strokeWidth={1.5} />
          <span className="text-[12.5px] font-medium">Date range</span>
        </div>
        <input
          type="date"
          className="input max-w-[170px]"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-[#a3a3a3] text-[13px]">→</span>
        <input
          type="date"
          className="input max-w-[170px]"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {quickPresets.map((p) => (
            <button
              key={p.label}
              onClick={p.action}
              className="btn-secondary !py-1 !text-[11.5px]"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab 1: Sales ────────────────────────────────────────────────────────────

const SALES_SUBTABS = [
  { id: "overview", label: "Overview" },
  { id: "invoices", label: "Invoice Reports" },
  { id: "by-employee", label: "By Employee" },
  { id: "trend", label: "Sales Trend" },
  { id: "top-products", label: "Top Products" },
  { id: "top-customers", label: "Top Customers" },
  { id: "occasions", label: "Birthdays & Anniversaries" },
  { id: "estimations-to-sale", label: "Estimations to Sale" },
];

function lineAmount(item) {
  return Number(item.line_total ?? item.total_price ?? item.price ?? 0);
}

function itemCategoryName(item) {
  return item.category_name || item.category || item.product_category || "Other";
}

function itemMetalName(item) {
  return (
    item.metal_name ||
    item.metal ||
    item.metal_type ||
    (item.is_pure_metal || item.line_type === "pure_metal"
      ? (/silver/i.test(String(item.purity || item.name || "")) ? "Silver" : "Gold")
      : "Other")
  );
}

function SalesTab({ from, to, setFrom, setTo, includeHidden = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [subTab, setSubTab] = useState("overview");
  const [chartCategory, setChartCategory] = useState("all");

  const { counters, employees, metalTypes, categories } = useFilterOptions();
  const [salespersonId, setSalespersonId] = useState("");
  const [counterId, setCounterId] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [metalType, setMetalType] = useState("");
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);

  const insightsParams = useMemo(() => ({
    from, to,
    salesperson_id: salespersonId || undefined,
    counter_id: counterId || undefined,
    payment_mode: paymentMode || undefined,
    status: invoiceStatus || undefined,
    category_id: categoryId || undefined,
    metal_type: metalType || undefined,
    include_hidden: includeHidden ? 1 : undefined,
  }), [from, to, salespersonId, counterId, paymentMode, invoiceStatus, categoryId, metalType, includeHidden]);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get("/reports/sales", { params: { from_date: from, to_date: to, include_hidden: includeHidden ? 1 : undefined } })
      .then(({ data: d }) => setData(d))
      .catch(() => toast.error("Failed to load sales data"))
      .finally(() => setLoading(false));
  }, [from, to, includeHidden]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!data) return;
    const header =
      "Invoice No,Date,Customer,Mobile,Items,Subtotal,Discount,GST,Grand Total,Payment Mode\n";
    const rows = (data.invoices || [])
      .map(
        (i) =>
          `${i.invoice_no},${fmtDateTime(i.created_at)},"${i.customer_name || "Walk-in"}",${i.customer_mobile || ""},${asArray(i.items).length},${i.subtotal || 0},${i.discount || 0},${i.gst_amount || 0},${i.grand_total || 0},"${invoicePaymentSummary(i)}"`,
      )
      .join("\n");
    downloadCsv(header + rows, `sales-${from}-to-${to}.csv`);
  };

  const allLineItems = useMemo(() => {
    if (!data?.invoices) return [];
    const lines = [];
    for (const inv of data.invoices) {
      for (const item of asArray(inv.items)) lines.push(item);
    }
    return lines;
  }, [data]);

  const categoryData = useMemo(() => {
    const map = {};
    for (const item of allLineItems) {
      const cat = itemCategoryName(item);
      map[cat] = (map[cat] || 0) + lineAmount(item);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [allLineItems]);

  useEffect(() => {
    if (chartCategory === "all") return;
    if (!categoryData.some((c) => c.name === chartCategory)) setChartCategory("all");
  }, [categoryData, chartCategory]);

  const filteredLines = useMemo(() => {
    if (chartCategory === "all") return allLineItems;
    return allLineItems.filter((item) => itemCategoryName(item) === chartCategory);
  }, [allLineItems, chartCategory]);

  const metalData = useMemo(() => {
    const map = {};
    for (const item of filteredLines) {
      const metal = itemMetalName(item);
      map[metal] = (map[metal] || 0) + lineAmount(item);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filteredLines]);

  const productData = useMemo(() => {
    const map = {};
    for (const item of filteredLines) {
      const name = item.product_name || item.name || item.item_name || "Item";
      map[name] = (map[name] || 0) + lineAmount(item);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name: name.length > 22 ? `${name.slice(0, 20)}…` : name, value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filteredLines]);

  const showInsightFilters = ["by-employee", "top-customers"].includes(subTab);

  if (loading) return (
    <div className="space-y-4">
      <PageLoadingBadge />
      <div className="h-96 shimmer rounded-md" />
    </div>
  );

  const totals = data?.totals || {};
  const invoices = data?.invoices || [];
  const avgInvoice =
    totals.count > 0 ? Number(totals.grand_total || 0) / totals.count : 0;

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />

      <div className="mb-4 overflow-x-auto rounded-xl border border-[#EADFBF] bg-[#FDFBF7] px-2 py-2">
        <div className="flex min-w-max flex-wrap gap-1.5">
          {SALES_SUBTABS.map((tab) => {
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-[#B49042] text-white shadow-sm"
                    : "bg-white text-[#525252] border border-[#E5E7EB] hover:border-[#B49042] hover:text-[#B49042]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {subTab === "overview" && (
        <>
          <div className="flex justify-end mb-4 gap-2">
            <button className="btn-secondary !py-1 !text-[11.5px]" onClick={() => setSummaryModalOpen(true)}>
              <Download size={12} strokeWidth={1.5} /> Print Summary
            </button>
            <button className="btn-secondary" onClick={exportCsv}>
              <Download size={13} strokeWidth={1.5} /> Export CSV
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Sales" value={fmtINR(totals.grand_total)} accent icon={TrendingUp} />
            <StatCard label="Total Invoices" value={totals.count || 0} icon={Receipt} />
            <StatCard label="Avg Invoice Value" value={fmtINR(avgInvoice)} icon={TrendingUp} />
            <StatCard label="Total GST Collected" value={fmtINR(totals.gst_collected ?? totals.gst_amount)} icon={Receipt} />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11.5px] font-medium text-[#737373]">Category:</span>
            <button
              type="button"
              onClick={() => setChartCategory("all")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                chartCategory === "all"
                  ? "bg-[#B49042] text-white border-[#B49042]"
                  : "bg-white text-[#525252] border-[#E5E7EB] hover:border-[#B49042]"
              }`}
            >
              All
            </button>
            {categoryData.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => setChartCategory(c.name)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                  chartCategory === c.name
                    ? "bg-[#B49042] text-white border-[#B49042]"
                    : "bg-white text-[#525252] border-[#E5E7EB] hover:border-[#B49042]"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="card p-4">
              <div className="text-[12px] font-semibold text-[#0A0A0A] mb-2">
                {chartCategory === "all" ? "Category-wise Sales" : `${chartCategory} — Top Products`}
              </div>
              <SimpleBarChart
                data={chartCategory === "all" ? categoryData.slice(0, 10) : productData}
                xKey="name"
                bars={[{
                  key: "value",
                  name: chartCategory === "all" ? "Sales" : "Revenue",
                  color: GOLD_ACCENT,
                }]}
                height={260}
              />
            </div>
            <div className="card p-4">
              <div className="text-[12px] font-semibold text-[#0A0A0A] mb-2">
                {chartCategory === "all" ? "Metal-wise Breakdown" : `${chartCategory} — Metal Mix`}
              </div>
              <SimplePieChart data={metalData} height={260} innerRadius={52} />
            </div>
          </div>
        </>
      )}

      {subTab === "invoices" && (
        <>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle>Invoice Reports</SectionTitle>
            <div className="flex gap-2">
              <PrintSummaryButton
                reportName="Sales Invoice Register"
                defaultOrientation="landscape"
                filtersSummary={`${from} to ${to}`}
                columns={[
                  { key: "invoice_no", label: "Invoice No" },
                  { key: "created_at", label: "Date", format: "datetime" },
                  { key: "customer_name", label: "Customer" },
                  { key: "customer_mobile", label: "Mobile" },
                  { key: "subtotal", label: "Subtotal", format: "currency", align: "right" },
                  { key: "discount", label: "Discount", format: "currency", align: "right" },
                  { key: "gst_amount", label: "GST", format: "currency", align: "right" },
                  { key: "grand_total", label: "Grand Total", format: "currency", align: "right" },
                  { key: "payment", label: "Payment Mode", exportValue: invoicePaymentSummary },
                ]}
                rows={invoices}
                totals={invoices.reduce((acc, i) => ({
                  subtotal: acc.subtotal + (Number(i.subtotal) || 0),
                  discount: acc.discount + (Number(i.discount) || 0),
                  gst_amount: acc.gst_amount + (Number(i.gst_amount) || 0),
                  grand_total: acc.grand_total + (Number(i.grand_total) || 0),
                }), { subtotal: 0, discount: 0, gst_amount: 0, grand_total: 0 })}
                summaryParticulars={[
                  { particular: "Subtotal", total: invoices.reduce((s, i) => s + (Number(i.subtotal) || 0), 0) },
                  { particular: "Discount", total: invoices.reduce((s, i) => s + (Number(i.discount) || 0), 0) },
                  { particular: "GST", total: invoices.reduce((s, i) => s + (Number(i.gst_amount) || 0), 0) },
                  { particular: "Grand Total", total: invoices.reduce((s, i) => s + (Number(i.grand_total) || 0), 0) },
                ]}
              />
              <button className="btn-secondary" onClick={exportCsv}>
                <Download size={13} strokeWidth={1.5} /> Export CSV
              </button>
            </div>
          </div>
          <TableShell
            headers={[
              { key: "inv", label: "Invoice No" },
              { key: "date", label: "Date" },
              { key: "cust", label: "Customer" },
              { key: "mobile", label: "Mobile" },
              { key: "items", label: "Items", right: true },
              { key: "sub", label: "Subtotal", right: true },
              { key: "disc", label: "Discount", right: true },
              { key: "gst", label: "GST", right: true },
              { key: "total", label: "Grand Total", right: true },
              { key: "pay", label: "Payment Mode" },
              { key: "view", label: "" },
            ]}
            empty={invoices.length === 0 ? "No invoices in this period." : null}
          >
            {invoices.map((i) => (
              <tr
                key={i.id}
                className="table-row cursor-pointer hover:bg-[#FAFAFA]"
                onClick={() => setSelectedInvoice(i)}
              >
                <td className="table-td font-mono text-[12px]">{i.invoice_no}</td>
                <td className="table-td text-[12.5px]">{fmtDateTime(i.created_at)}</td>
                <td className="table-td">{i.customer_name || "Walk-in"}</td>
                <td className="table-td text-[#525252]">{i.customer_mobile || "—"}</td>
                <td className="table-td text-right">{asArray(i.items).length}</td>
                <td className="table-td text-right tabular-nums">{fmtINR(i.subtotal)}</td>
                <td className="table-td text-right tabular-nums text-[#737373]">
                  {fmtINR(i.discount)}
                </td>
                <td className="table-td text-right tabular-nums">{fmtINR(i.gst_amount)}</td>
                <td className="table-td text-right font-semibold tabular-nums text-[#B49042]">
                  {fmtINR(i.grand_total)}
                </td>
                <td className="table-td">
                  <Badge color={invoicePaymentColor(i)}>{invoicePaymentSummary(i)}</Badge>
                </td>
                <td className="table-td text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedInvoice(i); }}
                    className="text-[#737373] hover:text-[#B49042] inline-flex items-center gap-1 text-[11.5px]"
                  >
                    <Eye size={13} strokeWidth={1.5} /> View
                  </button>
                </td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {showInsightFilters && (
        <FilterBar>
          <FilterSelect label="Salesperson" value={salespersonId} onChange={setSalespersonId} options={employees} />
          <FilterSelect label="Counter" value={counterId} onChange={setCounterId} options={counters} />
          <FilterSelect label="Payment Mode" value={paymentMode} onChange={setPaymentMode} options={Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => ({ value, label }))} />
          <FilterSelect label="Invoice Status" value={invoiceStatus} onChange={setInvoiceStatus} options={[{ value: "paid", label: "Paid" }, { value: "cancelled", label: "Cancelled" }]} />
          <FilterSelect label="Product Category" value={categoryId} onChange={setCategoryId} options={categories} />
          <FilterSelect label="Metal Type" value={metalType} onChange={setMetalType} options={metalTypes} />
        </FilterBar>
      )}

      {subTab === "by-employee" && (
        <SubReportTable
          title="Sales by Employee"
          endpoint="/reports/sales/by-employee"
          params={insightsParams}
          columns={[
            { key: "salesperson_name", label: "Salesperson" },
            { key: "invoice_count", label: "Invoices", align: "right" },
            { key: "grand_total", label: "Total Sales", align: "right", format: "currency", render: (r) => fmtINR(r.grand_total) },
            { key: "gst_amount", label: "GST", align: "right", format: "currency", render: (r) => fmtINR(r.gst_amount) },
          ]}
          chart={(rows) => (
            <SimpleBarChart
              data={rows.slice(0, 10).map((r) => ({
                name: String(r.salesperson_name || "—").split(" ")[0],
                value: Number(r.grand_total) || 0,
              }))}
              xKey="name"
              bars={[{ key: "value", name: "Sales", color: GOLD_ACCENT }]}
              height={240}
            />
          )}
        />
      )}

      {subTab === "trend" && (
        <SubReportTable
          title="Sales Trend"
          endpoint="/reports/sales/trend"
          params={{ from, to, include_hidden: includeHidden ? 1 : undefined }}
          columns={[
            { key: "date", label: "Date", format: "date", render: (r) => fmtDate(r.date) },
            { key: "invoice_count", label: "Invoices", align: "right" },
            { key: "grand_total", label: "Total Sales", align: "right", format: "currency", render: (r) => fmtINR(r.grand_total) },
          ]}
          chart={(rows) => (
            <SimpleBarChart
              data={rows.map((r) => ({
                name: String(r.date || "").slice(5, 10) || "—",
                value: Number(r.grand_total) || 0,
              }))}
              xKey="name"
              bars={[{ key: "value", name: "Sales", color: GOLD_ACCENT }]}
              height={240}
            />
          )}
        />
      )}

      {subTab === "top-products" && (
        <SubReportTable
          title="Top Selling Products"
          endpoint="/reports/sales/top-products"
          params={{ from, to, include_hidden: includeHidden ? 1 : undefined }}
          columns={[
            { key: "rank", label: "Rank", align: "right" },
            { key: "product_name", label: "Product" },
            { key: "quantity_sold", label: "Qty Sold", align: "right" },
            { key: "revenue", label: "Revenue", align: "right", format: "currency", render: (r) => fmtINR(r.revenue) },
            { key: "avg_selling_price", label: "Avg Price", align: "right", format: "currency", render: (r) => fmtINR(r.avg_selling_price) },
          ]}
          chart={(rows) => (
            <SimpleBarChart
              data={rows.slice(0, 8).map((r) => ({
                name: String(r.product_name || "—").length > 18
                  ? `${String(r.product_name).slice(0, 16)}…`
                  : (r.product_name || "—"),
                value: Number(r.revenue) || 0,
              }))}
              xKey="name"
              bars={[{ key: "value", name: "Revenue", color: GOLD_ACCENT }]}
              height={240}
            />
          )}
        />
      )}

      {subTab === "top-customers" && (
        <SubReportTable
          title="Top Customers"
          endpoint="/reports/sales/top-customers"
          params={insightsParams}
          columns={[
            { key: "customer_name", label: "Customer" },
            { key: "mobile", label: "Mobile" },
            { key: "invoice_count", label: "Invoices", align: "right" },
            { key: "grand_total", label: "Total Spend", align: "right", format: "currency", render: (r) => fmtINR(r.grand_total) },
          ]}
          chart={(rows) => (
            <SimpleBarChart
              data={rows.slice(0, 8).map((r) => ({
                name: String(r.customer_name || "Walk-in").split(" ")[0],
                value: Number(r.grand_total) || 0,
              }))}
              xKey="name"
              bars={[{ key: "value", name: "Spend", color: GOLD_ACCENT }]}
              height={240}
            />
          )}
        />
      )}

      {subTab === "occasions" && (
        <>
          <OccasionReportTable kind="birthday" />
          <OccasionReportTable kind="anniversary" />
        </>
      )}

      {subTab === "estimations-to-sale" && <EstimationsToSaleTab />}

      <BillDetailsModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />

      <ReportViewModal
        open={summaryModalOpen}
        onClose={() => setSummaryModalOpen(false)}
        reportName="Sales Summary"
        columns={[
          { key: "metric", label: "Metric" },
          { key: "value", label: "Value", align: "right" },
        ]}
        rows={[
          { metric: "Total Sales", value: fmtINR(totals.grand_total) },
          { metric: "Total Invoices", value: totals.count || 0 },
          { metric: "Avg Invoice Value", value: fmtINR(avgInvoice) },
          { metric: "Total GST Collected", value: fmtINR(totals.gst_collected ?? totals.gst_amount) },
        ]}
        totals={null}
        filtersSummary={`${from} to ${to}`}
      />
    </div>
  );
}

// ─── Tab 2: GST ──────────────────────────────────────────────────────────────

function GstTab({ from, to, setFrom, setTo, includeHidden = false }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liability, setLiability] = useState(null);

  useEffect(() => {
    api.get("/reports/gst/liability", { params: { from, to, include_hidden: includeHidden ? 1 : undefined } }).then(({ data }) => setLiability(data)).catch(() => setLiability(null));
  }, [from, to, includeHidden]);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get("/reports/gst/list", { params: { from_date: from, to_date: to, limit: 200, include_hidden: includeHidden ? 1 : undefined } })
      .then(({ data }) => setInvoices(data.data || []))
      .catch(() => toast.error("Failed to load GST data"))
      .finally(() => setLoading(false));
  }, [from, to, includeHidden]);

  useEffect(() => { load(); }, [load]);

  // Aggregate HSN-wise from invoice item snapshots (authoritative field names)
  const hsnMap = (() => {
    const m = {};
    for (const inv of invoices) {
      // Prefer invoice-level GST when items lack allocated shares
      const invCgst = Number(inv.cgst_amount ?? 0);
      const invSgst = Number(inv.sgst_amount ?? 0);
      const invTaxable = Number(inv.after_discount ?? Math.max(0, Number(inv.subtotal || 0) - Number(inv.discount || 0)));
      const items = asArray(inv.items);

      if (items.length === 0) {
        const hsn = "7113";
        if (!m[hsn]) m[hsn] = { hsn, description: "Jewellery", qty: 0, taxable: 0, cgst: 0, sgst: 0 };
        m[hsn].taxable += invTaxable;
        m[hsn].cgst += invCgst;
        m[hsn].sgst += invSgst;
        continue;
      }

      for (const item of items) {
        const hsn = item.hsn_code || item.hsn || "7113";
        const taxable = Number(item.taxable_amount ?? item.line_total ?? item.taxable_value ?? item.total_price ?? item.price ?? 0);
        const cgst = Number(item.cgst_amount ?? item.cgst ?? 0);
        const sgst = Number(item.sgst_amount ?? item.sgst ?? 0);
        if (!m[hsn]) {
          m[hsn] = { hsn, description: item.hsn_description || item.category || item.name || "Jewellery", qty: 0, taxable: 0, cgst: 0, sgst: 0 };
        }
        m[hsn].qty += Number(item.quantity || item.qty || 1);
        m[hsn].taxable += taxable;
        m[hsn].cgst += cgst;
        m[hsn].sgst += sgst;
      }
    }
    return Object.values(m).map((r) => ({
      ...r,
      taxable: Math.round(r.taxable * 100) / 100,
      cgst: Math.round(r.cgst * 100) / 100,
      sgst: Math.round(r.sgst * 100) / 100,
    }));
  })();

  const totalTaxable = hsnMap.reduce((s, r) => s + r.taxable, 0);
  const totalCgst = hsnMap.reduce((s, r) => s + r.cgst, 0);
  const totalSgst = hsnMap.reduce((s, r) => s + r.sgst, 0);

  const exportCsv = () => {
    const header = "HSN Code,Description,Qty,Taxable Value,CGST 1.5%,SGST 1.5%,Total GST\n";
    const rows = hsnMap
      .map(
        (r) =>
          `${r.hsn},"${r.description}",${r.qty},${r.taxable.toFixed(2)},${r.cgst.toFixed(2)},${r.sgst.toFixed(2)},${(r.cgst + r.sgst).toFixed(2)}`,
      )
      .join("\n");
    downloadCsv(header + rows, `gst-${from}-to-${to}.csv`);
  };

  if (loading) return (
    <div className="space-y-4">
      <PageLoadingBadge />
      <div className="h-96 shimmer rounded-md" />
    </div>
  );

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />

      <div className="flex items-center justify-end mb-4">
        <div className="flex gap-2">
          <PrintSummaryButton
            reportName="Sales GST Register"
            defaultOrientation="landscape"
            filtersSummary={`${from} to ${to}`}
            columns={[
              { key: "invoice_no", label: "Invoice No" },
              { key: "created_at", label: "Date", format: "datetime" },
              { key: "customer_name", label: "Customer" },
              { key: "gstin", label: "GST No", exportValue: (i) => i.customer_gstin || i.gstin || "" },
              { key: "taxable", label: "Taxable Value", format: "currency", align: "right", exportValue: (i) => Number(i.after_discount ?? Math.max(0, Number(i.subtotal || 0) - Number(i.discount || 0))) },
              { key: "cgst_amount", label: "CGST", format: "currency", align: "right" },
              { key: "sgst_amount", label: "SGST", format: "currency", align: "right" },
              { key: "grand_total", label: "Grand Total", format: "currency", align: "right" },
            ]}
            rows={invoices}
            totals={{
              taxable: invoices.reduce((s, i) => s + Number(i.after_discount ?? Math.max(0, Number(i.subtotal || 0) - Number(i.discount || 0))), 0),
              cgst_amount: invoices.reduce((s, i) => s + (Number(i.cgst_amount) || 0), 0),
              sgst_amount: invoices.reduce((s, i) => s + (Number(i.sgst_amount) || 0), 0),
              grand_total: invoices.reduce((s, i) => s + (Number(i.grand_total) || 0), 0),
            }}
            summaryParticulars={[
              { particular: "Taxable", total: invoices.reduce((s, i) => s + Number(i.after_discount ?? Math.max(0, Number(i.subtotal || 0) - Number(i.discount || 0))), 0) },
              { particular: "CGST", total: invoices.reduce((s, i) => s + (Number(i.cgst_amount) || 0), 0) },
              { particular: "SGST", total: invoices.reduce((s, i) => s + (Number(i.sgst_amount) || 0), 0) },
              { particular: "Grand Total", total: invoices.reduce((s, i) => s + (Number(i.grand_total) || 0), 0) },
            ]}
          />
          <button className="btn-secondary" onClick={exportCsv}>
            <Download size={13} strokeWidth={1.5} /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Taxable Value" value={fmtINR(totalTaxable)} icon={Receipt} />
        <StatCard label="CGST Collected (1.5%)" value={fmtINR(totalCgst)} accent icon={Receipt} />
        <StatCard label="SGST Collected (1.5%)" value={fmtINR(totalSgst)} accent icon={Receipt} />
        <StatCard label="Total GST (3%)" value={fmtINR(totalCgst + totalSgst)} icon={TrendingUp} />
      </div>

      <SectionTitle>HSN-wise Summary (for GSTR-1)</SectionTitle>
      <TableShell
        headers={[
          { key: "hsn", label: "HSN Code" },
          { key: "desc", label: "Description" },
          { key: "qty", label: "Qty", right: true },
          { key: "taxable", label: "Taxable Value", right: true },
          { key: "cgst", label: "CGST 1.5%", right: true },
          { key: "sgst", label: "SGST 1.5%", right: true },
          { key: "totalgst", label: "Total GST", right: true },
        ]}
        empty={hsnMap.length === 0 ? "No GST data for this period." : null}
      >
        {hsnMap.map((r, idx) => (
          <tr key={idx} className="table-row">
            <td className="table-td font-mono text-[12px] font-semibold">{r.hsn}</td>
            <td className="table-td">{r.description}</td>
            <td className="table-td text-right">{r.qty}</td>
            <td className="table-td text-right tabular-nums">{fmtINR(r.taxable)}</td>
            <td className="table-td text-right tabular-nums text-[#B49042]">{fmtINR(r.cgst)}</td>
            <td className="table-td text-right tabular-nums text-[#B49042]">{fmtINR(r.sgst)}</td>
            <td className="table-td text-right tabular-nums font-semibold">{fmtINR(r.cgst + r.sgst)}</td>
          </tr>
        ))}
      </TableShell>

      <SectionTitle>Invoice-wise GST Details</SectionTitle>
      <TableShell
        headers={[
          { key: "inv", label: "Invoice No" },
          { key: "date", label: "Date" },
          { key: "cust", label: "Customer" },
          { key: "gstin", label: "GST No" },
          { key: "taxable", label: "Taxable Value", right: true },
          { key: "cgst", label: "CGST", right: true },
          { key: "sgst", label: "SGST", right: true },
          { key: "grand", label: "Grand Total", right: true },
        ]}
        empty={invoices.length === 0 ? "No invoices in this period." : null}
      >
        {invoices.map((i) => {
          const taxable = Number(i.after_discount ?? Math.max(0, Number(i.subtotal || 0) - Number(i.discount || 0)));
          const gst = Number(i.gst_amount || 0);
          const cgst = Number(i.cgst_amount ?? Math.round((gst / 2) * 100) / 100);
          const sgst = Number(i.sgst_amount ?? Math.round((gst - cgst) * 100) / 100);
          return (
            <tr key={i.id} className="table-row">
              <td className="table-td font-mono text-[12px]">{i.invoice_no}</td>
              <td className="table-td text-[12.5px]">{fmtDate(i.created_at)}</td>
              <td className="table-td">{i.customer_name || "Walk-in"}</td>
              <td className="table-td font-mono text-[11.5px] text-[#525252]">
                {i.customer_gstin || i.gstin || "—"}
              </td>
              <td className="table-td text-right tabular-nums">{fmtINR(taxable)}</td>
              <td className="table-td text-right tabular-nums">{fmtINR(cgst)}</td>
              <td className="table-td text-right tabular-nums">{fmtINR(sgst)}</td>
              <td className="table-td text-right font-semibold tabular-nums text-[#B49042]">
                {fmtINR(i.grand_total)}
              </td>
            </tr>
          );
        })}
      </TableShell>

      <div className="mt-10 pt-6 border-t border-[#E5E7EB]">
        <SectionTitle>GST Insights</SectionTitle>
      </div>
      {liability && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard label="Output GST (Sales)" value={fmtINR(liability.output_gst)} icon={Receipt} />
          <StatCard label="Input GST (Purchases)" value={fmtINR(liability.input_gst)} icon={ShoppingCart} />
          <StatCard label="Net GST Liability" value={fmtINR(liability.net_liability)} accent icon={TrendingUp} />
        </div>
      )}
      <SubReportTable
        title="Monthly GST Summary"
        endpoint="/reports/gst/monthly-summary"
        params={{ from, to }}
        columns={[
          { key: "month", label: "Month" },
          { key: "invoice_count", label: "Invoices", align: "right" },
          { key: "taxable", label: "Taxable Value", align: "right", format: "currency", render: (r) => fmtINR(r.taxable) },
          { key: "cgst", label: "CGST", align: "right", format: "currency", render: (r) => fmtINR(r.cgst) },
          { key: "sgst", label: "SGST", align: "right", format: "currency", render: (r) => fmtINR(r.sgst) },
          { key: "gst", label: "Total GST", align: "right", format: "currency", render: (r) => fmtINR(r.gst) },
        ]}
      />
      <SubReportTable
        title="Tax Rate Summary"
        endpoint="/reports/gst/tax-rate-summary"
        params={{ from, to }}
        columns={[
          { key: "gst_pct", label: "GST Rate", render: (r) => `${r.gst_pct}%` },
          { key: "invoice_count", label: "Invoices", align: "right" },
          { key: "taxable", label: "Taxable Value", align: "right", format: "currency", render: (r) => fmtINR(r.taxable) },
          { key: "gst", label: "GST", align: "right", format: "currency", render: (r) => fmtINR(r.gst) },
        ]}
      />
      <SubReportTable
        title="GST Collection Trend"
        endpoint="/reports/gst/collection-trend"
        params={{ from, to }}
        columns={[
          { key: "date", label: "Date", format: "date", render: (r) => fmtDate(r.date) },
          { key: "gst_amount", label: "GST Collected", align: "right", format: "currency", render: (r) => fmtINR(r.gst_amount) },
        ]}
      />
    </div>
  );
}

// ─── Tab 3: Inventory ────────────────────────────────────────────────────────

const QUICK_REPORT_COMPONENTS = {
  "stock-details": StockDetailsReport,
  "category-stock": CategoryStockReport,
  "counter-stock": CounterStockReport,
  "today-stock-added": TodaysStockAddedReport,
  "dead-stock": DeadStockReport,
  "fast-moving": FastMovingStockReport,
  "stock-ageing": StockAgeingReport,
  "tag-history": TagHistoryReport,
  "item-movement": ItemMovementReport,
  "stock-check": StockCheckReport,
  "sold-items": SoldItemsReport,
};

function InventoryTab({ includeHidden = false }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quickReportKey, setQuickReportKey] = useState(null);
  const { categories, subcategoriesFor, counters, purities, vendors, metalTypes } = useFilterOptions();
  const [categoryIds, setCategoryIds] = useState([]);
  const [subcategoryIds, setSubcategoryIds] = useState([]);
  const [counterIds, setCounterIds] = useState([]);
  const [purityIds, setPurityIds] = useState([]);
  const [vendorIds, setVendorIds] = useState([]);
  const [metalTypeIds, setMetalTypeIds] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");

  const subcategoryOptions = categoryIds.length
    ? categoryIds.flatMap((id) => subcategoriesFor(id))
    : [];

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const loadProducts = useCallback(() => {
    setLoading(true);
    api
      .get("/products", {
        params: {
          category_id: categoryIds.length ? categoryIds.join(",") : undefined,
          subcategory_id: subcategoryIds.length ? subcategoryIds.join(",") : undefined,
          counter_id: counterIds.length ? counterIds.join(",") : undefined,
          purity_id: purityIds.length ? purityIds.join(",") : undefined,
          vendor_id: vendorIds.length ? vendorIds.join(",") : undefined,
          metal_type_id: metalTypeIds.length ? metalTypeIds.join(",") : undefined,
          status: statuses.length ? statuses.join(",") : undefined,
          q: q || undefined,
        },
      })
      .then(({ data }) => setProducts(Array.isArray(data) ? data : data.products || []))
      .catch(() => toast.error("Failed to load inventory"))
      .finally(() => setLoading(false));
  }, [categoryIds, subcategoryIds, counterIds, purityIds, vendorIds, metalTypeIds, statuses, q]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  if (quickReportKey) {
    const QuickReport = QUICK_REPORT_COMPONENTS[quickReportKey];
    return <QuickReport onBack={() => setQuickReportKey(null)} includeHidden={includeHidden} />;
  }

  const exportCsv = () => {
    const header = "SKU,Name,Category,Metal,Gross Wt,Net Wt,Stock Qty,Status\n";
    const rows = products
      .map(
        (p) =>
          `${p.sku || ""},"${p.name || ""}","${p.category || ""}","${p.metal_type || ""}",${p.gross_weight || 0},${p.net_weight || 0},${p.stock_qty ?? p.qty ?? 0},${p.status || ""}`,
      )
      .join("\n");
    downloadCsv(header + rows, `inventory-${todayStr()}.csv`);
  };

  if (loading) return (
    <div className="space-y-4">
      <PageLoadingBadge />
      <div className="h-96 shimmer rounded-md" />
    </div>
  );

  // Status breakdown
  const statusCounts = products.reduce((acc, p) => {
    const s = (p.status || "available").toLowerCase();
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  // Category breakdown
  const catMap = {};
  for (const p of products) {
    const cat = p.category_name || "Other";
    if (!catMap[cat]) {
      catMap[cat] = { cat, items: 0, grossWt: 0, netWt: 0, display: 0, lowStock: 0 };
    }
    catMap[cat].items += 1;
    catMap[cat].grossWt += weightContribution(p, "gross_weight");
    catMap[cat].netWt += weightContribution(p, "net_weight");
    if ((p.status || "").toLowerCase() === "on display") catMap[cat].display += 1;
    const qty = Number(p.stock_qty ?? p.qty ?? 0);
    if (qty > 0 && qty <= 3) catMap[cat].lowStock += 1;
  }
  const catRows = Object.values(catMap);

  const totalNetWt = products.reduce((s, p) => s + weightContribution(p, "net_weight"), 0);
  const totalMakingVal = products.reduce(
    (s, p) => s + Number(p.making_charges || 0) * Number(p.stock_qty ?? p.qty ?? 1),
    0,
  );

  const lowStock = products.filter(
    (p) => Number(p.stock_qty ?? p.qty ?? 0) > 0 && Number(p.stock_qty ?? p.qty ?? 0) <= 3,
  );
  const zeroStock = products.filter((p) => Number(p.stock_qty ?? p.qty ?? 0) === 0);

  return (
    <div>
      <QuickReportsGrid onSelect={setQuickReportKey} />

      <FilterBar>
        <FilterMultiSelect
          label="Category"
          value={categoryIds}
          onChange={(next) => {
            setCategoryIds(next);
            const allowed = new Set(next.flatMap((id) => subcategoriesFor(id)).map((c) => c.id));
            setSubcategoryIds((prev) => prev.filter((id) => allowed.has(id)));
          }}
          options={categories}
        />
        <FilterMultiSelect label="Sub Category" value={subcategoryIds} onChange={setSubcategoryIds} options={subcategoryOptions} />
        <FilterMultiSelect label="Counter" value={counterIds} onChange={setCounterIds} options={counters} />
        <FilterMultiSelect label="Purity" value={purityIds} onChange={setPurityIds} options={purities} />
        <FilterMultiSelect label="Vendor" value={vendorIds} onChange={setVendorIds} options={vendors} />
        <FilterMultiSelect label="Metal Type" value={metalTypeIds} onChange={setMetalTypeIds} options={metalTypes} />
        <FilterMultiSelect label="Stock Status" value={statuses} onChange={setStatuses} options={[
          { value: "available", label: "Available" },
          { value: "on_display", label: "On Display" },
          { value: "reserved", label: "Reserved" },
          { value: "sold", label: "Sold" },
        ]} />
        <FilterField label="Search" className="flex-1 min-w-[180px]">
          <input className="input !py-1.5 !text-[12.5px] w-full" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search name, code, barcode" />
        </FilterField>
      </FilterBar>

      <div className="flex justify-end mb-4 gap-2">
        <PrintSummaryButton
          reportName="Category-wise Stock"
          filtersSummary={[categoryIds.join(","), statuses.join(","), q].filter(Boolean).join(" · ")}
          columns={[
            { key: "cat", label: "Category" },
            { key: "items", label: "Items", align: "right" },
            { key: "grossWt", label: "Total Gross Wt", format: "weight", align: "right" },
            { key: "netWt", label: "Total Net Wt", format: "weight", align: "right" },
            { key: "display", label: "In Display", align: "right" },
            { key: "lowStock", label: "Low Stock", align: "right" },
          ]}
          rows={catRows}
        />
        <button className="btn-secondary" onClick={exportCsv}>
          <Download size={13} strokeWidth={1.5} /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Products" value={products.length} icon={Package} />
        <StatCard label="Total Net Weight" value={fmtWeight(totalNetWt)} icon={Gem} />
        <StatCard
          label="Stock Value (Making)"
          value={fmtINR(totalMakingVal)}
          accent
          icon={TrendingUp}
        />
        <StatCard
          label="Zero Stock Items"
          value={zeroStock.length}
          icon={AlertTriangle}
          sub={zeroStock.length > 0 ? "Needs restocking" : "All stocked"}
        />
      </div>

      <SectionTitle>Stock Status Breakdown</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { key: "available", label: "Available", color: "green" },
          { key: "on display", label: "On Display", color: "blue" },
          { key: "reserved", label: "Reserved", color: "amber" },
          { key: "damaged", label: "Damaged", color: "red" },
        ].map(({ key, label, color }) => (
          <div key={key} className="card text-center">
            <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#737373] mb-2">
              {label}
            </div>
            <div className="text-[28px] font-display font-semibold text-[#0A0A0A]">
              {statusCounts[key] || 0}
            </div>
          </div>
        ))}
      </div>

      <SectionTitle>Category-wise Stock</SectionTitle>
      <TableShell
        headers={[
          { key: "cat", label: "Category" },
          { key: "items", label: "Items", right: true },
          { key: "grosswt", label: "Total Gross Wt", right: true },
          { key: "netwt", label: "Total Net Wt", right: true },
          { key: "display", label: "In Display", right: true },
          { key: "low", label: "Low Stock", right: true },
        ]}
        empty={catRows.length === 0 ? "No products found." : null}
      >
        {catRows.map((r) => (
          <tr key={r.cat} className="table-row">
            <td className="table-td font-medium">{r.cat}</td>
            <td className="table-td text-right">{r.items}</td>
            <td className="table-td text-right tabular-nums">{fmtWeight(r.grossWt)}</td>
            <td className="table-td text-right tabular-nums">{fmtWeight(r.netWt)}</td>
            <td className="table-td text-right">{r.display}</td>
            <td className="table-td text-right">
              {r.lowStock > 0 ? (
                <span className="text-[#92400E] font-semibold">{r.lowStock}</span>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </TableShell>

      {lowStock.length > 0 && (
        <CollapsibleAlertSection
          icon={<AlertTriangle size={13} className="text-[#92400E]" strokeWidth={1.5} />}
          title="Low Stock Alert"
          count={lowStock.length}
        >
          {lowStock.map((p) => (
            <div
              key={p.id}
              className="border border-[#FDE68A] bg-[#FFFBEB] rounded-lg p-3 flex items-center justify-between"
            >
              <div>
                <div className="text-[13px] font-semibold text-[#0A0A0A]">{p.name}</div>
                <div className="text-[11.5px] text-[#525252]">{p.sku} · {p.category}</div>
              </div>
              <div className="text-[#92400E] font-bold text-[18px]">
                {p.stock_qty ?? p.qty ?? 0}
              </div>
            </div>
          ))}
        </CollapsibleAlertSection>
      )}

      {zeroStock.length > 0 && (
        <CollapsibleAlertSection
          icon={<AlertTriangle size={13} className="text-red-600" strokeWidth={1.5} />}
          title="Zero Stock"
          count={zeroStock.length}
        >
          {zeroStock.map((p) => (
            <div
              key={p.id}
              className="border border-[#FECACA] bg-[#FEF2F2] rounded-lg p-3 flex items-center justify-between"
            >
              <div>
                <div className="text-[13px] font-semibold text-[#0A0A0A]">{p.name}</div>
                <div className="text-[11.5px] text-[#525252]">{p.sku} · {p.category}</div>
              </div>
              <Badge color="red">Out of Stock</Badge>
            </div>
          ))}
        </CollapsibleAlertSection>
      )}
    </div>
  );
}

// ─── Tab 4: Customers ─────────────────────────────────────────────────────────

function CustomersTab({ from, to, setFrom, setTo }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/customers")
      .then(({ data }) => setCustomers(Array.isArray(data) ? data : data.customers || []))
      .catch(() => toast.error("Failed to load customer data"))
      .finally(() => setLoading(false));
  }, []);

  const newThisMonth = customers.filter((c) => {
    if (!c.created_at) return false;
    const d = new Date(c.created_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const vipCount = customers.filter(
    (c) => (c.tag || c.customer_type || "").toLowerCase() === "vip",
  ).length;

  // Top customers by purchase value
  const topCustomers = [...customers]
    .filter((c) => c.total_purchases || c.total_spent)
    .sort(
      (a, b) =>
        Number(b.total_purchases || b.total_spent || 0) -
        Number(a.total_purchases || a.total_spent || 0),
    )
    .slice(0, 20);

  // Inactive: last_purchase_at > 90 days ago
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const inactive = customers.filter((c) => {
    if (!c.last_purchase_at && !c.last_visit) return false;
    const d = new Date(c.last_purchase_at || c.last_visit);
    return d < ninetyDaysAgo;
  });

  // Tag breakdown for pie
  const tagMap = customers.reduce((acc, c) => {
    const t = c.tag || c.customer_type || "Regular";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const tagData = Object.entries(tagMap).map(([name, value]) => ({ name, value }));

  // Acquisition per month (last 6 months)
  const acquisitionData = (() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
      const count = customers.filter((c) => {
        if (!c.created_at) return false;
        const cd = new Date(c.created_at);
        return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear();
      }).length;
      months.push({ name: label, value: count });
    }
    return months;
  })();

  const exportCsv = () => {
    const header = "Customer ID,Customer,Mobile,Tag,Total Purchases,Visits,Last Purchase\n";
    const rows = topCustomers
      .map(
        (c) =>
          `${fmtCustomerCode(c.serial_no)},"${c.name || c.full_name || ""}",${c.mobile || c.phone || ""},"${c.tag || c.customer_type || "Regular"}",${c.total_purchases || c.total_spent || 0},${c.visit_count || c.visits || 0},${fmtDateTime(c.last_purchase_at || c.last_visit)}`,
      )
      .join("\n");
    downloadCsv(header + rows, `customers-${todayStr()}.csv`);
  };

  if (loading) return (
    <div className="space-y-4">
      <PageLoadingBadge />
      <div className="h-96 shimmer rounded-md" />
    </div>
  );

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div className="flex justify-end mb-4 gap-2">
        <PrintSummaryButton
          reportName="Top Customers"
          filtersSummary={`As of ${todayStr()}`}
          columns={[
            { key: "id", label: "Customer ID", exportValue: (c) => fmtCustomerCode(c.serial_no) },
            { key: "name", label: "Customer", exportValue: (c) => c.name || c.full_name || "" },
            { key: "mobile", label: "Mobile", exportValue: (c) => c.mobile || c.phone || "" },
            { key: "tag", label: "Tag", exportValue: (c) => c.tag || c.customer_type || "Regular" },
            { key: "total_purchases", label: "Total Purchases", format: "currency", align: "right", exportValue: (c) => c.total_purchases || c.total_spent || 0 },
            { key: "visit_count", label: "Visits", align: "right", exportValue: (c) => c.visit_count || c.visits || 0 },
            { key: "last_purchase_at", label: "Last Purchase", format: "datetime", exportValue: (c) => c.last_purchase_at || c.last_visit },
          ]}
          rows={topCustomers}
          totals={{
            total_purchases: topCustomers.reduce((s, c) => s + Number(c.total_purchases || c.total_spent || 0), 0),
          }}
          summaryParticulars={[
            { particular: "Total Purchases", total: topCustomers.reduce((s, c) => s + Number(c.total_purchases || c.total_spent || 0), 0) },
          ]}
        />
        <button className="btn-secondary" onClick={exportCsv}>
          <Download size={13} strokeWidth={1.5} /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Customers" value={customers.length} icon={Users} />
        <StatCard label="New This Month" value={newThisMonth} icon={Users} accent />
        <StatCard label="VIP Customers" value={vipCount} icon={Gem} />
        <StatCard label="Inactive (90+ days)" value={inactive.length} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {acquisitionData.some((d) => d.value > 0) && (
          <div className="card">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#737373] mb-3">
              Customer Acquisition (6 months)
            </div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={acquisitionData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#737373" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#737373" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="value" name="New Customers" fill={GOLD_ACCENT} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {tagData.length > 0 && (
          <div className="card">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#737373] mb-3">
              Customer Tag Breakdown
            </div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={tagData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={75}
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {tagData.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <SectionTitle>Top Customers (by Purchase Value)</SectionTitle>
      <TableShell
        headers={[
          { key: "rank", label: "#" },
          { key: "id", label: "Customer ID" },
          { key: "name", label: "Customer" },
          { key: "mobile", label: "Mobile" },
          { key: "tag", label: "Tag" },
          { key: "total", label: "Total Purchases (₹)", right: true },
          { key: "visits", label: "Visits", right: true },
          { key: "last", label: "Last Purchase" },
        ]}
        empty={topCustomers.length === 0 ? "No customer purchase data available." : null}
      >
        {topCustomers.map((c, idx) => (
          <tr key={c.id} className="table-row">
            <td className="table-td text-[#737373] font-medium">{idx + 1}</td>
            <td className="table-td font-mono text-[11px] text-[#737373]">{fmtCustomerCode(c.serial_no)}</td>
            <td className="table-td font-medium">{c.name || c.full_name || "—"}</td>
            <td className="table-td text-[#525252]">{c.mobile || c.phone || "—"}</td>
            <td className="table-td">
              <Badge
                color={
                  (c.tag || c.customer_type || "").toLowerCase() === "vip"
                    ? "gold"
                    : (c.tag || c.customer_type || "").toLowerCase() === "wholesale"
                    ? "blue"
                    : "gray"
                }
              >
                {c.tag || c.customer_type || "Regular"}
              </Badge>
            </td>
            <td className="table-td text-right font-semibold tabular-nums text-[#B49042]">
              {fmtINR(c.total_purchases || c.total_spent)}
            </td>
            <td className="table-td text-right">{c.visit_count || c.visits || "—"}</td>
            <td className="table-td text-[12.5px]">
              {fmtDateTime(c.last_purchase_at || c.last_visit)}
            </td>
          </tr>
        ))}
      </TableShell>

      {inactive.length > 0 && (
        <>
          <SectionTitle>
            <span className="flex items-center gap-2">
              <Clock size={13} className="text-[#737373]" strokeWidth={1.5} />
              Inactive Customers (90+ days)
            </span>
          </SectionTitle>
          <TableShell
            headers={[
              { key: "id", label: "Customer ID" },
              { key: "name", label: "Customer" },
              { key: "mobile", label: "Mobile" },
              { key: "tag", label: "Tag" },
              { key: "last", label: "Last Purchase" },
            ]}
            empty={null}
          >
            {inactive.slice(0, 30).map((c) => (
              <tr key={c.id} className="table-row">
                <td className="table-td font-mono text-[11px] text-[#737373]">{fmtCustomerCode(c.serial_no)}</td>
                <td className="table-td font-medium">{c.name || c.full_name || "—"}</td>
                <td className="table-td text-[#525252]">{c.mobile || c.phone || "—"}</td>
                <td className="table-td">
                  <Badge color="gray">{c.tag || c.customer_type || "Regular"}</Badge>
                </td>
                <td className="table-td text-[12.5px] text-[#737373]">
                  {fmtDateTime(c.last_purchase_at || c.last_visit)}
                </td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      <div className="mt-10 pt-6 border-t border-[#E5E7EB]">
        <SectionTitle>Customer Insights</SectionTitle>
      </div>
      <OccasionReportTable kind="birthday" />
      <OccasionReportTable kind="anniversary" />
      <SubReportTable
        title="Pending Balance"
        description="Advance/credit balance not yet applied to an invoice"
        endpoint="/reports/customers/pending-balance"
        columns={[
          { key: "customer_id", label: "Customer ID", forceShow: true, render: (r) => <span className="font-mono text-[11px] text-[#737373]">{fmtCustomerCode(r.serial_no)}</span> },
          { key: "customer_name", label: "Customer" },
          { key: "mobile", label: "Mobile" },
          { key: "pending_balance", label: "Pending Balance", align: "right", format: "currency", render: (r) => fmtINR(r.pending_balance) },
        ]}
      />
      <SubReportTable
        title="Purchase Frequency"
        endpoint="/reports/customers/purchase-frequency"
        columns={[
          { key: "customer_id", label: "Customer ID", forceShow: true, render: (r) => <span className="font-mono text-[11px] text-[#737373]">{fmtCustomerCode(r.serial_no)}</span> },
          { key: "customer_name", label: "Customer" },
          { key: "invoice_count", label: "Invoices", align: "right" },
          { key: "total_spent", label: "Total Spent", align: "right", format: "currency", render: (r) => fmtINR(r.total_spent) },
          { key: "first_purchase", label: "First Purchase", format: "datetime", render: (r) => fmtDateTime(r.first_purchase) },
          { key: "last_purchase", label: "Last Purchase", format: "datetime", render: (r) => fmtDateTime(r.last_purchase) },
        ]}
      />
      <SubReportTable
        title="Loyal Customers"
        description="Highest repeat-purchase frequency"
        endpoint="/reports/customers/loyal"
        columns={[
          { key: "customer_id", label: "Customer ID", forceShow: true, render: (r) => <span className="font-mono text-[11px] text-[#737373]">{fmtCustomerCode(r.serial_no)}</span> },
          { key: "customer_name", label: "Customer" },
          { key: "invoice_count", label: "Invoices", align: "right" },
          { key: "total_spent", label: "Total Spent", align: "right", format: "currency", render: (r) => fmtINR(r.total_spent) },
        ]}
      />
      <SubReportTable
        title="Top Spending Customers"
        endpoint="/reports/customers/top-spending"
        params={{ from, to }}
        columns={[
          { key: "customer_id", label: "Customer ID", forceShow: true, render: (r) => <span className="font-mono text-[11px] text-[#737373]">{fmtCustomerCode(r.serial_no)}</span> },
          { key: "customer_name", label: "Customer" },
          { key: "mobile", label: "Mobile" },
          { key: "invoice_count", label: "Invoices", align: "right" },
          { key: "grand_total", label: "Total Spend", align: "right", format: "currency", render: (r) => fmtINR(r.grand_total) },
        ]}
      />
    </div>
  );
}

// ─── Tab 5: Schemes ───────────────────────────────────────────────────────────

function SchemesTab() {
  const [schemes, setSchemes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/schemes")
      .then(({ data }) => setSchemes(Array.isArray(data) ? data : data.schemes || []))
      .catch(() => toast.error("Failed to load scheme data"))
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const activeSchemes = schemes.filter(
    (s) => (s.status || "").toLowerCase() === "active",
  );

  const maturedThisMonth = schemes.filter((s) => {
    if (!s.maturity_date) return false;
    const d = new Date(s.maturity_date);
    return d >= thisMonthStart && d <= thisMonthEnd;
  });

  const monthlyCollectionDue = activeSchemes.reduce(
    (sum, s) => sum + Number(s.monthly_amount || s.installment_amount || 0),
    0,
  );

  // Overdue: next_due_date < today and status active
  const overdue = activeSchemes.filter((s) => {
    if (!s.next_due_date) return false;
    return new Date(s.next_due_date) < now;
  });

  // Matured but not redeemed
  const maturedUnredeemed = schemes.filter(
    (s) =>
      (s.status || "").toLowerCase() === "matured" &&
      !(s.redeemed || s.is_redeemed),
  );

  const exportCsv = () => {
    const header = "Customer,Mobile,Plan,Monthly Amount,Months Paid,Months Remaining,Next Due Date,Status\n";
    const rows = activeSchemes
      .map(
        (s) =>
          `"${s.customer_name || ""}",${s.customer_mobile || s.mobile || ""},"${s.plan_name || s.scheme_type || ""}",${s.monthly_amount || s.installment_amount || 0},${s.months_paid || 0},${s.months_remaining || 0},${s.next_due_date || ""},${s.status || ""}`,
      )
      .join("\n");
    downloadCsv(header + rows, `schemes-${todayStr()}.csv`);
  };

  if (loading) return (
    <div className="space-y-4">
      <PageLoadingBadge />
      <div className="h-96 shimmer rounded-md" />
    </div>
  );

  return (
    <div>
      <div className="flex justify-end mb-4 gap-2">
        <PrintSummaryButton
          reportName="Active Schemes"
          filtersSummary={`As of ${todayStr()}`}
          columns={[
            { key: "customer_name", label: "Customer" },
            { key: "customer_mobile", label: "Mobile", exportValue: (s) => s.customer_mobile || s.mobile || "" },
            { key: "plan_name", label: "Plan", exportValue: (s) => s.plan_name || s.scheme_type || "" },
            { key: "monthly_amount", label: "Monthly Amount", format: "currency", align: "right", exportValue: (s) => s.monthly_amount || s.installment_amount || 0 },
            { key: "months_paid", label: "Months Paid", align: "right" },
            { key: "months_remaining", label: "Months Remaining", align: "right" },
            { key: "next_due_date", label: "Next Due Date", format: "date" },
            { key: "status", label: "Status" },
          ]}
          rows={activeSchemes}
          totals={{
            monthly_amount: monthlyCollectionDue,
          }}
          summaryParticulars={[
            { particular: "Monthly Collection Due", total: monthlyCollectionDue },
          ]}
        />
        <button className="btn-secondary" onClick={exportCsv}>
          <Download size={13} strokeWidth={1.5} /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Schemes" value={activeSchemes.length} icon={Gem} accent />
        <StatCard label="Total Members" value={schemes.length} icon={Users} />
        <StatCard
          label="Monthly Collection Due"
          value={fmtINR(monthlyCollectionDue)}
          icon={TrendingUp}
        />
        <StatCard
          label="Matured This Month"
          value={maturedThisMonth.length}
          icon={Receipt}
        />
      </div>

      <SectionTitle>Due This Month</SectionTitle>
      <TableShell
        headers={[
          { key: "cust", label: "Customer" },
          { key: "mobile", label: "Mobile" },
          { key: "plan", label: "Plan" },
          { key: "amt", label: "Monthly Amount", right: true },
          { key: "paid", label: "Months Paid", right: true },
          { key: "rem", label: "Months Remaining", right: true },
          { key: "due", label: "Next Due Date" },
        ]}
        empty={
          activeSchemes.filter((s) => {
            if (!s.next_due_date) return false;
            const d = new Date(s.next_due_date);
            return d >= thisMonthStart && d <= thisMonthEnd;
          }).length === 0
            ? "No schemes due this month."
            : null
        }
      >
        {activeSchemes
          .filter((s) => {
            if (!s.next_due_date) return false;
            const d = new Date(s.next_due_date);
            return d >= thisMonthStart && d <= thisMonthEnd;
          })
          .map((s, idx) => (
            <tr key={s.id || idx} className="table-row">
              <td className="table-td font-medium">{s.customer_name || "—"}</td>
              <td className="table-td text-[#525252]">{s.customer_mobile || s.mobile || "—"}</td>
              <td className="table-td">{s.plan_name || s.scheme_type || "—"}</td>
              <td className="table-td text-right tabular-nums font-semibold">
                {fmtINR(s.monthly_amount || s.installment_amount)}
              </td>
              <td className="table-td text-right">{s.months_paid || 0}</td>
              <td className="table-td text-right">{s.months_remaining || 0}</td>
              <td className="table-td text-[12.5px]">{fmtDate(s.next_due_date)}</td>
            </tr>
          ))}
      </TableShell>

      {overdue.length > 0 && (
        <>
          <SectionTitle>
            <span className="flex items-center gap-2 text-red-700">
              <AlertTriangle size={13} strokeWidth={1.5} />
              Overdue Payments
            </span>
          </SectionTitle>
          <TableShell
            headers={[
              { key: "cust", label: "Customer" },
              { key: "mobile", label: "Mobile" },
              { key: "plan", label: "Plan" },
              { key: "amt", label: "Monthly Amount", right: true },
              { key: "due", label: "Was Due On" },
            ]}
            empty={null}
          >
            {overdue.map((s, idx) => (
              <tr key={s.id || idx} className="table-row bg-[#FEF2F2]">
                <td className="table-td font-medium text-[#991B1B]">
                  {s.customer_name || "—"}
                </td>
                <td className="table-td text-[#525252]">{s.customer_mobile || s.mobile || "—"}</td>
                <td className="table-td">{s.plan_name || s.scheme_type || "—"}</td>
                <td className="table-td text-right tabular-nums font-semibold text-[#991B1B]">
                  {fmtINR(s.monthly_amount || s.installment_amount)}
                </td>
                <td className="table-td text-[12.5px] text-[#991B1B]">
                  {fmtDate(s.next_due_date)}
                </td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {maturedUnredeemed.length > 0 && (
        <>
          <SectionTitle>Matured but Not Redeemed</SectionTitle>
          <TableShell
            headers={[
              { key: "cust", label: "Customer" },
              { key: "mobile", label: "Mobile" },
              { key: "plan", label: "Plan" },
              { key: "mat", label: "Maturity Date" },
              { key: "val", label: "Maturity Value", right: true },
            ]}
            empty={null}
          >
            {maturedUnredeemed.map((s, idx) => (
              <tr key={s.id || idx} className="table-row">
                <td className="table-td font-medium">{s.customer_name || "—"}</td>
                <td className="table-td text-[#525252]">{s.customer_mobile || s.mobile || "—"}</td>
                <td className="table-td">{s.plan_name || s.scheme_type || "—"}</td>
                <td className="table-td text-[12.5px]">{fmtDate(s.maturity_date)}</td>
                <td className="table-td text-right tabular-nums font-semibold text-[#B49042]">
                  {fmtINR(s.maturity_value || s.total_amount)}
                </td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      <div className="mt-10 pt-6 border-t border-[#E5E7EB]">
        <SectionTitle>Scheme Insights</SectionTitle>
      </div>
      <SubReportTable
        title="Upcoming Maturity"
        description="Active schemes maturing within 30 days"
        endpoint="/reports/schemes/upcoming-maturity"
        params={{ days: 30 }}
        columns={[
          { key: "customer_name", label: "Customer" },
          { key: "plan_name", label: "Plan" },
          { key: "maturity_date", label: "Maturity Date", format: "date", render: (r) => fmtDate(r.maturity_date) },
          { key: "maturity_value", label: "Maturity Value", align: "right", format: "currency", render: (r) => fmtINR(r.maturity_value) },
        ]}
      />
      <SubReportTable
        title="Collection Report"
        description="Installments actually collected in the selected date range"
        endpoint="/reports/schemes/collection"
        columns={[
          { key: "customer_name", label: "Customer" },
          { key: "plan_name", label: "Plan" },
          { key: "amount", label: "Amount", align: "right", format: "currency", render: (r) => fmtINR(r.amount) },
          { key: "mode", label: "Mode" },
          { key: "paid_at", label: "Paid On", format: "datetime", render: (r) => fmtDateTime(r.paid_at) },
        ]}
      />
      <SubReportTable
        title="Missed Installments"
        endpoint="/reports/schemes/missed-installments"
        columns={[
          { key: "customer_name", label: "Customer" },
          { key: "plan_name", label: "Plan" },
          { key: "months_paid", label: "Months Paid", align: "right" },
          { key: "days_overdue", label: "Days Overdue", align: "right" },
        ]}
      />
      <SubReportTable
        title="Overdue Installments"
        description="Missed by more than 15 days"
        endpoint="/reports/schemes/overdue"
        columns={[
          { key: "customer_name", label: "Customer" },
          { key: "plan_name", label: "Plan" },
          { key: "monthly_amount", label: "Monthly Amount", align: "right", format: "currency", render: (r) => fmtINR(r.monthly_amount) },
          { key: "days_overdue", label: "Days Overdue", align: "right" },
        ]}
      />
    </div>
  );
}

// ─── Tab 6: Purchases ─────────────────────────────────────────────────────────

function PurchasesTab({ from, to, setFrom, setTo }) {
  const [purchases, setPurchases] = useState([]);
  const [vendor, setVendor] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get("/purchases", { params: { from_date: from, to_date: to, limit: 200 } })
      .then(({ data }) => setPurchases(Array.isArray(data) ? data : data.data || []))
      .catch(() => toast.error("Failed to load purchase data"))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const vendors = [...new Set(purchases.map((p) => p.vendor_name || p.vendor || "").filter(Boolean))];

  const filtered = vendor
    ? purchases.filter(
        (p) => (p.vendor_name || p.vendor || "") === vendor,
      )
    : purchases;

  const totalAmt = filtered.reduce((s, p) => s + Number(p.grand_total || p.total_amount || p.amount || 0), 0);
  const totalPaid = filtered.reduce((s, p) => s + Number(p.paid_amount || p.paid || 0), 0);
  const totalBalance = filtered.reduce(
    (s, p) => s + Number(p.balance ?? p.balance_amount ?? 0),
    0,
  );

  const exportCsv = () => {
    const header = "PO No,Date,Vendor,Type,Items,Amount,Paid,Balance,Status\n";
    const rows = filtered
      .map(
        (p) =>
          `${p.po_number || p.id},"${fmtDateTime(p.created_at || p.date)}","${p.vendor_name || p.vendor || ""}","${p.purchase_type || p.type || ""}",${asArray(p.items).length},${p.grand_total || p.total_amount || p.amount || 0},${p.paid_amount || p.paid || 0},${p.balance ?? p.balance_amount ?? 0},${p.status || ""}`,
      )
      .join("\n");
    downloadCsv(header + rows, `purchases-${from}-to-${to}.csv`);
  };

  if (loading) return (
    <div className="space-y-4">
      <PageLoadingBadge />
      <div className="h-96 shimmer rounded-md" />
    </div>
  );

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />

      <div className="flex items-center gap-3 mb-4">
        {vendors.length > 0 && (
          <select
            className="input max-w-[240px]"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          >
            <option value="">All Vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        )}
        <div className="ml-auto flex gap-2">
          <PrintSummaryButton
            reportName="Purchase Register"
            defaultOrientation="landscape"
            filtersSummary={`${from} to ${to}${vendor ? ` · Vendor: ${vendor}` : ""}`}
            columns={[
              { key: "po_number", label: "PO No", exportValue: (p) => p.po_number || p.id },
              { key: "created_at", label: "Date", format: "datetime", exportValue: (p) => p.created_at || p.date },
              { key: "vendor_name", label: "Vendor", exportValue: (p) => p.vendor_name || p.vendor || "" },
              { key: "purchase_type", label: "Type", exportValue: (p) => p.purchase_type || p.type || "" },
              { key: "grand_total", label: "Amount", format: "currency", align: "right", exportValue: (p) => p.total_amount || p.amount || p.grand_total || 0 },
              { key: "paid_amount", label: "Paid", format: "currency", align: "right", exportValue: (p) => p.paid_amount || p.paid || 0 },
              { key: "balance", label: "Balance", format: "currency", align: "right", exportValue: (p) => p.balance_amount || p.balance || 0 },
              { key: "status", label: "Status" },
            ]}
            rows={filtered}
            totals={{
              grand_total: totalAmt,
              paid_amount: totalPaid,
              balance: totalBalance,
            }}
            summaryParticulars={[
              { particular: "Amount", total: totalAmt },
              { particular: "Paid", total: totalPaid },
              { particular: "Balance", total: totalBalance },
            ]}
          />
          <button className="btn-secondary" onClick={exportCsv}>
            <Download size={13} strokeWidth={1.5} /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Purchases" value={filtered.length} icon={ShoppingCart} />
        <StatCard label="Total Amount" value={fmtINR(totalAmt)} accent icon={TrendingUp} />
        <StatCard label="Total Paid" value={fmtINR(totalPaid)} icon={Receipt} />
        <StatCard
          label="Outstanding Balance"
          value={fmtINR(totalBalance)}
          icon={AlertTriangle}
          sub={totalBalance > 0 ? "Pending with vendors" : "Fully settled"}
        />
      </div>

      <TableShell
        headers={[
          { key: "po", label: "PO No" },
          { key: "date", label: "Date" },
          { key: "vendor", label: "Vendor" },
          { key: "type", label: "Type" },
          { key: "items", label: "Items", right: true },
          { key: "amt", label: "Amount", right: true },
          { key: "paid", label: "Paid", right: true },
          { key: "bal", label: "Balance", right: true },
          { key: "status", label: "Status" },
        ]}
        empty={filtered.length === 0 ? "No purchases in this period." : null}
      >
        {filtered.map((p, idx) => {
          const balance = Number(p.balance ?? p.balance_amount ?? 0);
          const statusLabel = { paid: "Paid", partially_paid: "Partial", draft: "Draft", voided: "Voided" }[
            (p.status || "").toLowerCase()
          ] || p.status || "Pending";
          return (
            <tr key={p.id || idx} className="table-row">
              <td className="table-td font-mono text-[12px]">{p.po_number || `PO-${p.id}`}</td>
              <td className="table-td text-[12.5px]">
                {fmtDateTime(p.created_at || p.date)}
              </td>
              <td className="table-td font-medium">{p.vendor_name || p.vendor || "—"}</td>
              <td className="table-td text-[#525252]">{p.purchase_type || p.type || "—"}</td>
              <td className="table-td text-right">{asArray(p.items).length}</td>
              <td className="table-td text-right tabular-nums">
                {fmtINR(p.grand_total || p.total_amount || p.amount)}
              </td>
              <td className="table-td text-right tabular-nums text-[#166534]">
                {fmtINR(p.paid_amount || p.paid)}
              </td>
              <td
                className={`table-td text-right tabular-nums font-semibold ${
                  balance > 0 ? "text-[#991B1B]" : "text-[#166534]"
                }`}
              >
                {fmtINR(balance)}
              </td>
              <td className="table-td">
                <Badge
                  color={
                    (p.status || "").toLowerCase() === "paid"
                      ? "green"
                      : (p.status || "").toLowerCase() === "partially_paid"
                      ? "amber"
                      : "red"
                  }
                >
                  {statusLabel}
                </Badge>
              </td>
            </tr>
          );
        })}
      </TableShell>

      <PurchasesInsights from={from} to={to} />
    </div>
  );
}

function PurchasesInsights({ from, to }) {
  const { vendors } = useFilterOptions();
  const [ledgerVendorId, setLedgerVendorId] = useState("");

  return (
    <div>
      <div className="mt-10 pt-6 border-t border-[#E5E7EB]">
        <SectionTitle>Purchase Insights</SectionTitle>
      </div>

      <SubReportTable
        title="Metal-wise Purchases"
        description="Grouped by purchase type (gold bullion / finished goods / stones / karigar work)"
        endpoint="/reports/purchases/metal-wise"
        params={{ from, to }}
        columns={[
          { key: "purchase_type", label: "Type" },
          { key: "purchase_count", label: "Purchases", align: "right" },
          { key: "grand_total", label: "Total Amount", align: "right", format: "currency", render: (r) => fmtINR(r.grand_total) },
          { key: "paid_amount", label: "Paid", align: "right", format: "currency", render: (r) => fmtINR(r.paid_amount) },
        ]}
      />
      <SubReportTable
        title="Purchase Trend"
        endpoint="/reports/purchases/trend"
        params={{ from, to }}
        columns={[
          { key: "date", label: "Date", format: "date", render: (r) => fmtDate(r.date) },
          { key: "purchase_count", label: "Purchases", align: "right" },
          { key: "grand_total", label: "Total Amount", align: "right", format: "currency", render: (r) => fmtINR(r.grand_total) },
        ]}
      />
      <SubReportTable
        title="Pending Payments"
        endpoint="/reports/purchases/pending-payments"
        columns={[
          { key: "po_number", label: "PO No" },
          { key: "vendor_name", label: "Vendor" },
          { key: "grand_total", label: "Amount", align: "right", format: "currency", render: (r) => fmtINR(r.grand_total) },
          { key: "balance", label: "Balance", align: "right", format: "currency", render: (r) => fmtINR(r.balance) },
        ]}
      />
      <SubReportTable
        title="Outstanding Vendors"
        endpoint="/reports/purchases/outstanding-vendors"
        columns={[
          { key: "vendor_name", label: "Vendor" },
          { key: "type", label: "Type" },
          { key: "outstanding_balance", label: "Outstanding", align: "right", format: "currency", render: (r) => fmtINR(r.outstanding_balance) },
          { key: "total_purchases", label: "Total Purchases", align: "right", format: "currency", render: (r) => fmtINR(r.total_purchases) },
        ]}
      />

      <div className="mt-6">
        <FilterBar>
          <FilterSelect label="Vendor (for ledger below)" value={ledgerVendorId} onChange={setLedgerVendorId} options={vendors} placeholder="Select a vendor" />
        </FilterBar>
        {ledgerVendorId ? (
          <SubReportTable
            title="Vendor Ledger"
            endpoint="/reports/purchases/vendor-ledger"
            params={{ vendor_id: ledgerVendorId }}
            columns={[
              { key: "po_number", label: "PO No" },
              { key: "purchase_date", label: "Date", format: "date", render: (r) => fmtDate(r.purchase_date) },
              { key: "grand_total", label: "Amount", align: "right", format: "currency", render: (r) => fmtINR(r.grand_total) },
              { key: "paid_amount", label: "Paid", align: "right", format: "currency", render: (r) => fmtINR(r.paid_amount) },
              { key: "running_balance", label: "Running Balance", align: "right", format: "currency", render: (r) => fmtINR(r.running_balance) },
            ]}
          />
        ) : (
          <div className="card text-center py-8 text-[#737373] text-[13px]">Select a vendor to view their ledger.</div>
        )}
      </div>
    </div>
  );
}

// ─── Main Reports Page ────────────────────────────────────────────────────────

export default function Reports() {
  const { user } = useAuth();
  const isOwner = hasFullAccessRole(user?.role);
  const titleClicksRef = useRef({ count: 0, timer: null });

  const [hiddenUnlocked, setHiddenUnlocked] = useState(false);
  const [hiddenPwOpen, setHiddenPwOpen] = useState(false);
  const [hiddenPwBusy, setHiddenPwBusy] = useState(false);
  const [hiddenPwError, setHiddenPwError] = useState("");

  const [reportId, setReportId] = useState(() => {
    try {
      const fromQuery = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search).get("report");
      const saved = fromQuery || localStorage.getItem("reports.active") || "sales-workspace";
      if (saved === "hidden-data-workspace") return "sales-workspace";
      if (saved === "jew-metal") return "jew-workspace";
      return saved;
    } catch {
      return "sales-workspace";
    }
  });
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());

  const { sections: sectionVisibility, isSectionVisible } = useSectionVisibility();
  const isReportSectionVisible = useCallback(
    (level, id) => isSectionVisible("reports", level, id),
    [isSectionVisible],
  );

  const report = findReport(reportId) || defaultReportForCategory("sales");
  const categoryId = report?.category || categoryForReport(reportId);
  const visibleCategories = useMemo(
    () => (hiddenUnlocked
      ? REPORT_CATEGORIES
      : visibleReportCategories(isReportSectionVisible)),
    [hiddenUnlocked, isReportSectionVisible],
  );
  const categoryReports = useMemo(
    () => (hiddenUnlocked
      ? reportsInCategory(categoryId)
      : visibleReportsInCategory(categoryId, isReportSectionVisible)),
    [categoryId, hiddenUnlocked, isReportSectionVisible],
  );
  const categoryMeta = REPORT_CATEGORIES.find((c) => c.id === categoryId);

  useEffect(() => {
    if (!hiddenUnlocked && categoryId === "hidden-data") {
      const next = defaultReportForCategory("sales");
      if (next) setReportId(next.id);
    }
  }, [hiddenUnlocked, categoryId]);

  // Section-visibility toggles (Settings → Application Management) can hide
  // whatever category/report the user is currently looking at — fall back to
  // the first still-visible one instead of showing a blank/stale panel.
  useEffect(() => {
    if (hiddenUnlocked || categoryId === "hidden-data") return;
    if (!visibleCategories.some((c) => c.id === categoryId)) {
      const nextCat = visibleCategories[0];
      if (nextCat) {
        const next = defaultReportForCategory(nextCat.id, isReportSectionVisible);
        if (next) setReportId(next.id);
      }
      return;
    }
    if (!isReportSectionVisible("item", reportId)) {
      const next = defaultReportForCategory(categoryId, isReportSectionVisible);
      if (next) setReportId(next.id);
    }
  }, [sectionVisibility, hiddenUnlocked, categoryId, reportId, visibleCategories, isReportSectionVisible]);

  useEffect(() => {
    try {
      if (report?.id) localStorage.setItem("reports.active", report.id);
    } catch {
      /* ignore */
    }
  }, [report?.id]);

  const selectCategory = (catId) => {
    const next = defaultReportForCategory(catId, hiddenUnlocked ? undefined : isReportSectionVisible);
    if (next) setReportId(next.id);
  };

  const handleTitleClick = () => {
    if (!isOwner || hiddenUnlocked) return;
    const state = titleClicksRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.count += 1;
    if (state.count >= 3) {
      state.count = 0;
      state.timer = null;
      setHiddenPwError("");
      setHiddenPwOpen(true);
    } else {
      state.timer = setTimeout(() => {
        state.count = 0;
        state.timer = null;
      }, 2500);
    }
  };

  const dateProps = { from, to, setFrom, setTo };

  const body = (() => {
    if (!report) return <div className="text-sm text-[#737373]">No reports in this category.</div>;

    if (report.type === "tab") {
      const tab = report.tab;
      return (
        <>
          {tab === "sales" && <SalesTab {...dateProps} includeHidden={hiddenUnlocked} />}
          {tab === "hidden-data" && hiddenUnlocked ? <HiddenDataReportsTab {...dateProps} /> : null}
          {tab === "gst" && <GstTab {...dateProps} includeHidden={hiddenUnlocked} />}
          {tab === "inventory" && <InventoryTab includeHidden={hiddenUnlocked} />}
          {tab === "customers" && <CustomersTab {...dateProps} />}
          {tab === "schemes" && <SchemesTab />}
          {tab === "day-closing" && <DayClosingReportTab includeHidden={hiddenUnlocked} />}
          {tab === "purchases" && <PurchasesTab {...dateProps} />}
          {tab === "more" && <MoreReportsTab includeHidden={hiddenUnlocked} reportId={report.id} />}
        </>
      );
    }

    if (report.type === "quick" && QUICK_REPORT_COMPONENTS[report.quick]) {
      const QuickReport = QUICK_REPORT_COMPONENTS[report.quick];
      return <QuickReport onBack={() => selectCategory(categoryId)} includeHidden={hiddenUnlocked} />;
    }

    if (report.type === "api") {
      return <UnifiedReportView report={report} embedded includeHidden={hiddenUnlocked} />;
    }

    return null;
  })();

  return (
    <div className={hiddenUnlocked ? hiddenUnlockBleedClass(true) : undefined}>
    <div className="max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1
            className="select-none text-xl font-bold text-[#0A0A0A]"
            onClick={handleTitleClick}
            title={isOwner && !hiddenUnlocked ? "Triple-click to unlock hidden bill figures" : undefined}
          >
            Reports & Analytics
          </h1>
          <p className="mt-0.5 text-sm text-[#737373]">
            Same layout as Accounts — pick a category, then open a report. Financial statements use journals.
          </p>
        </div>
        {hiddenUnlocked ? (
          <button
            type="button"
            onClick={() => setHiddenUnlocked(false)}
            className="flex items-center gap-1.5 rounded-full bg-[#B49042]/15 px-3 py-1.5 text-xs font-semibold text-[#B49042] hover:bg-[#B49042]/25"
            title="Hidden bill figures are included — click to lock again"
          >
            Hidden bills included · Lock
          </button>
        ) : null}
      </div>

      {/* Category tabs */}
      <div className="mb-0 overflow-x-auto border-b border-[#EADFBF]">
        <div className="flex min-w-max items-end gap-0.5">
          {visibleCategories.map((c) => {
            const active = c.id === categoryId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCategory(c.id)}
                className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? c.id === "hidden-data"
                      ? "border-violet-600 text-violet-700"
                      : "border-[#B49042] text-[#B49042]"
                    : c.id === "hidden-data"
                      ? "border-transparent text-violet-600 hover:text-violet-800"
                      : "border-transparent text-[#737373] hover:text-[#0A0A0A]"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Report pills */}
      {categoryReports.length > 1 ? (
      <div className="mb-4 overflow-x-auto rounded-b-xl border border-t-0 border-[#EADFBF] bg-[#FDFBF7] px-2 py-2">
        <div className="flex min-w-max flex-wrap gap-1.5">
          {categoryReports.map((r) => {
            const active = report?.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setReportId(r.id)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-[#B49042] text-white shadow-sm"
                    : "bg-white text-[#525252] border border-[#E5E7EB] hover:border-[#B49042] hover:text-[#B49042]"
                }`}
              >
                {r.name}
              </button>
            );
          })}
        </div>
      </div>
      ) : (
        <div className="mb-4" />
      )}

      <div className="mb-3">
        <h2 className="text-lg font-semibold text-[#0A0A0A]">{report?.name}</h2>
        <p className="text-xs text-[#737373]">
          {report?.description || categoryMeta?.description || ""}
          {report?.source === "accounts" ? " · Accounting (journals)" : ""}
        </p>
      </div>

      {body}

      <HiddenBillPasswordDialog
        open={hiddenPwOpen}
        busy={hiddenPwBusy}
        error={hiddenPwError}
        onClose={() => {
          if (hiddenPwBusy) return;
          setHiddenPwOpen(false);
          setHiddenPwError("");
        }}
        onSubmit={async (pin) => {
          setHiddenPwBusy(true);
          setHiddenPwError("");
          try {
            await api.post("/settings/verify-hidden-bill-password", { password: pin });
            setHiddenUnlocked(true);
            setHiddenPwOpen(false);
            toast.success("Hidden bill figures unlocked");
          } catch (err) {
            const msg = formatApiError(err) || "Incorrect password";
            setHiddenPwError(msg);
            toast.error(
              msg.includes("Incorrect") || msg.includes("password") ? "Wrong PIN — try again" : msg,
            );
          } finally {
            setHiddenPwBusy(false);
          }
        }}
      />
    </div>
    </div>
  );
}
