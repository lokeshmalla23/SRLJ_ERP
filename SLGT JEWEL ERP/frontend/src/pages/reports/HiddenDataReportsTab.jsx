import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Coins,
  CreditCard,
  Download,
  EyeOff,
  Landmark,
  Loader2,
  Receipt,
  Smartphone,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { fmtINR, fmtWeight } from "@/lib/format";
import PrintSummaryButton from "@/pages/reports/PrintSummaryButton";

const POCKETS = [
  { id: "cash", label: "Cash", icon: Wallet, wrap: "border-[#CBDAD0] bg-[#F1F6F2]", text: "text-[#315C4A]" },
  { id: "bank", label: "Bank", icon: Landmark, wrap: "border-[#D8D2C6] bg-[#F4F2ED]", text: "text-[#59635D]" },
  { id: "upi", label: "UPI", icon: Smartphone, wrap: "border-[#D8C28C] bg-[#FBF6E9]", text: "text-[#765A20]" },
  { id: "card", label: "Card", icon: CreditCard, wrap: "border-[#CDD2CF] bg-[#F1F3F2]", text: "text-[#5F6863]" },
];

const SECTIONS = [
  { id: "bills", label: "Hidden bills" },
  { id: "oldgold", label: "Old gold exchange" },
  { id: "oldsilver", label: "Old silver exchange" },
  { id: "items", label: "Items sold" },
  { id: "people", label: "Employees & customers" },
  { id: "mix", label: "Category & metal" },
];

function moneyOrDash(n) {
  return Number(n) > 0 ? fmtINR(n) : "—";
}

