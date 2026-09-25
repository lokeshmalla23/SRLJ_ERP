import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { TableSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  Plus,
  X,
  Coins,
  Wallet,
  CalendarClock,
  AlertCircle,
  TrendingUp,
  Search,
  Download,
  ChevronRight,
  CheckCircle2,
  Clock,
  XCircle,
  Award,
  Gift,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import PageHeader from "@/components/common/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import MoneyInput from "@/components/ui/MoneyInput";
import { fmtINR, fmtDate, fmtRatePerGram, parseMoneyInput, fmtCustomerCode } from "@/lib/format";
import { asArray } from "@/lib/jsonFields";
import { invoiceOccurredAt } from "@/lib/occurredAt";
import { T } from "@/constants/testIds";
import { useAuth } from "@/context/AuthContext";
import { useBusinessDate } from "@/context/BusinessDateContext";
import DuplicateCustomerDialog, { dupInfo } from "@/components/customers/DuplicateCustomerDialog";

// ─── Date helpers ─────────────────────────────────────────────────────────────

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

const todayStr = () => TODAY.toISOString().slice(0, 10);

/** Add N calendar months to a date string */
function addMonths(dateStr, n) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d;
}

/** Returns true when the date falls within the current calendar month */
function isThisMonth(date) {
  if (!date) return false;
  const d = new Date(date);
  return d.getFullYear() === TODAY.getFullYear() && d.getMonth() === TODAY.getMonth();
}

/** Derive computed fields from a raw scheme row */
function enrich(s) {
  const payments = asArray(s.payments);
  const monthsPaid = payments.length;
  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const maturityDate = addMonths(s.start_date, s.duration_months);
  const nextDueDate = addMonths(s.start_date, monthsPaid + 1);

  const isActive = s.status === "active";
  const isOverdue = isActive && nextDueDate && nextDueDate < TODAY;
  const isDueThisMonth = isActive && !isOverdue && nextDueDate && isThisMonth(nextDueDate);
  const isMaturingThisMonth = isActive && maturityDate && isThisMonth(maturityDate);
  const isMaturingSoon =
    isActive && maturityDate && (s.duration_months - monthsPaid) <= 2 && !isMaturingThisMonth;

  const monthsLeft = maturityDate
    ? Math.max(0, Math.ceil((maturityDate - TODAY) / (1000 * 60 * 60 * 24 * 30.44)))
    : 0;

  return {
    ...s,
    payments,
    months_paid: monthsPaid,
    total_paid: totalPaid,
    maturity_date: maturityDate,
    next_due_date: nextDueDate,
    is_overdue: isOverdue,
    is_due_this_month: isDueThisMonth,
    is_maturing_this_month: isMaturingThisMonth,
    is_maturing_soon: isMaturingSoon,
    months_left: monthsLeft,
  };
}

// ─── Certificate print HTML ────────────────────────────────────────────────────

