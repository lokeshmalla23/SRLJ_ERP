import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { SimplePieChart } from "@/components/charts/SimpleCharts";
import MoneyInput from "@/components/ui/MoneyInput";
import { PageLoadingBadge, SectionSkeleton } from "@/components/ui/Skeletons";
import { fmtINR, parseMoneyInput } from "@/lib/format";
import { useBusinessDate, notifyBusinessDateChanged } from "@/context/BusinessDateContext";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const HISTORY_PAGE_SIZE = 5;

const fmtG = (n) => `${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} g`;

function Badge({ status }) {
  const map = {
    closed: { bg: "#DCFCE7", color: "#15803D", label: "Closed" },
    draft: { bg: "#FEF9C3", color: "#A16207", label: "Draft" },
    open: { bg: "#F3F4F6", color: "#525252", label: "Open" },
  };
  const cfg = map[status] || map.open;
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

function Card({ title, children, className = "", headerRight }) {
  return (
    <div
      className={`rounded-2xl border bg-white p-4 shadow-[0_1px_0_rgba(180,144,66,0.08)] ${className}`}
      style={{ borderColor: "#E7E2D6" }}
    >
      {(title || headerRight) ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#8A6A2D" }}>
              {title}
            </h3>
          ) : <span />}
          {headerRight}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function AccordionCard({
  id,
  title,
  summary,
  summaryTone,
  open,
  onToggle,
  children,
}) {
  const summaryColor =
    summaryTone === "out" ? "#B45309"
      : summaryTone === "in" ? "#3F6B4A"
        : "#8A6A2D";
  return (
    <div
      className="overflow-hidden rounded-2xl border bg-white shadow-[0_1px_0_rgba(180,144,66,0.08)]"
      style={{ borderColor: open ? "#E2D2A8" : "#E7E2D6" }}
    >
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors"
        style={{ background: open ? "#FFFCF5" : "#FDFBF7" }}
        aria-expanded={open}
      >
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "#8A6A2D" }}
        >
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-2.5">
          {summary != null && summary !== "" ? (
            <span
              className="truncate text-[13px] font-semibold tabular-nums"
              style={{ color: summaryColor }}
            >
              {summary}
            </span>
          ) : null}
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            style={{ background: open ? "#F5EEDC" : "#F3EFE6" }}
          >
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              style={{ color: "#B49042" }}
            />
          </span>
        </span>
      </button>
      {open ? (
        <div className="border-t bg-white px-4 pb-4 pt-3" style={{ borderColor: "#F0E9D8" }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ExpenseGroup({ title, total, open, onToggle, children, empty }) {
  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: "#F0E9D8" }}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#FFFCF5]"
        aria-expanded={open}
      >
        <span className="text-[13px] text-[#525252]">{title}</span>
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-semibold tabular-nums" style={{ color: "#B45309" }}>
            {fmtINR(total)}
          </span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            style={{ color: "#B49042" }}
          />
        </span>
      </button>
      {open ? (
        <div className="border-t px-3 pb-2 pt-1" style={{ borderColor: "#F0E9D8", background: "#FFFEFB" }}>
          {children || (
            <div className="py-2 text-[12px] text-[#a3a3a3]">{empty || "No entries"}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FinalPocketCard({
  title,
  hint,
  pocket,
  counted,
  onCountedChange,
  canEdit,
  testId,
}) {
  const expected = nNet(pocket?.expected);
  const opening = nNet(pocket?.opening);
  const inn = nNet(pocket?.in);
  const out = nNet(pocket?.out);
  const countedN = counted !== "" && counted != null ? nNet(counted) : expected;
  const diff = countedN - expected;
  const diffTone = Math.abs(diff) < 0.01 ? "green" : diff < 0 ? "red" : "amber";
  const diffLabel = Math.abs(diff) < 0.01
    ? fmtINR(0)
    : `${diff < 0 ? "−" : "+"}${fmtINR(Math.abs(diff))}`;
  return (
    <Card title={title}>
      <p className="mb-3 text-[11px] leading-4 text-[#A3A3A3]">{hint}</p>
      <Row label="Opening" value={fmtINR(opening)} />
      <Row label="In today" value={fmtINR(inn)} tone="green" />
      <Row label="Out today" value={fmtINR(out)} tone="red" />
      <Row label="Expected" value={fmtINR(expected)} strong />
      <div className="py-1.5">
        <label className="text-[11px] text-[#737373]">Counted (closing) ₹</label>
        {canEdit ? (
          <MoneyInput
            min="0"
            step="0.01"
            className="input mt-1"
            value={counted}
            onValueChange={onCountedChange}
            data-testid={testId}
          />
        ) : (
          <div className="mt-1 text-sm font-semibold tabular-nums text-[#0A0A0A]">
            {fmtINR(countedN)}
          </div>
        )}
      </div>
      <Row label="Difference" value={diffLabel} strong tone={diffTone} />
      <div className="mt-2 rounded-xl px-3 py-2 text-[11px] leading-4" style={{ background: "#FFFCF5", color: "#8A6A2D" }}>
        Tomorrow&apos;s opening: <strong className="tabular-nums">{fmtINR(countedN)}</strong>
      </div>
    </Card>
  );
}

function KpiCard({ label, value, sub, tone }) {
  const color =
    tone === "red" ? "#DC2626" : tone === "green" ? "#16A34A" : tone === "gold" ? "#B49042" : "#0A0A0A";
  return (
    <div className="bg-white rounded-2xl border p-4" style={{ borderColor: "#E5E7EB" }}>
      <div className="text-[11px] uppercase tracking-wide text-[#737373]">{label}</div>
      <div className="text-xl font-semibold tabular-nums mt-1" style={{ color }}>
        {value}
      </div>
      {sub ? <div className="text-[11px] text-[#a3a3a3] mt-1">{sub}</div> : null}
    </div>
  );
}

function ClosingDetailModal({ title, columns, rows, empty, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" style={{ border: "1px solid #E7E2D6" }}>
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3.5" style={{ borderColor: "#F0E9D8", background: "#FFFCF5" }}>
          <div className="text-[15px] font-semibold text-[#171717]">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[#737373] hover:bg-[#F5F5F5] hover:text-[#0A0A0A]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {(!rows || rows.length === 0) ? (
            <div className="py-8 text-center text-[13px] text-[#a3a3a3]">{empty || "No records"}</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#8A6A2D]" style={{ background: "#FFFCF5" }}>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={`px-4 py-2 font-semibold ${c.align === "right" ? "text-right" : ""}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.id || i} className="border-t text-[13px]" style={{ borderColor: "#F3F4F6" }}>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-4 py-2 tabular-nums ${c.align === "right" ? "text-right" : ""} ${c.strong ? "font-semibold" : ""}`}
                      >
                        {c.format === "inr" ? fmtINR(row[c.key])
                          : c.format === "weight" ? fmtG(row[c.key])
                            : row[c.key]}
                      </td>
                    ))}
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

function Row({ label, value, strong, tone, onClick }) {
  const color =
    tone === "red" ? "#DC2626" : tone === "green" ? "#16A34A" : tone === "amber" ? "#B45309" : "#0A0A0A";
  return (
    <div
      className={`flex items-center justify-between py-1.5 border-b last:border-b-0 ${
        onClick ? "cursor-pointer rounded-md px-1 -mx-1 hover:bg-[#FAFAF8]" : ""
      }`}
      style={{ borderColor: "#F3F4F6" }}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="text-[13px] text-[#525252]">{label}</span>
      <span className={`text-[13px] tabular-nums ${strong ? "font-semibold" : ""}`} style={{ color }}>
        {value}
      </span>
    </div>
  );
}

const PAY_MODES = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "upi", label: "UPI" },
  { key: "bank", label: "Bank Transfer" },
  { key: "cheque", label: "Cheque" },
  { key: "old_gold", label: "Old Gold" },
  { key: "old_silver", label: "Old Silver" },
  { key: "finance", label: "Finance" },
  { key: "other", label: "Other" },
];

function fmtLedgerWhen(at) {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return String(at);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function PaymentModeLedgerModal({ mode, snapshot, onClose }) {
  if (!mode) return null;
  const meta = PAY_MODES.find((m) => m.key === mode) || { key: mode, label: mode };
  const bucket = snapshot?.payment_ledger?.[mode] || { in: 0, out: 0, net: 0, lines: [] };
  const lines = Array.isArray(bucket.lines) ? bucket.lines : [];

  return (
    <PaymentModeLedgerModalBody
      meta={meta}
      bucket={bucket}
      lines={lines}
      onClose={onClose}
    />
  );
}

function PaymentModeLedgerModalBody({ meta, bucket, lines, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" style={{ border: "1px solid #E7E2D6" }}>
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3.5" style={{ borderColor: "#F0E9D8", background: "#FFFCF5" }}>
          <div>
            <div className="text-[15px] font-semibold text-[#171717]">{meta.label} transactions</div>
            <div className="mt-0.5 text-[12px] text-[#8A6A2D]">Green is money in · brown is money out</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[#737373] hover:bg-[#F5F5F5] hover:text-[#0A0A0A]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {lines.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-[#a3a3a3]">No {meta.label} transactions today</div>
          ) : (
            lines.map((line) => {
              const debit = line.side === "debit";
              return (
                <div
                  key={line.id}
                  className="flex items-start justify-between gap-3 py-2.5 border-b last:border-b-0"
                  style={{ borderColor: "#F3F4F6" }}
                >
                  <div className="min-w-0">
                    <div
                      className="text-[13px] leading-5"
                      style={{ color: debit ? "#B45309" : "#3F6B4A" }}
                    >
                      {line.description}
                    </div>
                    {line.at ? (
                      <div className="mt-0.5 text-[11px] text-[#A3A3A3]">{fmtLedgerWhen(line.at)}</div>
                    ) : null}
                  </div>
                  <div
                    className="shrink-0 text-[13px] font-medium tabular-nums"
                    style={{ color: debit ? "#B45309" : "#3F6B4A" }}
                  >
                    {debit ? "−" : "+"}{fmtINR(line.amount)}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 border-t px-5 py-3.5" style={{ borderColor: "#F0E9D8", background: "#FFFCF5" }}>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#8A6A2D]">Credit</div>
            <div className="text-[13px] font-semibold tabular-nums" style={{ color: "#3F6B4A" }}>{fmtINR(bucket.in)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#8A6A2D]">Debit</div>
            <div className="text-[13px] font-semibold tabular-nums" style={{ color: "#B45309" }}>{fmtINR(bucket.out)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-[#8A6A2D]">Net</div>
            <div
              className="text-[13px] font-semibold tabular-nums"
              style={{ color: nNet(bucket.net) < 0 ? "#B45309" : "#3F6B4A" }}
            >
              {fmtINR(bucket.net)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function nNet(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function StockTable({ rows }) {
  if (!(rows || []).length) {
    return <div className="text-[13px] text-[#a3a3a3]">No stock movement today</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] text-[#737373]">
          <th className="pb-2 font-medium">Type</th>
          <th className="pb-2 font-medium text-right">Opening</th>
          <th className="pb-2 font-medium text-right">Received</th>
          <th className="pb-2 font-medium text-right">Sold</th>
          <th className="pb-2 font-medium text-right">Closing</th>
        </tr>
      </thead>
      <tbody>
        {(rows || []).map((r) => (
          <tr key={r.label} className="border-t" style={{ borderColor: "#F3F4F6" }}>
            <td className="py-1.5">{r.label}</td>
            <td className="py-1.5 text-right tabular-nums text-[12px]">{fmtG(r.opening_g)}</td>
            <td className="py-1.5 text-right tabular-nums text-[12px]">{fmtG(r.received_g)}</td>
            <td className="py-1.5 text-right tabular-nums text-[12px] font-medium">{fmtG(r.sold_g)}</td>
            <td className="py-1.5 text-right tabular-nums text-[12px]">{fmtG(r.closing_g)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const CHECKLIST_KEYS = [
  { key: "cash_verified", label: "Cash verified (physical count)" },
  { key: "upi_verified", label: "UPI / online verified" },
  { key: "bank_verified", label: "Bank payments verified" },
  { key: "cheque_verified", label: "Cheque payments verified" },
  { key: "expenses_entered", label: "Expenses entered" },
  { key: "income_entered", label: "Income entered" },
  { key: "stock_checked", label: "Stock checked" },
  { key: "rates_checked", label: "Rates checked" },
];

export default function DailyClosingTab({ includeHidden = false }) {
  const navigate = useNavigate();
  const { date: activeBillingDate, loading: businessDateLoading } = useBusinessDate();
  const [date, setDate] = useState(today());
  const [snapshot, setSnapshot] = useState(null);
  const [countedCash, setCountedCash] = useState("");
  const [countedUpi, setCountedUpi] = useState("");
  const [countedBank, setCountedBank] = useState("");
  const [countedCheque, setCountedCheque] = useState("");
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [shopName, setShopName] = useState("Main Branch");
  const [payModeOpen, setPayModeOpen] = useState(null);
  const [ogDetail, setOgDetail] = useState(null);
  const [payView, setPayView] = useState("net");
  const [openLower, setOpenLower] = useState({});
  const dateInitRef = useRef(false);

  // Default to the active (open, unclosed) business day rather than the real
  // calendar date — if a day was never closed, this is the one that still
  // needs closing, even if several real days have since passed.
  useEffect(() => {
    if (dateInitRef.current || businessDateLoading) return;
    dateInitRef.current = true;
    if (activeBillingDate) setDate(activeBillingDate);
  }, [activeBillingDate, businessDateLoading]);

  const status = snapshot?.daily_closing?.status || "open";
  const isClosed = status === "closed";
  const isActiveDate = date === (activeBillingDate || today());
  const canEdit = isActiveDate && !isClosed;
  const pb = snapshot?.payment_breakdown || {};
  const totals = snapshot?.totals || {};
  const cash = snapshot?.cash_summary || {};
  const finalCheck = snapshot?.final_check || {};
  const blockers = snapshot?.blockers || { can_close: false, reasons: [], warnings: [] };
  const n = (v) => parseMoneyInput(v);

  const lockedOpening = snapshot?.has_previous_close || isClosed
    ? n(cash.opening_cash ?? snapshot?.previous_closing_cash ?? 0)
    : n(snapshot?.till_opening_float || cash.opening_cash || snapshot?.suggested_opening_cash || 0);
  const openingCash = lockedOpening;

  const needsGoLiveSetup = snapshot?.opening_setup_complete === false
    && !snapshot?.has_previous_close
    && !isClosed;

  const cashSchemes = n(cash.cash_schemes ?? snapshot?.scheme?.collected_cash ?? 0);
  const posCash = cash.cash_sales != null && cash.cash_sales !== ""
    ? n(cash.cash_sales)
    : n(pb.cash);
  const cashTransfersIn = n(cash.cash_transfers_in ?? totals.cash_transfers_in);
  const cashTransfersOut = n(cash.cash_transfers_out ?? totals.cash_transfers_out);
  const cashRefunded = n(cash.cash_refunded ?? totals.cash_refunded);

  const toggleLower = useCallback((id) => {
    setOpenLower((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const expectedClosing = useMemo(
    () => openingCash + posCash + cashSchemes + n(totals.cash_income)
      - n(totals.cash_expenses) - n(totals.cash_purchases)
      + cashTransfersIn - cashTransfersOut - cashRefunded,
    [openingCash, posCash, cashSchemes, totals.cash_income, totals.cash_expenses, totals.cash_purchases, cashTransfersIn, cashTransfersOut, cashRefunded],
  );

  const variance = useMemo(() => {
    if (countedCash === "" && canEdit) return null;
    const counted = countedCash !== "" ? n(countedCash) : n(cash.counted_closing_cash);
    if (countedCash === "" && !isClosed) return null;
    return counted - expectedClosing;
  }, [countedCash, expectedClosing, cash.counted_closing_cash, canEdit, isClosed]);

  const checklistDone = useMemo(
    () => CHECKLIST_KEYS.every(({ key }) => !!checklist[key]),
    [checklist],
  );

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))),
    [history],
  );
  const historyPageCount = Math.max(1, Math.ceil(sortedHistory.length / HISTORY_PAGE_SIZE));
  const safeHistoryPage = Math.min(historyPage, historyPageCount);
  const pagedHistory = useMemo(
    () => sortedHistory.slice(
      (safeHistoryPage - 1) * HISTORY_PAGE_SIZE,
      safeHistoryPage * HISTORY_PAGE_SIZE,
    ),
    [sortedHistory, safeHistoryPage],
  );

  const payTotal = useMemo(() => {
    // "advance" is a redemption marker (a slice of the sale paid from a
    // previously-received customer advance), not new money today — it's
    // already reflected under whichever real mode collected that advance.
    // Excluded so we do not double-count a previously received advance.
    const keys = ["cash", "upi", "card", "bank", "cheque", "old_gold", "old_silver", "finance", "other"];
    return keys.reduce((s, k) => s + n(pb[k]), 0);
  }, [pb]);

  const load = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    try {
      const [{ data: preview }, { data: hist }] = await Promise.all([
        api.get(`/accounts/daily-closings/${date}/preview`, {
          params: { include_hidden: includeHidden ? 1 : undefined },
        }),
        api.get("/accounts/daily-closings", { params: { limit: 365 } }),
      ]);
      setSnapshot(preview);
      const histRows = Array.isArray(hist) ? hist : (hist?.rows || hist?.data || []);
      setHistory(histRows);
      setHistoryPage(1);

      const saved = preview?.daily_closing;
      const fc = preview?.final_check || {};
      const pocketCount = (pocket, fallback) => {
        if (pocket?.counted != null && pocket.counted !== "") return String(pocket.counted);
        if (pocket?.expected != null && pocket.expected !== "") return String(pocket.expected);
        return fallback;
      };
      if (saved) {
        setCountedCash(String(saved.closing_cash ?? pocketCount(fc.cash, "")));
        setNotes(saved.notes || "");
        setChecklist(saved.checklist_json || preview.checklist || {});
      } else {
        setCountedCash(String(preview?.cash_summary?.expected_closing_cash ?? pocketCount(fc.cash, "")));
        setNotes("");
        setChecklist(preview?.checklist || {});
      }
      setCountedUpi(pocketCount(fc.upi, ""));
      setCountedBank(pocketCount(fc.bank, ""));
      setCountedCheque(pocketCount(fc.cheque, ""));
    } catch (err) {
      setSnapshot(null);
      toast.error(formatApiError(err) || "Failed to load day summary");
    } finally {
      setLoading(false);
    }
  }, [date, includeHidden]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get("/settings")
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : data?.data || [];
        const shop = list.find((s) => s.key === "shop" || s.key === "shop_info" || s.key === "business");
        const name = shop?.value?.name || shop?.value?.shop_name || shop?.value?.business_name;
        if (name) setShopName(name);
      })
      .catch(() => {});
  }, []);

  const persist = async (closeDay) => {
    if (!canEdit) return;
    if (needsGoLiveSetup) {
      toast.error("Complete Accounts → Overview → Opening Setup first");
      return;
    }
    if (closeDay && !checklistDone) {
      toast.error("Tick all checklist items before closing the day");
      return;
    }
    if (openingCash < 0) {
      toast.error("Opening cash cannot be negative");
      return;
    }
    setSaving(true);
    try {
      const closingCash = countedCash === "" ? expectedClosing : n(countedCash);
      const payload = {
        opening_cash: openingCash,
        closing_cash: closingCash,
        notes,
        checklist,
        use_system_totals: true,
        include_hidden: includeHidden ? 1 : undefined,
        final_check: {
          cash: closingCash,
          upi: countedUpi === "" ? n(finalCheck.upi?.expected) : n(countedUpi),
          bank: countedBank === "" ? n(finalCheck.bank?.expected) : n(countedBank),
          cheque: countedCheque === "" ? n(finalCheck.cheque?.expected) : n(countedCheque),
        },
      };

      if (closeDay) {
        await api.post(`/accounts/daily-closings/${date}/close`, payload);
        toast.success("Day closed successfully");
        notifyBusinessDateChanged();
        // Jump this screen to the new active business day too — the one-time
        // init effect above only ever syncs `date` from activeBillingDate on
        // first mount, so without this the picker stays stuck showing the day
        // that was just closed until the user manually picks the next date.
        try {
          const { data: next } = await api.get("/accounts/active-billing-date");
          if (next?.date) setDate(next.date);
        } catch {
          // non-fatal — the top bar will still catch up on its own poll
        }
      } else if (snapshot?.daily_closing?.id) {
        await api.put(`/accounts/daily-closings/${date}`, { ...payload, status: "draft" });
        toast.success("Draft saved");
      } else {
        await api.post("/accounts/daily-closings", { ...payload, date, status: "draft" });
        toast.success("Draft saved");
      }
      await load();
    } catch (err) {
      const detail = err?.response?.data?.detail || formatApiError(err) || "Failed to save closing";
      toast.error(detail);
    } finally {
      setSaving(false);
    }
  };

  const toggleCheck = (key) => {
    if (!canEdit) return;
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const varianceTone =
    variance == null ? undefined : Math.abs(variance) < 0.01 ? "green" : variance < 0 ? "red" : "amber";
  const varianceLabel =
    variance == null
      ? "—"
      : Math.abs(variance) < 0.01
        ? fmtINR(0)
        : `${variance < 0 ? "−" : "+"}${fmtINR(Math.abs(variance))}`;

  // "Advance Used" is deliberately not a row here — it's a redemption of money
  // already received (and already counted under whichever mode collected that
  // advance), not an independent payment mode. Showing it here would either
  // double the total (if summed) or mismatch the pie's own proportions
  // (if shown but excluded from the sum).
  const payDisplay = PAY_MODES.map((m) => {
    const bucket = snapshot?.payment_ledger?.[m.key] || {};
    const credit = n(bucket.in != null ? bucket.in : pb[m.key]);
    const debit = n(bucket.out);
    const net = bucket.net != null ? n(bucket.net) : credit - debit;
    const value = payView === "debit" ? debit : payView === "credit" ? credit : net;
    return { key: m.key, label: m.label, credit, debit, net, value };
  });
  const payViewTotal = payDisplay.reduce((s, p) => s + p.value, 0);
  const payViewAbs = payDisplay.reduce((s, p) => s + Math.abs(p.value), 0);

  return (
    <div className="w-full min-w-0 space-y-4 px-1 sm:px-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#0A0A0A]">Daily Closing</h2>
          <p className="text-[13px] text-[#737373]">
            Close your day by verifying sales, metal, schemes, and till cash (system vs physical).
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-[#737373]">
            <span>Branch: <strong className="text-[#0A0A0A]">{shopName}</strong></span>
            <span>Date: <strong className="text-[#0A0A0A]">{date}</strong></span>
            <Badge status={isClosed ? "closed" : snapshot?.daily_closing ? "draft" : "open"} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary text-xs inline-flex items-center gap-1.5"
            onClick={() => {
              try {
                localStorage.setItem("reports.active", "dcr-workspace");
              } catch {
                /* ignore */
              }
              const params = new URLSearchParams({ report: "dcr-workspace" });
              if (date) params.set("date", date);
              navigate(`/reports?${params.toString()}`);
            }}
          >
            <FileText size={13} strokeWidth={1.5} />
            Day Closing Report
          </button>
          <input
            type="date"
            className="input w-40"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            data-testid="daily-closing-date"
          />
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          {!isActiveDate && !isClosed && (
            <span className="text-[12px] text-[#737373]">Not the current business day — view only</span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <SectionSkeleton height="h-40" />
          <SectionSkeleton height="h-56" />
        </div>
      ) : (
        <>
          {(blockers.reasons?.length > 0 || blockers.warnings?.length > 0) && (
            <div
              className="rounded-xl border p-4 space-y-2"
              style={{
                borderColor: blockers.can_close || isClosed ? "#FDE68A" : "#FECACA",
                background: blockers.can_close || isClosed ? "#FFFBEB" : "#FEF2F2",
              }}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle size={15} className={isClosed || blockers.can_close ? "text-amber-600" : "text-red-600"} />
                {isClosed ? "Day locked" : blockers.can_close ? "Warnings" : "Cannot close yet"}
              </div>
              <ul className="text-[13px] space-y-1 text-[#525252]">
                {(blockers.reasons || []).filter((r) => !isClosed || r.includes("already closed")).map((r) => (
                  <li key={r}>• {r}</li>
                ))}
                {(blockers.warnings || []).map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            </div>
          )}

          {needsGoLiveSetup ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-950">
              <strong>Go-live required:</strong> Complete{" "}
              <strong>Accounts → Overview → Opening Setup</strong> before day closing.
              {snapshot?.till_opening_locked ? (
                <> Drawer cash ({fmtINR(openingCash)}) is saved — finish the setup wizard to post GL opening balances and lock.</>
              ) : (
                <> Opening balances are set once there — not on this screen.</>
              )}
            </div>
          ) : snapshot?.till_opening_locked && !snapshot?.has_previous_close ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900">
              Opening drawer cash is <strong>locked at {fmtINR(openingCash)}</strong> from go-live setup.
              After you close today, tomorrow&apos;s opening comes from your physical count.
            </div>
          ) : null}

          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard label="Total Sales" value={fmtINR(totals.sales)} sub={`${totals.invoice_count || 0} bills`} tone="green" />
            <KpiCard label="Total Collection" value={fmtINR(totals.collection ?? payTotal)} sub="Money received" />
            <KpiCard
              label="Cash Difference"
              value={varianceLabel}
              sub={variance == null ? "Count Final cash below" : Math.abs(variance) < 0.01 ? "Matched" : variance < 0 ? "You are short" : "You have excess"}
              tone={varianceTone}
            />
            <KpiCard label="Gold Sold" value={fmtG(totals.gold_sold_g || snapshot?.metals?.gold_g)} sub="All purities" tone="gold" />
            <KpiCard label="Silver Sold" value={fmtG(totals.silver_sold_g || snapshot?.metals?.silver_g)} sub="Jewellery + pure" />
            <KpiCard label="Total Bills" value={String(totals.invoice_count || 0)} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card
              title="Payment Summary"
              headerRight={(
                <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: "#E2D2A8", background: "#FDFBF7" }}>
                  {[
                    { id: "credit", label: "Credit" },
                    { id: "debit", label: "Debit" },
                    { id: "net", label: "Net" },
                  ].map((opt) => {
                    const active = payView === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPayView(opt.id)}
                        className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
                        style={{
                          background: active ? "#315C4A" : "transparent",
                          color: active ? "#fff" : "#8A6A2D",
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
            >
              <p className="mb-3 text-[11px] text-[#a3a3a3]">
                {payView === "credit"
                  ? "Money received today by mode. Click a mode for the full list."
                  : payView === "debit"
                    ? "Money paid out today by mode. Click a mode for the full list."
                    : "Net by mode (received minus paid out). Default view. Click a mode for the full list."}
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <SimplePieChart
                  data={payDisplay
                    .filter((p) => Math.abs(p.value) > 0)
                    .map((p) => ({ name: p.label, value: Math.abs(p.value) }))}
                  height={200}
                  onSliceClick={(name) => {
                    const found = PAY_MODES.find((m) => m.label === name);
                    if (found) setPayModeOpen(found.key);
                  }}
                />
                <div>
                  {payDisplay.map((p) => {
                    const pct = payViewAbs > 0 ? ((Math.abs(p.value) / payViewAbs) * 100).toFixed(1) : "0.0";
                    const out = (payView === "debit" && p.value > 0) || (payView === "net" && p.value < 0);
                    const inn = (payView === "credit" && p.value > 0) || (payView === "net" && p.value > 0);
                    const signed = payView === "net" && p.value < 0
                      ? `−${fmtINR(Math.abs(p.value))}`
                      : fmtINR(p.value);
                    return (
                      <Row
                        key={p.key}
                        label={`${p.label} (${pct}%)`}
                        value={signed}
                        tone={out ? "red" : inn ? "green" : undefined}
                        onClick={() => setPayModeOpen(p.key)}
                      />
                    );
                  })}
                  <Row
                    label={payView === "credit" ? "Total credit" : payView === "debit" ? "Total debit" : "Total net"}
                    value={payView === "net" && payViewTotal < 0 ? `−${fmtINR(Math.abs(payViewTotal))}` : fmtINR(payViewTotal)}
                    strong
                    tone={payView === "debit" || payViewTotal < 0 ? "red" : "green"}
                  />
                </div>
              </div>
            </Card>

            <Card title="Cash Summary">
              <div className="space-y-3">
                <>
                  <Row
                    label={snapshot?.has_previous_close
                      ? "Opening cash (from previous close)"
                      : "Opening cash (from go-live setup)"}
                    value={fmtINR(openingCash)}
                    strong
                  />
                  <div className="text-[11px] text-[#a3a3a3] -mt-2">
                    {snapshot?.has_previous_close
                      ? "Locked — always taken from last closed day"
                      : snapshot?.till_opening_locked
                        ? "Locked from Opening Setup"
                        : "Set in Accounts → Opening Setup"}
                  </div>
                </>
                <Row label="Cash sales (system)" value={fmtINR(posCash)} />
                <Row label="Cash Schemes" value={fmtINR(cashSchemes)} />
                <Row label="Cash income" value={fmtINR(n(totals.cash_income) - n(cash.cash_old_gold_sales ?? totals.cash_old_gold_sales))} tone="green" />
                {n(cash.cash_old_gold_sales ?? totals.cash_old_gold_sales) > 0 ? (
                  <Row
                    label="Old gold sales"
                    value={fmtINR(cash.cash_old_gold_sales ?? totals.cash_old_gold_sales)}
                    tone="green"
                  />
                ) : null}
                <Row label="Cash expenses" value={fmtINR(totals.cash_expenses)} tone="red" />
                <Row label="Cash paid to vendors (Purchases)" value={fmtINR(totals.cash_purchases)} tone="red" />
                {cashTransfersIn > 0 ? (
                  <Row label="Cash received (transfer)" value={fmtINR(cashTransfersIn)} tone="green" />
                ) : null}
                {cashTransfersOut > 0 ? (
                  <Row label="Cash sent (transfer)" value={fmtINR(cashTransfersOut)} tone="red" />
                ) : null}
                {cashRefunded > 0 ? (
                  <Row label="Cash refunded (cancelled/returned bills)" value={fmtINR(cashRefunded)} tone="red" />
                ) : null}
                {n(cash.purchases_by_mode?.upi ?? totals.purchases_by_mode?.upi) > 0 ? (
                  <Row
                    label="UPI paid to vendors (Purchases)"
                    value={fmtINR(cash.purchases_by_mode?.upi ?? totals.purchases_by_mode?.upi)}
                    tone="red"
                  />
                ) : null}
                {n(cash.purchases_by_mode?.bank ?? totals.purchases_by_mode?.bank) > 0 ? (
                  <Row
                    label="Bank paid to vendors (Purchases)"
                    value={fmtINR(cash.purchases_by_mode?.bank ?? totals.purchases_by_mode?.bank)}
                    tone="red"
                  />
                ) : null}
                {n(cash.purchases_by_mode?.card ?? totals.purchases_by_mode?.card) > 0 ? (
                  <Row
                    label="Card paid to vendors (Purchases)"
                    value={fmtINR(cash.purchases_by_mode?.card ?? totals.purchases_by_mode?.card)}
                    tone="red"
                  />
                ) : null}
                {n(cash.purchases_by_mode?.cheque ?? totals.purchases_by_mode?.cheque) > 0 ? (
                  <Row
                    label="Cheque paid to vendors (Purchases)"
                    value={fmtINR(cash.purchases_by_mode?.cheque ?? totals.purchases_by_mode?.cheque)}
                    tone="red"
                  />
                ) : null}
                <Row label="Expected cash" value={fmtINR(expectedClosing)} strong tone="green" />
              </div>
            </Card>
          </div>

          <div>
            <div className="mb-2 flex items-end justify-between gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8A6A2D]">
                Day details
              </h3>
              <p className="text-[11px] text-[#A3A3A3]">Click a heading to open</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <AccordionCard
              id="expenses"
              title="Expenses"
              summary={fmtINR(n(totals.expenses) + n(totals.vendor_payments))}
              summaryTone="out"
              open={!!openLower.expenses}
              onToggle={toggleLower}
            >
              {(() => {
                const rows = snapshot?.expense_list || [];
                const shopRows = rows.filter((e) => e.kind !== "purchase");
                const vendorRows = rows.filter((e) => e.kind === "purchase");
                const shopTotal = n(totals.expenses);
                const vendorTotal = n(totals.vendor_payments ?? vendorRows.reduce((s, r) => s + n(r.amount), 0));
                const line = (e) => (
                  <Row
                    key={e.id}
                    label={`${e.description || e.category || "Expense"}${e.payment_mode ? ` · ${String(e.payment_mode).toUpperCase()}` : ""}`}
                    value={fmtINR(e.amount)}
                    tone="red"
                  />
                );
                return (
                  <div className="space-y-2">
                    <ExpenseGroup
                      title="Shop expenses"
                      total={shopTotal}
                      open={!!openLower["expense-shop"]}
                      onToggle={() => toggleLower("expense-shop")}
                      empty="No shop expenses today"
                    >
                      {shopRows.length ? shopRows.map(line) : null}
                    </ExpenseGroup>
                    <ExpenseGroup
                      title="Vendor purchases"
                      total={vendorTotal}
                      open={!!openLower["expense-vendor"]}
                      onToggle={() => toggleLower("expense-vendor")}
                      empty="No vendor purchases today"
                    >
                      {vendorRows.length ? vendorRows.map(line) : null}
                    </ExpenseGroup>
                  </div>
                );
              })()}
            </AccordionCard>

            <AccordionCard
              id="income"
              title="Income"
              summary={fmtINR(totals.income)}
              summaryTone="in"
              open={!!openLower.income}
              onToggle={toggleLower}
            >
              {(snapshot?.income_list || []).length === 0 ? (
                <div className="text-[13px] text-[#a3a3a3]">No income entries today</div>
              ) : (
                <>
                  {(snapshot.income_list || []).slice(0, 8).map((i) => (
                    <Row
                      key={i.id}
                      label={(i.kind === "old_gold_sale" || i.kind === "old_silver_sale")
                        ? `${i.description || (i.kind === "old_silver_sale" ? "Old silver sale" : "Old gold sale")}${i.payment_mode ? ` · ${String(i.payment_mode).toUpperCase()}` : ""}`
                        : (i.description || "Income")}
                      value={fmtINR(i.amount)}
                      tone="green"
                    />
                  ))}
                  <Row label="Total" value={fmtINR(totals.income)} strong tone="green" />
                </>
              )}
            </AccordionCard>

            <AccordionCard
              id="old-gold"
              title="Old Gold Exchange"
              summary={fmtINR(snapshot?.old_gold?.value)}
              open={!!openLower["old-gold"]}
              onToggle={toggleLower}
            >
              <Row
                label="Exchange bills"
                value={String(snapshot?.old_gold?.bill_count || 0)}
                onClick={() => setOgDetail("og-bills")}
              />
              <Row
                label="Gold weight received"
                value={fmtG(snapshot?.old_gold?.weight_g)}
                onClick={() => setOgDetail("og-weight")}
              />
              <Row label="Value" value={fmtINR(snapshot?.old_gold?.value)} strong />
            </AccordionCard>

            <AccordionCard
              id="old-silver"
              title="Old Silver Exchange"
              summary={fmtINR(snapshot?.old_silver?.value)}
              open={!!openLower["old-silver"]}
              onToggle={toggleLower}
            >
              <Row
                label="Exchange bills"
                value={String(snapshot?.old_silver?.bill_count || 0)}
                onClick={() => setOgDetail("os-bills")}
              />
              <Row
                label="Silver weight received"
                value={fmtG(snapshot?.old_silver?.weight_g)}
                onClick={() => setOgDetail("os-weight")}
              />
              <Row label="Value" value={fmtINR(snapshot?.old_silver?.value)} strong />
            </AccordionCard>

            <AccordionCard
              id="scheme"
              title="Scheme Collection"
              summary={fmtINR(snapshot?.scheme?.collected)}
              summaryTone="in"
              open={!!openLower.scheme}
              onToggle={toggleLower}
            >
              <Row label="Collected today" value={fmtINR(snapshot?.scheme?.collected)} />
              <Row label="Cash collected" value={fmtINR(snapshot?.scheme?.collected_cash ?? cashSchemes)} />
              <Row label="UPI collected" value={fmtINR(snapshot?.scheme?.collected_upi ?? snapshot?.scheme?.by_mode?.upi)} />
              <Row label="Adjusted in billing" value={fmtINR(snapshot?.scheme?.adjusted_on_bills)} />
              <Row label="Installments" value={String(snapshot?.scheme?.payment_count || 0)} />
            </AccordionCard>

            <AccordionCard
              id="advance"
              title="Advance Collection"
              summary={fmtINR(snapshot?.advances?.received)}
              summaryTone="in"
              open={!!openLower.advance}
              onToggle={toggleLower}
            >
              <Row label="Received" value={fmtINR(snapshot?.advances?.received)} />
              <Row label="Utilized on bills" value={fmtINR(snapshot?.advances?.utilized)} />
              <Row label="Refunded (cancel)" value={fmtINR(snapshot?.advances?.refunded)} />
              <Row label="Balance (day)" value={fmtINR(snapshot?.advances?.balance)} strong />
            </AccordionCard>

            <AccordionCard
              id="returns"
              title="Returns / Cancelled"
              summary={`${snapshot?.returns?.cancelled_count || 0} bills`}
              open={!!openLower.returns}
              onToggle={toggleLower}
            >
              <Row label="Cancelled bills" value={`${snapshot?.returns?.cancelled_count || 0} · ${fmtINR(snapshot?.returns?.cancelled_amount)}`} />
              <Row label="Credit notes" value={`${snapshot?.returns?.credit_note_count || 0} · ${fmtINR(snapshot?.returns?.credit_note_amount)}`} />
            </AccordionCard>

            <AccordionCard
              id="discounts"
              title="Discounts"
              summary={fmtINR(snapshot?.discounts?.total)}
              open={!!openLower.discounts}
              onToggle={toggleLower}
            >
              <Row label="Manual" value={fmtINR(snapshot?.discounts?.manual)} />
              <Row label="Scheme credit" value={fmtINR(snapshot?.discounts?.scheme)} />
              <Row label="Total" value={fmtINR(snapshot?.discounts?.total)} strong />
            </AccordionCard>

            <AccordionCard
              id="gst"
              title="GST Summary"
              summary={fmtINR(snapshot?.gst?.total)}
              open={!!openLower.gst}
              onToggle={toggleLower}
            >
              <Row label="Taxable" value={fmtINR(snapshot?.gst?.taxable)} />
              <Row label="CGST" value={fmtINR(snapshot?.gst?.cgst)} />
              <Row label="SGST" value={fmtINR(snapshot?.gst?.sgst)} />
              <Row label="Total GST" value={fmtINR(snapshot?.gst?.total)} strong />
            </AccordionCard>

            <AccordionCard
              id="pending"
              title="Pending Items"
              summary={String(
                (snapshot?.pending?.unpaid_invoices || blockers.pending_invoices?.length || 0)
                + (snapshot?.pending?.hold_drafts || blockers.pending_drafts?.length || 0),
              )}
              summaryTone={(snapshot?.pending?.unpaid_invoices || 0) > 0 ? "out" : undefined}
              open={!!openLower.pending}
              onToggle={toggleLower}
            >
              <Row label="Unpaid / partial bills" value={String(snapshot?.pending?.unpaid_invoices || blockers.pending_invoices?.length || 0)} />
              <Row label="Hold / draft sales" value={String(snapshot?.pending?.hold_drafts || blockers.pending_drafts?.length || 0)} />
              <Row label="Credit notes today" value={String(snapshot?.pending?.credit_notes || 0)} />
            </AccordionCard>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <AccordionCard
              id="stock-gold"
              title="Stock Movement — Gold"
              summary={fmtG(totals.gold_sold_g || snapshot?.metals?.gold_g)}
              open={!!openLower["stock-gold"]}
              onToggle={toggleLower}
            >
              <StockTable rows={snapshot?.stock?.gold} />
            </AccordionCard>
            <AccordionCard
              id="stock-silver"
              title="Stock Movement — Silver"
              summary={fmtG(totals.silver_sold_g || snapshot?.metals?.silver_g)}
              open={!!openLower["stock-silver"]}
              onToggle={toggleLower}
            >
              <StockTable rows={snapshot?.stock?.silver} />
            </AccordionCard>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <AccordionCard
              id="activity"
              title="User Activity"
              summary={`${(snapshot?.user_activity || []).length} staff`}
              open={!!openLower.activity}
              onToggle={toggleLower}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-[#737373]">
                    <th className="pb-2">Employee</th>
                    <th className="pb-2 text-right">Bills</th>
                    <th className="pb-2 text-right">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot?.user_activity || []).map((u) => (
                    <tr key={u.employee_id} className="border-t" style={{ borderColor: "#F0E9D8" }}>
                      <td className="py-1.5">
                        <div className="font-medium">{u.employee_name}</div>
                        {u.job_title && <div className="text-[11px] text-[#a3a3a3]">{u.job_title}</div>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{u.invoice_count}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium" style={{ color: "#B49042" }}>
                        {fmtINR(u.sales)}
                      </td>
                    </tr>
                  ))}
                  {!(snapshot?.user_activity || []).length && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-[#a3a3a3]">
                        No salesperson tagged on bills today
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </AccordionCard>

            <AccordionCard
              id="rates"
              title="Rate Snapshot"
              summary={fmtINR(snapshot?.rates?.closing?.gold_22k)}
              open={!!openLower.rates}
              onToggle={toggleLower}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-[#737373]">
                    <th className="pb-2">Metal</th>
                    <th className="pb-2 text-right">Opening</th>
                    <th className="pb-2 text-right">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["24K Gold", snapshot?.rates?.opening?.gold_24k, snapshot?.rates?.closing?.gold_24k],
                    ["22K Gold", snapshot?.rates?.opening?.gold_22k, snapshot?.rates?.closing?.gold_22k],
                    ["Silver", snapshot?.rates?.opening?.silver, snapshot?.rates?.closing?.silver],
                  ].map(([label, open, close]) => (
                    <tr key={label} className="border-t" style={{ borderColor: "#F0E9D8" }}>
                      <td className="py-1.5">{label}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtINR(open)}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium" style={{ color: "#8A6A2D" }}>{fmtINR(close)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AccordionCard>
          </div>

          <div>
            <div className="mb-2">
              <h3 className="text-sm font-semibold text-[#0A0A0A]">Final Check</h3>
              <p className="text-[12px] text-[#737373]">
                Count each pocket here. Counted closing becomes tomorrow&apos;s opening. Bank and cheques are separate.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <FinalPocketCard
                title="Final cash"
                hint="Physical till count. This is the cash closing for tomorrow's opening."
                pocket={finalCheck.cash}
                counted={countedCash}
                onCountedChange={setCountedCash}
                canEdit={canEdit}
                testId="daily-closing-counted"
              />
              <FinalPocketCard
                title="Final UPI"
                hint="Opening + UPI in − UPI out. Counted as per UPI statement."
                pocket={finalCheck.upi}
                counted={countedUpi}
                onCountedChange={setCountedUpi}
                canEdit={canEdit}
              />
              <FinalPocketCard
                title="Final Bank"
                hint="Bank transfers only — cheques are counted separately."
                pocket={finalCheck.bank}
                counted={countedBank}
                onCountedChange={setCountedBank}
                canEdit={canEdit}
              />
              <FinalPocketCard
                title="Final Cheques"
                hint="Cheque receipts and payments only — not mixed with bank."
                pocket={finalCheck.cheque}
                counted={countedCheque}
                onCountedChange={setCountedCheque}
                canEdit={canEdit}
              />
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Closing Checklist">
              <p className="text-[12px] text-[#737373] mb-2">
                All items must be ticked before you can close the day.
              </p>
              <div className="space-y-2">
                {CHECKLIST_KEYS.map(({ key, label }) => (
                  <label
                    key={key}
                    className={`flex items-center gap-2 text-[13px] text-[#0A0A0A] ${canEdit ? "cursor-pointer" : "cursor-default opacity-90"}`}
                  >
                    <input
                      type="checkbox"
                      checked={!!checklist[key]}
                      onChange={() => toggleCheck(key)}
                      disabled={!canEdit}
                      className="rounded border-[#D4D4D4]"
                    />
                    {label}
                  </label>
                ))}
              </div>
              {canEdit && !checklistDone && (
                <div className="mt-3 text-[12px] text-amber-700">
                  Tick all boxes to enable Close Day.
                </div>
              )}
            </Card>

            <Card title="Notes">
              {canEdit ? (
                <textarea
                  className="input w-full"
                  rows={5}
                  placeholder="Shortfall reason, handover notes…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{ resize: "vertical" }}
                />
              ) : (
                <div className="text-[13px] text-[#525252] whitespace-pre-wrap min-h-[6rem]">
                  {notes || "—"}
                </div>
              )}
              {isClosed && (
                <div className="mt-3 rounded-xl p-3 text-center text-sm font-medium" style={{ background: "#DCFCE7", color: "#15803D" }}>
                  Day closed successfully
                  {snapshot?.daily_closing?.closed_at
                    ? ` · ${new Date(snapshot.daily_closing.closed_at).toLocaleString("en-IN")}`
                    : ""}
                </div>
              )}
            </Card>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2 pb-2">
              <button
                className="btn-secondary text-sm flex-1"
                onClick={() => persist(false)}
                disabled={saving}
                data-testid="daily-closing-save-draft"
              >
                {saving ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
                Save Draft
              </button>
              <button
                className="btn-primary text-sm flex-1 flex items-center justify-center gap-1.5"
                onClick={() => persist(true)}
                disabled={saving || !blockers.can_close || !checklistDone}
                title={
                  !checklistDone
                    ? "Tick all checklist items first"
                    : !blockers.can_close
                      ? (blockers.reasons || []).join("; ")
                      : "Finalize EOD"
                }
                data-testid="daily-closing-close-day"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CalendarCheck size={14} />}
                Close Day
              </button>
            </div>
          )}

          {sortedHistory.length > 0 && (
            <Card
              title="Recent Closings"
              headerRight={sortedHistory.length > HISTORY_PAGE_SIZE ? (
                <span className="text-[11px] font-medium text-[#737373]">
                  Latest {HISTORY_PAGE_SIZE} days · page {safeHistoryPage} of {historyPageCount}
                </span>
              ) : null}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F9FAFB] text-left text-[12px] text-[#737373]">
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2 text-right">Sales</th>
                    <th className="px-2 py-2 text-right">Closing</th>
                    <th className="px-2 py-2 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedHistory.map((h) => (
                    <tr
                      key={h.id}
                      className="border-t cursor-pointer hover:bg-[#FAFAFA]"
                      style={{ borderColor: "#E5E7EB" }}
                      onClick={() => setDate(h.date)}
                    >
                      <td className="px-2 py-2 font-mono text-[12.5px]">{h.date}</td>
                      <td className="px-2 py-2"><Badge status={h.status === "closed" ? "closed" : "draft"} /></td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtINR(h.total_sales)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtINR(h.closing_cash)}</td>
                      <td className="px-2 py-2 text-right tabular-nums" style={{ color: Math.abs(Number(h.variance || 0)) < 0.01 ? "#16A34A" : "#B45309" }}>
                        {fmtINR(h.variance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sortedHistory.length > HISTORY_PAGE_SIZE ? (
                <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-[#737373]">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-[9px] border border-[#D2CCBF] bg-[#FFFDF9] px-2.5 py-1.5 font-medium transition hover:border-[#9EB2A6] hover:bg-[#F1F5F1] disabled:opacity-40"
                    disabled={safeHistoryPage <= 1}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={14} />
                    Previous
                  </button>
                  <span>
                    {pagedHistory.length} of {sortedHistory.length}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-[9px] border border-[#D2CCBF] bg-[#FFFDF9] px-2.5 py-1.5 font-medium transition hover:border-[#9EB2A6] hover:bg-[#F1F5F1] disabled:opacity-40"
                    disabled={safeHistoryPage >= historyPageCount}
                    onClick={() => setHistoryPage((p) => Math.min(historyPageCount, p + 1))}
                  >
                    Next
                    <ChevronRight size={14} />
                  </button>
                </div>
              ) : null}
            </Card>
          )}
        </>
      )}
      {payModeOpen ? (
        <PaymentModeLedgerModal
          mode={payModeOpen}
          snapshot={snapshot}
          onClose={() => setPayModeOpen(null)}
        />
      ) : null}
      {ogDetail === "og-bills" ? (
        <ClosingDetailModal
          title="Exchange bills"
          empty="No old gold exchange bills today"
          columns={[
            { key: "sno", label: "S.No", align: "right" },
            { key: "invoice_no", label: "Invoice No" },
            { key: "amount", label: "Amount", align: "right", format: "inr", strong: true },
          ]}
          rows={(snapshot?.old_gold?.bills || []).map((b, i) => ({
            sno: i + 1,
            invoice_no: b.invoice_no || "—",
            amount: b.amount,
          }))}
          onClose={() => setOgDetail(null)}
        />
      ) : null}
      {ogDetail === "og-weight" ? (
        <ClosingDetailModal
          title="Gold weight received"
          empty="No old gold weight received today"
          columns={[
            { key: "purity", label: "Purity" },
            { key: "weight_g", label: "Weight", align: "right", format: "weight", strong: true },
          ]}
          rows={snapshot?.old_gold?.by_purity || []}
          onClose={() => setOgDetail(null)}
        />
      ) : null}
      {ogDetail === "os-bills" ? (
        <ClosingDetailModal
          title="Silver exchange bills"
          empty="No old silver exchange bills today"
          columns={[
            { key: "sno", label: "S.No", align: "right" },
            { key: "invoice_no", label: "Invoice No" },
            { key: "amount", label: "Amount", align: "right", format: "inr", strong: true },
          ]}
          rows={(snapshot?.old_silver?.bills || []).map((b, i) => ({
            sno: i + 1,
            invoice_no: b.invoice_no || "—",
            amount: b.amount,
          }))}
          onClose={() => setOgDetail(null)}
        />
      ) : null}
      {ogDetail === "os-weight" ? (
        <ClosingDetailModal
          title="Silver weight received"
          empty="No old silver weight received today"
          columns={[
            { key: "purity", label: "Purity" },
            { key: "weight_g", label: "Weight", align: "right", format: "weight", strong: true },
          ]}
          rows={snapshot?.old_silver?.by_purity || []}
          onClose={() => setOgDetail(null)}
        />
      ) : null}
    </div>
  );
}
