import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarDays,
  CreditCard,
  Landmark,
  Loader2,
  Smartphone,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import MoneyInput from "@/components/ui/MoneyInput";
import api, { formatApiError } from "@/lib/api";
import { parseMoneyInput } from "@/lib/format";
import { useBusinessDate } from "@/context/BusinessDateContext";
import useConfirm from "@/hooks/useConfirm";
import { AccountsTable, fmtDate, fmtINR, today } from "./accountsShared";

const POCKETS = [
  { id: "cash", label: "Cash", icon: Wallet, theme: "emerald" },
  { id: "bank", label: "Bank", icon: Landmark, theme: "sky" },
  { id: "upi", label: "UPI", icon: Smartphone, theme: "violet" },
  { id: "card", label: "Card", icon: CreditCard, theme: "amber" },
];

const THEME = {
  emerald: {
    wrap: "border-emerald-200 bg-emerald-50",
    icon: "bg-emerald-100 text-emerald-700",
    text: "text-emerald-800",
  },
  sky: {
    wrap: "border-sky-200 bg-sky-50",
    icon: "bg-sky-100 text-sky-700",
    text: "text-sky-800",
  },
  violet: {
    wrap: "border-violet-200 bg-violet-50",
    icon: "bg-violet-100 text-violet-700",
    text: "text-violet-800",
  },
  amber: {
    wrap: "border-amber-200 bg-amber-50",
    icon: "bg-amber-100 text-amber-800",
    text: "text-amber-900",
  },
};

function pocketMeta(id) {
  return POCKETS.find((p) => p.id === id) || POCKETS[0];
}

function pocketLabel(id) {
  return pocketMeta(id).label;
}

