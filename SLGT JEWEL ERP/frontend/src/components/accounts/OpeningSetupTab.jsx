import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Database,
  Landmark,
  Loader2,
  Lock,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import MoneyInput from "@/components/ui/MoneyInput";
import api, { formatApiError } from "@/lib/api";
import { parseMoneyInput } from "@/lib/format";
import { notifyBusinessDateChanged } from "@/context/BusinessDateContext";
import {
  ACCOUNTS_SETUP_COMPLETE_EVENT,
  getRememberedOpeningSetup,
  isAccountsSetupComplete,
  rememberOpeningSetup,
} from "@/lib/accountsSetup";
import { AccountsKpiCard, fmtINR, today } from "./accountsShared";

function StepHeading({ number, icon: Icon, title, description, optional = false }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F5EEDC] text-[#9A762E]">
        <Icon size={17} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#B49042]">
            Step {number}
          </span>
          {optional ? (
            <span className="rounded-full bg-[#F5F5F5] px-2 py-0.5 text-[10px] font-medium text-[#737373]">
              Optional
            </span>
          ) : null}
        </div>
        <h3 className="mt-0.5 text-[15px] font-semibold text-[#171717]">{title}</h3>
        {description ? <p className="mt-1 text-xs leading-5 text-[#737373]">{description}</p> : null}
      </div>
    </div>
  );
}

