import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Printer, Receipt } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { printHtml } from "@/lib/printHtml";
import { generateEstimationPrintHTML, generateThermalEstimationPrintHTML } from "@/lib/estimationPrint";
import {
  DEFAULT_ESTIMATION_LAYOUT,
  DEFAULT_THERMAL_ESTIMATION_LAYOUT,
  SAMPLE_ESTIMATION,
  SECTION_IDS,
  SECTION_META,
  FONT_FAMILY_OPTIONS,
  mergeEstimationLayout,
  mergeThermalEstimationLayout,
  setThermalEstimationLayoutPath,
  setCachedEstimationLayout,
  setCachedThermalEstimationLayout,
  setCachedEstimationPrinterType,
  setEstimationLayoutPath as setNormalPath,
} from "@/lib/estimationLayout";
import { useCompany } from "@/context/CompanyContext";
import { DesignerActionBar, DesignerPreviewHeader, PrintDesignerFrame, PrintSettingsLockBanner } from "@/components/settings/settingsLayout";
import LayoutNum from "@/components/settings/LayoutNum";

function Num(props) {
  return <LayoutNum {...props} />;
}

function Text({ label, value, onChange, disabled, placeholder }) {
  return (
    <label className="block text-[12px] text-[#525252]">
      {label}
      <input
        className="input mt-1"
        disabled={disabled}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-[#0A0A0A] cursor-pointer">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function FontFamilySelect({ value, onChange, disabled }) {
  return (
    <label className="block text-[12px] text-[#525252]">
      Font
      <select
        className="input mt-1"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {FONT_FAMILY_OPTIONS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
    </label>
  );
}

function sectionVisible(layout, id) {
  if (id === "header") return layout.show_shop || layout.show_city || layout.show_phone;
  if (id === "rate") return layout.show_rate;
  if (id === "meta") return layout.show_quote_no || layout.show_customer || layout.show_date || layout.show_purity_line;
  if (id === "items") return Object.values(layout.items || {}).some(Boolean);
  if (id === "totals") return layout.show_total || layout.show_balance || layout.show_discount || layout.show_advance;
  if (id === "footer") return layout.show_thanking || layout.show_customer_fields || layout.show_notes;
  return true;
}

// Section toggles use the exact same field names on both the normal (A5) and
// thermal layouts, so this — and WidgetProps below, apart from "paper" — is
// shared between both printer types. `setPath` is whichever layout's own
// path-setter (setEstimationLayoutPath / setThermalEstimationLayoutPath).
function setSectionVisible(layout, id, show, setPath, mergeFn) {
  if (id === "header") {
    let next = setPath(layout, "show_shop", show);
    next = setPath(next, "show_city", show);
    next = setPath(next, "show_phone", show);
    return next;
  }
  if (id === "rate") return setPath(layout, "show_rate", show);
  if (id === "meta") {
    let next = setPath(layout, "show_quote_no", show);
    next = setPath(next, "show_customer", show);
    next = setPath(next, "show_date", show);
    next = setPath(next, "show_purity_line", show);
    return next;
  }
  if (id === "items") {
    const items = Object.fromEntries(Object.keys(layout.items || {}).map((k) => [k, show]));
    return mergeFn({ ...layout, items: { ...layout.items, ...items } });
  }
  if (id === "totals") {
    let next = setPath(layout, "show_total", show);
    next = setPath(next, "show_balance", show);
    next = setPath(next, "show_discount", show);
    next = setPath(next, "show_advance", show);
    return next;
  }
  if (id === "footer") {
    let next = setPath(layout, "show_thanking", show);
    next = setPath(next, "show_customer_fields", show);
    next = setPath(next, "show_notes", show);
    return next;
  }
  return layout;
}

function WidgetProps({ id, layout, onChange, canWrite, printerType }) {
  const disabled = !canWrite;
  if (id === "paper") {
    if (printerType === "thermal") {
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
            <label className="block text-[12px] text-[#525252]">
              Roll width
              <select
                className="input mt-1"
                disabled={disabled}
                value={layout.paper_width_mm}
                onChange={(e) => onChange("paper_width_mm", Number(e.target.value))}
              >
                <option value={58}>58mm</option>
                <option value={80}>80mm</option>
              </select>
            </label>
            <Num label="Body font" value={layout.font_pt} onChange={(v) => onChange("font_pt", v)} step={0.5} min={7} max={14} disabled={disabled} suffix="pt" />
            <FontFamilySelect value={layout.font_family} onChange={(v) => onChange("font_family", v)} disabled={disabled} />
            <Num label="Shop name size" value={layout.shop_pt} onChange={(v) => onChange("shop_pt", v)} step={0.5} min={8} max={18} disabled={disabled} suffix="pt" />
            <Num label="Title size" value={layout.title_pt} onChange={(v) => onChange("title_pt", v)} step={0.5} min={8} max={18} disabled={disabled} suffix="pt" />
            <Num label="Side padding" value={layout.pad_x} onChange={(v) => onChange("pad_x", v)} step={0.5} min={0} max={16} disabled={disabled} suffix="mm" />
          </div>
          <Toggle label="Bold body text" checked={Boolean(layout.bold)} onChange={(v) => onChange("bold", v)} disabled={disabled} />
          <p className="text-[11.5px] text-[#a3a3a3] leading-snug">
            No fixed page height — the roll feeds and cuts to fit the estimation, same as a POS bill.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Page width" value={layout.page_w_in} onChange={(v) => onChange("page_w_in", v)} step={0.05} min={4.5} max={8.5} disabled={disabled} suffix="in" />
          <Num label="Page height" value={layout.page_h_in} onChange={(v) => onChange("page_h_in", v)} step={0.05} min={6} max={14} disabled={disabled} suffix="in" />
          <Num label="Body font" value={layout.font_pt} onChange={(v) => onChange("font_pt", v)} step={0.5} min={7} max={16} disabled={disabled} suffix="pt" />
          <FontFamilySelect value={layout.font_family} onChange={(v) => onChange("font_family", v)} disabled={disabled} />
          <Num label="Shop name size" value={layout.shop_pt} onChange={(v) => onChange("shop_pt", v)} step={0.5} min={8} max={22} disabled={disabled} suffix="pt" />
          <Num label="Title size" value={layout.title_pt} onChange={(v) => onChange("title_pt", v)} step={0.5} min={8} max={22} disabled={disabled} suffix="pt" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Pad top" value={layout.pad_t} onChange={(v) => onChange("pad_t", v)} step={1} min={0} max={80} disabled={disabled} suffix="px" />
          <Num label="Pad right" value={layout.pad_r} onChange={(v) => onChange("pad_r", v)} step={1} min={0} max={80} disabled={disabled} suffix="px" />
          <Num label="Pad bottom" value={layout.pad_b} onChange={(v) => onChange("pad_b", v)} step={1} min={0} max={80} disabled={disabled} suffix="px" />
          <Num label="Pad left" value={layout.pad_l} onChange={(v) => onChange("pad_l", v)} step={1} min={0} max={80} disabled={disabled} suffix="px" />
        </div>
        <Toggle label="Bold body text" checked={Boolean(layout.bold)} onChange={(v) => onChange("bold", v)} disabled={disabled} />
      </div>
    );
  }
  if (id === "header") {
    return (
      <div className="space-y-2">
        <Toggle label="Shop name" checked={layout.show_shop} onChange={(v) => onChange("show_shop", v)} disabled={disabled} />
        <Toggle label="City / address" checked={layout.show_city} onChange={(v) => onChange("show_city", v)} disabled={disabled} />
        <Toggle label="Phone" checked={layout.show_phone} onChange={(v) => onChange("show_phone", v)} disabled={disabled} />
        <Toggle label="Title" checked={layout.title_show} onChange={(v) => onChange("title_show", v)} disabled={disabled} />
        <Text label="Title text" value={layout.title_text} onChange={(v) => onChange("title_text", v)} disabled={disabled} />
      </div>
    );
  }
  if (id === "rate") {
    return (
      <div className="space-y-2">
        <Toggle label="Show metal rate" checked={layout.show_rate} onChange={(v) => onChange("show_rate", v)} disabled={disabled} />
      </div>
    );
  }
  if (id === "meta") {
    return (
      <div className="space-y-2">
        <Toggle label="Estimation number" checked={layout.show_quote_no} onChange={(v) => onChange("show_quote_no", v)} disabled={disabled} />
        <Toggle label="K.V. suffix" checked={layout.show_kv} onChange={(v) => onChange("show_kv", v)} disabled={disabled} />
        <Toggle label="Employee name" checked={layout.show_customer} onChange={(v) => onChange("show_customer", v)} disabled={disabled} />
        <Toggle label="Purity line (No : 1)" checked={layout.show_purity_line} onChange={(v) => onChange("show_purity_line", v)} disabled={disabled} />
        <Toggle label="Date & time" checked={layout.show_date} onChange={(v) => onChange("show_date", v)} disabled={disabled} />
      </div>
    );
  }
  if (id === "items") {
    const I = layout.items || {};
    return (
      <div className="space-y-2">
        <Toggle label="Tag no (TNO)" checked={I.show_tno} onChange={(v) => onChange("items.show_tno", v)} disabled={disabled} />
        <Toggle label="Product name" checked={I.show_name} onChange={(v) => onChange("items.show_name", v)} disabled={disabled} />
        <Toggle label="Pieces" checked={I.show_pcs} onChange={(v) => onChange("items.show_pcs", v)} disabled={disabled} />
        <Toggle label="Gross Weight" checked={I.show_gross} onChange={(v) => onChange("items.show_gross", v)} disabled={disabled} />
        <Toggle label="Value Add" checked={I.show_value_add} onChange={(v) => onChange("items.show_value_add", v)} disabled={disabled} />
        <Toggle label="Stone Weight" checked={I.show_stone_wt} onChange={(v) => onChange("items.show_stone_wt", v)} disabled={disabled} />
        <Toggle label="Stone Price" checked={I.show_stone_price} onChange={(v) => onChange("items.show_stone_price", v)} disabled={disabled} />
        <Toggle label="Total Weight" checked={I.show_total_wt} onChange={(v) => onChange("items.show_total_wt", v)} disabled={disabled} />
        <Toggle label="Cost (gold value)" checked={I.show_cost} onChange={(v) => onChange("items.show_cost", v)} disabled={disabled} />
        <Toggle label="Wastage" checked={I.show_wastage} onChange={(v) => onChange("items.show_wastage", v)} disabled={disabled} />
        <Toggle label="Making Charges" checked={I.show_making} onChange={(v) => onChange("items.show_making", v)} disabled={disabled} />
        <Toggle label="Making Amount" checked={I.show_making_amount} onChange={(v) => onChange("items.show_making_amount", v)} disabled={disabled} />
        <Toggle label="Item TOTAL" checked={I.show_item_total} onChange={(v) => onChange("items.show_item_total", v)} disabled={disabled} />
      </div>
    );
  }
  if (id === "totals") {
    return (
      <div className="space-y-2">
        <Toggle label="Discount" checked={layout.show_discount} onChange={(v) => onChange("show_discount", v)} disabled={disabled} />
        <Toggle label="TOTAL AMOUNT" checked={layout.show_total} onChange={(v) => onChange("show_total", v)} disabled={disabled} />
        <Toggle label="BAL. AMOUNT" checked={layout.show_balance} onChange={(v) => onChange("show_balance", v)} disabled={disabled} />
        <Toggle label="Advance / remaining" checked={layout.show_advance} onChange={(v) => onChange("show_advance", v)} disabled={disabled} />
      </div>
    );
  }
  if (id === "footer") {
    return (
      <div className="space-y-2">
        <Toggle label="THANKING YOU" checked={layout.show_thanking} onChange={(v) => onChange("show_thanking", v)} disabled={disabled} />
        <Toggle label="Name / address / phone lines" checked={layout.show_customer_fields} onChange={(v) => onChange("show_customer_fields", v)} disabled={disabled} />
        <Toggle label="Notes" checked={layout.show_notes} onChange={(v) => onChange("show_notes", v)} disabled={disabled} />
      </div>
    );
  }
  return null;
}

const PRINTER_TABS = [
  { id: "normal", label: "Normal Printer", sub: "A5 letterhead / inkjet / laser", icon: Printer },
  { id: "thermal", label: "Thermal Printer", sub: "58mm / 80mm receipt roll", icon: Receipt },
];

export default function EstimationLayoutEditor({ canWrite = false, unlocked = false, onLocked }) {
  const { company } = useCompany();
  const [printerType, setPrinterType] = useState("normal"); // which sub-tab is being edited/previewed
  const [normalLayout, setNormalLayout] = useState(DEFAULT_ESTIMATION_LAYOUT);
  const [thermalLayout, setThermalLayout] = useState(DEFAULT_THERMAL_ESTIMATION_LAYOUT);
  const [activeType, setActiveType] = useState("normal"); // which one real estimation prints actually use
  const [selected, setSelected] = useState("paper");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [switchingActive, setSwitchingActive] = useState(false);
  const [hasSavedLayout, setHasSavedLayout] = useState(false);

  useEffect(() => {
    api.get("/settings/estimation-print").then(({ data }) => {
      setHasSavedLayout(Boolean(data?.print_layout));
      const mergedNormal = mergeEstimationLayout(data?.print_layout);
      const mergedThermal = mergeThermalEstimationLayout(data?.thermal_layout);
      const type = data?.active_printer_type === "thermal" ? "thermal" : "normal";
      setNormalLayout(mergedNormal);
      setThermalLayout(mergedThermal);
      setActiveType(type);
      setCachedEstimationLayout(mergedNormal);
      setCachedThermalEstimationLayout(mergedThermal);
      setCachedEstimationPrinterType(type);
    }).catch(() => {
      setNormalLayout(DEFAULT_ESTIMATION_LAYOUT);
      setThermalLayout(DEFAULT_THERMAL_ESTIMATION_LAYOUT);
    }).finally(() => setLoading(false));
  }, []);

  const frozen = hasSavedLayout && !unlocked;
  const effectiveCanWrite = canWrite && !frozen;

  const isThermal = printerType === "thermal";
  const layout = isThermal ? thermalLayout : normalLayout;
  const setLayoutState = isThermal ? setThermalLayout : setNormalLayout;
  const setPath = isThermal ? setThermalEstimationLayoutPath : setNormalPath;
  const mergeFn = isThermal ? mergeThermalEstimationLayout : mergeEstimationLayout;
  const generator = isThermal ? generateThermalEstimationPrintHTML : generateEstimationPrintHTML;

  const onChange = (path, value) => {
    setLayoutState((prev) => setPath(prev, path, value));
  };

  const save = async () => {
    setSaving(true);
    try {
      const merged = mergeFn(layout);
      await api.put("/settings/estimation-print", isThermal ? { thermal_layout: merged } : { print_layout: merged });
      setLayoutState(merged);
      if (isThermal) setCachedThermalEstimationLayout(merged);
      else setCachedEstimationLayout(merged);
      setHasSavedLayout(true);
      onLocked?.();
      toast.success(`${isThermal ? "Thermal" : "Normal"} printer layout saved`);
    } catch (err) {
      toast.error(formatApiError(err) || "Could not save layout");
    } finally {
      setSaving(false);
    }
  };

  const switchActiveType = async (type) => {
    if (type === activeType || switchingActive) return;
    setSwitchingActive(true);
    try {
      await api.put("/settings/estimation-print", { active_printer_type: type });
      setActiveType(type);
      setCachedEstimationPrinterType(type);
      toast.success(`Estimations will now print on the ${type === "thermal" ? "Thermal" : "Normal"} printer format`);
    } catch (err) {
      toast.error(formatApiError(err) || "Could not switch printer type");
    } finally {
      setSwitchingActive(false);
    }
  };

  const testPrint = async () => {
    setTesting(true);
    try {
      await printHtml(
        generator(
          SAMPLE_ESTIMATION.quote,
          SAMPLE_ESTIMATION.items,
          company || {},
          SAMPLE_ESTIMATION.goldRate,
          SAMPLE_ESTIMATION.rateMap,
          layout,
        ),
        { printerType: "estimation" },
      );
    } catch {
      /* toast from printHtml */
    } finally {
      setTesting(false);
    }
  };

  const previewHtml = useMemo(
    () => generator(
      SAMPLE_ESTIMATION.quote,
      SAMPLE_ESTIMATION.items,
      company || {},
      SAMPLE_ESTIMATION.goldRate,
      SAMPLE_ESTIMATION.rateMap,
      layout,
    ),
    [generator, layout, company],
  );

  if (loading) {
    return <p className="text-[13px] text-[#737373]">Loading estimation layout…</p>;
  }

  const pageWpx = isThermal
    ? Math.round(((layout.paper_width_mm || 80) / 25.4) * 96)
    : Math.round((layout.page_w_in || 5.7) * 96);
  const pageHpx = isThermal
    ? Math.round(8.5 * 96) // continuous roll — preview a representative length
    : Math.round((layout.page_h_in || 8.27) * 96);
  const scale = isThermal ? 1 : 0.72;
  const otherIds = ["paper", ...SECTION_IDS];

  return (
    <PrintDesignerFrame
      left={(
        <div className="space-y-3">
          <PrintSettingsLockBanner frozen={frozen} />

          <div className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden">
            <p className="text-[12px] font-semibold text-[#0A0A0A] px-3.5 py-2 border-b border-[#E5E7EB]">
              Printing estimations with
            </p>
            <div className="p-3 space-y-2">
              {PRINTER_TABS.map((t) => {
                const isActive = activeType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!canWrite || switchingActive}
                    onClick={() => switchActiveType(t.id)}
                    className={`w-full flex items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors ${
                      isActive ? "border-[#0A0A0A] bg-[#FAFAFA]" : "border-[#E5E7EB] hover:border-[#D4D4D4]"
                    } disabled:opacity-60`}
                  >
                    <t.icon size={15} strokeWidth={1.5} className={isActive ? "text-[#0A0A0A]" : "text-[#a3a3a3]"} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-[#0A0A0A]">{t.label}</span>
                      <span className="block text-[11px] text-[#737373]">{t.sub}</span>
                    </span>
                    {isActive && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-white bg-[#0A0A0A] rounded px-1.5 py-0.5 shrink-0">
                        Active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-1 gap-1">
            {PRINTER_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setPrinterType(t.id); setSelected("paper"); }}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                  printerType === t.id ? "bg-white shadow-sm text-[#0A0A0A]" : "text-[#737373] hover:text-[#0A0A0A]"
                }`}
              >
                <t.icon size={13} strokeWidth={1.5} />
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-[12.5px] text-[#737373] leading-snug">
            {isThermal
              ? "Condensed receipt layout for a 58mm/80mm thermal printer. Turn fields on or off, then Save."
              : "Same detailed estimation slip as before, printed on A5. Turn fields on or off, then Save."}
          </p>

          <div className="bg-white border border-[#E5E7EB] rounded-lg">
            <div className="px-3.5 pt-3 pb-1.5">
              <h3 className="text-[15px] font-semibold text-[#0A0A0A]">{SECTION_META[selected]?.label || "Edit"}</h3>
              <p className="text-[12px] text-[#737373] mt-0.5">Changes show live on the preview</p>
            </div>
            <div className="px-3.5 pb-2">
              <WidgetProps id={selected} layout={layout} onChange={onChange} canWrite={effectiveCanWrite} printerType={printerType} />
            </div>
            <div className="px-3.5 pb-3">
              <DesignerActionBar
                canWrite={effectiveCanWrite}
                saving={saving}
                testing={testing}
                onSave={save}
                onTest={testPrint}
                onReset={() => {
                  setLayoutState(mergeFn(isThermal ? DEFAULT_THERMAL_ESTIMATION_LAYOUT : DEFAULT_ESTIMATION_LAYOUT));
                  setSelected("paper");
                }}
              />
            </div>
          </div>

          <div className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden">
            <p className="text-[12px] font-semibold text-[#0A0A0A] px-3.5 py-2 border-b border-[#E5E7EB]">Other Sections</p>
            {otherIds.map((id) => {
              const visible = id === "paper" ? true : sectionVisible(layout, id);
              const expanded = selected === id;
              return (
                <div key={id} className="border-b border-[#E5E7EB] last:border-b-0">
                  <div className={`flex items-center ${expanded ? "bg-[#FAFAFA]" : ""}`}>
                    <button
                      type="button"
                      className="flex-1 text-left text-[13px] px-3.5 py-2 text-[#0A0A0A]"
                      onClick={() => setSelected(id)}
                    >
                      {SECTION_META[id]?.label || id}
                    </button>
                    {id !== "paper" && (
                      <button
                        type="button"
                        className="p-1.5 text-[#737373]"
                        disabled={!effectiveCanWrite}
                        onClick={() => setLayoutState((prev) => setSectionVisible(prev, id, !visible, setPath, mergeFn))}
                        title={visible ? "Hide" : "Show"}
                      >
                        {visible ? <Eye size={15} /> : <EyeOff size={15} />}
                      </button>
                    )}
                    <button
                      type="button"
                      className="p-1.5 text-[#A3A3A3]"
                      onClick={() => setSelected(id)}
                      aria-label={expanded ? "Collapse" : "Expand"}
                    >
                      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      right={(
        <div>
          <DesignerPreviewHeader
            title="Live Preview"
            subtitle={isThermal
              ? `${layout.paper_width_mm}mm roll — thermal receipt`
              : `${layout.page_w_in} × ${layout.page_h_in} in A5 — old detailed slip`}
          />
          <div className="bg-[#E5E7EB] p-2.5 rounded-lg shadow-inner overflow-auto">
            <div className="bg-white shadow-md overflow-hidden mx-auto" style={{ width: pageWpx * scale, height: pageHpx * scale }}>
              <iframe
                key={previewHtml}
                srcDoc={previewHtml}
                title={isThermal ? "Estimation thermal preview" : "Estimation A5 preview"}
                scrolling="no"
                style={{
                  width: pageWpx,
                  height: pageHpx,
                  border: "none",
                  display: "block",
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              />
            </div>
          </div>
        </div>
      )}
    />
  );
}