function generateCertificateHTML(scheme, shopName) {
  const maturityValue = scheme.monthly_amount * (scheme.duration_months + (scheme.bonus_months || 0));
  const issuedDate = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const startDate = scheme.start_date ? new Date(scheme.start_date).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  const maturityDate = scheme.maturity_date ? new Date(scheme.maturity_date).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Certificate — ${scheme.customer_name}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Georgia, "Times New Roman", serif; color: #111; }
@page { size: A4 landscape; margin: 0; }
.frame { width: 100%; min-height: 210mm; border: 14px solid #B49042; outline: 2px solid #111; outline-offset: -22px; padding: 48px 64px; display: flex; flex-direction: column; align-items: center; text-align: center; }
.shop-name { font-size: 22pt; font-weight: bold; letter-spacing: 0.04em; }
.shop-sub { font-size: 10pt; color: #737373; letter-spacing: 0.15em; text-transform: uppercase; margin-top: 4px; }
.title { font-size: 30pt; color: #B49042; font-weight: bold; margin-top: 34px; letter-spacing: 0.05em; }
.subtitle { font-size: 11pt; color: #555; margin-top: 6px; }
.body-text { font-size: 13pt; margin-top: 34px; line-height: 1.8; max-width: 640px; }
.cust-name { font-size: 20pt; font-weight: bold; color: #0A0A0A; margin: 6px 0; }
.details { margin-top: 30px; display: flex; gap: 40px; justify-content: center; }
.details div { font-size: 10.5pt; color: #555; }
.details b { display: block; font-size: 13pt; color: #111; margin-top: 3px; }
.amount { margin-top: 28px; font-size: 15pt; color: #B49042; font-weight: bold; }
.sign { margin-top: auto; padding-top: 60px; width: 100%; display: flex; justify-content: space-between; font-size: 10.5pt; }
.sign div { width: 220px; border-top: 1px solid #999; padding-top: 6px; }
.issued { margin-top: 24px; font-size: 9.5pt; color: #888; }
</style>
</head>
<body>
<div class="frame">
  <div class="shop-name">${shopName}</div>
  <div class="shop-sub">Jewellery ERP</div>

  <div class="title">Certificate of Completion</div>
  <div class="subtitle">Gold Saving Scheme</div>

  <div class="body-text">
    This is to certify that
    <div class="cust-name">${scheme.customer_name}</div>
    ${scheme.customer_mobile ? `(${scheme.customer_mobile})` : ""}
    has successfully completed all monthly commitments under the
    <b>${scheme.plan_name}</b> gold saving scheme.
  </div>

  <div class="details">
    <div>START DATE<b>${startDate}</b></div>
    <div>MATURITY DATE<b>${maturityDate}</b></div>
    <div>MONTHS PAID<b>${scheme.months_paid} of ${scheme.duration_months}</b></div>
  </div>

  <div class="amount">Total Paid: ${fmtINR(scheme.total_paid || 0)} &nbsp;·&nbsp; Maturity Value: ${fmtINR(maturityValue)}</div>

  <div class="sign">
    <div>Customer Signature</div>
    <div>For ${shopName}</div>
  </div>

  <div class="issued">Issued on ${issuedDate}</div>
</div>
</body>
</html>`;
}

// ─── Swarnakala Maturity Certificate HTML ─────────────────────────────────────

function generateSwarnakalaHTML(scheme, shopName, currentGoldRate) {
  const issuedDate = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const startDate = scheme.start_date
    ? new Date(scheme.start_date).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
    : "—";

  const totalGrams = asArray(scheme.payments).reduce((sum, p) => sum + (p.grams_credited || 0), 0);
  const totalAmountPaid = asArray(scheme.payments).reduce((sum, p) => sum + (p.amount || 0), 0);
  const currentValue = currentGoldRate ? totalGrams * currentGoldRate : null;

  const paymentRows = asArray(scheme.payments).map((p, i) => {
    const occurredAt = invoiceOccurredAt(p);
    const date = occurredAt ? occurredAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #f0e9d8;text-align:center;">${i + 1}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f0e9d8;">${date}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f0e9d8;text-align:right;">${fmtINR(p.amount || 0)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f0e9d8;text-align:right;">${p.gold_rate_at_payment ? fmtINR(p.gold_rate_at_payment, { decimals: 0 }) : "—"}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f0e9d8;text-align:right;">${p.grams_credited ? Number(p.grams_credited).toFixed(3) + "g" : "—"}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Swarnakala Certificate — ${scheme.customer_name}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Georgia, "Times New Roman", serif; color: #111; background: #fff; }
@page { size: A4; margin: 0; }
.frame { width: 100%; min-height: 297mm; border: 14px solid #B49042; outline: 2px solid #111; outline-offset: -22px; padding: 44px 56px; display: flex; flex-direction: column; align-items: center; }
.shop-name { font-size: 20pt; font-weight: bold; letter-spacing: 0.04em; text-align:center; }
.shop-sub { font-size: 9.5pt; color: #737373; letter-spacing: 0.15em; text-transform: uppercase; margin-top: 4px; text-align:center; }
.title { font-size: 22pt; color: #B49042; font-weight: bold; margin-top: 28px; letter-spacing: 0.05em; text-align:center; }
.subtitle { font-size: 10pt; color: #555; margin-top: 4px; text-align:center; }
.cust-block { margin-top: 22px; text-align:center; }
.cust-name { font-size: 17pt; font-weight: bold; color: #0A0A0A; }
.cust-mobile { font-size: 10pt; color: #737373; margin-top: 2px; }
.section-label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.12em; font-weight: bold; color: #B49042; margin: 22px 0 8px; width:100%; }
table.pay-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
table.pay-table th { background: #FDFBF7; border-bottom: 2px solid #EADFBF; padding: 7px 10px; text-align:left; color: #8A6D2F; font-size: 9pt; }
table.pay-table tfoot td { padding: 8px 10px; font-weight: bold; background: #FDFBF7; border-top: 2px solid #EADFBF; }
.summary-grid { display:flex; gap:32px; margin-top:20px; justify-content:center; }
.summary-grid div { text-align:center; }
.summary-grid .val { font-size:15pt; font-weight:bold; color:#0A0A0A; margin-top:3px; }
.summary-grid .lbl { font-size:8.5pt; text-transform:uppercase; letter-spacing:0.1em; color:#737373; }
.current-value { margin-top:16px; font-size:13pt; color:#B49042; font-weight:bold; text-align:center; }
.congrats { margin-top:18px; font-size:11pt; color:#555; font-style:italic; text-align:center; }
.sign { margin-top:40px; width:100%; display:flex; justify-content:space-between; font-size:9.5pt; }
.sign div { width:200px; border-top:1px solid #999; padding-top:5px; }
.issued { margin-top:18px; font-size:9pt; color:#888; text-align:center; }
</style>
</head>
<body>
<div class="frame">
  <div class="shop-name">${shopName}</div>
  <div class="shop-sub">Gold Saving Scheme</div>

  <div class="title">SWARNAKALA MATURITY CERTIFICATE</div>
  <div class="subtitle">Gold Gram Accumulation Scheme</div>

  <div class="cust-block">
    <div class="cust-name">${scheme.customer_name}</div>
    ${scheme.customer_mobile ? `<div class="cust-mobile">${scheme.customer_mobile}</div>` : ""}
    <div style="font-size:9.5pt;color:#737373;margin-top:6px;">Scheme Start Date: <b>${startDate}</b></div>
  </div>

  <div class="section-label">Payment Summary</div>
  <table class="pay-table">
    <thead>
      <tr>
        <th style="text-align:center;">Month</th>
        <th>Date</th>
        <th style="text-align:right;">Amount Paid</th>
        <th style="text-align:right;">Gold Rate (₹/g)</th>
        <th style="text-align:right;">Grams Credited</th>
      </tr>
    </thead>
    <tbody>${paymentRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="text-align:right;color:#555;">Total</td>
        <td style="text-align:right;">${fmtINR(totalAmountPaid)}</td>
        <td></td>
        <td style="text-align:right;">${totalGrams.toFixed(3)}g</td>
      </tr>
    </tfoot>
  </table>

  <div class="summary-grid">
    <div>
      <div class="lbl">Total Amount Paid</div>
      <div class="val">${fmtINR(totalAmountPaid)}</div>
    </div>
    <div>
      <div class="lbl">Total Grams Accumulated</div>
      <div class="val">${totalGrams.toFixed(3)}g</div>
    </div>
    ${currentGoldRate ? `<div>
      <div class="lbl">Current Gold Rate</div>
      <div class="val">${fmtRatePerGram(currentGoldRate)}</div>
    </div>` : ""}
  </div>

  ${currentValue !== null ? `<div class="current-value">Current Value: ${fmtINR(currentValue, { decimals: 0 })}</div>` : ""}

  <div class="congrats">Congratulations! Your gold savings are ready to redeem.</div>

  <div class="sign">
    <div>Customer Signature</div>
    <div>For ${shopName}<br><span style="font-size:8.5pt;color:#737373;">Proprietor</span></div>
  </div>

  <div class="issued">Issued on ${issuedDate}</div>
</div>
</body>
</html>`;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GoldSchemes() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schemePlans, setSchemePlans] = useState([]);
  const [currentGoldRate, setCurrentGoldRate] = useState(null);

  // Modals
  const [openNew, setOpenNew] = useState(false);
  const [activePay, setActivePay] = useState(null);   // scheme for payment
  const [detailRow, setDetailRow] = useState(null);   // scheme for detail panel

  // Filters
  const [q, setQ] = useState("");
  const [snoQuery, setSnoQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [quickFilter, setQuickFilter] = useState("");  // "due" | "overdue" | "maturing"
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const load = () => {
    api.get("/schemes").then(({ data }) => {
      setRows((data || []).map(enrich));
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get("/scheme-plans?active=true").then(({ data }) => setSchemePlans(data || [])).catch(() => setSchemePlans([]));
    api.get("/settings/gold-rate").then(({ data }) => {
      if (data?.rate) setCurrentGoldRate(Number(data.rate));
    }).catch(() => {});
  }, []);

  const redeemScheme = async (scheme) => {
    try {
      await api.post(`/schemes/${scheme.id}/redeem`);
      toast.success("Scheme marked as redeemed");
      load();
      setDetailRow(null);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  // ── Summary totals ───────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const active = rows.filter((r) => r.status === "active");
    const nowMonth = new Date();
    return {
      activeMembers: active.length,
      totalCollection: rows.reduce((s, r) => s + (r.total_paid || 0), 0),
      dueThisMonth: active
        .filter((r) => r.is_due_this_month || r.is_overdue)
        .reduce((s, r) => s + (r.monthly_amount || 0), 0),
      overdueCount: active.filter((r) => r.is_overdue).length,
      maturingThisMonth: active.filter((r) => r.is_maturing_this_month).length,
      awaitingRedemption: rows.filter((r) => r.status === "matured").length,
    };
  }, [rows]);

  // ── Filtered list ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return rows
      .filter((r) => {
        const lq = q.toLowerCase();
        if (lq && !r.customer_name?.toLowerCase().includes(lq) && !r.customer_mobile?.includes(lq))
          return false;
        const sq = snoQuery.trim();
        if (sq && String(r.serial_no ?? "") !== sq) return false;
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        if (quickFilter === "due" && !r.is_due_this_month && !r.is_overdue) return false;
        if (quickFilter === "overdue" && !r.is_overdue) return false;
        if (quickFilter === "maturing" && !r.is_maturing_this_month && !r.is_maturing_soon) return false;
        if (quickFilter === "matured" && r.status !== "matured") return false;
        return true;
      })
      .sort((a, b) => {
        const sa = Number(a.serial_no);
        const sb = Number(b.serial_no);
        const aHas = Number.isFinite(sa) && sa > 0;
        const bHas = Number.isFinite(sb) && sb > 0;
        if (aHas && bHas && sa !== sb) return sb - sa;
        if (aHas !== bHas) return aHas ? -1 : 1;
        const da = new Date(a.created_at || a.start_date || 0).getTime() || 0;
        const db = new Date(b.created_at || b.start_date || 0).getTime() || 0;
        return db - da;
      });
  }, [rows, q, snoQuery, statusFilter, quickFilter]);

  useEffect(() => {
    setPage(1);
  }, [q, snoQuery, statusFilter, quickFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── CSV export ───────────────────────────────────────────────────────────────
  const exportCsv = () => {
    const header = "S.No,Customer,Mobile,Plan,Monthly ₹,Duration,Paid Months,Total Paid ₹,Next Due,Status,Maturity Date\n";
    const body = filtered
      .map((r) =>
        [
          r.serial_no ?? "",
          `"${r.customer_name || ""}"`,
          r.customer_mobile || "",
          `"${r.plan_name || ""}"`,
          r.monthly_amount || 0,
          r.duration_months || 0,
          r.months_paid || 0,
          r.total_paid || 0,
          r.next_due_date ? r.next_due_date.toISOString().slice(0, 10) : "",
          r.status || "",
          r.maturity_date ? r.maturity_date.toISOString().slice(0, 10) : "",
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gold-schemes-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Exported");
  };

  // ── Quick filter toggle helper ────────────────────────────────────────────────
  const toggleQuick = (key) => setQuickFilter((prev) => (prev === key ? "" : key));

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title="Gold Saving Schemes"
        subtitle="Track monthly gold commitments — collections, maturity and redemption."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className="btn-secondary flex items-center gap-1.5">
              <Download size={13} strokeWidth={1.5} /> Export CSV
            </button>
            {can("gold_schemes", "create") && (
              <button
                data-testid={T.schemeAddBtn}
                onClick={() => setOpenNew(true)}
                className="btn-primary flex items-center gap-1.5"
              >
                <Plus size={14} strokeWidth={1.5} /> New Scheme
              </button>
            )}
          </div>
        }
      />

      {/* ── KPI cards ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <KpiCard
          label="Active Members"
          value={summary.activeMembers}
          icon={Wallet}
        />
        <KpiCard
          label="Total Collection"
          value={fmtINR(summary.totalCollection)}
          icon={Coins}
          accent
        />
        <KpiCard
          label="Due This Month"
          value={fmtINR(summary.dueThisMonth)}
          icon={CalendarClock}
          accent
        />
        <KpiCard
          label="Overdue Payments"
          value={summary.overdueCount}
          icon={AlertCircle}
          danger={summary.overdueCount > 0}
        />
        <KpiCard
          label="Maturing This Month"
          value={summary.maturingThisMonth}
          icon={TrendingUp}
        />
        <KpiCard
          label="Awaiting Redemption"
          value={summary.awaitingRedemption}
          icon={Award}
          accent={summary.awaitingRedemption > 0}
        />
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a3a3a3]" strokeWidth={1.5} />
          <input
            className="input pl-9 text-[13px]"
            placeholder="Search by name or mobile…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <input
          className="input max-w-[110px] text-[13px]"
          placeholder="S.No"
          inputMode="numeric"
          value={snoQuery}
          onChange={(e) => setSnoQuery(e.target.value)}
        />
        <select
          className="input max-w-[160px] text-[13px]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="matured">Matured</option>
          <option value="breaked">Breaked</option>
          <option value="completed">Collected</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <div className="flex items-center gap-1.5 ml-auto">
          <QuickBtn
            label="Due This Month"
            active={quickFilter === "due"}
            onClick={() => toggleQuick("due")}
            color="amber"
          />
          <QuickBtn
            label="Overdue"
            active={quickFilter === "overdue"}
            onClick={() => toggleQuick("overdue")}
            color="red"
          />
          <QuickBtn
            label="Maturing Soon"
            active={quickFilter === "maturing"}
            onClick={() => toggleQuick("maturing")}
            color="gold"
          />
          <QuickBtn
            label="Awaiting Redemption"
            active={quickFilter === "matured"}
            onClick={() => toggleQuick("matured")}
            color="gold"
          />
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <TableSkeleton rows={8} cols={6} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? "No schemes yet" : "No matching schemes"}
          description={
            rows.length === 0
              ? "Enrol customers into a monthly gold saving plan."
              : "Try adjusting your search or filters."
          }
          icon={Coins}
        />
      ) : (
        <div className="table-shell" data-testid={T.schemesTable}>
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">S.No</th>
                <th className="table-th">Customer</th>
                <th className="table-th">Plan</th>
                <th className="table-th text-right">Monthly ₹</th>
                <th className="table-th">Progress</th>
                <th className="table-th text-right">Total Paid</th>
                <th className="table-th">Next Due</th>
                <th className="table-th">Status</th>
                <th className="table-th">Maturity</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((s) => (
                <SchemeRow
                  key={s.id}
                  scheme={s}
                  onDetail={() => setDetailRow(s)}
                  onPay={() => setActivePay(s)}
                  canCreate={can("gold_schemes", "create")}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-[12px] text-[#737373]">
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 disabled:opacity-40"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <div>
            Page {safePage} of {totalPages} · showing {pagedRows.length} of {filtered.length}
          </div>
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 disabled:opacity-40"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────────── */}
      {openNew && (
        <NewSchemeModal
          schemePlans={schemePlans}
          onClose={() => setOpenNew(false)}
          onCreated={() => {
            load();
          }}
        />
      )}
      {activePay && (
        <PayModal
          scheme={activePay}
          onClose={() => setActivePay(null)}
          onDone={() => {
            load();
            setDetailRow(null);
          }}
        />
      )}
      {detailRow && (
        <DetailPanel
          scheme={detailRow}
          onClose={() => setDetailRow(null)}
          onPay={() => {
            setActivePay(detailRow);
          }}
          onRedeem={() => redeemScheme(detailRow)}
          canCreate={can("gold_schemes", "create")}
          currentGoldRate={currentGoldRate}
        />
      )}
    </div>
  );
}

// ─── SchemeRow ────────────────────────────────────────────────────────────────

function SchemeRow({ scheme: s, onDetail, onPay, canCreate }) {
  const pct = s.duration_months > 0 ? Math.min((s.months_paid / s.duration_months) * 100, 100) : 0;

  // Next due color
  let dueCls = "text-[#525252]";
  let dueLabel = s.next_due_date ? fmtDate(s.next_due_date) : "—";
  if (s.is_overdue) dueCls = "text-[#DC2626] font-semibold";
  else if (s.is_due_this_month) dueCls = "text-[#D97706] font-medium";

  return (
    <tr
      className="table-row cursor-pointer hover:bg-[#FAFAF9]"
      onClick={onDetail}
    >
      {/* S.No */}
      <td className="table-td font-mono text-[13px] text-[#525252]">{s.serial_no ?? "—"}</td>

      {/* Customer */}
      <td className="table-td">
        <div className="font-mono text-[10px] text-[#a3a3a3]">{fmtCustomerCode(s.customer_serial_no)}</div>
        <div className="font-medium text-[13px]">{s.customer_name}</div>
        <div className="font-mono text-[11px] text-[#a3a3a3]">{s.customer_mobile}</div>
      </td>

      {/* Plan */}
      <td className="table-td">
        <div className="text-[13px]">{s.plan_name}</div>
        {(s.scheme_type === "swarnakala" || s.plan_type === "weight") ? (
          <div className="text-[11px] text-[#B49042]">Gold Saving</div>
        ) : (
          <div className="text-[11px] text-[#737373]">
            Cash Saving{s.bonus_months > 0 ? ` · ${s.duration_months}+${s.bonus_months}` : ""}
          </div>
        )}
      </td>

      {/* Monthly */}
      <td className="table-td text-right font-mono tabular-nums text-[13px]">
        {fmtINR(s.monthly_amount)}
      </td>

      {/* Progress */}
      <td className="table-td">
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="h-1.5 flex-1 bg-[#F1F1F1] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#B49042] rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11.5px] font-mono text-[#525252] shrink-0">
            {s.months_paid}/{s.duration_months}
          </span>
        </div>
      </td>

      {/* Total paid */}
      <td className="table-td text-right font-medium tabular-nums">
        {fmtINR(s.total_paid)}
      </td>

      {/* Next due */}
      <td className="table-td">
        {s.status === "active" ? (
          <span className={`font-mono text-[12px] ${dueCls}`}>{dueLabel}</span>
        ) : (
          <span className="text-[#a3a3a3] text-[12px]">—</span>
        )}
      </td>

      {/* Status badge */}
      <td className="table-td">
        <StatusBadge status={s.status} />
      </td>

      {/* Maturity */}
      <td className="table-td">
        {s.maturity_date ? (
          <div>
            <div className="font-mono text-[12px] text-[#525252]">
              {fmtDate(s.maturity_date)}
            </div>
            {s.status === "active" && (
              <div className={`text-[11px] mt-0.5 ${s.is_maturing_this_month ? "text-[#B49042] font-medium" : "text-[#a3a3a3]"}`}>
                {s.is_maturing_this_month ? "Matures this month!" : `${s.months_left}m left`}
              </div>
            )}
          </div>
        ) : (
          <span className="text-[#a3a3a3]">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="table-td text-right" onClick={(e) => e.stopPropagation()}>
        {s.status === "active" && canCreate ? (
          <button
            onClick={onPay}
            className="btn-secondary !py-1 !text-[12px]"
          >
            Record payment
          </button>
        ) : (
          <button
            onClick={onDetail}
            className="text-[#a3a3a3] hover:text-[#0A0A0A] p-1"
            title="View details"
          >
            <ChevronRight size={14} strokeWidth={1.5} />
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Detail Panel (side drawer style modal) ───────────────────────────────────

function DetailPanel({ scheme: s, onClose, onPay, onRedeem, canCreate, currentGoldRate }) {
  const pct = s.duration_months > 0 ? Math.min((s.months_paid / s.duration_months) * 100, 100) : 0;
  const maturityValue = s.monthly_amount * (s.duration_months + (s.bonus_months || 0));
  const isGold = s.scheme_type === "swarnakala" || s.plan_type === "weight";
  const totalGrams = asArray(s.payments).reduce((sum, p) => sum + (p.grams_credited || 0), 0);
  const currentValue = currentGoldRate && totalGrams > 0 ? totalGrams * currentGoldRate : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 bg-white w-full max-w-xl h-full overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-[#E5E7EB] flex items-start justify-between sticky top-0 bg-white z-10">
          <div>
            <div className="font-display text-[17px] font-semibold text-[#0A0A0A]">
              {s.customer_name}
              {s.serial_no != null && (
                <span className="ml-2 font-mono text-[12px] font-normal text-[#a3a3a3]">
                  #{s.serial_no}
                </span>
              )}
            </div>
            <div className="font-mono text-[12px] text-[#a3a3a3] mt-0.5">{s.customer_mobile}</div>
          </div>
          <div className="flex items-center gap-2">
            {s.status === "active" && canCreate && (
              <button onClick={onPay} className="btn-primary !py-1.5 !text-[12px]">
                <Plus size={12} strokeWidth={1.5} /> Add Payment
              </button>
            )}
            {s.status === "matured" && canCreate && (
              <button onClick={onRedeem} className="btn-primary !py-1.5 !text-[12px] inline-flex items-center gap-1">
                <Gift size={12} strokeWidth={1.5} /> Mark as Redeemed
              </button>
            )}
            <button onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A] p-1">
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Scheme summary */}
        <div className="p-5 border-b border-[#E5E7EB] space-y-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px] text-[#0A0A0A]">{s.plan_name}</span>
            <StatusBadge status={s.status} />
            {s.is_overdue && (
              <span className="chip" style={{ background: "#FEF2F2", color: "#DC2626", borderColor: "#FECACA" }}>
                Overdue
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <InfoRow label="Monthly Amount" value={fmtINR(s.monthly_amount)} />
            <InfoRow label="Duration" value={`${s.duration_months} months`} />
            <InfoRow label="Bonus Months" value={s.bonus_months ?? 0} />
            <InfoRow
              label="Saving Type"
              value={isGold ? "Gold Saving (grams)" : "Cash Saving (11+1)"}
            />
            <InfoRow label="Start Date" value={fmtDate(s.start_date)} />
            <InfoRow label="Maturity Date" value={s.maturity_date ? fmtDate(s.maturity_date) : "—"} />
            <InfoRow label="Total Paid" value={fmtINR(s.total_paid)} bold />
            {isGold ? (
              <InfoRow
                label="Redeemable"
                value={
                  s.redeemable_grams > 0
                    ? `${Number(s.redeemable_grams).toFixed(3)}g`
                    : (s.redeemable_label || "Gold grams")
                }
              />
            ) : (
              <InfoRow label="Maturity Credit" value={fmtINR(s.maturity_value || maturityValue)} bold accent />
            )}
          </div>

          {/* Gold accumulation — gold schemes only */}
          {isGold && totalGrams > 0 && (
            <div className="bg-[#FDFBF7] border border-[#EADFBF] rounded-md p-3 space-y-1.5">
              <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#B49042] mb-1">
                Gold Accumulation
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-[#525252]">Total Grams Accumulated</span>
                <span className="font-mono font-semibold text-[#0A0A0A]">{totalGrams.toFixed(3)}g</span>
              </div>
              {currentValue !== null && (
                <div className="flex justify-between text-[12.5px]">
                  <span className="text-[#525252]">Current Value</span>
                  <span className="font-mono font-semibold text-[#B49042]">
                    {fmtINR(Math.round(currentValue))}
                  </span>
                </div>
              )}
              {currentGoldRate && (
                <div className="text-[11px] text-[#a3a3a3] mt-0.5">
                  At current rate {fmtRatePerGram(currentGoldRate)}
                </div>
              )}
            </div>
          )}

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-[11.5px] text-[#737373] mb-1.5">
              <span>{s.months_paid} of {s.duration_months} months paid</span>
              <span>{Math.round(pct)}%</span>
            </div>
            <div className="h-2 bg-[#F1F1F1] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#B49042] rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {s.status === "matured" && (
            <div className="bg-[#FDFBF7] border border-[#EADFBF] rounded-md p-3 text-[12.5px] text-[#8A6D2F] flex items-center gap-2">
              <Award size={14} strokeWidth={1.5} className="shrink-0 text-[#B49042]" />
              {isGold
                ? "All months paid — gold grams ready to redeem on a jewellery bill at today's rate."
                : `All months paid — maturity credit ${fmtINR(s.maturity_value || maturityValue)} (paid + bonus) ready to apply on a jewellery bill.`}
            </div>
          )}

          {s.status === "completed" && s.redeemed_at && (
            <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-md p-3 text-[12.5px] text-[#1D4ED8] flex items-center gap-2">
              <Gift size={14} strokeWidth={1.5} className="shrink-0" />
              Matured scheme collected on bill {fmtDate(s.redeemed_at)} — no further payments.
            </div>
          )}

          {s.status === "breaked" && (
            <div className="bg-[#FFF7ED] border border-[#FED7AA] rounded-md p-3 text-[12.5px] text-[#C2410C] flex items-center gap-2">
              <Scissors size={14} strokeWidth={1.5} className="shrink-0" />
              Breaked mid-scheme on bill {s.redeemed_at ? fmtDate(s.redeemed_at) : ""} — only the amount paid till date was credited. No further payments.
            </div>
          )}

          {s.notes && (
            <div className="bg-[#FAFAF9] rounded-md p-3 text-[12.5px] text-[#525252] border border-[#E5E7EB]">
              {s.notes}
            </div>
          )}
        </div>

        {/* Payment history */}
        <div className="flex-1 p-5">
          <div className="section-title mb-3">Payment History</div>
          {asArray(s.payments).length === 0 ? (
            <div className="text-[13px] text-[#a3a3a3] py-6 text-center">No payments recorded yet.</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="table-head-row">
                  <th className="table-th">#</th>
                  <th className="table-th">Date</th>
                  <th className="table-th text-right">Amount</th>
                  <th className="table-th text-right">Gold Rate</th>
                  <th className="table-th text-right">Gold (g)</th>
                  <th className="table-th">Mode</th>
                  <th className="table-th">Reference</th>
                </tr>
              </thead>
              <tbody>
                {asArray(s.payments).map((p, i) => (
                  <tr key={p.id || i} className="table-row">
                    <td className="table-td text-[#a3a3a3] font-mono">{i + 1}</td>
                    <td className="table-td font-mono">{fmtDate(invoiceOccurredAt(p))}</td>
                    <td className="table-td text-right font-medium tabular-nums">{fmtINR(p.amount)}</td>
                    <td className="table-td text-right font-mono text-[11.5px] text-[#525252]">
                      {p.gold_rate_at_payment ? fmtINR(p.gold_rate_at_payment, { decimals: 0 }) : "—"}
                    </td>
                    <td className="table-td text-right font-mono text-[11.5px] text-[#8A6D2F] font-semibold">
                      {p.grams_credited ? `${Number(p.grams_credited).toFixed(3)}g` : "—"}
                    </td>
                    <td className="table-td">
                      <span className="capitalize text-[#525252]">{p.mode || "—"}</span>
                    </td>
                    <td className="table-td text-[#a3a3a3] font-mono text-[11px]">
                      {p.reference || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── New Scheme Modal ─────────────────────────────────────────────────────────

function NewSchemeModal({ schemePlans, onClose, onCreated }) {
  const { date: activeBillingDate } = useBusinessDate();
  const [customerMode, setCustomerMode] = useState("existing"); // "existing" | "walkin"
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({
    walkin_name: "",
    walkin_mobile: "",
    plan_name: "",
    plan_type: "amount",
    scheme_type: "fixed_amount",
    monthly_amount: 5000,
    duration_months: 11,
    bonus_months: 1,
    // The shop's transaction date, not the real calendar date — still
    // editable if they want to backdate/postdate the scheme's start.
    start_date: activeBillingDate || todayStr(),
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [dupCustomer, setDupCustomer] = useState(null);

  // Customer typeahead (POS-style)
  const [custQ, setCustQ] = useState("");
  const [custResults, setCustResults] = useState([]);
  const [custOpen, setCustOpen] = useState(false);
  const [custSearching, setCustSearching] = useState(false);
  const custTimer = useRef(null);
  const custWrap = useRef(null);

  // Employee typeahead
  const [empQ, setEmpQ] = useState("");
  const [empOpen, setEmpOpen] = useState(false);
  const empWrap = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get("/employees", { params: { status: "active" } })
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : data?.items || data?.data || [];
        setEmployees(list.filter((e) => !e.status || e.status === "active"));
      })
      .catch(() => setEmployees([]));
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (custWrap.current && !custWrap.current.contains(e.target)) setCustOpen(false);
      if (empWrap.current && !empWrap.current.contains(e.target)) setEmpOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const searchCustomers = useCallback((term) => {
    if (!term.trim()) { setCustResults([]); return; }
    setCustSearching(true);
    api.get("/customers", { params: { q: term } })
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : data?.items || data?.data || [];
        setCustResults(list.slice(0, 12));
        setCustOpen(true);
      })
      .catch(() => setCustResults([]))
      .finally(() => setCustSearching(false));
  }, []);

  const onCustType = (e) => {
    const v = e.target.value;
    setCustQ(v);
    setSelectedCustomer(null);
    clearTimeout(custTimer.current);
    custTimer.current = setTimeout(() => searchCustomers(v), 300);
  };

  const pickCustomer = (c) => {
    setSelectedCustomer(c);
    setCustQ(`${c.name} — ${c.mobile || ""}`);
    setCustOpen(false);
  };

  const filteredEmployees = useMemo(() => {
    const lq = empQ.toLowerCase().trim();
    if (!lq) return employees.slice(0, 12);
    return employees.filter((e) =>
      e.name?.toLowerCase().includes(lq) || e.mobile?.includes(lq) || e.job_title?.toLowerCase().includes(lq),
    ).slice(0, 12);
  }, [employees, empQ]);

  const pickEmployee = (e) => {
    setSelectedEmployee(e);
    setEmpQ(e.name);
    setEmpOpen(false);
  };

  const handlePlanSelect = (planId) => {
    setSelectedPlanId(planId);
    const plan = schemePlans.find((p) => String(p.id) === String(planId));
    if (!plan) return;
    setForm((f) => ({
      ...f,
      plan_name: plan.name,
      plan_type: plan.plan_type || "amount",
      scheme_type: (plan.plan_type === "weight") ? "swarnakala" : "fixed_amount",
      duration_months: plan.duration_months,
      bonus_months: plan.bonus_months ?? 1,
      monthly_amount: plan.default_monthly_amount || f.monthly_amount,
    }));
  };

  const maturityValue = parseMoneyInput(form.monthly_amount) * (Number(form.duration_months || 0) + Number(form.bonus_months || 0));

  const save = async (e, { force = false } = {}) => {
    if (e) e.preventDefault();
    if (!selectedEmployee?.id) return toast.error("Select the employee who registered this scheme");
    if (!selectedPlanId || !form.plan_name) return toast.error("Select a scheme type");

    let customerName, customerMobile, customerId;

    if (customerMode === "existing") {
      if (!selectedCustomer?.id) return toast.error("Search and select a customer");
      customerName = selectedCustomer.name;
      customerMobile = selectedCustomer.mobile;
      customerId = selectedCustomer.id;
    } else {
      if (!form.walkin_name.trim()) return toast.error("Enter customer name");
      if (!form.walkin_mobile.trim()) return toast.error("Enter mobile number");
      customerName = form.walkin_name.trim();
      customerMobile = form.walkin_mobile.trim();
      customerId = null;
    }

    setBusy(true);
    try {
      await api.post("/schemes", {
        customer_id: customerId,
        customer_name: customerName,
        customer_mobile: customerMobile,
        plan_name: form.plan_name,
        plan_type: form.plan_type,
        scheme_type: form.scheme_type,
        monthly_amount: parseMoneyInput(form.monthly_amount),
        duration_months: Number(form.duration_months),
        bonus_months: Number(form.bonus_months),
        start_date: form.start_date,
        notes: form.notes,
        status: "active",
        salesperson_id: selectedEmployee.id,
        allow_duplicate_mobile: force || undefined,
      });
      toast.success(
        customerMode === "walkin"
          ? "Scheme created — customer added to customers list"
          : "Scheme created",
      );
      onCreated();
      onClose();
    } catch (err) {
      const info = dupInfo(err);
      if (info) setDupCustomer(info);
      else toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  // Walk-in mobile matched one or more existing customers — attach the
  // chosen one instead of creating a new record for the same person.
  const useExistingCustomer = (existing) => {
    setSelectedCustomer(existing);
    setCustQ(`${existing.name} — ${existing.mobile || ""}`);
    setCustomerMode("existing");
    setDupCustomer(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <form
        onSubmit={save}
        className="bg-white rounded-lg border border-[#E5E7EB] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="section-title">New Gold Scheme</div>
          <button type="button" onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Employee */}
          <div ref={empWrap} className="relative">
            <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-2">
              Registered by (employee)
            </div>
            <input
              className="input text-[13px]"
              placeholder="Search employee name…"
              value={empQ}
              onChange={(e) => {
                setEmpQ(e.target.value);
                setSelectedEmployee(null);
                setEmpOpen(true);
              }}
              onFocus={() => setEmpOpen(true)}
              required={!selectedEmployee}
            />
            {selectedEmployee && (
              <div className="mt-1.5 text-[12px] text-emerald-700">
                Selected: <span className="font-semibold">{selectedEmployee.name}</span>
                {selectedEmployee.job_title ? ` · ${selectedEmployee.job_title}` : ""}
              </div>
            )}
            {empOpen && filteredEmployees.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-[#E5E7EB] bg-white shadow-lg">
                {filteredEmployees.map((emp) => (
                  <li key={emp.id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#FAFAFA]"
                      onClick={() => pickEmployee(emp)}
                    >
                      <div className="font-medium text-[#0A0A0A]">{emp.name}</div>
                      <div className="text-[11px] text-[#737373]">
                        {[emp.job_title, emp.mobile].filter(Boolean).join(" · ") || "Staff"}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Customer selection */}
          <div>
            <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-2">
              Customer
            </div>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setCustomerMode("existing")}
                className={`px-3 py-1.5 text-[12px] rounded-md border transition-colors ${
                  customerMode === "existing"
                    ? "bg-[#0A0A0A] text-white border-[#0A0A0A]"
                    : "border-[#E5E7EB] text-[#525252] hover:border-[#0A0A0A]"
                }`}
              >
                Existing Customer
              </button>
              <button
                type="button"
                onClick={() => setCustomerMode("walkin")}
                className={`px-3 py-1.5 text-[12px] rounded-md border transition-colors ${
                  customerMode === "walkin"
                    ? "bg-[#0A0A0A] text-white border-[#0A0A0A]"
                    : "border-[#E5E7EB] text-[#525252] hover:border-[#0A0A0A]"
                }`}
              >
                Walk-in / New
              </button>
            </div>

            {customerMode === "existing" ? (
              <div ref={custWrap} className="relative space-y-1">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a3a3a3]" />
                  <input
                    className="input text-[13px] pl-9"
                    placeholder="Search customer by name or mobile…"
                    value={custQ}
                    onChange={onCustType}
                    onFocus={() => { if (custResults.length) setCustOpen(true); }}
                  />
                </div>
                {custSearching && <div className="text-[11px] text-[#a3a3a3]">Searching…</div>}
                {selectedCustomer && (
                  <div className="text-[12px] text-emerald-700">
                    Selected: <span className="font-semibold">{selectedCustomer.name}</span>
                    {selectedCustomer.mobile ? ` · ${selectedCustomer.mobile}` : ""}
                  </div>
                )}
                {custOpen && custResults.length > 0 && (
                  <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-[#E5E7EB] bg-white shadow-lg">
                    {custResults.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#FAFAFA]"
                          onClick={() => pickCustomer(c)}
                        >
                          <div className="font-medium text-[#0A0A0A]">{c.name}</div>
                          <div className="text-[11px] font-mono text-[#737373]">{c.mobile || "—"}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <F label="Name">
                  <input
                    required
                    className="input"
                    placeholder="Customer name"
                    value={form.walkin_name}
                    onChange={(e) => set("walkin_name", e.target.value)}
                  />
                </F>
                <F label="Mobile">
                  <input
                    required
                    className="input font-mono"
                    placeholder="10-digit mobile"
                    value={form.walkin_mobile}
                    onChange={(e) => set("walkin_mobile", e.target.value)}
                  />
                </F>
              </div>
            )}
          </div>

          {/* Plan details */}
          <F label="Scheme Type">
            <select
              required
              className="input"
              value={selectedPlanId}
              onChange={(e) => handlePlanSelect(e.target.value)}
            >
              <option value="" disabled>Select a scheme type…</option>
              {schemePlans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {schemePlans.length === 0 && (
              <div className="text-[11.5px] text-[#a3a3a3] mt-1.5">
                No scheme types defined yet — set them up under Programs → Scheme Management.
              </div>
            )}
          </F>

          <F label="Saving Type">
            <select
              className="input"
              value={form.scheme_type}
              onChange={(e) => {
                const next = e.target.value;
                set("scheme_type", next);
                set("plan_type", next === "swarnakala" ? "weight" : "amount");
                if (next === "swarnakala") set("bonus_months", 0);
                else if (Number(form.bonus_months) === 0) set("bonus_months", 1);
              }}
            >
              <option value="fixed_amount">Cash Saving (11+1 bonus)</option>
              <option value="swarnakala">Gold Saving (grams at day's rate)</option>
            </select>
            <div className="mt-2 bg-[#FDFBF7] border border-[#EADFBF] rounded-md p-3 text-[12px] text-[#8A6D2F]">
              {form.scheme_type === "swarnakala"
                ? "Each payment ÷ today's gold rate → grams stored. Redeem at current rate."
                : "Pay monthly cash. After all paid months, redeem paid amount + bonus month(s) credit toward jewellery."}
            </div>
          </F>

          <div className="grid grid-cols-2 gap-3">
            <F label="Monthly Amount (₹)">
              <MoneyInput
                required
                min="1"
                className="input font-mono"
                value={form.monthly_amount}
                onValueChange={(raw) => set("monthly_amount", raw)}
              />
            </F>
            <F label="Duration (paid months)">
              <input
                required
                type="text" inputMode="decimal"
                min="1"
                className="input font-mono"
                value={form.duration_months}
                onChange={(e) => set("duration_months", e.target.value)}
              />
            </F>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <F label={form.scheme_type === "swarnakala" ? "Bonus Months (usually 0)" : "Bonus Months"}>
              <input
                type="text" inputMode="decimal"
                min="0"
                max="3"
                className="input font-mono"
                value={form.bonus_months}
                onChange={(e) => set("bonus_months", e.target.value)}
              />
            </F>
            <F label="Start Date">
              <input
                type="date"
                required
                className="input"
                value={form.start_date}
                onChange={(e) => set("start_date", e.target.value)}
              />
            </F>
          </div>

          {/* Maturity value preview — cash schemes */}
          {maturityValue > 0 && form.scheme_type !== "swarnakala" && (
            <div className="bg-[#FDFBF7] border border-[#EADFBF] rounded-md p-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#B49042]">
                  Maturity Credit (after {form.duration_months} payments)
                </div>
                <div className="font-display text-[20px] font-semibold text-[#0A0A0A] mt-0.5">
                  {fmtINR(maturityValue)}
                </div>
              </div>
              <div className="text-[11.5px] text-[#737373] text-right">
                <div>{form.duration_months} × {fmtINR(form.monthly_amount)} paid</div>
                <div>+ {form.bonus_months} × {fmtINR(form.monthly_amount)} bonus</div>
              </div>
            </div>
          )}
          {form.scheme_type === "swarnakala" && (
            <div className="bg-[#FDFBF7] border border-[#EADFBF] rounded-md p-3 text-[12px] text-[#8A6D2F]">
              Gold value depends on rates at each payment and at redemption — not a fixed ₹ maturity.
            </div>
          )}
          <F label="Notes (optional)">
            <textarea
              className="input resize-none"
              rows={2}
              placeholder="Any remarks about this scheme…"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </F>
        </div>

        <div className="p-4 border-t border-[#E5E7EB] flex items-center justify-end gap-2 sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Creating…" : "Create Scheme"}
          </button>
        </div>
      </form>
      <DuplicateCustomerDialog
        info={dupCustomer}
        creating={busy}
        onClose={() => setDupCustomer(null)}
        onViewCustomer={useExistingCustomer}
        onCreateAnyway={() => { setDupCustomer(null); save(null, { force: true }); }}
      />
    </div>
  );
}

// ─── Pay Modal ────────────────────────────────────────────────────────────────

function isGoldScheme(scheme) {
  const type = String(scheme?.scheme_type || "").toLowerCase();
  const planType = String(scheme?.plan_type || "").toLowerCase();
  return type === "swarnakala" || planType === "weight";
}

function PayModal({ scheme, onClose, onDone }) {
  const { date: activeBillingDate } = useBusinessDate();
  const goldMode = isGoldScheme(scheme);
  const nextMonth = scheme.months_paid + 1;
  const [form, setForm] = useState({
    // Always the shop's transaction date — an installment is collected "now,"
    // so there's no legitimate reason to backdate/postdate it; see F field below.
    date: activeBillingDate || todayStr(),
    amount: scheme.monthly_amount,
    mode: "cash",
    reference: "",
    month_number: nextMonth,
    gold_rate: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Gold schemes only — fetch day's rate to convert payment → grams
  useEffect(() => {
    if (!goldMode) return;
    api.get("/settings/gold-rate").then(({ data }) => {
      const rate = data?.gold_22k || data?.rate || 0;
      if (rate) set("gold_rate", String(rate));
    }).catch(() => {});
  }, [goldMode]);

  const gramsPreview =
    goldMode && form.gold_rate && parseMoneyInput(form.gold_rate) > 0
      ? (parseMoneyInput(form.amount) / parseMoneyInput(form.gold_rate)).toFixed(3)
      : null;

  const save = async (e) => {
    e.preventDefault();
    if (goldMode && (!form.gold_rate || parseMoneyInput(form.gold_rate) <= 0)) {
      return toast.error("Enter today's gold rate — payment is stored as gold grams");
    }
    setBusy(true);
    try {
      const payload = {
        date: form.date,
        amount: parseMoneyInput(form.amount),
        mode: form.mode,
        reference: form.reference,
        month_number: Number(form.month_number),
        ...(goldMode
          ? {
              gold_rate_at_payment: parseMoneyInput(form.gold_rate),
              grams_credited: gramsPreview ? Number(gramsPreview) : null,
            }
          : {}),
      };
      await api.post(`/schemes/${scheme.id}/payments`, payload);
      toast.success(
        goldMode
          ? `Payment recorded — ${gramsPreview || "?"}g gold stored`
          : `Payment recorded — ${fmtINR(parseMoneyInput(form.amount))}`,
      );
      onDone();
      onClose();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const bonus = Number(scheme.bonus_months) || 0;
  const maturityPreview =
    Number(scheme.monthly_amount || 0) * (Number(scheme.duration_months || 0) + bonus);

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
      <form
        onSubmit={save}
        className="bg-white rounded-lg border border-[#E5E7EB] shadow-2xl w-full max-w-sm"
      >
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between">
          <div>
            <div className="section-title">Add Payment</div>
            <div className="text-[12px] text-[#737373] mt-0.5">
              {scheme.customer_name} · {scheme.plan_name}
              <span className="ml-1.5 text-[11px] text-[#B49042]">
                ({goldMode ? "Gold Saving" : "Cash Saving"})
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <F label="Payment Date">
              <div className="input bg-[#F5F5F5] text-[#525252] flex items-center cursor-not-allowed" title="Always the shop's current transaction date">
                {fmtDate(form.date)}
              </div>
            </F>
            <F label="Month No.">
              <input
                type="text" inputMode="decimal"
                min="1"
                className="input font-mono"
                value={form.month_number}
                onChange={(e) => set("month_number", e.target.value)}
              />
            </F>
          </div>

          <F label="Amount (₹)">
            <MoneyInput
              required
              min="1"
              className="input font-mono"
              value={form.amount}
              onValueChange={(raw) => set("amount", raw)}
            />
          </F>

          {goldMode ? (
            <>
              <F label="Gold Rate Today (22K ₹/g) *">
                <MoneyInput
                  min="1"
                  step="0.01"
                  required
                  className="input font-mono"
                  placeholder="e.g. 12000"
                  value={form.gold_rate}
                  onValueChange={(raw) => set("gold_rate", raw)}
                />
              </F>
              {gramsPreview !== null && (
                <div className="bg-[#FDFBF7] border border-[#EADFBF] rounded-md p-3 text-[12.5px] text-[#8A6D2F]">
                  <span className="font-semibold">Gold stored this payment: </span>
                  <span className="font-mono font-semibold">{gramsPreview}g</span>
                  <span className="text-[11px] text-[#a3a3a3] ml-2">
                    ({fmtINR(parseMoneyInput(form.amount))} ÷ {fmtRatePerGram(parseMoneyInput(form.gold_rate))})
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-md p-3 text-[12px] text-[#525252]">
              Cash saving — no gold rate needed. After {scheme.duration_months} paid months
              {bonus > 0 ? `, maturity credit is ${fmtINR(maturityPreview)} (includes ${bonus} bonus month)` : ""}.
            </div>
          )}

          <F label="Payment Mode">
            <select className="input" value={form.mode} onChange={(e) => set("mode", e.target.value)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="cheque">Cheque</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
          </F>

          <F label="Reference / UTR (optional)">
            <input
              className="input font-mono"
              placeholder="Transaction ID or cheque no."
              value={form.reference}
              onChange={(e) => set("reference", e.target.value)}
            />
          </F>

          {/* Mini scheme status */}
          <div className="bg-[#F9FAFB] rounded-md p-3 text-[12px] text-[#525252] border border-[#E5E7EB]">
            <div className="flex justify-between mb-1">
              <span>Months paid so far</span>
              <span className="font-mono font-medium">{scheme.months_paid} / {scheme.duration_months}</span>
            </div>
            <div className="flex justify-between">
              <span>Total collected</span>
              <span className="font-mono font-medium">{fmtINR(scheme.total_paid)}</span>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Record Payment"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, accent, danger }) {
  const text = value == null ? "—" : String(value);
  const long = text.length > 10;
  return (
    <div className="card min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#737373] truncate">
          {label}
        </div>
        {Icon && (
          <div
            className={`h-7 w-7 rounded-md flex items-center justify-center border flex-shrink-0 ${
              danger
                ? "bg-[#FEF2F2] border-[#FECACA]"
                : accent
                ? "bg-[#FDFBF7] border-[#EADFBF]"
                : "bg-[#F9FAFB] border-[#E5E7EB]"
            }`}
          >
            <Icon
              size={14}
              strokeWidth={1.5}
              className={danger ? "text-[#DC2626]" : accent ? "text-[#B49042]" : "text-[#525252]"}
            />
          </div>
        )}
      </div>
      <div
        className={`font-display font-semibold mt-3 leading-tight tracking-tight tabular-nums break-all ${
          long ? "text-[16px] sm:text-[18px]" : "text-[22px] sm:text-[26px]"
        } ${danger ? "text-[#DC2626]" : "text-[#0A0A0A]"}`}
        title={text}
      >
        {text}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === "active")
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]">
        <CheckCircle2 size={10} strokeWidth={2} /> Active
      </span>
    );
  if (status === "matured")
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full bg-[#FDFBF7] text-[#B49042] border border-[#EADFBF]">
        <Award size={10} strokeWidth={2} /> Matured
      </span>
    );
  if (status === "completed")
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
        <CheckCircle2 size={10} strokeWidth={2} /> Collected
      </span>
    );
  if (status === "breaked")
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]">
        <Scissors size={10} strokeWidth={2} /> Breaked
      </span>
    );
  if (status === "cancelled")
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
        <XCircle size={10} strokeWidth={2} /> Cancelled
      </span>
    );
  return <span className="chip chip-neutral capitalize">{status}</span>;
}

function QuickBtn({ label, active, onClick, color }) {
  const colorMap = {
    amber: active
      ? "bg-[#FFFBEB] text-[#D97706] border-[#FCD34D]"
      : "border-[#E5E7EB] text-[#737373] hover:border-[#D97706] hover:text-[#D97706]",
    red: active
      ? "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]"
      : "border-[#E5E7EB] text-[#737373] hover:border-[#DC2626] hover:text-[#DC2626]",
    gold: active
      ? "bg-[#FDFBF7] text-[#B49042] border-[#EADFBF]"
      : "border-[#E5E7EB] text-[#737373] hover:border-[#B49042] hover:text-[#B49042]",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-[12px] rounded-md border font-medium transition-colors ${colorMap[color] || colorMap.gold}`}
    >
      {label}
    </button>
  );
}

function InfoRow({ label, value, bold, accent }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#a3a3a3] mb-0.5">{label}</div>
      <div
        className={`text-[13px] ${bold ? "font-semibold" : ""} ${
          accent ? "text-[#B49042]" : "text-[#0A0A0A]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function F({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
