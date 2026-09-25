import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import MoneyInput from "@/components/ui/MoneyInput";
import api, { formatApiError } from "@/lib/api";
import { parseMoneyInput } from "@/lib/format";
import {
  getRememberedOpeningSetup,
  isAccountsSetupComplete,
  isAccountsSetupCompleteEvent,
  liveSetupFromEvent,
  rememberOpeningSetup,
} from "@/lib/accountsSetup";
import {
  ACCOUNTS_NAV_GROUPS,
  filterAccountsNavGroups,
  OPENING_SETUP_SECTION,
  AccountsFilterBar,
  AccountsKpiCard,
  AccountsTable,
  daysAgo,
  fmtDate,
  fmtDateTime,
  fmtINR,
  fmtSummaryKpi,
  sectionMeta,
  today,
} from "./accountsShared";
import useConfirm from "@/hooks/useConfirm";
import { useSectionVisibility } from "@/context/SectionVisibilityContext";
import { invoiceOccurredAt, sortByInvoiceNoDesc } from "@/lib/occurredAt";
import StatementsTab from "./StatementsTab";
import DailyClosingTab from "./DailyClosingTab";
import OpeningSetupTab from "./OpeningSetupTab";
import EmployeeSalesTab from "./EmployeeSalesTab";
import IncomeTab from "./IncomeTab";
import ErpStatementTab from "./ErpStatementTab";
import InfoTab from "./InfoTab";
import TransferPaymentsTab from "./TransferPaymentsTab";
import HiddenDataTab from "./HiddenDataTab";

function HiddenAwareCell({ value, hidden }) {
  if (!hidden) return value;
  return (
    <span className="inline-flex items-center gap-1.5">
      {value}
      <span className="rounded-full bg-[#B49042]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#B49042]">
        Hidden
      </span>
    </span>
  );
}