function PocketChoice({ pocket, selected, balance, onSelect, disabled }) {
  const Icon = pocket.icon;
  const theme = THEME[pocket.theme];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(pocket.id)}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
        selected
          ? `${theme.wrap} shadow-sm ring-2 ring-[#B49042]/25`
          : "border-[#EADFBF] bg-white hover:border-[#D8C89F] hover:bg-[#FDFBF7]"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${theme.icon}`}>
        <Icon size={15} strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-[#171717]">{pocket.label}</span>
        <span className={`block text-[11px] tabular-nums ${theme.text}`}>{fmtINR(balance)}</span>
      </span>
    </button>
  );
}

function SideCard({ tone, title, pocketId, pockets, onPick, lockedId }) {
  const meta = pocketMeta(pocketId);
  const Icon = meta.icon;
  const theme = THEME[meta.theme];
  const balance = Number(pockets?.[pocketId]) || 0;
  const frame =
    tone === "from"
      ? "border-rose-200/80 bg-gradient-to-br from-rose-50/80 to-white"
      : "border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 to-white";

  return (
    <div className={`flex-1 rounded-2xl border p-4 shadow-sm ${frame}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
            tone === "from" ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {title}
        </span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${theme.icon}`}>
          <Icon size={15} />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {POCKETS.map((p) => (
          <PocketChoice
            key={p.id}
            pocket={p}
            selected={p.id === pocketId}
            balance={Number(pockets?.[p.id]) || 0}
            disabled={p.id === lockedId}
            onSelect={onPick}
          />
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-white/80 bg-white/70 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-[#737373]">Available</div>
        <div className={`text-lg font-semibold tabular-nums ${theme.text}`}>{fmtINR(balance)}</div>
      </div>
    </div>
  );
}

export default function TransferPaymentsTab() {
  const { date: activeBillingDate } = useBusinessDate();
  const [confirm, confirmModal] = useConfirm();
  const [date, setDate] = useState(() => activeBillingDate || today());
  const [fromMode, setFromMode] = useState("cash");
  const [toMode, setToMode] = useState("bank");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [pockets, setPockets] = useState({ cash: 0, bank: 0, upi: 0, card: 0 });
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const userTouchedDate = useRef(false);

  useEffect(() => {
    if (!userTouchedDate.current && activeBillingDate) setDate(activeBillingDate);
  }, [activeBillingDate]);

  const load = useCallback(async (asOf) => {
    if (!asOf) return;
    setLoading(true);
    try {
      const { data } = await api.get("/accounts/transfers", { params: { date: asOf } });
      setPockets(data?.pockets || { cash: 0, bank: 0, upi: 0, card: 0 });
      setTransfers(data?.transfers || []);
    } catch (err) {
      toast.error(formatApiError(err) || "Could not load balances");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [load, date]);

  const amt = parseMoneyInput(amount, 0) || 0;
  const fromBal = Number(pockets[fromMode]) || 0;
  const toBal = Number(pockets[toMode]) || 0;
  const samePocket = fromMode === toMode;
  const overAvailable = amt > 0 && amt - fromBal > 0.009;
  const canSubmit = amt > 0 && !samePocket && !overAvailable && !saving;

  const afterFrom = toMoneySafe(fromBal - amt);
  const afterTo = toMoneySafe(toBal + amt);

  const swapSides = () => {
    setFromMode(toMode);
    setToMode(fromMode);
  };

  const fillMax = () => {
    if (fromBal > 0) setAmount(String(fromBal.toFixed(2)));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) {
      if (samePocket) toast.error("Pick two different pockets");
      else if (!(amt > 0)) toast.error("Enter an amount");
      else if (overAvailable) toast.error(`Not enough ${pocketLabel(fromMode)} available`);
      return;
    }
    const ok = await confirm(
      `Move ${fmtINR(amt)} from ${pocketLabel(fromMode)} to ${pocketLabel(toMode)} on ${fmtDay(date)}?\n\nThis is not income or expense — it only shifts which pocket holds the money.`,
      {
        title: "Transfer payment",
        confirmLabel: "Transfer",
        danger: false,
      },
    );
    if (!ok) return;
    setSaving(true);
    try {
      const { data } = await api.post("/accounts/transfers", {
        from_mode: fromMode,
        to_mode: toMode,
        amount: amt,
        date,
        notes: notes.trim() || undefined,
      });
      toast.success(`${fmtINR(amt)} moved ${pocketLabel(fromMode)} → ${pocketLabel(toMode)}`);
      setAmount("");
      setNotes("");
      if (data?.pockets) setPockets(data.pockets);
      await load(date);
    } catch (err) {
      toast.error(formatApiError(err) || "Transfer failed");
    } finally {
      setSaving(false);
    }
  };

  const recentRows = useMemo(
    () =>
      (transfers || []).map((t) => ({
        ...t,
        path: `${t.from_label || pocketLabel(t.from_mode)} → ${t.to_label || pocketLabel(t.to_mode)}`,
      })),
    [transfers],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {POCKETS.map((p) => {
          const theme = THEME[p.theme];
          const Icon = p.icon;
          return (
            <div key={p.id} className={`rounded-xl border p-3.5 shadow-sm ${theme.wrap}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[#737373]">
                <Icon size={13} className={theme.text} />
                {p.label}
              </div>
              <div className={`mt-1 text-lg font-semibold tabular-nums ${theme.text}`}>
                {loading ? "…" : fmtINR(pockets[p.id])}
              </div>
            </div>
          );
        })}
      </div>
      <p className="-mt-2 text-[11px] text-[#737373]">
        Normal billing only. Hidden-bill cash, bank, UPI and card stay out of these pockets.
      </p>

      <form
        onSubmit={onSubmit}
        className="overflow-hidden rounded-2xl border border-[#EADFBF] bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EADFBF] bg-[#FDFBF7] px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold text-[#171717]">Move money between pockets</h3>
            <p className="text-[11px] text-[#737373]">
              Moves normal billing money only. Hidden bills never go through this transfer.
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-[#EADFBF] bg-white px-3 py-2">
            <CalendarDays size={15} className="text-[#B49042]" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">Date</span>
            <input
              type="date"
              className="border-0 bg-transparent p-0 text-sm font-semibold text-[#171717] outline-none"
              value={date}
              onChange={(e) => {
                userTouchedDate.current = true;
                setDate(e.target.value);
              }}
              required
            />
          </label>
        </div>

        <div className="p-5">
          <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
            <SideCard
              tone="from"
              title="From"
              pocketId={fromMode}
              pockets={pockets}
              onPick={setFromMode}
              lockedId={toMode}
            />

            <div className="flex shrink-0 flex-col items-center justify-center py-1">
              <button
                type="button"
                onClick={swapSides}
                title="Swap From and To"
                className="flex h-12 w-12 items-center justify-center rounded-full border border-[#E9D293] bg-[#B49042] text-white shadow-md transition hover:bg-[#9A762E]"
              >
                <ArrowRight className="hidden lg:block" size={20} />
                <ArrowLeftRight className="lg:hidden" size={18} />
              </button>
              <span className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-[#B49042]">
                Swap
              </span>
            </div>

            <SideCard
              tone="to"
              title="To"
              pocketId={toMode}
              pockets={pockets}
              onPick={setToMode}
              lockedId={fromMode}
            />
          </div>

          {amt > 0 && !samePocket ? (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <PreviewChip
                label={`After · ${pocketLabel(fromMode)}`}
                value={afterFrom}
                down
              />
              <div className="flex items-center justify-center gap-2 rounded-xl border border-[#EADFBF] bg-[#FDFBF7] px-3 py-2 text-[12px] font-medium text-[#8A6A2D]">
                <span>{fmtINR(amt)}</span>
                <ArrowRight size={14} />
                <span>
                  {pocketLabel(fromMode)} → {pocketLabel(toMode)}
                </span>
              </div>
              <PreviewChip
                label={`After · ${pocketLabel(toMode)}`}
                value={afterTo}
                down={false}
              />
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-[#737373]">
                  Amount <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={fillMax}
                  disabled={!(fromBal > 0)}
                  className="text-[11px] font-medium text-[#B49042] hover:underline disabled:text-[#A3A3A3]"
                >
                  Use available {fmtINR(fromBal)}
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 focus-within:border-[#B49042] focus-within:ring-2 focus-within:ring-[#B49042]/10">
                <span className="text-lg font-medium text-[#A3A3A3]">₹</span>
                <MoneyInput
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-lg font-semibold tabular-nums text-[#171717] outline-none"
                  value={amount}
                  onValueChange={(raw) => setAmount(raw)}
                  placeholder="0.00"
                />
              </div>
              {overAvailable ? (
                <p className="mt-1.5 text-[12px] text-red-600">
                  Not enough {pocketLabel(fromMode)}. Available {fmtINR(fromBal)}.
                </p>
              ) : samePocket ? (
                <p className="mt-1.5 text-[12px] text-amber-700">Choose a different To pocket.</p>
              ) : (
                <p className="mt-1.5 text-[11px] text-[#A3A3A3]">
                  Does not add or remove money — only moves it from {pocketLabel(fromMode)} to {pocketLabel(toMode)}.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#737373]">Note (optional)</label>
              <input
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={160}
                placeholder="e.g. Cash deposited in bank"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-[#B49042] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#9A762E] disabled:cursor-not-allowed disabled:bg-[#D4D4D4]"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              {saving
                ? "Transferring…"
                : `Transfer ${amt > 0 ? fmtINR(amt) : ""} ${pocketLabel(fromMode)} → ${pocketLabel(toMode)}`.replace(
                    /\s+/g,
                    " ",
                  )}
            </button>
          </div>
        </div>
      </form>

      <div className="rounded-2xl border border-[#EADFBF] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#171717]">Recent transfers</h3>
          {loading ? <Loader2 size={14} className="animate-spin text-[#B49042]" /> : null}
        </div>
        <AccountsTable
          columns={[
            { key: "date", label: "Date", render: (r) => fmtDay(r.date) },
            { key: "path", label: "From → To" },
            { key: "amount", label: "Amount", render: (r) => fmtINR(r.amount) },
            { key: "notes", label: "Note", render: (r) => r.notes || "—" },
            { key: "id", label: "Ref" },
          ]}
          rows={recentRows}
          empty="No transfers yet"
        />
      </div>
      {confirmModal}
    </div>
  );
}

function toMoneySafe(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function fmtDay(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return fmtDate(ymd);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function PreviewChip({ label, value, down }) {
  return (
    <div className="rounded-xl border border-[#EADFBF] bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[#737373]">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${down ? "text-rose-700" : "text-emerald-700"}`}>
        {fmtINR(value)}
      </div>
    </div>
  );
}
