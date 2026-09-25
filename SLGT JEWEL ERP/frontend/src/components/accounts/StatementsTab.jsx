import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { SimpleBarChart, SimplePieChart } from "@/components/charts/SimpleCharts";
import MoneyInput from "@/components/ui/MoneyInput";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import { fmtINR, parseMoneyInput } from "@/lib/format";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function downloadCsv(filename, rows) {
  const blob = new Blob([rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StatementsTab() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [view, setView] = useState("tb"); // tb | pnl | bs | voucher
  const [tb, setTb] = useState(null);
  const [pnl, setPnl] = useState(null);
  const [bs, setBs] = useState(null);
  const [coa, setCoa] = useState([]);
  const [journals, setJournals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [voucher, setVoucher] = useState({
    voucher_type: "journal",
    memo: "",
    lines: [
      { account_code: "5100", debit: "", credit: "" },
      { account_code: "1000", debit: "", credit: "" },
    ],
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tbRes, pnlRes, bsRes, coaRes, jRes] = await Promise.all([
        api.get("/accounts/trial-balance", { params: { from, to } }),
        api.get("/accounts/pnl", { params: { from, to } }),
        api.get("/accounts/balance-sheet", { params: { to } }),
        api.get("/masters/coa"),
        api.get("/masters/journals", { params: { limit: 30 } }),
      ]);
      setTb(tbRes.data);
      setPnl(pnlRes.data);
      setBs(bsRes.data);
      setCoa(coaRes.data?.data || []);
      setJournals(jRes.data?.data || []);
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to load statements");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const pnlBars = useMemo(
    () => [
      { name: "Income", value: pnl?.totals?.income || 0 },
      { name: "Expense", value: pnl?.totals?.expense || 0 },
      { name: "Net", value: pnl?.totals?.net_profit || 0 },
    ],
    [pnl],
  );

  const bsPie = useMemo(
    () => [
      { name: "Assets", value: Math.max(0, bs?.totals?.assets || 0) },
      { name: "Liabilities", value: Math.max(0, bs?.totals?.liabilities || 0) },
      { name: "Equity", value: Math.max(0, bs?.totals?.equity || 0) },
    ],
    [bs],
  );

  const postVoucher = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/accounts/vouchers", {
        voucher_type: voucher.voucher_type,
        memo: voucher.memo,
        entry_date: to,
        lines: voucher.lines.map((l) => ({
          accountCode: l.account_code,
          debit: parseMoneyInput(l.debit),
          credit: parseMoneyInput(l.credit),
        })),
      });
      toast.success("Voucher posted");
      load();
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to post voucher");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !tb) return <PageLoadingBadge />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#D8D2C6] bg-[#FBF8F1] p-3 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
        <input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        {[
          ["tb", "Trial Balance"],
          ["pnl", "P&L"],
          ["bs", "Balance Sheet"],
          ["voucher", "Vouchers"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${view === id ? "border-[#315C4A] bg-[#315C4A] text-white shadow-sm" : "border-[#D8D2C6] bg-[#FFFDF9] text-[#59635D] hover:border-[#9EB2A6] hover:bg-[#F1F5F1]"}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "tb" && (
        <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)] overflow-hidden" style={{ borderColor: "#D8D2C6" }}>
          <div className="px-4 py-3 flex justify-between items-center border-b" style={{ borderColor: "#D8D2C6" }}>
            <span className="text-sm font-medium">Trial Balance</span>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => {
                const lines = ["Code,Name,Type,Debit,Credit"];
                for (const r of tb?.rows || []) {
                  lines.push(`${r.code},${r.name},${r.type},${r.debit},${r.credit}`);
                }
                downloadCsv(`trial-balance-${from}-${to}.csv`, lines.join("\n"));
              }}
            >
              CSV
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F1EEE7] text-left text-[12px] text-[#737373]">
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {(tb?.rows || []).map((r) => (
                <tr key={r.code} className="border-t" style={{ borderColor: "#D8D2C6" }}>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.debit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold" style={{ borderColor: "#D8D2C6" }}>
                <td className="px-3 py-2" colSpan={2}>Totals</td>
                <td className="px-3 py-2 text-right">{fmtINR(tb?.totals?.debit)}</td>
                <td className="px-3 py-2 text-right">{fmtINR(tb?.totals?.credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {view === "pnl" && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)] p-4" style={{ borderColor: "#D8D2C6" }}>
            <SimpleBarChart data={pnlBars} bars={[{ key: "value", name: "Amount", color: "#3D6B5B" }]} />
            <div className="mt-3 text-sm">
              Net profit: <strong style={{ color: (pnl?.totals?.net_profit || 0) >= 0 ? "#16A34A" : "#DC2626" }}>{fmtINR(pnl?.totals?.net_profit)}</strong>
            </div>
          </div>
          <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)] overflow-hidden" style={{ borderColor: "#D8D2C6" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F1EEE7] text-left text-[12px] text-[#737373]">
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {[...(pnl?.income || []).map((r) => ({ ...r, side: "Income" })), ...(pnl?.expense || []).map((r) => ({ ...r, side: "Expense" }))].map((r) => (
                  <tr key={`${r.side}-${r.code}`} className="border-t" style={{ borderColor: "#D8D2C6" }}>
                    <td className="px-3 py-2">{r.name} <span className="text-[11px] text-[#a3a3a3]">({r.side})</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "bs" && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)] p-4" style={{ borderColor: "#D8D2C6" }}>
            <SimplePieChart data={bsPie} />
            <div className="text-xs text-[#737373] mt-2">As of {bs?.as_of}</div>
          </div>
          <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)] p-4 space-y-3 text-sm" style={{ borderColor: "#D8D2C6" }}>
            <div className="flex justify-between"><span>Assets</span><strong>{fmtINR(bs?.totals?.assets)}</strong></div>
            <div className="flex justify-between"><span>Liabilities</span><strong>{fmtINR(bs?.totals?.liabilities)}</strong></div>
            <div className="flex justify-between"><span>Equity</span><strong>{fmtINR(bs?.totals?.equity)}</strong></div>
            <div className="flex justify-between border-t pt-2" style={{ borderColor: "#D8D2C6" }}>
              <span>Liabilities + Equity</span>
              <strong>{fmtINR(bs?.totals?.liabilities_and_equity)}</strong>
            </div>
          </div>
        </div>
      )}

      {view === "voucher" && (
        <div className="space-y-4">
          <form onSubmit={postVoucher} className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)] p-4 space-y-3" style={{ borderColor: "#D8D2C6" }}>
            <div className="flex gap-2 flex-wrap">
              <select className="input w-40" value={voucher.voucher_type} onChange={(e) => setVoucher((v) => ({ ...v, voucher_type: e.target.value }))}>
                <option value="journal">Journal</option>
                <option value="payment">Payment</option>
                <option value="receipt">Receipt</option>
                <option value="contra">Contra</option>
              </select>
              <input className="input flex-1 min-w-[180px]" placeholder="Memo" value={voucher.memo} onChange={(e) => setVoucher((v) => ({ ...v, memo: e.target.value }))} />
            </div>
            {voucher.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-3 gap-2">
                <select
                  className="input"
                  value={line.account_code}
                  onChange={(e) => {
                    const lines = [...voucher.lines];
                    lines[idx] = { ...lines[idx], account_code: e.target.value };
                    setVoucher((v) => ({ ...v, lines }));
                  }}
                >
                  {coa.map((a) => (
                    <option key={a.id} value={a.code}>{a.code} — {a.name}</option>
                  ))}
                </select>
                <MoneyInput
                  className="input"
                  min="0"
                  step="0.01"
                  placeholder="Debit"
                  value={line.debit}
                  onValueChange={(raw) => {
                    const lines = [...voucher.lines];
                    lines[idx] = { ...lines[idx], debit: raw };
                    setVoucher((v) => ({ ...v, lines }));
                  }}
                />
                <MoneyInput
                  className="input"
                  min="0"
                  step="0.01"
                  placeholder="Credit"
                  value={line.credit}
                  onValueChange={(raw) => {
                    const lines = [...voucher.lines];
                    lines[idx] = { ...lines[idx], credit: raw };
                    setVoucher((v) => ({ ...v, lines }));
                  }}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setVoucher((v) => ({
                  ...v,
                  lines: [...v.lines, { account_code: coa[0]?.code || "1000", debit: "", credit: "" }],
                }))}
              >
                <Plus size={12} className="inline mr-1" /> Line
              </button>
              <button type="submit" className="btn-primary text-sm" disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin inline" /> : null} Post voucher
              </button>
            </div>
          </form>

          <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)] overflow-hidden" style={{ borderColor: "#D8D2C6" }}>
            <div className="px-4 py-2 text-xs font-semibold uppercase text-[#737373] border-b" style={{ borderColor: "#D8D2C6" }}>Recent journals</div>
            <table className="w-full text-sm">
              <tbody>
                {journals.map((j) => (
                  <tr key={j.id} className="border-t" style={{ borderColor: "#D8D2C6" }}>
                    <td className="px-3 py-2 font-mono text-[12px]">{j.entry_date}</td>
                    <td className="px-3 py-2">{j.memo || j.voucher_type || "—"}</td>
                    <td className="px-3 py-2 text-[12px] text-[#737373]">{j.source_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