function useRange(defaultPreset = "this_month") {
  const [preset, setPreset] = useState(defaultPreset);
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());

  const applyPreset = (id) => {
    setPreset(id);
    if (id === "custom") return;
    const t = today();
    if (id === "today") {
      setFrom(t);
      setTo(t);
    } else if (id === "yesterday") {
      const y = daysAgo(1);
      setFrom(y);
      setTo(y);
    } else if (id === "this_week") {
      setFrom(daysAgo(6));
      setTo(t);
    } else if (id === "this_month") {
      const d = new Date();
      setFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
      setTo(t);
    } else if (id === "last_month") {
      const d = new Date();
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const last = new Date(d.getFullYear(), d.getMonth(), 0);
      const ymd = (x) =>
        `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
      setFrom(ymd(first));
      setTo(ymd(last));
    } else if (id === "this_year") {
      setFrom(`${new Date().getFullYear()}-01-01`);
      setTo(t);
    }
  };

  return { preset, from, to, setFrom, setTo, applyPreset };
}

function DashboardPanel({ includeHidden = false }) {
  const range = useRange("this_month");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/accounts/dashboard", {
        params: {
          from: range.from,
          to: range.to,
          preset: range.preset === "custom" ? undefined : range.preset,
          include_hidden: includeHidden ? 1 : undefined,
        },
      });
      setData(res.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, range.preset, includeHidden]);

  useEffect(() => {
    load();
  }, [load]);

  const k = data?.kpis || {};
  const t = data?.today || {};

  return (
    <div>
      <AccountsFilterBar
        from={range.from}
        to={range.to}
        preset={range.preset}
        onFrom={(v) => {
          range.setFrom(v);
          range.applyPreset("custom");
        }}
        onTo={(v) => {
          range.setTo(v);
          range.applyPreset("custom");
        }}
        onPreset={range.applyPreset}
        onRefresh={load}
        loading={loading}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-6">
        <AccountsKpiCard label="Total Sales" value={fmtINR(k.total_sales)} />
        <AccountsKpiCard label="Total Purchases" value={fmtINR(k.total_purchases)} />
        <AccountsKpiCard label="Cash in Hand" value={fmtINR(k.cash_in_hand)} tone="good" />
        <AccountsKpiCard label="Bank Balance" value={fmtINR(k.bank_balance)} />
        <AccountsKpiCard label="Receivables" value={fmtINR(k.customer_receivables)} tone="warn" />
        <AccountsKpiCard label="Payables" value={fmtINR(k.vendor_payables)} tone="warn" />
        <AccountsKpiCard label="GST Payable" value={fmtINR(k.gst_payable)} />
        <AccountsKpiCard label="Exchange Value" value={fmtINR(k.exchange_value)} />
        <AccountsKpiCard label="Expenses" value={fmtINR(k.total_expenses)} />
        <AccountsKpiCard label="Gold Purchases" value={fmtINR(k.gold_purchase_value)} />
      </div>
      <h3 className="mb-2 text-sm font-semibold text-[#0A0A0A]">Today</h3>
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <AccountsKpiCard label="Sales" value={fmtINR(t.sales)} />
        <AccountsKpiCard label="Collections" value={fmtINR(t.collections)} />
        <AccountsKpiCard label="Purchases" value={fmtINR(t.purchases)} />
        <AccountsKpiCard label="Expenses" value={fmtINR(t.expenses)} />
        <AccountsKpiCard label="Payments" value={fmtINR(t.payments)} />
      </div>
      <h3 className="mb-2 text-sm font-semibold">Payment Method Summary (period)</h3>
      <div className="mb-4 grid grid-cols-3 gap-2 lg:grid-cols-6">
        {Object.entries(data?.payment_method_summary || {}).map(([mode, amt]) => (
          <AccountsKpiCard key={mode} label={mode.replace("_", " ")} value={fmtINR(amt)} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Pending Customer Payments</h3>
          <AccountsTable
            columns={[
              { key: "invoice_no", label: "Invoice" },
              { key: "customer_name", label: "Customer", render: (r) => r.customer_name || "—" },
              { key: "balance_due", label: "Due", render: (r) => fmtINR(r.balance_due) },
            ]}
            rows={data?.pending_customer_payments || []}
          />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Pending Vendor Payments</h3>
          <AccountsTable
            columns={[
              { key: "po_number", label: "PO" },
              { key: "vendor_name", label: "Vendor" },
              { key: "balance", label: "Due", render: (r) => fmtINR(r.balance) },
            ]}
            rows={data?.pending_vendor_payments || []}
          />
        </div>
      </div>
      <h3 className="mb-2 mt-4 text-sm font-semibold">Recent Financial Activity</h3>
      <AccountsTable
        columns={[
          { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
          { key: "source_type", label: "Type" },
          { key: "memo", label: "Description" },
          { key: "voucher_no", label: "Voucher" },
        ]}
        rows={data?.recent_transactions || []}
      />
    </div>
  );
}

function RegisterPanel({
  endpoint,
  title,
  columns,
  mapRow,
  asOfOnly = false,
  includeHidden = false,
}) {
  const range = useRange("this_month");
  const [rows, setRows] = useState([]);
  const [extra, setExtra] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bankAcct, setBankAcct] = useState("1010");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = asOfOnly
        ? { to: range.to, as_of: range.to }
        : { from: range.from, to: range.to };
      if (endpoint === "/accounts/bank-book") params.account = bankAcct;
      if (includeHidden) params.include_hidden = 1;
      const res = await api.get(endpoint, { params });
      if (Array.isArray(res.data?.rows)) {
        const next = mapRow ? res.data.rows.map(mapRow) : res.data.rows;
        setRows(endpoint === "/accounts/sales" ? sortByInvoiceNoDesc(next) : next);
      } else if (res.data?.lines) {
        setRows(res.data.lines);
      } else {
        setRows([]);
      }
      setExtra(res.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [endpoint, range.from, range.to, bankAcct, mapRow, asOfOnly, includeHidden]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCols = columns.map((c) => ({ key: c.key, label: c.label, format: c.format }));

  return (
    <div>
      <AccountsFilterBar
        from={asOfOnly ? range.to : range.from}
        to={range.to}
        preset={asOfOnly ? "custom" : range.preset}
        onFrom={(v) => {
          if (asOfOnly) {
            range.setTo(v);
            range.applyPreset("custom");
            return;
          }
          range.setFrom(v);
          range.applyPreset("custom");
        }}
        onTo={(v) => {
          range.setTo(v);
          range.applyPreset("custom");
        }}
        onPreset={asOfOnly ? undefined : range.applyPreset}
        onRefresh={load}
        loading={loading}
        exportTitle={title}
        exportRows={rows}
        exportColumns={exportCols}
      >
        {asOfOnly ? (
          <span className="text-[11px] text-[#737373]">As of date (ageing)</span>
        ) : null}
        {endpoint === "/accounts/bank-book" ? (
          <select
            value={bankAcct}
            onChange={(e) => setBankAcct(e.target.value)}
            className="rounded border border-[#E5E7EB] bg-white px-2 py-1 text-xs"
          >
            <option value="1010">Bank</option>
            <option value="1020">UPI</option>
            <option value="1030">Card</option>
          </select>
        ) : null}
      </AccountsFilterBar>
      {extra?.summary ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Object.entries(extra.summary).map(([k, v]) => (
            <AccountsKpiCard
              key={k}
              label={k.replace(/_/g, " ")}
              value={fmtSummaryKpi(k, v)}
            />
          ))}
        </div>
      ) : null}
      {extra?.opening_balance != null ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <AccountsKpiCard label="Opening" value={fmtINR(extra.opening_balance)} />
          <AccountsKpiCard label="Cash In / Debit" value={fmtINR(extra.total_in || 0)} />
          <AccountsKpiCard label="Cash Out / Credit" value={fmtINR(extra.total_out || 0)} />
          <AccountsKpiCard label="Closing" value={fmtINR(extra.closing_balance)} tone="good" />
        </div>
      ) : null}
      <AccountsTable columns={columns} rows={rows} />
    </div>
  );
}

function PartyLedgerPanel({ kind }) {
  const [partyId, setPartyId] = useState("");
  const [parties, setParties] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const range = useRange("this_year");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(kind === "customer" ? "/customers" : "/vendors", {
          params: { limit: 200 },
        });
        const list = Array.isArray(res.data) ? res.data : res.data?.data || res.data?.items || [];
        setParties(list);
      } catch {
        setParties([]);
      }
    })();
  }, [kind]);

  const load = useCallback(async () => {
    if (!partyId) return;
    setLoading(true);
    try {
      const path =
        kind === "customer"
          ? `/accounts/customers/${partyId}/ledger`
          : `/accounts/suppliers/${partyId}/ledger`;
      const res = await api.get(path, { params: { from: range.from, to: range.to } });
      setData(res.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [kind, partyId, range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const cols = [
    { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
    { key: "particular", label: "Particular" },
    { key: "debit", label: "Debit", render: (r) => fmtINR(r.debit) },
    { key: "credit", label: "Credit", render: (r) => fmtINR(r.credit) },
    { key: "balance", label: "Balance", render: (r) => fmtINR(r.balance) },
  ];

  return (
    <div>
      <AccountsFilterBar
        from={range.from}
        to={range.to}
        preset={range.preset}
        onFrom={range.setFrom}
        onTo={range.setTo}
        onPreset={range.applyPreset}
        onRefresh={load}
        loading={loading}
        exportTitle={`${kind}-ledger`}
        exportRows={data?.rows || []}
        exportColumns={cols.map((c) => ({ key: c.key, label: c.label }))}
      >
        <select
          value={partyId}
          onChange={(e) => setPartyId(e.target.value)}
          className="min-w-[200px] rounded border border-[#E5E7EB] bg-white px-2 py-1 text-xs"
        >
          <option value="">Select {kind}…</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.customer_name || p.id}
            </option>
          ))}
        </select>
      </AccountsFilterBar>
      {data ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <AccountsKpiCard label="Outstanding (ops)" value={fmtINR(data.outstanding_ops)} />
          <AccountsKpiCard label="Running" value={fmtINR(data.running_balance)} />
          <AccountsKpiCard
            label={kind === "customer" ? "GL AR" : "GL AP"}
            value={fmtINR(data.gl_ar_control ?? data.gl_ap_control)}
          />
        </div>
      ) : null}
      <AccountsTable columns={cols} rows={data?.rows || []} empty="Select a party to view ledger" />
    </div>
  );
}

function GstPanel() {
  const range = useRange("this_month");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/accounts/gst", { params: { from: range.from, to: range.to } });
      setData(res.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div>
      <AccountsFilterBar
        from={range.from}
        to={range.to}
        preset={range.preset}
        onFrom={range.setFrom}
        onTo={range.setTo}
        onPreset={range.applyPreset}
        onRefresh={load}
        loading={loading}
      />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <AccountsKpiCard label="Sales Taxable" value={fmtINR(data?.sales_taxable)} />
        <AccountsKpiCard label="Output GST" value={fmtINR(data?.output_gst)} />
        <AccountsKpiCard label="Input GST" value={fmtINR(data?.input_gst)} />
        <AccountsKpiCard label="Output IGST" value={fmtINR(data?.output_igst)} />
        <AccountsKpiCard label="Input IGST" value={fmtINR(data?.input_igst)} />
        <AccountsKpiCard label="Net GST Liability" value={fmtINR(data?.net_gst_payable)} tone="warn" />
        <AccountsKpiCard label="Output CGST" value={fmtINR(data?.output_cgst)} />
        <AccountsKpiCard label="Output SGST" value={fmtINR(data?.output_sgst)} />
        <AccountsKpiCard label="Input CGST" value={fmtINR(data?.input_cgst)} />
        <AccountsKpiCard label="Input SGST" value={fmtINR(data?.input_sgst)} />
      </div>
      <p className="mt-3 text-xs text-[#737373]">{data?.note}</p>
    </div>
  );
}

function MetalPanel({ includeHidden = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/accounts/metal", {
        params: { include_hidden: includeHidden ? 1 : undefined },
      });
      setData(res.data);
    } catch (err) {
      toast.error(formatApiError(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [includeHidden]);
  useEffect(() => {
    load();
  }, [load]);

  const metals = data?.metals || [];
  const totalPieces = metals.reduce((s, m) => s + (Number(m.pieces) || 0), 0);
  const totalNet = metals.reduce((s, m) => s + (Number(m.net_weight) || 0), 0);
  const totalValue = metals.reduce((s, m) => s + (Number(m.value) || 0), 0);

  return (
    <div>
      {/* Live inventory snapshot — date chips would be misleading (API has no period filter). */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EADFBF] bg-[#FDFBF7] p-3">
        <p className="text-xs text-[#525252]">
          Current stock as of now · pieces, weight and GL from live inventory (not a date range)
        </p>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1 rounded-lg bg-[#0A0A0A] px-3 py-1.5 text-xs font-medium text-white"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Refresh
        </button>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <AccountsKpiCard label="Stock pieces" value={String(totalPieces)} />
        <AccountsKpiCard label="Stock net wt" value={`${totalNet.toFixed(3)} g`} />
        <AccountsKpiCard label="Stock value" value={fmtINR(totalValue)} />
        <AccountsKpiCard
          label="Old gold"
          value={fmtINR(data?.old_gold?.value)}
          sub={`${Number(data?.old_gold?.weight_g || 0).toFixed(3)} g · GL ${fmtINR(data?.old_gold?.gl_balance)}`}
        />
        <AccountsKpiCard
          label="Old silver"
          value={fmtINR(data?.old_silver?.value)}
          sub={`${Number(data?.old_silver?.weight_g || 0).toFixed(3)} g · GL ${fmtINR(data?.old_silver?.gl_balance)}`}
        />
      </div>
      <AccountsTable
        columns={[
          { key: "metal", label: "Metal" },
          { key: "pieces", label: "Pieces" },
          { key: "gross_weight", label: "Gross Wt (g)" },
          { key: "net_weight", label: "Net Wt (g)" },
          { key: "value", label: "Stock value", render: (r) => fmtINR(r.value) },
        ]}
        rows={metals}
        empty="No in-stock metal found. Add products with stock, or restock sold tags."
      />
      <p className="mt-2 text-xs text-[#737373]">{data?.note}</p>

      <OldGoldSalePanel onChanged={load} includeHidden={includeHidden} metal="gold" />
      <OldGoldSalePanel onChanged={load} includeHidden={includeHidden} metal="silver" />
    </div>
  );
}

const PAYMENT_MODES = [
  { id: "cash", label: "Cash" },
  { id: "upi", label: "UPI" },
  { id: "bank", label: "Bank" },
  { id: "cheque", label: "Cheque" },
  { id: "card", label: "Card" },
];

/** Old Gold Sale / Disposal — selling accumulated Old Gold Stock (1300) to a wholesaler/refiner. */
function OldGoldSalePanel({ onChanged, includeHidden = false, metal = "gold" }) {
  const isSilver = metal === "silver";
  const noun = isSilver ? "old silver" : "old gold";
  const title = isSilver ? "Old Silver Sale / Disposal" : "Old Gold Sale / Disposal";
  const [available, setAvailable] = useState([]);
  const [sales, setSales] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [buyerName, setBuyerName] = useState("");
  const [saleValue, setSaleValue] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [refiningCharges, setRefiningCharges] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, confirmModal] = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [av, sl] = await Promise.all([
        api.get("/reports/old-gold/available", {
          params: { include_hidden: includeHidden ? 1 : undefined, metal },
        }),
        api.get("/reports/old-gold/sales", {
          params: { include_hidden: includeHidden ? 1 : undefined, metal },
        }),
      ]);
      setAvailable(av.data?.data || []);
      setSales(sl.data?.data || []);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [includeHidden, metal]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedReceipts = useMemo(
    () => available.filter((r) => selected.has(r.id)),
    [available, selected],
  );
  const bookValue = useMemo(
    () => selectedReceipts.reduce((s, r) => s + (Number(r.value) || 0), 0),
    [selectedReceipts],
  );
  const totalWeight = useMemo(
    () => selectedReceipts.reduce((s, r) => s + (Number(r.weight_g) || 0), 0),
    [selectedReceipts],
  );
  const saleAmt = parseMoneyInput(saleValue) || 0;
  const chargesAmt = parseMoneyInput(refiningCharges) || 0;
  const gainLoss = saleAmt > 0 ? saleAmt - bookValue : 0;

  const toggleReceipt = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetForm = () => {
    setSelected(new Set());
    setBuyerName("");
    setSaleValue("");
    setPaymentMode("cash");
    setReferenceNo("");
    setRefiningCharges("");
    setNotes("");
  };

  const submit = async () => {
    if (!selectedReceipts.length) {
      toast.error(`Select at least one ${noun} receipt to sell`);
      return;
    }
    if (!buyerName.trim()) {
      toast.error("Buyer / wholesaler name is required");
      return;
    }
    if (!(saleAmt > 0)) {
      toast.error("Enter the actual realized sale value");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/reports/old-gold/sales", {
        receipt_ids: [...selected],
        buyer_name: buyerName.trim(),
        sale_value: saleAmt,
        payment_mode: paymentMode,
        reference_no: referenceNo || null,
        refining_charges: chargesAmt,
        notes: notes || null,
        metal,
        include_hidden: includeHidden ? 1 : undefined,
      });
      toast.success(isSilver ? "Old silver sale recorded" : "Old gold sale recorded");
      resetForm();
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelSale = async (sale) => {
    if (!(await confirm(`Cancel ${noun} sale ${sale.sale_no}? This reverses the accounting entry and returns the ${isSilver ? "silver" : "gold"} to available stock.`))) {
      return;
    }
    try {
      await api.post(`/reports/old-gold/sales/${sale.id}/cancel`, {});
      toast.success(isSilver ? "Old silver sale cancelled" : "Old gold sale cancelled");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="mt-6 border-t border-[#F3F4F6] pt-4">
      <h3 className="mb-1 text-sm font-semibold text-[#0A0A0A]">{title}</h3>
      <p className="mb-3 text-xs text-[#737373]">
        Sell accumulated {noun} stock to a wholesaler/refiner — reduces {isSilver ? "Old Silver Stock (1310)" : "Old Gold Stock (1300)"} and books the realized amount plus any gain/loss.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-[#525252]">Select available {noun}</p>
          <div className="max-h-56 overflow-auto rounded-lg border border-[#E5E7EB]">
            {available.length ? (
              available.map((r) => (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-[#F3F4F6] px-2.5 py-1.5 text-xs last:border-0 hover:bg-[#FDFBF7]"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleReceipt(r.id)}
                  />
                  <span className="flex-1">
                    {r.receipt_no} · {Number(r.weight_g).toFixed(3)}g {r.purity || ""}
                    {r.invoice_no ? ` · Inv ${r.invoice_no}` : ""}
                  </span>
                  <span className="tabular-nums text-[#525252]">{fmtINR(r.value)}</span>
                </label>
              ))
            ) : (
              <p className="px-2.5 py-4 text-center text-xs text-[#737373]">
                {loading ? "Loading…" : `No ${noun} available to sell`}
              </p>
            )}
          </div>
          {selectedReceipts.length ? (
            <p className="mt-1 text-xs text-[#525252]">
              Selected: {selectedReceipts.length} · {totalWeight.toFixed(3)}g · Book value {fmtINR(bookValue)}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <input
            className="input w-full"
            placeholder="Buyer / wholesaler / refiner name"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <MoneyInput
              className="input"
              placeholder="Actual sale value"
              value={saleValue}
              onValueChange={(raw) => setSaleValue(raw)}
            />
            <MoneyInput
              className="input"
              placeholder="Refining/melting charges"
              value={refiningCharges}
              onValueChange={(raw) => setRefiningCharges(raw)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              className="input"
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
            >
              {PAYMENT_MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Reference / transaction no."
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
            />
          </div>
          <input
            className="input w-full"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {saleAmt > 0 && bookValue > 0 ? (
            <p className={`text-xs font-medium ${gainLoss >= 0 ? "text-[#15803D]" : "text-[#B45309]"}`}>
              {gainLoss >= 0 ? "Gain" : "Loss"}: {fmtINR(Math.abs(gainLoss))} (book {fmtINR(bookValue)} vs sale {fmtINR(saleAmt)})
            </p>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1 rounded-lg bg-[#0A0A0A] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Record {isSilver ? "Old Silver Sale" : "Old Gold Sale"}
          </button>
        </div>
      </div>

      <p className="mb-1 mt-4 text-xs font-medium text-[#525252]">Recent {noun} sales</p>
      <AccountsTable
        columns={[
          { key: "occurred_at", label: "Date & Time", render: (r) => fmtDateTime(invoiceOccurredAt(r)) },
          { key: "sale_no", label: "Sale No." },
          { key: "buyer_name", label: "Buyer" },
          { key: "gross_weight_g", label: "Weight (g)", render: (r) => Number(r.gross_weight_g).toFixed(3) },
          { key: "book_value", label: "Book value", render: (r) => fmtINR(r.book_value) },
          { key: "sale_value", label: "Sale value", render: (r) => fmtINR(r.sale_value) },
          {
            key: "gain_loss_amount",
            label: "Gain/Loss",
            render: (r) => (
              <span className={Number(r.gain_loss_amount) >= 0 ? "text-[#15803D]" : "text-[#B45309]"}>
                {fmtINR(r.gain_loss_amount)}
              </span>
            ),
          },
          { key: "status", label: "Status" },
          {
            key: "actions",
            label: "",
            render: (r) => (
              r.status === "posted" ? (
                <button
                  type="button"
                  onClick={() => cancelSale(r)}
                  className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] hover:bg-[#FDFBF7]"
                >
                  Cancel
                </button>
              ) : null
            ),
          },
        ]}
        rows={sales}
        empty={isSilver ? "No old silver sales recorded yet." : "No old gold sales recorded yet."}
      />
      {confirmModal}
    </div>
  );
}

function IntegrityPanel() {
  const [data, setData] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cutoverDate, setCutoverDate] = useState(today());
  const [cash, setCash] = useState("0");
  const [bank, setBank] = useState("0");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        api.get("/accounts/integrity"),
        api.get("/accounts/assessment"),
      ]);
      setData(a.data);
      setAssessment(b.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applyCutover = async () => {
    try {
      await api.post("/accounts/cutover", {
        cutover_date: cutoverDate,
        cash: parseMoneyInput(cash),
        bank: parseMoneyInput(bank),
      });
      toast.success("Cutover opening balances posted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={load}
        className="rounded-lg bg-[#0A0A0A] px-3 py-1.5 text-xs text-white"
      >
        {loading ? "Loading…" : "Refresh integrity"}
      </button>
      {data ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <AccountsKpiCard
            label="Trial Balance"
            value={data.trial_balance?.balanced ? "Balanced" : "IMBALANCE"}
            tone={data.trial_balance?.balanced ? "good" : "bad"}
            sub={fmtINR(data.trial_balance?.difference)}
          />
          <AccountsKpiCard
            label="AR Control"
            value={data.controls?.ar?.ok ? "OK" : "Check"}
            sub={`GL ${fmtINR(data.controls?.ar?.gl)} / Ops ${fmtINR(data.controls?.ar?.ops)}`}
          />
          <AccountsKpiCard
            label="AP Control"
            value={data.controls?.ap?.ok ? "OK" : "Check"}
            sub={`GL ${fmtINR(data.controls?.ap?.gl)} / Ops ${fmtINR(data.controls?.ap?.ops)}`}
          />
          <AccountsKpiCard label="Cutover" value={data.cutover_date || "Not set"} />
        </div>
      ) : null}
      {data?.warnings?.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <div className="mb-2 text-sm font-semibold text-amber-900">
            Integrity warnings ({data.warnings.length})
          </div>
          <AccountsTable
            columns={[
              { key: "code", label: "Code" },
              { key: "message", label: "Message" },
              { key: "gl", label: "GL", render: (r) => (r.gl != null && r.gl !== "" ? fmtINR(r.gl) : "—") },
              { key: "ops", label: "Ops", render: (r) => (r.ops != null && r.ops !== "" ? fmtINR(r.ops) : "—") },
            ]}
            rows={data.warnings}
            empty="No warnings"
          />
        </div>
      ) : data ? (
        <p className="text-xs text-emerald-700">No integrity warnings.</p>
      ) : null}
      {assessment ? (
        <div className="rounded-xl border border-[#EADFBF] bg-[#FDFBF7] p-3 text-xs">
          <div className="font-semibold">Historical assessment</div>
          <div className="mt-1 text-[#525252]">
            Strategy: {assessment.strategy} — recommended cutover {assessment.recommended_cutover_date}
          </div>
        </div>
      ) : null}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-3">
        <div className="mb-2 text-sm font-semibold">Apply accounting cutover</div>
        <div className="flex flex-wrap gap-2">
          <input type="date" value={cutoverDate} onChange={(e) => setCutoverDate(e.target.value)} className="rounded border px-2 py-1 text-xs" />
          <MoneyInput placeholder="Cash count" value={cash} onValueChange={(raw) => setCash(raw)} className="rounded border px-2 py-1 text-xs" />
          <MoneyInput placeholder="Bank count" value={bank} onValueChange={(raw) => setBank(raw)} className="rounded border px-2 py-1 text-xs" />
          <button type="button" onClick={applyCutover} className="rounded-lg bg-[#B49042] px-3 py-1.5 text-xs text-white">
            Post opening balances
          </button>
        </div>
      </div>
    </div>
  );
}

function ReconciliationPanel() {
  const [banks, setBanks] = useState([]);
  const [bankId, setBankId] = useState("");
  const [form, setForm] = useState({
    name: "",
    bank_name: "",
    account_number: "",
    ifsc: "",
    gl_code: "1010",
    opening_balance: "0",
  });
  const [stmtBal, setStmtBal] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const range = useRange("this_month");

  const loadBanks = useCallback(async () => {
    try {
      const res = await api.get("/accounts/bank-accounts");
      setBanks(res.data?.data || []);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }, []);

  const loadRecon = useCallback(async () => {
    if (!bankId) return;
    setLoading(true);
    try {
      const res = await api.get("/accounts/reconciliation", {
        params: {
          bank_account_id: bankId,
          from: range.from,
          to: range.to,
          statement_balance: stmtBal || undefined,
        },
      });
      setData(res.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [bankId, range.from, range.to, stmtBal]);

  useEffect(() => {
    loadBanks();
  }, [loadBanks]);

  useEffect(() => {
    loadRecon();
  }, [loadRecon]);

  const createBank = async () => {
    try {
      await api.post("/accounts/bank-accounts", {
        ...form,
        opening_balance: parseMoneyInput(form.opening_balance),
      });
      toast.success("Bank account created");
      setForm({ name: "", bank_name: "", account_number: "", ifsc: "", gl_code: "1010", opening_balance: "0" });
      loadBanks();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const mark = async (row, status) => {
    try {
      await api.post("/accounts/reconciliation/mark", {
        bank_account_id: bankId,
        journal_entry_id: row.journal_entry_id,
        line_key: row.line_key,
        amount: row.amount,
        entry_date: row.entry_date,
        description: row.memo || row.source_type,
        status,
      });
      loadRecon();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#EADFBF] bg-[#FDFBF7] p-3">
        <div className="mb-2 text-sm font-semibold">Bank accounts</div>
        <div className="mb-2 flex flex-wrap gap-2">
          <input placeholder="Name (e.g. HDFC Current)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded border px-2 py-1 text-xs" />
          <input placeholder="Bank" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className="rounded border px-2 py-1 text-xs" />
          <input placeholder="A/c No" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} className="rounded border px-2 py-1 text-xs" />
          <input placeholder="IFSC" value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value })} className="rounded border px-2 py-1 text-xs" />
          <select value={form.gl_code} onChange={(e) => setForm({ ...form, gl_code: e.target.value })} className="rounded border px-2 py-1 text-xs">
            <option value="1010">GL Bank</option>
            <option value="1020">GL UPI</option>
            <option value="1030">GL Card</option>
          </select>
          <MoneyInput placeholder="Opening" value={form.opening_balance} onValueChange={(raw) => setForm({ ...form, opening_balance: raw })} className="w-24 rounded border px-2 py-1 text-xs" />
          <button type="button" onClick={createBank} className="rounded-lg bg-[#B49042] px-3 py-1.5 text-xs text-white">Add</button>
        </div>
        <AccountsTable
          columns={[
            { key: "name", label: "Name" },
            { key: "bank_name", label: "Bank" },
            { key: "account_number", label: "A/c" },
            { key: "gl_code", label: "GL" },
            { key: "gl_balance", label: "GL Bal", render: (r) => fmtINR(r.gl_balance) },
          ]}
          rows={banks}
          empty="No bank accounts yet"
        />
      </div>

      <AccountsFilterBar
        from={range.from}
        to={range.to}
        preset={range.preset}
        onFrom={range.setFrom}
        onTo={range.setTo}
        onPreset={range.applyPreset}
        onRefresh={loadRecon}
        loading={loading}
      >
        <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="min-w-[180px] rounded border px-2 py-1 text-xs">
          <option value="">Select bank…</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <MoneyInput
          placeholder="Statement balance"
          value={stmtBal}
          onValueChange={(raw) => setStmtBal(raw)}
          className="w-36 rounded border px-2 py-1 text-xs"
        />
      </AccountsFilterBar>

      {data ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <AccountsKpiCard label="ERP Balance" value={fmtINR(data.erp_balance)} />
          <AccountsKpiCard label="Statement" value={fmtINR(data.statement_balance)} />
          <AccountsKpiCard label="Difference" value={fmtINR(data.difference)} tone={Math.abs(data.difference || 0) < 1 ? "good" : "warn"} />
          <AccountsKpiCard label="Matched / Unmatched" value={`${data.matched_count} / ${data.unmatched_count}`} />
        </div>
      ) : null}

      <AccountsTable
        columns={[
          { key: "entry_date", label: "Date", render: (r) => fmtDate(r.entry_date) },
          { key: "memo", label: "Description", render: (r) => r.memo || r.source_type },
          { key: "amount", label: "Amount", render: (r) => fmtINR(r.amount) },
          { key: "recon_status", label: "Status" },
          {
            key: "actions",
            label: "Actions",
            render: (r) => (
              <div className="flex gap-1">
                <button type="button" className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white" onClick={() => mark(r, "matched")}>Match</button>
                <button type="button" className="rounded bg-amber-500 px-2 py-0.5 text-[10px] text-white" onClick={() => mark(r, "pending")}>Pending</button>
                <button type="button" className="rounded bg-gray-400 px-2 py-0.5 text-[10px] text-white" onClick={() => mark(r, "unmatched")}>Clear</button>
              </div>
            ),
          },
        ]}
        rows={data?.rows || []}
        empty="Select a bank account to reconcile"
      />
    </div>
  );
}

/** Expenses stay as existing inline implementation via Accounts.jsx bridge — placeholder redirects note */
function ExpensesBridge({ children }) {
  return children || null;
}

export default function AccountsModule({ expensesNode = null, includeHidden = false }) {
  const [setupComplete, setSetupComplete] = useState(null);
  const [financialMode, setFinancialMode] = useState(null);
  const [section, setSection] = useState(() => {
    try {
      const saved = localStorage.getItem("accounts.section") || "dashboard";
      if (saved === "cashbook-manual" || saved === "cashbook" || saved === "hidden-data") return "dashboard";
      return saved;
    } catch {
      return "dashboard";
    }
  });

  const applySetup = useCallback((data) => {
    if (!data) return data;
    rememberOpeningSetup(data);
    const done = isAccountsSetupComplete(data);
    setSetupComplete(done);
    setFinancialMode(data?.financial_mode || (done ? "LIVE" : "PRE_ACCOUNTS"));
    return data;
  }, []);

  const refreshSetupStatus = useCallback(async () => {
    try {
      const { data } = await api.get("/accounts/opening-setup");
      const remembered = getRememberedOpeningSetup();
      if (!isAccountsSetupComplete(data) && isAccountsSetupComplete(remembered)) {
        return applySetup(remembered);
      }
      return applySetup(data);
    } catch {
      setSetupComplete(true);
      return null;
    }
  }, [applySetup]);

  useEffect(() => {
    refreshSetupStatus();
  }, [refreshSetupStatus]);

  useEffect(() => {
    const handler = (e) => {
      const t = e.detail?.type;
      if (isAccountsSetupCompleteEvent(e.detail)) {
        applySetup(liveSetupFromEvent(e.detail));
        setSection(OPENING_SETUP_SECTION);
        return;
      }
      if (t === "accounts:opening_setup_complete" || t === "accounts:opening_saved") {
        refreshSetupStatus().then((data) => {
          if (isAccountsSetupComplete(data)) setSection(OPENING_SETUP_SECTION);
        });
      }
    };
    window.addEventListener("realtime", handler);
    return () => window.removeEventListener("realtime", handler);
  }, [applySetup, refreshSetupStatus]);

  useEffect(() => {
    if (setupComplete === false) {
      setSection(OPENING_SETUP_SECTION);
    }
  }, [setupComplete]);

  const { sections: sectionVisibility, isSectionVisible } = useSectionVisibility();
  const isAccountsSectionVisible = useCallback(
    (level, id) => isSectionVisible("accounts", level, id),
    [isSectionVisible],
  );

  const navGroups = useMemo(
    () => filterAccountsNavGroups(ACCOUNTS_NAV_GROUPS, { includeHidden, isVisible: isAccountsSectionVisible }),
    [includeHidden, isAccountsSectionVisible],
  );

  useEffect(() => {
    if (!includeHidden && section === "hidden-data") setSection("dashboard");
  }, [includeHidden, section]);

  // Section-visibility toggles (Settings → Application Management) can hide
  // whatever section the user is currently viewing — fall back instead of
  // showing a blank/stale panel.
  useEffect(() => {
    if (navGroups.some((g) => g.items.some((i) => i.id === section))) return;
    const fallback = navGroups.some((g) => g.items.some((i) => i.id === "dashboard"))
      ? "dashboard"
      : navGroups[0]?.items?.[0]?.id;
    if (fallback) setSection(fallback);
  }, [navGroups, section, sectionVisibility]);

  const handleSetupComplete = useCallback((status) => {
    applySetup(status || {
      setup_complete: true,
      financial_mode: "LIVE",
      accounts_setup_status: "COMPLETED",
    });
    setSection(OPENING_SETUP_SECTION);
  }, [applySetup]);

  useEffect(() => {
    try {
      localStorage.setItem("accounts.section", section);
    } catch {
      /* ignore */
    }
  }, [section]);

  const meta = sectionMeta(section);
  const activeGroupId = meta.groupId || "overview";
  const activeGroup = useMemo(
    () => navGroups.find((g) => g.id === activeGroupId) || navGroups[0],
    [activeGroupId, navGroups],
  );

  const selectGroup = (groupId) => {
    const group = navGroups.find((g) => g.id === groupId);
    if (!group?.items?.length) return;
    const stillInGroup = group.items.some((i) => i.id === section);
    if (!stillInGroup) setSection(group.items[0].id);
  };

  const panel = useMemo(() => {
    switch (section) {
      case "opening-setup":
        return <OpeningSetupTab onComplete={handleSetupComplete} />;
      case "dashboard":
        return <DashboardPanel includeHidden={includeHidden} />;
      case "sales":
        return (
          <RegisterPanel
            endpoint="/accounts/sales"
            title="Sales Accounts"
            includeHidden={includeHidden}
            columns={[
              { key: "invoice_no", label: "Invoice", render: (r) => <HiddenAwareCell value={r.invoice_no} hidden={r.is_hidden} /> },
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "customer_name", label: "Customer" },
              { key: "taxable", label: "Taxable", render: (r) => fmtINR(r.taxable) },
              { key: "cgst", label: "CGST", render: (r) => fmtINR(r.cgst) },
              { key: "sgst", label: "SGST", render: (r) => fmtINR(r.sgst) },
              { key: "igst", label: "IGST", render: (r) => fmtINR(r.igst) },
              { key: "grand_total", label: "Total", render: (r) => fmtINR(r.grand_total) },
              { key: "paid_amount", label: "Paid", render: (r) => fmtINR(r.paid_amount) },
              { key: "balance_due", label: "Balance", render: (r) => fmtINR(r.balance_due) },
              { key: "payment_status", label: "Status" },
            ]}
          />
        );
      case "purchases":
        return (
          <RegisterPanel
            endpoint="/accounts/purchases"
            title="Purchase Accounts"
            columns={[
              { key: "po_number", label: "PO" },
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "vendor_name", label: "Vendor" },
              { key: "net_weight", label: "Net Wt" },
              { key: "taxable", label: "Taxable", render: (r) => fmtINR(r.taxable) },
              { key: "gst_amount", label: "GST", render: (r) => fmtINR(r.gst_amount) },
              { key: "grand_total", label: "Total", render: (r) => fmtINR(r.grand_total) },
              { key: "paid_amount", label: "Paid", render: (r) => fmtINR(r.paid_amount) },
              { key: "outstanding", label: "Due", render: (r) => fmtINR(r.outstanding) },
              { key: "payment_status", label: "Status" },
            ]}
          />
        );
      case "receivables":
        return (
          <RegisterPanel
            endpoint="/accounts/receivables"
            title="Customer Receivables"
            asOfOnly
            includeHidden={includeHidden}
            columns={[
              { key: "customer_name", label: "Customer" },
              { key: "source", label: "Type" },
              { key: "invoice_no", label: "Invoice", render: (r) => <HiddenAwareCell value={r.invoice_no} hidden={r.is_hidden} /> },
              { key: "invoice_date", label: "Date", render: (r) => fmtDate(r.invoice_date) },
              { key: "total_amount", label: "Total", render: (r) => fmtINR(r.total_amount) },
              { key: "outstanding", label: "Outstanding", render: (r) => fmtINR(r.outstanding) },
              { key: "days_outstanding", label: "Days" },
              { key: "status", label: "Status" },
            ]}
          />
        );
      case "payables":
        return (
          <RegisterPanel
            endpoint="/accounts/payables"
            title="Vendor Payables"
            asOfOnly
            columns={[
              { key: "vendor_name", label: "Vendor" },
              { key: "po_number", label: "PO" },
              { key: "purchase_date", label: "Date", render: (r) => fmtDate(r.purchase_date) },
              { key: "total_amount", label: "Total", render: (r) => fmtINR(r.total_amount) },
              { key: "outstanding", label: "Outstanding", render: (r) => fmtINR(r.outstanding) },
              { key: "days_outstanding", label: "Days" },
              { key: "status", label: "Status" },
            ]}
          />
        );
      case "transfer-payments":
        return <TransferPaymentsTab />;
      case "hidden-data":
        return includeHidden ? <HiddenDataTab /> : <DashboardPanel includeHidden={includeHidden} />;
      case "cash-book":
        return (
          <RegisterPanel
            endpoint="/accounts/cash-book"
            title="Cash Book"
            columns={[
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "type", label: "Type" },
              { key: "description", label: "Description" },
              { key: "cash_in", label: "In", render: (r) => fmtINR(r.cash_in) },
              { key: "cash_out", label: "Out", render: (r) => fmtINR(r.cash_out) },
              { key: "running_balance", label: "Balance", render: (r) => fmtINR(r.running_balance) },
            ]}
          />
        );
      case "bank-book":
        return (
          <RegisterPanel
            endpoint="/accounts/bank-book"
            title="Bank Book"
            columns={[
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "transaction", label: "Transaction" },
              { key: "reference", label: "Ref" },
              { key: "debit", label: "Debit", render: (r) => fmtINR(r.debit) },
              { key: "credit", label: "Credit", render: (r) => fmtINR(r.credit) },
              { key: "balance", label: "Balance", render: (r) => fmtINR(r.balance) },
            ]}
          />
        );
      case "receipts":
        return (
          <RegisterPanel
            endpoint="/accounts/receipts"
            title="Receipts"
            columns={[
              { key: "invoice_no", label: "Invoice No" },
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "type", label: "Type" },
              { key: "mode", label: "Mode" },
              { key: "amount", label: "Amount", render: (r) => fmtINR(r.amount) },
              { key: "receipt_no", label: "Receipt #" },
              { key: "reference", label: "Reference" },
            ]}
          />
        );
      case "employee-sales":
        return <EmployeeSalesTab includeHidden={includeHidden} />;
      case "income":
        return <IncomeTab />;
      case "payments":
        return (
          <RegisterPanel
            endpoint="/accounts/payments-register"
            title="Payments"
            columns={[
              { key: "payment_no", label: "Payment #" },
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "type", label: "Type" },
              { key: "payee", label: "Payee" },
              { key: "mode", label: "Mode" },
              { key: "amount", label: "Amount", render: (r) => fmtINR(r.amount) },
            ]}
          />
        );
      case "expenses":
        return <ExpensesBridge>{expensesNode}</ExpensesBridge>;
      case "customer-ledger":
        return <PartyLedgerPanel kind="customer" />;
      case "vendor-ledger":
        return <PartyLedgerPanel kind="vendor" />;
      case "metal":
        return <MetalPanel includeHidden={includeHidden} />;
      case "schemes":
        return (
          <RegisterPanel
            endpoint="/accounts/schemes"
            title="Scheme Accounts"
            columns={[
              { key: "member", label: "Member" },
              { key: "plan_name", label: "Plan" },
              { key: "monthly_amount", label: "Monthly", render: (r) => fmtINR(r.monthly_amount) },
              { key: "paid_installments", label: "Paid" },
              { key: "pending_installments", label: "Pending" },
              { key: "total_collected", label: "Collected", render: (r) => fmtINR(r.total_collected) },
              { key: "status", label: "Status" },
            ]}
          />
        );
      case "gst":
        return <GstPanel />;
      case "day-book":
        return (
          <RegisterPanel
            endpoint="/accounts/day-book"
            title="Day Book"
            columns={[
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "voucher_no", label: "Voucher" },
              { key: "type", label: "Type" },
              { key: "description", label: "Description" },
              { key: "debit", label: "Debit", render: (r) => fmtINR(r.debit) },
              { key: "credit", label: "Credit", render: (r) => fmtINR(r.credit) },
            ]}
          />
        );
      case "erp-statement":
        return <ErpStatementTab includeHidden={includeHidden} />;
      case "info":
        return <InfoTab />;
      case "statements":
        return <StatementsTab />;
      case "reconciliation":
        return <ReconciliationPanel />;
      case "audit":
        return (
          <RegisterPanel
            endpoint="/accounts/audit-trail"
            title="Audit Trail"
            columns={[
              { key: "date", label: "Date", format: "datetime", render: (r) => fmtDateTime(r.date) },
              { key: "action", label: "Action" },
              { key: "entity_type", label: "Module" },
              { key: "reason", label: "Reason" },
            ]}
          />
        );
      case "daily-closing":
        return <DailyClosingTab includeHidden={includeHidden} />;
      case "integrity":
        return <IntegrityPanel />;
      default:
        return <DashboardPanel />;
    }
  }, [section, expensesNode, includeHidden, handleSetupComplete]);

  return (
    <div className="min-h-[70vh]">
      {/* Group tabs */}
      <div className="mb-0 overflow-x-auto border-b border-[#EADFBF]">
        <div className="flex min-w-max items-end gap-0.5">
          {navGroups.map((group) => {
            const active = group.id === activeGroupId;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => selectGroup(group.id)}
                className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? group.id === "hidden-data"
                      ? "border-violet-600 text-violet-700"
                      : "border-[#B49042] text-[#B49042]"
                    : group.id === "hidden-data"
                      ? "border-transparent text-violet-600 hover:text-violet-800"
                      : "border-transparent text-[#737373] hover:text-[#0A0A0A]"
                }`}
              >
                {group.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section tabs within group */}
      {activeGroup.items.length > 1 ? (
        <div className="mb-4 overflow-x-auto rounded-b-xl border border-t-0 border-[#EADFBF] bg-[#FDFBF7] px-2 py-2">
          <div className="flex min-w-max flex-wrap gap-1.5">
            {activeGroup.items.map((item) => {
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    active
                      ? "bg-[#B49042] text-white shadow-sm"
                      : "bg-white text-[#525252] border border-[#E5E7EB] hover:border-[#B49042] hover:text-[#B49042]"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mb-4" />
      )}

      {setupComplete === false && section !== "opening-setup" ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-950">
          Accounts Setup is not completed. Financial transactions are currently in Test Mode.
        </div>
      ) : null}
      {setupComplete === true && financialMode === "LIVE" && section === "dashboard" ? (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-950">
          Accounts Setup Completed. ERP is now in Live Accounting Mode.
        </div>
      ) : null}

      {section !== "daily-closing" && section !== "opening-setup" ? (
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-[#0A0A0A]">{meta.label}</h2>
          {meta.hint ? <p className="text-xs text-[#737373]">{meta.hint}</p> : null}
        </div>
      ) : null}

      {panel}
    </div>
  );
}
