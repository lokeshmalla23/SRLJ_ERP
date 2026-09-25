import { useCallback, useEffect, useState } from "react";
import { Coins, CreditCard, EyeOff, Landmark, Loader2, Smartphone, Wallet } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { fmtWeight } from "@/lib/format";
import {
  AccountsFilterBar,
  AccountsTable,
  fmtDate,
  fmtINR,
  useAccountsDateRange,
} from "./accountsShared";

const POCKETS = [
  { id: "cash", label: "Cash", icon: Wallet, wrap: "border-[#CBDAD0] bg-[#F1F6F2]", text: "text-[#315C4A]" },
  { id: "bank", label: "Bank", icon: Landmark, wrap: "border-[#D8D2C6] bg-[#F4F2ED]", text: "text-[#59635D]" },
  { id: "upi", label: "UPI", icon: Smartphone, wrap: "border-[#D8C28C] bg-[#FBF6E9]", text: "text-[#765A20]" },
  { id: "card", label: "Card", icon: CreditCard, wrap: "border-[#CDD2CF] bg-[#F1F3F2]", text: "text-[#5F6863]" },
];

export default function HiddenDataTab() {
  const range = useAccountsDateRange("this_month");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await api.get("/accounts/hidden-data", {
        params: { from: range.from, to: range.to, include_hidden: 1 },
      });
      setData(payload);
    } catch (err) {
      setData(null);
      toast.error(formatApiError(err) || "Could not load hidden data");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const pockets = data?.pockets || { cash: 0, bank: 0, upi: 0, card: 0, total: 0 };
  const receipts = data?.receipts || { cash: 0, bank: 0, upi: 0, card: 0, old_gold: 0, money: 0 };
  const totals = data?.totals || { invoices: 0, sales: 0, collections: 0, outstanding: 0 };
  const oldGold = data?.old_gold || { bill_count: 0, weight_g: 0, value: 0, by_purity: [], bills: [] };
  const oldSilver = data?.old_silver || { bill_count: 0, weight_g: 0, value: 0, by_purity: [], bills: [] };
  const byPurity = (oldGold.by_purity || []).filter((x) => Number(x.weight_g) > 0);
  const silverByPurity = (oldSilver.by_purity || []).filter((x) => Number(x.weight_g) > 0);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#DDD6FE] bg-[#F7F5FC] px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <EyeOff size={15} />
          </span>
          <div>
            <p className="text-sm font-semibold text-violet-950">Hidden billing only</p>
            <p className="mt-0.5 text-[12px] leading-5 text-violet-800">
              These figures never mix into Transfer payments. Lock hidden bills again to hide this tab.
            </p>
          </div>
        </div>
      </div>

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

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[#171717]">Hidden money in pockets</h3>
        <p className="mb-3 text-[11px] text-[#737373]">
          Cash / Bank / UPI / Card currently sitting from hidden bills, as of {data?.to || range.to}.
        </p>
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
                  {loading && !data ? "…" : fmtINR(pockets[p.id])}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-[#525252]">
          Hidden liquid total{" "}
          <span className="font-semibold tabular-nums text-[#171717]">{fmtINR(pockets.total)}</span>
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[#171717]">Hidden payments received</h3>
        <p className="mb-3 text-[11px] text-[#737373]">
          Tenders on hidden invoices in this period — Cash, Bank, UPI, Card, Old gold and Old silver separately.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {POCKETS.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.id} className="rounded-xl border border-[#D8D2C6] bg-white p-3.5 shadow-sm">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[#737373]">
                  <Icon size={13} className={p.text} />
                  {p.label} received
                </div>
                <div className={`mt-1 text-lg font-semibold tabular-nums ${p.text}`}>
                  {loading && !data ? "…" : fmtINR(receipts[p.id])}
                </div>
              </div>
            );
          })}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 shadow-sm">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[#737373]">
              <Coins size={13} className="text-amber-800" />
              Old gold received
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-amber-900">
              {loading && !data ? "…" : fmtINR(oldGold.value || receipts.old_gold)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 shadow-sm">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[#737373]">
              <Coins size={13} className="text-slate-700" />
              Old silver received
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-800">
              {loading && !data ? "…" : fmtINR(oldSilver.value || receipts.old_silver)}
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniStat label="Hidden invoices" value={String(totals.invoices || 0)} />
          <MiniStat label="Hidden sales" value={fmtINR(totals.sales)} />
          <MiniStat label="Money collected" value={fmtINR(totals.collections)} />
          <MiniStat label="Still outstanding" value={fmtINR(totals.outstanding)} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[#171717]">Old gold exchange</h3>
        <p className="mb-3 text-[11px] text-[#737373]">
          Gold taken on hidden bills in this period — not cash / bank / UPI / card. Lock hidden bills again to keep this off other Accounts tabs.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 shadow-sm">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">Exchange value</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-amber-900">
              {loading && !data ? "…" : fmtINR(oldGold.value)}
            </div>
          </div>
          <MiniStat label="Exchange bills" value={String(oldGold.bill_count || 0)} />
          <div className="rounded-xl border border-[#D8D2C6] bg-white p-3.5 shadow-sm">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">Weight by purity</div>
            {loading && !data ? (
              <div className="mt-1 text-sm font-semibold text-[#171717]">…</div>
            ) : byPurity.length === 0 ? (
              <div className="mt-1 text-sm font-semibold tabular-nums text-[#171717]">0.000 g</div>
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
        <div className="mt-3 rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-4 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
          <h4 className="mb-3 text-sm font-semibold text-[#171717]">Exchange bills</h4>
          <AccountsTable
            columns={[
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "invoice_no", label: "Invoice" },
              { key: "customer_name", label: "Customer" },
              { key: "purity", label: "Purity" },
              { key: "weight_g", label: "Weight", render: (r) => fmtWeight(r.weight_g) },
              { key: "rate", label: "Rate/g", render: (r) => (Number(r.rate) > 0 ? fmtINR(r.rate) : "—") },
              { key: "value", label: "Value", render: (r) => fmtINR(r.value) },
            ]}
            rows={oldGold.bills || []}
            empty="No old gold exchange on hidden bills in this period"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[#171717]">Old silver exchange</h3>
        <p className="mb-3 text-[11px] text-[#737373]">
          Silver taken on hidden bills in this period — not cash / bank / UPI / card. Lock hidden bills again to keep this off other Accounts tabs.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 shadow-sm">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">Exchange value</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-800">
              {loading && !data ? "…" : fmtINR(oldSilver.value)}
            </div>
          </div>
          <MiniStat label="Exchange bills" value={String(oldSilver.bill_count || 0)} />
          <div className="rounded-xl border border-[#D8D2C6] bg-white p-3.5 shadow-sm">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">Weight by purity</div>
            {loading && !data ? (
              <div className="mt-1 text-sm font-semibold text-[#171717]">…</div>
            ) : silverByPurity.length === 0 ? (
              <div className="mt-1 text-sm font-semibold tabular-nums text-[#171717]">0.000 g</div>
            ) : (
              <div className="mt-1.5 space-y-0.5">
                {silverByPurity.map((x) => (
                  <div key={x.purity} className="flex items-baseline justify-between gap-2 text-[13px] tabular-nums">
                    <span className="font-medium text-[#525252]">{x.purity}</span>
                    <span className="font-semibold text-[#0A0A0A]">{fmtWeight(x.weight_g)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-4 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
          <h4 className="mb-3 text-sm font-semibold text-[#171717]">Exchange bills</h4>
          <AccountsTable
            columns={[
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "invoice_no", label: "Invoice" },
              { key: "customer_name", label: "Customer" },
              { key: "purity", label: "Purity" },
              { key: "weight_g", label: "Weight", render: (r) => fmtWeight(r.weight_g) },
              { key: "rate", label: "Rate/g", render: (r) => (Number(r.rate) > 0 ? fmtINR(r.rate) : "—") },
              { key: "value", label: "Value", render: (r) => fmtINR(r.value) },
            ]}
            rows={oldSilver.bills || []}
            empty="No old silver exchange on hidden bills in this period"
          />
        </div>
      </div>

      <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-4 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#171717]">Hidden invoices</h3>
          {loading ? <Loader2 size={14} className="animate-spin text-violet-600" /> : null}
        </div>
        <AccountsTable
          columns={[
            { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
            { key: "invoice_no", label: "Invoice" },
            { key: "customer_name", label: "Customer" },
            { key: "grand_total", label: "Total", render: (r) => fmtINR(r.grand_total) },
            { key: "cash", label: "Cash", render: (r) => moneyOrDash(r.cash) },
            { key: "bank", label: "Bank", render: (r) => moneyOrDash(r.bank) },
            { key: "upi", label: "UPI", render: (r) => moneyOrDash(r.upi) },
            { key: "card", label: "Card", render: (r) => moneyOrDash(r.card) },
            { key: "old_gold", label: "Old Gold", render: (r) => moneyOrDash(r.old_gold) },
            { key: "old_silver", label: "Old Silver", render: (r) => moneyOrDash(r.old_silver) },
            { key: "balance_due", label: "Due", render: (r) => moneyOrDash(r.balance_due) },
          ]}
          rows={data?.rows || []}
          empty="No hidden invoices in this period"
        />
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] px-3.5 py-3 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-[#171717]">{value}</div>
    </div>
  );
}

function moneyOrDash(n) {
  return Number(n) > 0 ? fmtINR(n) : "—";
}