function MoneyField({ icon: Icon, label, hint, value, onChange, disabled, badge }) {
  return (
    <label
      className={`block rounded-xl border p-3.5 transition ${
        disabled
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-[#E5E7EB] bg-white hover:border-[#D8C89F] focus-within:border-[#B49042] focus-within:ring-2 focus-within:ring-[#B49042]/10"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium text-[#404040]">
          <Icon size={14} className="text-[#8A6A2D]" />
          {label}
        </span>
        {badge ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <Lock size={9} /> {badge}
          </span>
        ) : null}
      </span>
      <span className="mt-3 flex items-center gap-2">
        <span className="text-lg font-medium text-[#A3A3A3]">₹</span>
        <MoneyInput
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-lg font-semibold tabular-nums text-[#171717] outline-none placeholder:text-[#D4D4D4] disabled:text-emerald-800"
          value={value}
          onValueChange={(raw) => onChange(raw)}
          placeholder="0.00"
          disabled={disabled}
        />
      </span>
      <span className="mt-1 block text-[10px] text-[#A3A3A3]">{hint}</span>
    </label>
  );
}

function SetupStatusBadge({ complete }) {
  if (complete) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
        <CheckCircle2 size={12} /> Status: COMPLETED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
      Status: PENDING
    </span>
  );
}

function FinancialModeBadge({ live }) {
  if (live) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
        Financial Mode: LIVE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-700 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
      Financial Mode: PRE-ACCOUNTS / TEST
    </span>
  );
}

export default function OpeningSetupTab({ onComplete }) {
  const [status, setStatus] = useState(() => {
    const cached = getRememberedOpeningSetup();
    return cached && isAccountsSetupComplete(cached) ? cached : null;
  });
  const [loading, setLoading] = useState(() => !isAccountsSetupComplete(getRememberedOpeningSetup()));
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [cutoverDate, setCutoverDate] = useState(today());
  const [cash, setCash] = useState("");
  const [bank, setBank] = useState("");
  const [upi, setUpi] = useState("");
  const [card, setCard] = useState("");
  const [outputGst, setOutputGst] = useState("");
  const [inputGst, setInputGst] = useState("");

  const applyStatus = useCallback((data) => {
    if (!data) return data;
    rememberOpeningSetup(data);
    setStatus(data);
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/accounts/opening-setup");
      const remembered = getRememberedOpeningSetup();
      const resolved = isAccountsSetupComplete(data)
        ? data
        : (isAccountsSetupComplete(remembered) ? remembered : data);
      applyStatus(resolved);
      if (isAccountsSetupComplete(resolved)) {
        onComplete?.(resolved);
        return;
      }
      if (data?.recommended_cutover_date && !data?.cutover_date) {
        setCutoverDate(data.recommended_cutover_date);
      } else if (data?.cutover_date) {
        setCutoverDate(data.cutover_date);
      }
      if (data?.till_opening_cash > 0) {
        setCash(String(data.till_opening_cash));
      }
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [applyStatus, onComplete]);

  useEffect(() => {
    load();
  }, [load]);

  const auto = status?.snapshot || {};
  const liquidTotal = useMemo(
    () => parseMoneyInput(cash) + parseMoneyInput(bank) + parseMoneyInput(upi) + parseMoneyInput(card),
    [cash, bank, upi, card],
  );

  const save = async () => {
    if (!confirmed) {
      toast.error("Confirm the checklist before saving");
      return;
    }
    const payload = {
      cutover_date: cutoverDate,
      cash: parseMoneyInput(cash),
      bank: parseMoneyInput(bank),
      upi: parseMoneyInput(upi),
      card: parseMoneyInput(card),
      output_gst: parseMoneyInput(outputGst),
      input_gst: parseMoneyInput(inputGst),
    };
    if (payload.cash + payload.bank + payload.upi + payload.card <= 0) {
      toast.error("Enter at least one opening balance");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post("/accounts/opening-setup", payload);
      const after = data?.status || data;
      const complete = isAccountsSetupComplete(after);
      toast.success("Go-live setup complete — opening balances locked in ERP");
      if (complete) {
        applyStatus(after);
        window.dispatchEvent(
          new CustomEvent("realtime", {
            detail: {
              type: ACCOUNTS_SETUP_COMPLETE_EVENT,
              setup_complete: true,
              financial_mode: after?.financial_mode || "LIVE",
              accounts_setup_status: after?.accounts_setup_status || "COMPLETED",
              status: after,
            },
          }),
        );
        notifyBusinessDateChanged();
        onComplete?.(after);
      } else {
        window.dispatchEvent(
          new CustomEvent("realtime", { detail: { type: ACCOUNTS_SETUP_COMPLETE_EVENT } }),
        );
        notifyBusinessDateChanged();
        await load();
      }
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[#737373]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading setup…
      </div>
    );
  }

  if (status?.setup_complete) {
    const saved = status.opening_saved || {};
    return (
      <div className="min-h-full bg-[#F8F7F3] pb-8">
        <section className="relative overflow-hidden rounded-2xl bg-[#171A17] px-5 py-6 text-white shadow-sm sm:px-7">
          <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="relative">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SetupStatusBadge complete />
              <FinancialModeBadge live />
              <span className="text-xs text-white/55">Accounts Setup</span>
            </div>
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
              Opening books are locked
            </h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/65">
              {status.note
                || "Accounts Setup Completed. ERP is now in Live Accounting Mode."}
            </p>
            {status.accounts_go_live_at || status.completed_at ? (
              <p className="mt-2 text-[12px] text-white/45">
                Go-live {new Date(status.accounts_go_live_at || status.completed_at).toLocaleString("en-IN")}
              </p>
            ) : null}
          </div>
        </section>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AccountsKpiCard label="Opening cash" value={fmtINR(saved.cash)} />
          <AccountsKpiCard label="Opening bank" value={fmtINR(saved.bank)} />
          <AccountsKpiCard label="Opening UPI" value={fmtINR(saved.upi)} />
          <AccountsKpiCard label="Opening card" value={fmtINR(saved.card)} />
        </div>
      </div>
    );
  }

  const remaining = Array.isArray(status?.remaining_steps) ? status.remaining_steps : [];

  return (
    <div className="min-h-full bg-[#F8F7F3] pb-8">
      <section className="relative overflow-hidden rounded-2xl bg-[#171A17] px-5 py-6 text-white shadow-sm sm:px-7">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#B49042]/20 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SetupStatusBadge complete={false} />
              <FinancialModeBadge live={false} />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#B49042] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                <ShieldCheck size={12} /> One-time setup
              </span>
              <span className="text-xs text-white/55">Opening balances • ERP go-live</span>
            </div>
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
              Start your books with the right balance
            </h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/65">
              Accounts Setup is not completed. Financial transactions are currently in Test Mode.
              Set the exact balances your business has on the day you begin using the ERP. Inventory
              entered before go-live stays real.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/15"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh values
          </button>
        </div>
      </section>

      {remaining.length ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-950">
          <div className="font-semibold">Still to complete</div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12.5px] leading-5">
            {remaining.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_270px]">
        <main className="space-y-4">
          <section className="rounded-2xl border border-[#E7E2D6] bg-white p-5">
            <StepHeading
              number="01"
              icon={CalendarDays}
              title="Choose your accounting start date"
              description="Transactions before this date become opening balances. New ERP activity starts from this date."
            />
            <label className="mt-5 block max-w-sm">
              <span className="mb-1.5 block text-xs font-medium text-[#525252]">Cutover date</span>
              <input
                type="date"
                className="input w-full"
                value={cutoverDate}
                onChange={(e) => setCutoverDate(e.target.value)}
              />
              <span className="mt-1.5 block text-[11px] text-[#A3A3A3]">
                Recommended: {status?.recommended_cutover_date || today()}
              </span>
            </label>
          </section>

          <section className="rounded-2xl border border-[#E7E2D6] bg-white p-5">
            <StepHeading
              number="02"
              icon={Wallet}
              title="Enter money available at go-live"
              description="Use the actual balances you can verify from your drawer, bank statement, UPI and card settlement accounts."
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MoneyField
                icon={Banknote}
                label="Cash in drawer"
                hint="Physical notes and coins"
                value={cash}
                onChange={setCash}
                disabled={status?.till_locked}
                badge={status?.till_locked ? "Saved & locked" : null}
              />
              <MoneyField
                icon={Landmark}
                label="Bank balance"
                hint="Closing bank statement balance"
                value={bank}
                onChange={setBank}
              />
              <MoneyField
                icon={Smartphone}
                label="UPI balance"
                hint="Unsettled or available UPI amount"
                value={upi}
                onChange={setUpi}
              />
              <MoneyField
                icon={CreditCard}
                label="Card balance"
                hint="Pending card settlements"
                value={card}
                onChange={setCard}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-[#E7E2D6] bg-white p-5">
            <StepHeading
              number="03"
              icon={Database}
              title="Balances found in your ERP"
              description="Inventory at cost is included because stock is live before Accounts Setup. Pre-accounts sales, purchases, expenses and advances are not carried into LIVE opening balances."
            />
            <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-3">
              <AccountsKpiCard label="Receivables" value={fmtINR(auto.accounts_receivable)} sub="Customers owe you" />
              <AccountsKpiCard label="Payables" value={fmtINR(auto.supplier_payable)} sub="You owe suppliers" />
              <AccountsKpiCard label="Customer advances" value={fmtINR(auto.customer_advances)} />
              <AccountsKpiCard label="Inventory at cost" value={fmtINR(auto.inventory)} />
              <AccountsKpiCard label="Old gold stock" value={fmtINR(auto.old_gold_stock)} />
            </div>
          </section>

          <section className="rounded-2xl border border-[#E7E2D6] bg-white p-5">
            <StepHeading
              number="04"
              icon={ReceiptText}
              title="Add GST opening balances"
              description="Enter figures from your latest GST return. Leave both at zero if this does not apply."
              optional
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MoneyField
                icon={ReceiptText}
                label="Output GST payable"
                hint="Tax liability carried forward"
                value={outputGst}
                onChange={setOutputGst}
              />
              <MoneyField
                icon={CheckCircle2}
                label="Input GST credit"
                hint="Input tax credit available"
                value={inputGst}
                onChange={setInputGst}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-[#DCC995] bg-[#FFFCF5] p-5">
            <StepHeading
              number="05"
              icon={ShieldCheck}
              title="Review and lock your opening books"
              description="Saving creates the opening ledger voucher. This setup page will disappear after completion."
            />
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-[#EADFBF] bg-white p-4">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#C8B77F] text-[#B49042]"
              />
              <span className="text-[13px] leading-5 text-[#404040]">
                I have verified these balances as of <strong>{cutoverDate}</strong> and understand
                they cannot be edited from this setup screen after saving.
              </span>
            </label>
            <button
              type="button"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#171A17] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              onClick={save}
              disabled={saving || loading || !confirmed}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Lock size={15} />}
              Complete setup &amp; lock balances
              {!saving ? <ArrowRight size={15} /> : null}
            </button>
          </section>
        </main>

        <aside className="h-fit space-y-3 xl:sticky xl:top-4">
          <div className="rounded-2xl border border-[#E7E2D6] bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#A3A3A3]">
              Live opening summary
            </p>
            <div className="mt-4 border-b border-[#F0ECE3] pb-4">
              <p className="text-xs text-[#737373]">Liquid opening total</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#171717]">{fmtINR(liquidTotal)}</p>
            </div>
            <dl className="mt-3 space-y-2.5 text-xs">
              {[
                ["Cash", parseMoneyInput(cash)],
                ["Bank", parseMoneyInput(bank)],
                ["UPI", parseMoneyInput(upi)],
                ["Card", parseMoneyInput(card)],
              ].map(([label, amount]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <dt className="text-[#737373]">{label}</dt>
                  <dd className="font-medium tabular-nums text-[#262626]">{fmtINR(amount)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 rounded-xl bg-[#F8F7F3] p-3 text-[11px] leading-5 text-[#737373]">
              Effective from <strong className="text-[#404040]">{cutoverDate}</strong>
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="flex gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" />
              <div>
                <p className="text-xs font-semibold text-emerald-900">Where this will appear</p>
                <p className="mt-1 text-[11px] leading-5 text-emerald-800">
                  ERP Statement, Cash Book, Bank Book, Dashboard and Day Closing.
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