function fmtDay(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd || "—";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function downloadCsv(text, filename) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function HiddenDataReportsTab({ from, to, setFrom, setTo }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState("bills");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await api.get("/reports/hidden-data", {
        params: { from, to, include_hidden: 1 },
      });
      setData(payload);
    } catch (err) {
      setData(null);
      toast.error(formatApiError(err) || "Could not load hidden data");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data?.totals || {};
  const receipts = data?.receipts || {};
  const invoices = data?.invoices || [];
  const items = data?.items || [];
  const oldGold = data?.old_gold || { bill_count: 0, weight_g: 0, value: 0, by_purity: [], bills: [] };
  const oldSilver = data?.old_silver || { bill_count: 0, weight_g: 0, value: 0, by_purity: [], bills: [] };

  const invoiceColumns = useMemo(
    () => [
      { key: "date", label: "Date" },
      { key: "invoice_no", label: "Invoice" },
      { key: "customer_name", label: "Customer" },
      { key: "salesperson", label: "Staff" },
      { key: "grand_total", label: "Total" },
      { key: "cash", label: "Cash" },
      { key: "bank", label: "Bank" },
      { key: "upi", label: "UPI" },
      { key: "card", label: "Card" },
      { key: "old_gold", label: "Old Gold" },
      { key: "old_silver", label: "Old Silver" },
    ],
    [],
  );

  const exportBills = () => {
    const header = "Date,Invoice,Customer,Mobile,Staff,Items,Subtotal,Discount,GST,Total,Cash,Bank,UPI,Card,Old Gold,Old Silver,Due\n";
    const rows = invoices
      .map((i) =>
        [
          i.date || "",
          i.invoice_no || "",
          `"${String(i.customer_name || "").replace(/"/g, '""')}"`,
          i.customer_mobile || "",
          `"${String(i.salesperson || "").replace(/"/g, '""')}"`,
          i.item_count || 0,
          i.subtotal || 0,
          i.discount || 0,
          i.gst_amount || 0,
          i.grand_total || 0,
          i.cash || 0,
          i.bank || 0,
          i.upi || 0,
          i.card || 0,
          i.old_gold || 0,
          i.old_silver || 0,
          i.balance_due || 0,
        ].join(","),
      )
      .join("\n");
    downloadCsv(header + rows, `hidden-bills-${from}-to-${to}.csv`);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#DDD6FE] bg-[#F7F5FC] px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <EyeOff size={15} />
          </span>
          <div>
            <p className="text-sm font-semibold text-violet-950">Hidden POS billing only</p>
            <p className="mt-0.5 text-[12px] leading-5 text-violet-800">
              These bills stay out of the other report tabs while locked. Lock hidden bills again to hide this tab.
            </p>
          </div>
        </div>
      </div>

      <div className="card mb-0 !rounded-xl !border-[#D8D2C6] !bg-[#FBF8F1] p-3.5 shadow-[0_1px_2px_rgba(38,52,43,0.04)] [&_.input]:!rounded-[9px] [&_.input]:!border-[#CFC8BB] [&_.btn-secondary]:!rounded-[9px] [&_.btn-secondary]:!border-[#D2CCBF] [&_.btn-secondary]:!bg-[#FFFDF9]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] font-medium text-[#525252]">Date range</span>
          <input type="date" className="input max-w-[170px]" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-[#a3a3a3] text-[13px]">→</span>
          <input type="date" className="input max-w-[170px]" value={to} onChange={(e) => setTo(e.target.value)} />
          <button type="button" className="btn-secondary !py-1 !text-[11.5px] ml-auto" onClick={load} disabled={loading}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : null}
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Hidden sales" value={fmtINR(totals.grand_total)} icon={TrendingUp} />
        <Kpi label="Hidden bills" value={totals.count || 0} icon={Receipt} />
        <Kpi label="GST collected" value={fmtINR(totals.gst_amount)} icon={Receipt} />
        <Kpi label="Avg bill" value={fmtINR(totals.avg_invoice)} icon={TrendingUp} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Money collected" value={fmtINR(totals.collections)} />
        <Kpi label="Still due" value={fmtINR(totals.outstanding)} />
        <Kpi label="Items sold" value={totals.items_sold || 0} />
        <Kpi label="Net weight" value={fmtWeight(totals.net_weight)} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[#171717]">Payments received</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {POCKETS.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.id} className={`rounded-xl border p-3.5 shadow-sm ${p.wrap}`}>
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[#737373]">
                  <Icon size={13} className={p.text} />
                  {p.label}
                </div>
                <div className={`mt-1 text-lg font-semibold tabular-nums ${p.text}`}>
                  {loading && !data ? "…" : fmtINR(receipts[p.id])}
                </div>
              </div>
            );
          })}
          <div className="rounded-xl border border-[#D8C28C] bg-[#FBF6E9] p-3.5 shadow-sm">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[#737373]">
              <Coins size={13} className="text-amber-800" />
              Old gold
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-[#765A20]">
              {loading && !data ? "…" : fmtINR(oldGold.value || receipts.old_gold)}
            </div>
          </div>
          <div className="rounded-xl border border-[#CDD2CF] bg-[#F1F3F2] p-3.5 shadow-sm">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[#737373]">
              <Coins size={13} className="text-slate-700" />
              Old silver
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-800">
              {loading && !data ? "…" : fmtINR(oldSilver.value || receipts.old_silver)}
            </div>
          </div>
        </div>
      </div>

      <HiddenOldGoldSummary oldGold={oldGold} loading={loading && !data} />
      <HiddenOldGoldSummary
        oldGold={oldSilver}
        loading={loading && !data}
        title="Old silver exchange"
        blurb="Silver taken on hidden POS bills in this period — weight, purity and exchange value. This never mixes into Jewellery reports while hidden bills are locked."
        tone="silver"
      />

      <div className="overflow-x-auto rounded-xl border border-[#D8D2C6] bg-[#FBF8F1] px-2 py-2">
        <div className="flex min-w-max flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                section === s.id
                  ? "border border-[#315C4A] bg-[#315C4A] text-white shadow-sm"
                  : "border border-[#D8D2C6] bg-[#FFFDF9] text-[#59635D] hover:border-[#9EB2A6] hover:bg-[#F1F5F1] hover:text-[#315C4A]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {section === "bills" ? (
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#171717]">Hidden POS bills</h3>
            <div className="flex gap-2">
              <PrintSummaryButton
                reportName="Hidden Data — Bills"
                columns={invoiceColumns}
                rows={invoices.map((r) => ({
                  ...r,
                  date: fmtDay(r.date),
                  grand_total: fmtINR(r.grand_total),
                  cash: moneyOrDash(r.cash),
                  bank: moneyOrDash(r.bank),
                  upi: moneyOrDash(r.upi),
                  card: moneyOrDash(r.card),
                  old_gold: moneyOrDash(r.old_gold),
                  old_silver: moneyOrDash(r.old_silver),
                }))}
                filtersSummary={`${from} → ${to}`}
              />
              <button type="button" className="btn-secondary !py-1 !text-[11.5px]" onClick={exportBills} disabled={!invoices.length}>
                <Download size={12} /> CSV
              </button>
            </div>
          </div>
          <ReportTable
            empty="No hidden bills in this period"
            headers={[
              { key: "date", label: "Date" },
              { key: "invoice_no", label: "Invoice" },
              { key: "customer", label: "Customer" },
              { key: "staff", label: "Staff" },
              { key: "items", label: "Items", right: true },
              { key: "total", label: "Total", right: true },
              { key: "cash", label: "Cash", right: true },
              { key: "bank", label: "Bank", right: true },
              { key: "upi", label: "UPI", right: true },
              { key: "card", label: "Card", right: true },
              { key: "old_gold", label: "Old Gold", right: true },
              { key: "old_silver", label: "Old Silver", right: true },
              { key: "due", label: "Due", right: true },
            ]}
            rows={invoices}
            render={(r) => (
              <>
                <td className="table-td">{fmtDay(r.date)}</td>
                <td className="table-td font-medium">{r.invoice_no}</td>
                <td className="table-td">
                  {r.customer_name}
                  {r.customer_mobile ? <div className="text-[11px] text-[#737373]">{r.customer_mobile}</div> : null}
                </td>
                <td className="table-td">{r.salesperson}</td>
                <td className="table-td text-right tabular-nums">{r.item_count}</td>
                <td className="table-td text-right tabular-nums">{fmtINR(r.grand_total)}</td>
                <td className="table-td text-right tabular-nums">{moneyOrDash(r.cash)}</td>
                <td className="table-td text-right tabular-nums">{moneyOrDash(r.bank)}</td>
                <td className="table-td text-right tabular-nums">{moneyOrDash(r.upi)}</td>
                <td className="table-td text-right tabular-nums">{moneyOrDash(r.card)}</td>
                <td className="table-td text-right tabular-nums">{moneyOrDash(r.old_gold)}</td>
                <td className="table-td text-right tabular-nums">{moneyOrDash(r.old_silver)}</td>
                <td className="table-td text-right tabular-nums">{moneyOrDash(r.balance_due)}</td>
              </>
            )}
          />
        </div>
      ) : null}

      {section === "oldgold" ? (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-[#171717]">Old gold exchange on hidden bills</h3>
          <ReportTable
            empty="No old gold exchange on hidden bills in this period"
            headers={[
              { key: "date", label: "Date" },
              { key: "invoice_no", label: "Invoice" },
              { key: "customer", label: "Customer" },
              { key: "purity", label: "Purity" },
              { key: "weight", label: "Weight", right: true },
              { key: "rate", label: "Rate/g", right: true },
              { key: "value", label: "Value", right: true },
            ]}
            rows={oldGold.bills || []}
            render={(r) => (
              <>
                <td className="table-td">{fmtDay(r.date)}</td>
                <td className="table-td font-medium">{r.invoice_no}</td>
                <td className="table-td">{r.customer_name}</td>
                <td className="table-td">{r.purity || "—"}</td>
                <td className="table-td text-right tabular-nums">{fmtWeight(r.weight_g)}</td>
                <td className="table-td text-right tabular-nums">{Number(r.rate) > 0 ? fmtINR(r.rate) : "—"}</td>
                <td className="table-td text-right tabular-nums">{fmtINR(r.value)}</td>
              </>
            )}
          />
        </div>
      ) : null}

      {section === "oldsilver" ? (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-[#171717]">Old silver exchange on hidden bills</h3>
          <ReportTable
            empty="No old silver exchange on hidden bills in this period"
            headers={[
              { key: "date", label: "Date" },
              { key: "invoice_no", label: "Invoice" },
              { key: "customer", label: "Customer" },
              { key: "purity", label: "Purity" },
              { key: "weight", label: "Weight", right: true },
              { key: "rate", label: "Rate/g", right: true },
              { key: "value", label: "Value", right: true },
            ]}
            rows={oldSilver.bills || []}
            render={(r) => (
              <>
                <td className="table-td">{fmtDay(r.date)}</td>
                <td className="table-td font-medium">{r.invoice_no}</td>
                <td className="table-td">{r.customer_name}</td>
                <td className="table-td">{r.purity || "—"}</td>
                <td className="table-td text-right tabular-nums">{fmtWeight(r.weight_g)}</td>
                <td className="table-td text-right tabular-nums">{Number(r.rate) > 0 ? fmtINR(r.rate) : "—"}</td>
                <td className="table-td text-right tabular-nums">{fmtINR(r.value)}</td>
              </>
            )}
          />
        </div>
      ) : null}

      {section === "items" ? (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-[#171717]">Items sold on hidden bills</h3>
          <ReportTable
            empty="No hidden items in this period"
            headers={[
              { key: "date", label: "Date" },
              { key: "invoice_no", label: "Invoice" },
              { key: "tag", label: "Tag" },
              { key: "name", label: "Item" },
              { key: "metal", label: "Metal" },
              { key: "qty", label: "Qty", right: true },
              { key: "wt", label: "Net wt", right: true },
              { key: "amt", label: "Amount", right: true },
            ]}
            rows={items}
            render={(r) => (
              <>
                <td className="table-td">{fmtDay(r.date)}</td>
                <td className="table-td">{r.invoice_no}</td>
                <td className="table-td">{r.tag_number || "—"}</td>
                <td className="table-td">{r.name}</td>
                <td className="table-td">{r.metal}</td>
                <td className="table-td text-right tabular-nums">{r.quantity}</td>
                <td className="table-td text-right tabular-nums">{fmtWeight(r.net_weight)}</td>
                <td className="table-td text-right tabular-nums">{fmtINR(r.amount)}</td>
              </>
            )}
          />
        </div>
      ) : null}

      {section === "people" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#171717]">By employee</h3>
            <ReportTable
              empty="No hidden staff sales"
              headers={[
                { key: "name", label: "Employee" },
                { key: "bills", label: "Bills", right: true },
                { key: "sales", label: "Sales", right: true },
              ]}
              rows={data?.by_employee || []}
              render={(r) => (
                <>
                  <td className="table-td">{r.name}</td>
                  <td className="table-td text-right tabular-nums">{r.invoice_count}</td>
                  <td className="table-td text-right tabular-nums">{fmtINR(r.sales)}</td>
                </>
              )}
            />
          </div>
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#171717]">By customer</h3>
            <ReportTable
              empty="No hidden customer sales"
              headers={[
                { key: "name", label: "Customer" },
                { key: "bills", label: "Bills", right: true },
                { key: "sales", label: "Sales", right: true },
              ]}
              rows={data?.by_customer || []}
              render={(r) => (
                <>
                  <td className="table-td">
                    {r.name}
                    {r.mobile ? <div className="text-[11px] text-[#737373]">{r.mobile}</div> : null}
                  </td>
                  <td className="table-td text-right tabular-nums">{r.invoice_count}</td>
                  <td className="table-td text-right tabular-nums">{fmtINR(r.sales)}</td>
                </>
              )}
            />
          </div>
        </div>
      ) : null}

      {section === "mix" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#171717]">By category</h3>
            <ReportTable
              empty="No category split"
              headers={[
                { key: "name", label: "Category" },
                { key: "qty", label: "Qty", right: true },
                { key: "sales", label: "Sales", right: true },
              ]}
              rows={data?.by_category || []}
              render={(r) => (
                <>
                  <td className="table-td">{r.name}</td>
                  <td className="table-td text-right tabular-nums">{r.qty}</td>
                  <td className="table-td text-right tabular-nums">{fmtINR(r.sales)}</td>
                </>
              )}
            />
          </div>
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#171717]">By metal</h3>
            <ReportTable
              empty="No metal split"
              headers={[
                { key: "name", label: "Metal" },
                { key: "wt", label: "Net wt", right: true },
                { key: "sales", label: "Sales", right: true },
              ]}
              rows={data?.by_metal || []}
              render={(r) => (
                <>
                  <td className="table-td">{r.name}</td>
                  <td className="table-td text-right tabular-nums">{fmtWeight(r.weight)}</td>
                  <td className="table-td text-right tabular-nums">{fmtINR(r.sales)}</td>
                </>
              )}
            />
          </div>
          <div className="card p-4 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-[#171717]">Day-wise hidden sales</h3>
            <ReportTable
              empty="No daily movement"
              headers={[
                { key: "name", label: "Date" },
                { key: "bills", label: "Bills", right: true },
                { key: "sales", label: "Sales", right: true },
              ]}
              rows={data?.daily || []}
              render={(r) => (
                <>
                  <td className="table-td">{fmtDay(r.name)}</td>
                  <td className="table-td text-right tabular-nums">{r.invoice_count}</td>
                  <td className="table-td text-right tabular-nums">{fmtINR(r.sales)}</td>
                </>
              )}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HiddenOldGoldSummary({
  oldGold,
  loading,
  title = "Old gold exchange",
  blurb = "Gold taken on hidden POS bills in this period — weight, purity and exchange value. This never mixes into Jewellery reports while hidden bills are locked.",
  tone = "gold",
}) {
  const byPurity = (oldGold?.by_purity || []).filter((x) => Number(x.weight_g) > 0);
  const valueWrap = tone === "silver" ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50";
  const valueText = tone === "silver" ? "text-slate-800" : "text-amber-900";
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-[#171717]">{title}</h3>
      <p className="mb-3 text-[11px] text-[#737373]">{blurb}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className={`rounded-xl border p-3.5 shadow-sm ${valueWrap}`}>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">Exchange value</div>
          <div className={`mt-1 text-lg font-semibold tabular-nums ${valueText}`}>
            {loading ? "…" : fmtINR(oldGold?.value)}
          </div>
        </div>
        <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-3.5 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">Exchange bills</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-[#171717]">
            {loading ? "…" : String(oldGold?.bill_count || 0)}
          </div>
        </div>
        <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-3.5 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">Weight by purity</div>
          {loading ? (
            <div className="mt-1 text-lg font-semibold text-[#171717]">…</div>
          ) : byPurity.length === 0 ? (
            <div className="mt-1 text-lg font-semibold tabular-nums text-[#171717]">0.000 g</div>
          ) : (
            <div className="mt-1.5 space-y-0.5">
              {byPurity.map((x) => (
                <div key={x.purity} className="flex items-baseline justify-between gap-2 text-[13px] tabular-nums">
                  <span className="font-medium text-[#525252]">{x.purity}</span>
                  <span className="font-semibold text-[#0A0A0A]">{fmtWeight(x.weight_g)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon }) {
  return (
    <div className="card !rounded-xl !border-[#D8D2C6] !bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]">
      <div className="flex items-start justify-between">
        <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#737373]">{label}</div>
        {Icon ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#D8D2C6] bg-[#F1F5F1]">
            <Icon size={14} strokeWidth={1.5} className="text-[#315C4A]" />
          </div>
        ) : null}
      </div>
      <div className="mt-4 font-display text-[22px] font-semibold leading-none tracking-tight text-[#0A0A0A] tabular-nums">
        {value}
      </div>
    </div>
  );
}

function ReportTable({ headers, rows, render, empty }) {
  if (!rows?.length) {
    return (
      <div className="rounded-xl border border-dashed border-[#E5E7EB] py-10 text-center text-sm text-[#737373]">
        {empty}
      </div>
    );
  }
  return (
    <div className="table-shell overflow-x-auto !rounded-xl !border-[#D8D2C6] shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
      <table className="w-full min-w-[700px]">
        <thead>
          <tr className="table-head-row">
            {headers.map((h) => (
              <th key={h.key} className={`table-th ${h.right ? "text-right" : ""}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || r.invoice_no || r.name || i} className="table-row">
              {render(r)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
