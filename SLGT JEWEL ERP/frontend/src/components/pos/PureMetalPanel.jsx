import { useState } from "react";
import {
  Search, Plus, Scale, IndianRupee, FileText, Tag, ChevronDown, ChevronUp,
  Lightbulb, Lock, Unlock, User2, RefreshCw, TrendingUp, Pencil,
} from "lucide-react";
import MoneyInput from "@/components/ui/MoneyInput";
import WeightInput from "@/components/ui/WeightInput";
import { fmtINR, fmtRatePerGram, parseMoneyInput } from "@/lib/format";

/** Mock palette */
const GOLD = "#C08E2D";
const GOLD_TEXT = "#B26E27";
const GOLD_SOFT = "#FFF8E7";
const BORDER = "#E8E4DC";
const LABEL = "#6B6560";
const INK = "#1A1A1A";

/* ── Icons matching mock (stacked bars / ring) ───────────────────────────── */
function GoldBarsIcon({ size = 22, color = GOLD_TEXT }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="14" width="18" height="5" rx="1" stroke={color} strokeWidth="1.6" />
      <rect x="5" y="9" width="14" height="5" rx="1" stroke={color} strokeWidth="1.6" />
      <rect x="7" y="4" width="10" height="5" rx="1" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function SilverBarsIcon({ size = 22, color = "#8A8F98" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="14" width="18" height="5" rx="1" stroke={color} strokeWidth="1.6" />
      <rect x="5" y="9" width="14" height="5" rx="1" stroke={color} strokeWidth="1.6" />
      <rect x="7" y="4" width="10" height="5" rx="1" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function RingIcon({ size = 15, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="14" r="6.5" stroke={color} strokeWidth="1.7" />
      <path d="M9.5 8.5 12 4l2.5 4.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="4.5" r="1.4" fill={color} />
    </svg>
  );
}

/**
 * Pure Gold / Silver POS form — select inventory item + qty (weight derived).
 */
export default function PureMetalPanel({
  metal,
  onMetalChange,
  pureProducts = [],
  selectedProductId,
  onProductChange,
  qty,
  onQtyChange,
  weight,
  onWeightChange,
  overQtyDialog,
  onCloseOverQtyDialog,
  rate,
  onRateChange,
  rateLocked,
  onToggleRateLock,
  liveRate,
  otherCharges,
  onOtherChargesChange,
  discount,
  onDiscountChange,
  discountType,
  onDiscountTypeChange,
  custSearch,
  onCustSearchChange,
  selectedCustomer,
  walkInCustomer,
  onFocusCustomer,
  onCustomerKeyDown,
  custAnchorRef,
  custDropRef,
  posFieldErrors,
  onOpenNewCustomer,
  salesperson,
  empSearch,
  onEmpSearchChange,
  onFocusSalesperson,
  onSalespersonKeyDown,
  empAnchorRef,
  empDropRef,
}) {
  const [chargesOpen, setChargesOpen] = useState(Boolean(Number(otherCharges) > 0));

  const selected = pureProducts.find((p) => p.id === selectedProductId) || null;
  const isBulk = selected
    && (String(selected.form_type).toLowerCase() === "pure" || String(selected.form_type).toLowerCase() === "biscuit");
  const unitWeight = selected && !isBulk ? Number(selected.weight_g) || 0 : 0;
  const qtyN = Number(qty) || 0;
  const wt = isBulk
    ? (Number(weight) || 0)
    : Math.round(unitWeight * qtyN * 1000) / 1000;
  const available = selected ? Number(selected.stock_qty) || 0 : 0;
  const rt = parseMoneyInput(rate);
  const gross = Math.round(wt * rt * 100) / 100;
  const disc = discountType === "flat" ? parseMoneyInput(discount) : Number(discount) || 0;
  const discAmt = discountType === "pct" ? Math.round(gross * disc) / 100 : disc;
  const afterDiscount = Math.max(0, Math.round((gross - discAmt) * 100) / 100);
  const other = parseMoneyInput(otherCharges);

  const metalKey = metal === "silver" ? "silver" : "gold";
  const options = pureProducts.filter((p) => p.metal === metalKey);

  const optionLabel = (p) => {
    const avail = Number(p.stock_qty) || 0;
    const bulk = String(p.form_type).toLowerCase() === "pure" || String(p.form_type).toLowerCase() === "biscuit";
    return bulk
      ? `${p.name} — avail ${avail} g`
      : `${p.name} — avail ${avail}`;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white" data-testid="pure-metal-panel">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-5 pt-4 pb-5 space-y-5">

          {/* ── Customer + Sales Person ──────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_220px] gap-4 items-end">
            <div ref={custDropRef}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>
                Customer <span style={{ color: GOLD }}>*</span>
              </div>
              <div className="flex gap-2 h-11">
                <div className="relative flex-1 min-w-0" ref={custAnchorRef}>
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A3A3]" strokeWidth={1.75} />
                  <input
                    className={`w-full h-full rounded-lg border bg-white pl-9 pr-3 text-[13px] outline-none ${
                      posFieldErrors?.customer ? "border-red-500" : "border-[#E5E7EB] focus:border-[#C08E2D]"
                    }`}
                    placeholder="Search customer by name or phone number..."
                    value={selectedCustomer
                      ? `${selectedCustomer.mobile || ""} | ${selectedCustomer.name}`
                      : walkInCustomer ? "Walk-in Customer" : custSearch}
                    onChange={onCustSearchChange}
                    onFocus={onFocusCustomer}
                    onKeyDown={onCustomerKeyDown}
                  />
                </div>
                <button
                  type="button"
                  onClick={onOpenNewCustomer}
                  className="h-full px-3.5 rounded-lg border text-[12.5px] font-semibold flex items-center gap-1.5 whitespace-nowrap bg-white hover:bg-[#FFF8E7] transition-colors"
                  style={{ borderColor: GOLD, color: GOLD_TEXT }}
                >
                  <Plus size={14} strokeWidth={2.25} />
                  New Customer
                </button>
              </div>
            </div>

            <div ref={empDropRef}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>
                Sales Person <span style={{ color: GOLD }}>*</span>
              </div>
              <div className="relative h-11" ref={empAnchorRef}>
                <User2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A3A3]" strokeWidth={1.75} />
                <input
                  className={`w-full h-full rounded-lg border bg-white pl-9 pr-8 text-[13px] outline-none ${
                    posFieldErrors?.salesperson ? "border-red-500" : "border-[#E5E7EB] focus:border-[#C08E2D]"
                  }`}
                  placeholder="Select salesperson…"
                  value={salesperson ? salesperson.name : empSearch}
                  onChange={onEmpSearchChange}
                  onFocus={onFocusSalesperson}
                  onKeyDown={onSalespersonKeyDown}
                />
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A3A3A3] pointer-events-none" />
              </div>
            </div>
          </div>

          {/* ── Select Metal ─────────────────────────────────────────────── */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: LABEL }}>
              Select Metal
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MetalCard
                active={metal === "24k"}
                onClick={() => onMetalChange("24k")}
                icon={<GoldBarsIcon color={metal === "24k" ? GOLD_TEXT : "#A3A3A3"} />}
                title="24K Gold"
                subtitle="99.9% Purity"
                accent={GOLD_TEXT}
              />
              <MetalCard
                active={metal === "silver"}
                onClick={() => onMetalChange("silver")}
                icon={<SilverBarsIcon color={metal === "silver" ? "#6B7280" : "#A3A3A3"} />}
                title="Pure Silver"
                subtitle="99.9% Purity"
                accent="#6B7280"
              />
            </div>
          </div>

          {/* ── Item / Qty or Weight ─────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>
                Item
              </div>
              <div className="relative h-11">
                <select
                  className="w-full h-full rounded-lg border border-[#E5E7EB] bg-white pl-3 pr-8 text-[14px] font-medium outline-none focus:border-[#C08E2D] appearance-none"
                  value={selectedProductId || ""}
                  onChange={(e) => onProductChange(e.target.value)}
                  data-testid="pm-item-select"
                >
                  <option value="">Select coin / pure…</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {optionLabel(p)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A3A3A3] pointer-events-none" />
              </div>
              <div className="mt-1.5 text-[11px] text-[#A3A3A3]">
                {options.length === 0
                  ? "No stock in Inventory → Pure for this metal"
                  : selected
                    ? (isBulk ? `Available: ${available} g` : `Available: ${available}`)
                    : "Choose an item from inventory"}
              </div>
            </div>

            {isBulk ? (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>
                  Sell Weight
                </div>
                <div className="relative h-11">
                  <Scale size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A3A3]" />
                  <WeightInput
                    className="w-full h-full rounded-lg border border-[#E5E7EB] bg-white pl-9 pr-12 text-[14px] font-semibold tabular-nums outline-none focus:border-[#C08E2D]"
                    value={weight}
                    onValueChange={(raw) => onWeightChange(raw)}
                    placeholder="0.000"
                    data-testid="pm-weight"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#8A857C]">gram</span>
                </div>
                <div className="mt-1.5 text-[11px] text-[#A3A3A3]">Max {available} g</div>
              </div>
            ) : (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>Qty</div>
                <div className="relative h-11">
                  <input
                    type="text"
                    inputMode="numeric"
                    className="w-full h-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-[14px] font-semibold tabular-nums outline-none focus:border-[#C08E2D]"
                    value={qty}
                    onChange={(e) => onQtyChange(e.target.value)}
                    placeholder="0"
                    data-testid="pm-qty"
                  />
                </div>
                <div className="mt-1.5 text-[11px] text-[#A3A3A3]">
                  {selected ? `× ${unitWeight} g = ${wt || 0} g` : "Pieces"}
                </div>
              </div>
            )}
          </div>

          {/* ── Weight / Rate / Gross ────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>Weight</div>
              <div className="relative h-11">
                <Scale size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A3A3]" />
                <div className="w-full h-full rounded-lg border border-[#E5E7EB] bg-[#F7F7F5] pl-9 pr-12 flex items-center text-[14px] font-semibold tabular-nums text-[#0A0A0A]">
                  {wt > 0 ? Number(wt).toFixed(3) : "0.000"}
                </div>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#8A857C]">gram</span>
              </div>
              <div className="mt-1.5 text-[11px] text-[#A3A3A3]">
                {isBulk ? "Entered sell weight" : "From item × qty"}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>Rate (Per Gram)</div>
              <div className="relative h-11">
                <IndianRupee size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A3A3]" />
                <MoneyInput
                  step="0.01"
                  min="0"
                  disabled={rateLocked}
                  className={`w-full h-full rounded-lg border border-[#E5E7EB] pl-9 pr-10 text-[14px] font-semibold tabular-nums outline-none focus:border-[#C08E2D] ${
                    rateLocked ? "bg-[#F7F7F5] text-[#525252]" : "bg-white"
                  }`}
                  value={rate}
                  onValueChange={(raw) => onRateChange(raw)}
                  data-testid="pm-rate"
                />
                <button
                  type="button"
                  title={rateLocked ? "Unlock rate" : "Lock to live rate"}
                  onClick={onToggleRateLock}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8A857C] hover:text-[#B26E27]"
                >
                  {rateLocked ? <Lock size={14} /> : <Unlock size={14} />}
                </button>
              </div>
              <div className="mt-1.5 text-[11px] font-medium text-[#16a34a]">
                Live Rate: {liveRate != null ? fmtRatePerGram(liveRate) : "—"}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>Gross Amount</div>
              <div className="relative h-11">
                <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A3A3]" />
                <div className="w-full h-full rounded-lg border border-[#E5E7EB] bg-[#F7F7F5] pl-9 pr-3 flex items-center text-[14px] font-semibold tabular-nums text-[#0A0A0A]">
                  {fmtINR(gross)}
                </div>
              </div>
              <div className="mt-1.5 text-[11px] text-[#A3A3A3]">Weight × Rate</div>
            </div>
          </div>

          {/* ── Discount ─────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
            <div className="grid grid-cols-3 gap-4 items-start">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>Discount Type</div>
                <div className="h-11 flex items-center gap-5">
                  <label className="flex items-center gap-2 text-[13px] text-[#1A1A1A] cursor-pointer">
                    <span className={`h-[16px] w-[16px] rounded-full border-2 flex items-center justify-center ${discountType === "flat" ? "border-[#B26E27]" : "border-[#D4D4D4]"}`}>
                      {discountType === "flat" && <span className="h-2 w-2 rounded-full bg-[#B26E27]" />}
                    </span>
                    <input type="radio" className="sr-only" checked={discountType === "flat"} onChange={() => onDiscountTypeChange("flat")} />
                    ₹ Amount
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-[#1A1A1A] cursor-pointer">
                    <span className={`h-[16px] w-[16px] rounded-full border-2 flex items-center justify-center ${discountType === "pct" ? "border-[#B26E27]" : "border-[#D4D4D4]"}`}>
                      {discountType === "pct" && <span className="h-2 w-2 rounded-full bg-[#B26E27]" />}
                    </span>
                    <input type="radio" className="sr-only" checked={discountType === "pct"} onChange={() => onDiscountTypeChange("pct")} />
                    % Percentage
                  </label>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>Discount Amount (₹)</div>
                <div className="relative h-11">
                  <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A3A3]" />
                  {discountType === "flat" ? (
                    <MoneyInput
                      step="0.01"
                      min="0"
                      className="w-full h-full rounded-lg border border-[#E5E7EB] bg-white pl-9 pr-3 text-[14px] font-semibold tabular-nums outline-none focus:border-[#C08E2D]"
                      value={discount}
                      onValueChange={(raw) => onDiscountChange(raw)}
                      data-testid="pm-discount"
                    />
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      className="w-full h-full rounded-lg border border-[#E5E7EB] bg-white pl-9 pr-3 text-[14px] font-semibold tabular-nums outline-none focus:border-[#C08E2D]"
                      value={discount}
                      onChange={(e) => onDiscountChange(e.target.value)}
                      data-testid="pm-discount"
                    />
                  )}
                </div>
                <div className="mt-1.5 text-[11px] text-[#A3A3A3]">Discount will be deducted from gross amount</div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: LABEL }}>Amount After Discount</div>
                <div className="h-11 rounded-lg px-3 flex items-center gap-2 text-[15px] font-bold tabular-nums bg-[#ECFDF5] text-[#15803D] border border-[#BBF7D0]">
                  <span className="h-5 w-5 rounded-full bg-[#16a34a]/15 flex items-center justify-center text-[11px]">₹</span>
                  {fmtINR(afterDiscount)}
                </div>
              </div>
            </div>
          </div>

          {/* ── Other Charges (collapsed bar per mock) ───────────────────── */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setChargesOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-[#FAFAF8]"
            >
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#525252]">Other Charges (Optional)</div>
                <div className="text-[12px] text-[#A3A3A3] mt-0.5">Making Charges, Labour, Other Charges</div>
              </div>
              {chargesOpen
                ? <ChevronUp size={18} className="text-[#8A857C]" />
                : <ChevronDown size={18} className="text-[#8A857C]" />}
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-300 ease-out"
              style={{ gridTemplateRows: chargesOpen ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                <div className="px-4 pb-4 border-t border-[#F0EEE9]">
                  <div className="relative mt-3 max-w-[240px] h-11">
                    <IndianRupee size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A3A3]" />
                    <MoneyInput
                      step="0.01"
                      min="0"
                      className="w-full h-full rounded-lg border border-[#E5E7EB] pl-9 pr-3 text-[14px] font-semibold tabular-nums outline-none focus:border-[#C08E2D]"
                      value={otherCharges}
                      onValueChange={(raw) => onOtherChargesChange(raw)}
                      placeholder="0.00"
                      data-testid="pm-other-charges"
                    />
                  </div>
                  {other > 0 && (
                    <div className="text-[12px] text-[#525252] mt-2">Added: {fmtINR(other)}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {overQtyDialog && (
        <div className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4" data-testid="pm-over-qty-dialog">
          <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-2xl w-full max-w-sm p-5">
            <div className="text-[16px] font-semibold text-[#0A0A0A]">Not enough stock</div>
            <p className="text-[13px] text-[#525252] mt-2 leading-relaxed">
              You entered <span className="font-semibold text-[#0A0A0A]">{overQtyDialog.requested}{overQtyDialog.unit || ""}</span> but only{" "}
              <span className="font-semibold text-[#0A0A0A]">{overQtyDialog.available}{overQtyDialog.unit || ""}</span> available
              {overQtyDialog.name ? ` for ${overQtyDialog.name}` : ""}.
            </p>
            <div className="mt-5 flex justify-end">
              <button type="button" className="btn-primary" onClick={onCloseOverQtyDialog}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetalCard({ active, onClick, icon, title, subtitle, accent }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-center gap-3.5 h-[76px] px-4 rounded-xl border-2 text-left bg-white transition-all duration-300 ease-out"
      style={{
        borderColor: active ? accent : BORDER,
        boxShadow: active ? `0 0 0 3px ${accent}18` : "none",
        background: active ? GOLD_SOFT : "#FFFFFF",
      }}
    >
      <div
        className="h-12 w-12 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors duration-300"
        style={{ background: active ? `${accent}14` : "#F5F5F4" }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-bold" style={{ color: INK }}>{title}</div>
        <div className="text-[12px] mt-0.5" style={{ color: LABEL }}>{subtitle}</div>
      </div>
      <div
        className="h-[18px] w-[18px] rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-300"
        style={{ borderColor: active ? accent : "#D4D4D4" }}
      >
        <div
          className="rounded-full transition-all duration-300"
          style={{
            width: active ? 8 : 0,
            height: active ? 8 : 0,
            background: accent,
            opacity: active ? 1 : 0,
          }}
        />
      </div>
    </button>
  );
}

/**
 * Header mode toggle — matches mock:
 * inactive = plain icon+text; active = cream pill fitted snugly around its content.
 * Both options share the same 32px height and optical vertical centering.
 */
export function PosModeToggle({ mode, onChange, showJewellery = true, showPureMetal = true }) {
  const options = [];
  if (showJewellery) options.push({ key: "jewellery", label: "Jewellery POS", kind: "ring" });
  if (showPureMetal) options.push({ key: "pure_metal", label: "Pure Gold / Silver POS", kind: "bars" });
  if (!options.length) return null;

  return (
    <div
      className="flex items-center flex-shrink-0"
      role="tablist"
      aria-label="POS mode"
      data-testid="pos-mode-toggle"
      style={{ height: 32, touchAction: "manipulation" }}
    >
      {options.map((opt, i) => {
        const active = mode === opt.key;
        return (
          <div key={opt.key} className="flex items-center h-full">
            {i > 0 && (
              <div
                className="flex-shrink-0 self-center mx-1.5"
                style={{ width: 1, height: 14, background: "#E0DCD4" }}
                aria-hidden
              />
            )}
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (mode === opt.key) return;
                onChange(opt.key);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg text-[12.5px] font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150"
              style={{
                height: 32,
                paddingLeft: 12,
                paddingRight: 12,
                lineHeight: 1,
                background: active ? GOLD_SOFT : "transparent",
                color: active ? GOLD_TEXT : "#3F3F3F",
                boxShadow: active ? "inset 0 0 0 1px #E8C99A" : "none",
              }}
              data-testid={opt.key === "jewellery" ? "pos-mode-jewellery" : "pos-mode-pure-metal"}
            >
              <span
                className="inline-flex items-center justify-center flex-shrink-0 pointer-events-none"
                style={{ width: 15, height: 15, lineHeight: 0 }}
              >
                {opt.kind === "ring"
                  ? <RingIcon size={15} color="currentColor" />
                  : <GoldBarsIcon size={15} color="currentColor" />}
              </span>
              <span className="pointer-events-none" style={{ lineHeight: "15px", display: "inline-block" }}>{opt.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Live rate strip — matches mock cards + green delta + Refresh Rates */
export function PureMetalRateStrip({
  goldRate,
  silverRate,
  goldDelta,
  silverDelta,
  onRefresh,
  refreshing,
}) {
  return (
    <div
      className="flex items-center gap-3 border-t px-5 py-3"
      style={{ background: "#FAFAF8", borderColor: "#F0E6D0" }}
    >
      <div className="flex items-stretch gap-3 flex-1 min-w-0 justify-center">
        <LiveRateCard
          icon={<GoldBarsIcon size={20} color={GOLD_TEXT} />}
          label="24K GOLD LIVE RATE"
          value={goldRate}
          delta={goldDelta}
          accent={GOLD_TEXT}
        />
        <LiveRateCard
          icon={<SilverBarsIcon size={20} color="#6B7280" />}
          label="PURE SILVER LIVE RATE"
          value={silverRate}
          delta={silverDelta}
          accent="#6B7280"
        />
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="flex-shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-lg border bg-white text-[12.5px] font-semibold text-[#525252] hover:border-[#C08E2D] hover:text-[#B26E27] transition-colors"
        style={{ borderColor: BORDER }}
      >
        <RefreshCw size={13} strokeWidth={2} className={refreshing ? "animate-spin" : ""} />
        Refresh Rates
      </button>
    </div>
  );
}

function LiveRateCard({ icon, label, value, delta, accent }) {
  const hasDelta = delta && Number.isFinite(delta.amount) && delta.amount !== 0;
  const up = hasDelta && delta.amount > 0;
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border min-w-0 flex-1 max-w-[300px]"
      style={{ borderColor: BORDER }}
    >
      <div
        className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${accent}12` }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8A857C] truncate">{label}</div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <div className="text-[16px] font-bold tabular-nums text-[#0A0A0A]">
            {value != null ? fmtRatePerGram(value) : "—"}
          </div>
          {hasDelta && (
            <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${up ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
              <TrendingUp size={11} className={!up ? "rotate-180" : ""} strokeWidth={2.5} />
              {up ? "+" : ""}{Math.round(delta.amount)} ({delta.pct >= 0 ? "+" : ""}{delta.pct.toFixed(2)}%)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Bill summary panel body — pixel-matched to mock right column */
export function PureMetalBillSummary({
  metalLabel,
  rate,
  weight,
  gross,
  discountAmt,
  otherCharges,
  taxable,
  cgst,
  sgst,
  gstHalfPct,
  grand,
  onProceed,
  canProceed,
  testId,
}) {
  const Row = ({ label, value, valueClass = "text-[#0A0A0A]", right }) => (
    <div className="flex items-center justify-between text-[12.5px] leading-5">
      <span className="text-[#6B6560]">{label}</span>
      <span className={`font-medium tabular-nums flex items-center gap-1 ${valueClass}`}>
        {value}
        {right}
      </span>
    </div>
  );

  return (
    <div className="p-4 flex flex-col h-full min-h-0" data-testid={testId || "pm-bill-summary"} style={{ background: "#FAFAF8" }}>
      <div className="flex items-center gap-2 pb-3 mb-1">
        <FileText size={15} style={{ color: GOLD }} strokeWidth={1.75} />
        <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#0A0A0A]">Bill Summary</span>
      </div>

      <div className="space-y-2.5 pb-3 border-b" style={{ borderColor: BORDER }}>
        <Row label="Metal" value={metalLabel} valueClass="font-semibold text-[#0A0A0A]" />
        <Row label="Purity" value="99.9%" />
        <Row label="Rate (per gram)" value={rate != null ? fmtINR(Number(rate)) : "—"} />
        <Row label="Weight" value={weight ? `${Number(weight).toFixed(3)} g` : "—"} />
      </div>

      <div className="space-y-2.5 py-3 border-b" style={{ borderColor: BORDER }}>
        <Row label="Gross Amount" value={fmtINR(gross)} />
        <Row
          label="Discount"
          value={discountAmt > 0 ? `- ${fmtINR(discountAmt)}` : fmtINR(0)}
          valueClass={discountAmt > 0 ? "text-[#DC2626] font-semibold" : "text-[#0A0A0A]"}
        />
        <Row label="Other Charges" value={fmtINR(otherCharges || 0)} />
      </div>

      <div className="space-y-2.5 py-3 border-b" style={{ borderColor: BORDER }}>
        <Row label="Taxable Amount" value={fmtINR(taxable)} valueClass="font-semibold text-[#0A0A0A]" />
        <Row
          label={`CGST (${gstHalfPct}%)`}
          value={fmtINR(cgst)}
          right={<Pencil size={11} className="text-[#A3A3A3]" strokeWidth={1.75} />}
        />
        <Row
          label={`SGST (${gstHalfPct}%)`}
          value={fmtINR(sgst)}
          right={<Pencil size={11} className="text-[#A3A3A3]" strokeWidth={1.75} />}
        />
      </div>

      <div className="flex items-center justify-between py-4">
        <span className="text-[13px] font-bold tracking-wide text-[#0A0A0A]">GRAND TOTAL</span>
        <span className="text-[22px] font-bold tabular-nums" style={{ color: GOLD }}>{fmtINR(grand)}</span>
      </div>

      <button
        type="button"
        data-testid="pos-checkout"
        data-enter-submit="true"
        onClick={onProceed}
        disabled={!canProceed}
        className="w-full min-h-[56px] h-14 rounded-lg text-[15px] font-semibold text-white flex items-center justify-center gap-2.5 disabled:opacity-50 transition-opacity"
        style={{ background: GOLD }}
      >
        Proceed to Payment
        <span className="inline-flex items-center justify-center min-w-[36px] h-7 px-1.5 rounded-md bg-white/20 border border-white/35 text-[12px] font-bold tracking-wide">
          F12
        </span>
        <span aria-hidden>→</span>
      </button>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5">
        <Lightbulb size={14} className="mt-0.5 flex-shrink-0 text-[#92400E]" strokeWidth={1.75} />
        <p className="text-[11.5px] text-[#92400E] leading-snug">
          This is a pure metal (bullion) sale. No making charges or wastage applicable.
        </p>
      </div>
    </div>
  );
}


