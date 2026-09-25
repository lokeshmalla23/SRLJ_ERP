import { useEffect, useState } from "react";
import { ListSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import { Plus, X, Layers3, Pencil, Trash2, Power, Gift, CalendarDays, Check } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import PageHeader from "@/components/common/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import MoneyInput from "@/components/ui/MoneyInput";
import { fmtINR, parseMoneyInput } from "@/lib/format";
import { T } from "@/constants/testIds";
import { useAuth } from "@/context/AuthContext";
import useConfirm from "@/hooks/useConfirm";

// Presentation-only scheme canvas and control treatment.
const TRADE_PAGE_CLASS = [
  "text-[#2F3A32]",
  "[&_.btn-primary]:rounded-[9px]",
  "[&_.btn-primary]:bg-[#244B39]",
  "[&_.btn-primary]:border-[#244B39]",
  "[&_.btn-primary]:hover:bg-[#1D3B2E]",
  "[&_.btn-primary]:focus-visible:ring-2",
  "[&_.btn-primary]:focus-visible:ring-[#B8CBB9]",
  "[&_.btn-secondary]:rounded-[9px]",
  "[&_.btn-secondary]:border-[#D3DDD1]",
  "[&_.btn-secondary]:text-[#2F4939]",
  "[&_.btn-secondary]:hover:border-[#AFC2AE]",
  "[&_.btn-secondary]:hover:bg-[#F1F4ED]",
  "[&_.btn-accent]:rounded-[9px]",
  "[&_.btn-accent]:bg-[#244B39]",
  "[&_.btn-accent]:border-[#244B39]",
  "[&_.btn-accent]:hover:bg-[#1D3B2E]",
  "[&_.input]:rounded-[9px]",
  "[&_.input]:border-[#C8D4C7]",
  "[&_.input]:focus:border-[#66806B]",
  "[&_.input]:focus:shadow-[0_0_0_3px_rgba(102,128,107,0.14)]",
  "[&_.card]:rounded-[10px]",
  "[&_.card]:border-[#DCE3D6]",
  "[&_.card]:bg-[#FFFDF8]",
  "[&_.card]:shadow-[0_1px_2px_rgba(35,58,43,0.04)]",
  "[&_.table-shell]:rounded-[10px]",
  "[&_.table-shell]:border-[#DCE3D6]",
  "[&_.table-shell]:shadow-[0_1px_2px_rgba(35,58,43,0.04)]",
  "[&_.table-head-row]:bg-[#F1F4ED]",
  "[&_.table-head-row]:border-[#DCE3D6]",
  "[&_.table-th]:text-[#607063]",
  "[&_.table-td]:border-[#E3E8E0]",
  "[&_.table-row:hover_.table-td]:bg-[#F7F9F4]",
  "[&_h2]:text-[#2F3A32]",
  "[&_h2+p]:text-[#6E786F]",
].join(" ");


/** Preset scheme styles shown in the right panel */
const SCHEME_STYLES = [
  {
    key: "bonus",
    label: "Bonus Month",
    short: "Pay months + free bonus",
    description: "Customer pays for the duration; shop gives bonus month(s) free toward jewellery.",
    icon: Gift,
    defaults: { duration_months: 11, bonus_months: 1 },
    durationOptions: [
      { duration: 11, bonus: 1, label: "11 + 1 Bonus" },
      { duration: 10, bonus: 1, label: "10 + 1 Bonus" },
      { duration: 17, bonus: 1, label: "17 + 1 Bonus" },
      { duration: 23, bonus: 1, label: "23 + 1 Bonus" },
    ],
  },
  {
    key: "standard",
    label: "Standard",
    short: "Fixed months, no bonus",
    description: "Simple fixed-duration plan — e.g. 12 months with no free bonus month.",
    icon: CalendarDays,
    defaults: { duration_months: 12, bonus_months: 0 },
    durationOptions: [
      { duration: 6, bonus: 0, label: "6 Months" },
      { duration: 12, bonus: 0, label: "12 Months" },
      { duration: 18, bonus: 0, label: "18 Months" },
      { duration: 24, bonus: 0, label: "24 Months" },
    ],
  },
];

function detectStyleKey(plan) {
  if (!plan) return "bonus";
  const bonus = Number(plan.bonus_months || 0);
  return bonus > 0 ? "bonus" : "standard";
}

function styleBadge(plan) {
  const bonus = Number(plan.bonus_months || 0);
  if (bonus > 0) {
    return { label: "Bonus Month", cls: "bg-[#FDFBF7] text-[#8A6D2F] border border-[#EADFBF]" };
  }
  return { label: "Standard", cls: "bg-[#F1F4ED] text-[#526B59] border border-[#D5E0D2]" };
}

export default function SchemePlans() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [confirm, confirmModal] = useConfirm();

  const load = () => {
    api.get("/scheme-plans").then(({ data }) => {
      setRows(data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggleActive = async (plan) => {
    try {
      await api.patch(`/scheme-plans/${plan.id}`, { active: !plan.active });
      toast.success(plan.active ? "Scheme type deactivated" : "Scheme type activated");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const removePlan = async (plan) => {
    if (!(await confirm(`Delete "${plan.name}"? This won't affect members already enrolled under it.`))) return;
    try {
      await api.delete(`/scheme-plans/${plan.id}`);
      toast.success("Scheme type deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className={`${TRADE_PAGE_CLASS} max-w-[1100px]`}>
      <PageHeader
        title="Scheme Management"
        subtitle="Define the gold saving scheme types your shop offers — members are enrolled under one of these."
        actions={
          can("gold_schemes", "create") && (
            <button
              data-testid={T.schemeAddBtn}
              onClick={() => { setEditingPlan(null); setOpenForm(true); }}
              className="btn-primary flex items-center gap-1.5"
            >
              <Plus size={14} strokeWidth={1.5} /> New Scheme Type
            </button>
          )
        }
      />

      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <ListSkeleton rows={4} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No scheme types yet"
          description="Create a Bonus Month plan (e.g. 11+1) or a Standard plan (e.g. 12 months)."
          icon={Layers3}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((p) => {
            const badge = styleBadge(p);
            return (
              <div key={p.id} className="card flex items-center justify-between gap-4 bg-[#FFFDF8] border-[#DCE3D6] shadow-[0_1px_2px_rgba(35,58,43,0.04)]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[14px] text-[#244B39]">{p.name}</span>
                    <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>
                      {badge.label}
                    </span>
                    {!p.active && (
                      <span className="chip chip-neutral">Inactive</span>
                    )}
                  </div>
                  <div className="text-[12px] text-[#6E786F] mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>
                      {p.duration_months} months
                      {p.bonus_months ? ` + ${p.bonus_months} bonus` : ""}
                    </span>
                    <span>·</span>
                    <span>{p.plan_type === "weight" ? "Gold Saving" : "Cash Saving"}</span>
                    {p.default_monthly_amount > 0 && (
                      <>
                        <span>·</span>
                        <span>Default {fmtINR(p.default_monthly_amount)}/month</span>
                      </>
                    )}
                  </div>
                  {p.description && (
                    <div className="text-[12px] text-[#8D998F] mt-1">{p.description}</div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {can("gold_schemes", "edit") && (
                    <>
                      <button
                        onClick={() => { setEditingPlan(p); setOpenForm(true); }}
                        className="text-[#5F6D62] hover:text-[#244B39] p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
                        title="Edit"
                      >
                        <Pencil size={14} strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => toggleActive(p)}
                        className="text-[#5F6D62] hover:text-[#244B39] p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
                        title={p.active ? "Deactivate" : "Activate"}
                      >
                        <Power size={14} strokeWidth={1.5} />
                      </button>
                    </>
                  )}
                  {can("gold_schemes", "delete") && (
                    <button
                      onClick={() => removePlan(p)}
                      className="text-[#5F6D62] hover:text-[#9B3E3A] p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8B5B2]"
                      title="Delete"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openForm && (
        <SchemePlanPanel
          plan={editingPlan}
          onClose={() => setOpenForm(false)}
          onSaved={load}
        />
      )}

      {confirmModal}
    </div>
  );
}

// ─── Right-side create / edit panel ───────────────────────────────────────────

function SchemePlanPanel({ plan, onClose, onSaved }) {
  const isEdit = !!plan;
  const initialStyle = detectStyleKey(plan);

  const [styleKey, setStyleKey] = useState(initialStyle);
  const [form, setForm] = useState({
    name: plan?.name || suggestName(
      plan?.duration_months ?? SCHEME_STYLES.find((s) => s.key === initialStyle).defaults.duration_months,
      plan?.bonus_months ?? SCHEME_STYLES.find((s) => s.key === initialStyle).defaults.bonus_months,
      plan?.plan_type || "amount"
    ),
    plan_type: plan?.plan_type || "amount",
    duration_months: plan?.duration_months ?? SCHEME_STYLES.find((s) => s.key === initialStyle).defaults.duration_months,
    bonus_months: plan?.bonus_months ?? SCHEME_STYLES.find((s) => s.key === initialStyle).defaults.bonus_months,
    default_monthly_amount: plan?.default_monthly_amount ?? "",
    description: plan?.description || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const style = SCHEME_STYLES.find((s) => s.key === styleKey) || SCHEME_STYLES[0];
  const totalMonths = Number(form.duration_months || 0) + Number(form.bonus_months || 0);

  const applyStyle = (key) => {
    const next = SCHEME_STYLES.find((s) => s.key === key);
    if (!next) return;
    setStyleKey(key);
    setForm((f) => ({
      ...f,
      duration_months: next.defaults.duration_months,
      bonus_months: next.defaults.bonus_months,
      name: isEdit
        ? f.name
        : suggestName(next.defaults.duration_months, next.defaults.bonus_months, f.plan_type),
    }));
  };

  const applyDurationOption = (opt) => {
    setForm((f) => ({
      ...f,
      duration_months: opt.duration,
      bonus_months: opt.bonus,
      name: isEdit ? f.name : suggestName(opt.duration, opt.bonus, f.plan_type),
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Enter a scheme name");
    if (!form.duration_months || Number(form.duration_months) <= 0) return toast.error("Enter a valid duration");

    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        plan_type: form.plan_type,
        duration_months: Number(form.duration_months),
        bonus_months: styleKey === "standard" ? 0 : Number(form.bonus_months || 0),
        default_monthly_amount: form.default_monthly_amount ? parseMoneyInput(form.default_monthly_amount) : null,
        description: form.description.trim() || null,
      };
      if (isEdit) {
        await api.patch(`/scheme-plans/${plan.id}`, payload);
        toast.success("Scheme type updated");
      } else {
        await api.post("/scheme-plans", payload);
        toast.success("Scheme type created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-[#20352A]/30 backdrop-blur-[2px]" />
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-[#FFFDF8] h-full shadow-[0_18px_50px_rgba(35,58,43,0.18)] flex flex-col animate-slide-in-right border-l border-[#DCE3D6]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DCE3D6] shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-[#244B39]">
              {isEdit ? "Edit Scheme Type" : "New Scheme Type"}
            </h2>
            <p className="text-[12px] text-[#6E786F] mt-0.5">
              Choose plan style, then set duration and amount
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[#6E786F] hover:text-[#244B39] p-1">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Plan style tabs */}
          <section>
            <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#6E786F] mb-2.5">
              Plan Type
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {SCHEME_STYLES.map((s) => {
                const Icon = s.icon;
                const active = styleKey === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => applyStyle(s.key)}
                    className={`text-left rounded-xl border px-3.5 py-3 transition-colors ${
                      active
                        ? "border-[#244B39] bg-[#F7F8F2] ring-1 ring-[#244B39]"
                        : "border-[#DCE3D6] hover:border-[#d4d4d4] bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        active ? "bg-[#244B39] text-white" : "bg-[#F5F5F5] text-[#6E786F]"
                      }`}>
                        <Icon size={15} strokeWidth={1.75} />
                      </div>
                      {active && <Check size={14} className="text-[#244B39]" strokeWidth={2} />}
                    </div>
                    <p className="text-[13px] font-semibold text-[#244B39]">{s.label}</p>
                    <p className="text-[11px] text-[#6E786F] mt-0.5 leading-snug">{s.short}</p>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[#8D998F] mt-2 leading-relaxed">{style.description}</p>
          </section>

          {/* Duration presets */}
          <section>
            <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#6E786F] mb-2.5">
              Duration
            </p>
            <div className="flex flex-wrap gap-2">
              {style.durationOptions.map((opt) => {
                const selected =
                  Number(form.duration_months) === opt.duration &&
                  Number(form.bonus_months || 0) === opt.bonus;
                return (
                  <button
                    key={`${opt.duration}-${opt.bonus}`}
                    type="button"
                    onClick={() => applyDurationOption(opt)}
                    className={`px-3 py-1.5 rounded-[9px] text-[12px] font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] ${
                      selected
                        ? "bg-[#244B39] text-white border-[#244B39]"
                        : "bg-white text-[#5F6D62] border-[#DCE3D6] hover:border-[#8D998F]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="Paid months">
                <input
                  required
                  type="text" inputMode="decimal"
                  min="1"
                  className="input font-mono"
                  value={form.duration_months}
                  onChange={(e) => set("duration_months", e.target.value)}
                />
              </Field>
              <Field label="Bonus months">
                <input
                  type="text" inputMode="decimal"
                  min="0"
                  max="3"
                  disabled={styleKey === "standard"}
                  className="input font-mono disabled:bg-[#F5F5F5] disabled:text-[#8D998F]"
                  value={styleKey === "standard" ? 0 : form.bonus_months}
                  onChange={(e) => set("bonus_months", e.target.value)}
                />
              </Field>
            </div>
            <p className="text-[11px] text-[#6E786F] mt-2">
              Maturity span: <span className="font-semibold text-[#244B39]">{totalMonths || "—"} months</span>
              {styleKey === "bonus" && Number(form.bonus_months) > 0
                ? ` (${form.duration_months} paid + ${form.bonus_months} bonus)`
                : " (no bonus)"}
            </p>
          </section>

          {/* Name & contribution */}
          <section className="space-y-4">
            <Field label="Scheme Name">
              <input
                required
                autoFocus={!isEdit}
                className="input"
                placeholder={
                  styleKey === "bonus"
                    ? "e.g. 11-Month Gold Bonus Scheme"
                    : "e.g. 12-Month Gold Scheme"
                }
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Contribution">
                <select className="input" value={form.plan_type} onChange={(e) => set("plan_type", e.target.value)}>
                  <option value="amount">Cash Saving (₹)</option>
                  <option value="weight">Gold Saving (grams)</option>
                </select>
              </Field>
              <Field label={form.plan_type === "weight" ? "Default ₹ / month (→ grams)" : "Default monthly ₹"}>
                <MoneyInput
                  min="0"
                  step={form.plan_type === "weight" ? "0.01" : "1"}
                  className="input font-mono"
                  placeholder="Optional"
                  value={form.default_monthly_amount}
                  onValueChange={(raw) => set("default_monthly_amount", raw)}
                />
              </Field>
            </div>

            <Field label="Description (optional)">
              <textarea
                className="input resize-none"
                rows={2}
                placeholder="Notes for staff when enrolling a member…"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#DCE3D6] flex items-center justify-end gap-2 shrink-0 bg-[#F7F8F2]">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Saving…" : isEdit ? "Save Changes" : "Create Scheme Type"}
          </button>
        </div>
      </form>

      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); opacity: 0.6; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </div>
  );
}

function suggestName(duration, bonus, planType) {
  const kind = planType === "weight" ? "Gold" : "Cash";
  if (Number(bonus) > 0) {
    return `Swarnalakshmi ${kind} ${duration}+${bonus}`;
  }
  return `Swarnalakshmi ${kind} ${duration}M`;
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#6E786F] mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
