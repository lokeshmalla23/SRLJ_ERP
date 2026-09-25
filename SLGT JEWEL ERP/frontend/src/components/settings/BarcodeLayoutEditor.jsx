import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { printHtml } from "@/lib/printHtml";
import { generateStripTagHTML, generateStripTagTSPLBase64, renderStripTagPng } from "@/lib/labelPrint";
import {
  SAMPLE_TAG_PRODUCT,
  TAG_H_MAX,
  TAG_H_MIN,
  TAG_SIZE_PRESETS,
  TAG_W_MAX,
  TAG_W_MIN,
  WIDGET_META,
  applyTagSize,
  applyWeightsFontPt,
  createDefaultBarcodeLayout,
  formatTagSizeMm,
  mergeBarcodeLayout,
  moveRightLine,
  pageSizeMm,
  parseTagSizeMm,
  setBarcodeLayoutPath,
  setCachedBarcodeLayout,
  LAYOUT_VERSION,
} from "@/lib/barcodeLayout";
import { useCompany } from "@/context/CompanyContext";
import { DragModeToggle, DesignerActionBar, PrintSettingsLockBanner } from "@/components/settings/settingsLayout";
import LayoutNum from "@/components/settings/LayoutNum";

/** CSS px per millimetre (96dpi). Preview is 2× so the 12mm tag is still draggable. */
const MM_PX = 96 / 25.4;
const TAG_PREVIEW_SCALE = 2;

const LINE_TITLES = {
  subcategory: "Subcategory name",
  shop_purity: "Shop + purity",
  gw: "Gross weight",
  nw: "Net weight",
  st: "Stone weight",
  cal_code: "Cal code",
};

function startDrag(e, { value, onChange, min, max, axis = "x", step = 0.5, scale = MM_PX * TAG_PREVIEW_SCALE }) {
  e.preventDefault();
  e.stopPropagation();
  const origin = Number(value) || 0;
  const start = axis === "y" ? e.clientY : e.clientX;
  const move = (ev) => {
    const now = axis === "y" ? ev.clientY : ev.clientX;
    const raw = origin + (now - start) / scale;
    const snapped = Math.round(raw / step) * step;
    onChange(Math.min(max, Math.max(min, Math.round(snapped * 100) / 100)));
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function GoldHandle({ className, style, title, onPointerDown, active }) {
  return (
    <div
      className={`absolute z-30 ${active ? "bg-[#C08E2D]" : "bg-[#C08E2D]/50 hover:bg-[#C08E2D]"} ${className}`}
      style={style}
      title={title}
      onPointerDown={onPointerDown}
    />
  );
}

function BarcodeTagCanvas({ layout, previewPng, selected, onSelect, onChange, canWrite, draggable = false, fillWidth = false }) {
  const boxRef = useRef(null);
  const [pxPerMm, setPxPerMm] = useState(MM_PX * TAG_PREVIEW_SCALE);
  const stemMm = Math.max(0, layout.tag_w_mm - layout.left_mm - layout.right_mm);
  const totalMm = layout.tag_w_mm || 1;
  const leftPct = (layout.left_mm / totalMm) * 100;
  const rightPct = (layout.right_mm / totalMm) * 100;
  const stemPct = (stemMm / totalMm) * 100;
  const minStem = 4;
  const maxLeft = Math.max(12, layout.tag_w_mm - layout.right_mm - minStem);
  const maxRight = Math.max(12, layout.tag_w_mm - layout.left_mm - minStem);
  const minWidth = layout.left_mm + layout.right_mm + minStem;
  const showDrag = Boolean(draggable && canWrite);
  const rightShown = (layout.right.lines || []).filter((l) => l.show);
  const leftParts = [
    layout.left.show_shop && "left.shop",
    layout.left.show_barcode && "left.barcode",
    layout.left.show_code && "left.code",
    layout.left.show_cal_code && "left.cal_code",
  ].filter(Boolean);
  const leftTitles = { "left.shop": "Shop text", "left.barcode": "Barcode", "left.code": "Code", "left.cal_code": "Cal code" };

  useEffect(() => {
    if (!fillWidth) {
      setPxPerMm(MM_PX * TAG_PREVIEW_SCALE);
      return undefined;
    }
    const el = boxRef.current;
    if (!el) return undefined;
    const apply = () => setPxPerMm(el.clientWidth / Math.max(1, Number(layout.tag_w_mm) || 1));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fillWidth, layout.tag_w_mm]);

  const drag = (e, opts) => startDrag(e, { scale: pxPerMm, ...opts });

  const hit = (id) =>
    `h-full ${selected === id || selected === id.split(".")[0] ? "bg-[#C08E2D]/25" : "bg-transparent hover:bg-black/5"}`;

  return (
    <div
      ref={boxRef}
      className="relative bg-white rounded-sm shadow-sm"
      style={fillWidth
        ? { width: "100%", aspectRatio: `${layout.tag_w_mm} / ${layout.tag_h_mm}` }
        : { width: `${layout.tag_w_mm * TAG_PREVIEW_SCALE}mm`, height: `${layout.tag_h_mm * TAG_PREVIEW_SCALE}mm` }}
    >
      {previewPng ? (
        <img
          src={previewPng}
          alt="Barcode tag preview"
          className="block pointer-events-none"
          style={{ width: "100%", height: "100%", imageRendering: "pixelated" }}
        />
      ) : (
        <div className="h-full bg-[#F4F4F5]" />
      )}

      <div className="absolute inset-0 flex">
        <div className="h-full flex flex-col border-r border-dashed border-black/30" style={{ width: `${leftPct}%` }}>
          {leftParts.length === 0 ? (
            <button type="button" className={hit("left")} onClick={() => onSelect("left")} title="Left panel" />
          ) : leftParts.map((id) => (
            <button
              key={id}
              type="button"
              className={`${hit(id)} flex-1 text-[8px] leading-none`}
              onClick={() => onSelect(id)}
              title={leftTitles[id]}
            />
          ))}
        </div>
        <div className="h-full flex flex-col border-r border-dashed border-black/30" style={{ width: `${rightPct}%` }}>
          {rightShown.length === 0 ? (
            <button type="button" className={hit("right")} onClick={() => onSelect("right")} title="Right panel" />
          ) : rightShown.map((line) => (
            <button
              key={line.id}
              type="button"
              className={`${hit(`right.line.${line.id}`)} flex-1`}
              onClick={() => onSelect(`right.line.${line.id}`)}
              title={LINE_TITLES[line.id] || line.id}
            />
          ))}
        </div>
        <button
          type="button"
          className={hit("paper")}
          style={{ width: `${stemPct}%` }}
          onClick={() => onSelect("paper")}
          title="Stem / tag size"
        />
      </div>

      {showDrag && (
        <>
          <GoldHandle
            className="top-0 bottom-0 w-1.5 -ml-0.5 cursor-ew-resize"
            style={{ left: `${leftPct}%` }}
            active={selected === "left" || String(selected).startsWith("left.")}
            title={`Left panel ${layout.left_mm} mm — drag`}
            onPointerDown={(e) => drag(e, {
              value: layout.left_mm,
              onChange: (v) => { onChange("left_mm", v); onSelect("left"); },
              min: 8,
              max: maxLeft,
            })}
          />
          <GoldHandle
            className="top-0 bottom-0 w-1.5 -ml-0.5 cursor-ew-resize"
            style={{ left: `${leftPct + rightPct}%` }}
            active={selected === "right" || String(selected).startsWith("right.")}
            title={`Right panel ${layout.right_mm} mm — drag`}
            onPointerDown={(e) => drag(e, {
              value: layout.right_mm,
              onChange: (v) => { onChange("right_mm", v); onSelect("right"); },
              min: 8,
              max: maxRight,
            })}
          />
          <GoldHandle
            className="top-0 bottom-0 -right-1 w-2.5 cursor-ew-resize"
            active={selected === "paper"}
            title={`Tag width ${layout.tag_w_mm} mm — drag`}
            onPointerDown={(e) => drag(e, {
              value: layout.tag_w_mm,
              onChange: (v) => { onChange("tag_w_mm", v); onSelect("paper"); },
              min: minWidth,
              max: TAG_W_MAX,
            })}
          />
          <GoldHandle
            className="left-0 right-0 -bottom-1 h-2.5 cursor-ns-resize"
            active={selected === "paper"}
            title={`Tag height ${layout.tag_h_mm} mm — drag`}
            onPointerDown={(e) => drag(e, {
              value: layout.tag_h_mm,
              onChange: (v) => { onChange("tag_h_mm", v); onSelect("paper"); },
              min: TAG_H_MIN,
              max: TAG_H_MAX,
              axis: "y",
              step: 0.5,
            })}
          />
          <GoldHandle
            className="left-0 right-0 top-0 h-1.5 cursor-ns-resize"
            active={selected === "paper" || selected === "left"}
            title={`Top/bottom pad ${layout.pad_y_mm} mm — drag`}
            onPointerDown={(e) => drag(e, {
              value: layout.pad_y_mm,
              onChange: (v) => onChange("pad_y_mm", v),
              min: 0.2,
              max: 4,
              axis: "y",
              step: 0.1,
            })}
          />
          <GoldHandle
            className="top-0 bottom-0 left-0 w-1.5 cursor-ew-resize"
            active={selected === "left"}
            title={`Side padding ${layout.pad_x_mm} mm — drag`}
            onPointerDown={(e) => drag(e, {
              value: layout.pad_x_mm,
              onChange: (v) => onChange("pad_x_mm", v),
              min: 0.5,
              max: 8,
              step: 0.1,
            })}
          />
        </>
      )}
    </div>
  );
}

function Num(props) {
  return <LayoutNum {...props} />;
}

function Text({ label, value, onChange, disabled, placeholder }) {
  return (
    <label className="block text-[11.5px] font-medium text-[#5F6F63]">
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
    <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-[#34463A]">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-[#C8D2C5] accent-[#315E48] focus:ring-2 focus:ring-[#78917C]/35" />
      {label}
    </label>
  );
}

function TagSizeField({ width, height, onChange, disabled }) {
  const shown = formatTagSizeMm(width, height);
  const [draft, setDraft] = useState(shown);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(shown);
  }, [shown, focused]);

  const commit = (raw) => {
    const parsed = parseTagSizeMm(raw);
    if (!parsed) {
      setDraft(shown);
      return;
    }
    onChange(parsed.w, parsed.h);
  };

  return (
    <label className="block text-[11.5px] font-medium text-[#5F6F63]">
      Tag size (W × H)
      <div className="flex items-center gap-1 mt-1">
        <input
          className="input"
          disabled={disabled}
          placeholder="96 × 15"
          value={focused ? draft : shown}
          onFocus={() => { setFocused(true); setDraft(shown); }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { setFocused(false); commit(draft); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
        <span className="text-[11px] text-[#737373] w-8 shrink-0">mm</span>
      </div>
      <p className="text-[11px] text-[#737373] mt-1">Type 96 x 15 (BarTender) or 80 x 12</p>
    </label>
  );
}

function PadBox({ children }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function WidgetProps({ id, layout, onChange, canWrite }) {
  const disabled = !canWrite;

  if (id === "left.shop") {
    const box = layout.left;
    return (
      <div className="space-y-3">
        <Toggle label="Show shop name" checked={box.show_shop} onChange={(v) => onChange("left.show_shop", v)} disabled={disabled} />
        <Toggle label="Show purity beside shop (e.g. 22K)" checked={box.show_purity !== false} onChange={(v) => onChange("left.show_purity", v)} disabled={disabled} />
        <Text label="Shop text (blank = auto abbr)" value={box.shop_text} onChange={(v) => onChange("left.shop_text", v)} disabled={disabled} placeholder="SSJ" />
        <p className="text-[11px] font-medium text-[#737373]">BarTender position (Top-Left)</p>
        <PadBox>
          <Num label="SSJ X" value={layout.pos?.shop?.x_mm} onChange={(v) => onChange("pos.shop.x_mm", v)} step={0.1} min={0} max={TAG_W_MAX} disabled={disabled} suffix="mm" />
          <Num label="SSJ Y" value={layout.pos?.shop?.y_mm} onChange={(v) => onChange("pos.shop.y_mm", v)} step={0.1} min={0} max={TAG_H_MAX} disabled={disabled} suffix="mm" />
          <Num label="22K X" value={layout.pos?.purity?.x_mm} onChange={(v) => onChange("pos.purity.x_mm", v)} step={0.1} min={0} max={TAG_W_MAX} disabled={disabled} suffix="mm" />
          <Num label="22K Y" value={layout.pos?.purity?.y_mm} onChange={(v) => onChange("pos.purity.y_mm", v)} step={0.1} min={0} max={TAG_H_MAX} disabled={disabled} suffix="mm" />
          <Num label="SSJ pt" value={layout.pos?.shop?.font_pt} onChange={(v) => onChange("pos.shop.font_pt", v)} step={0.5} min={4} max={24} disabled={disabled} />
          <Num label="22K pt" value={layout.pos?.purity?.font_pt} onChange={(v) => onChange("pos.purity.font_pt", v)} step={0.5} min={4} max={24} disabled={disabled} />
        </PadBox>
      </div>
    );
  }

  if (id === "left.barcode") {
    const box = layout.left;
    const bc = layout.pos?.barcode || {};
    return (
      <div className="space-y-3">
        <Toggle label="Show barcode" checked={box.show_barcode} onChange={(v) => onChange("left.show_barcode", v)} disabled={disabled} />
        <p className="text-[11px] font-medium text-[#737373]">BarTender position (Top-Left)</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Num label="X" value={bc.x_mm} onChange={(v) => onChange("pos.barcode.x_mm", v)} step={0.1} min={0} max={TAG_W_MAX} disabled={disabled} suffix="mm" />
          <Num label="Y" value={bc.y_mm} onChange={(v) => onChange("pos.barcode.y_mm", v)} step={0.1} min={0} max={TAG_H_MAX} disabled={disabled} suffix="mm" />
          <Num label="Width" value={bc.w_mm} onChange={(v) => onChange("pos.barcode.w_mm", v)} step={0.1} min={1} max={TAG_W_MAX} disabled={disabled} suffix="mm" />
          <Num label="Height" value={bc.h_mm} onChange={(v) => onChange("pos.barcode.h_mm", v)} step={0.1} min={1} max={TAG_H_MAX} disabled={disabled} suffix="mm" />
          <Num label="X-dim (module)" value={bc.module_mm} onChange={(v) => onChange("pos.barcode.module_mm", v)} step={0.01} min={0.1} max={1} disabled={disabled} suffix="mm" />
        </div>
      </div>
    );
  }

  if (id === "left.code") {
    const box = layout.left;
    const cd = layout.pos?.code || {};
    return (
      <div className="space-y-3">
        <Toggle label="Show code" checked={box.show_code} onChange={(v) => onChange("left.show_code", v)} disabled={disabled} />
        <p className="text-[11px] font-medium text-[#737373]">BarTender position (under barcode)</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Num label="X" value={cd.x_mm} onChange={(v) => onChange("pos.code.x_mm", v)} step={0.1} min={0} max={TAG_W_MAX} disabled={disabled} suffix="mm" />
          <Num label="Y" value={cd.y_mm} onChange={(v) => onChange("pos.code.y_mm", v)} step={0.1} min={0} max={TAG_H_MAX} disabled={disabled} suffix="mm" />
          <Num label="Width" value={cd.w_mm} onChange={(v) => onChange("pos.code.w_mm", v)} step={0.1} min={1} max={TAG_W_MAX} disabled={disabled} suffix="mm" />
          <Num label="Font pt" value={cd.font_pt} onChange={(v) => onChange("pos.code.font_pt", v)} step={0.5} min={4} max={24} disabled={disabled} />
        </div>
      </div>
    );
  }

  if (id === "left.cal_code") {
    const box = layout.left;
    const cc = layout.pos?.cal_code || {};
    return (
      <div className="space-y-3">
        <Toggle label="Show cal code in left panel" checked={box.show_cal_code} onChange={(v) => onChange("left.show_cal_code", v)} disabled={disabled} />
        <p className="text-[11px] text-[#737373]">Prints the product&apos;s Cal Code. Blank when a product has none.</p>
        <p className="text-[11px] font-medium text-[#737373]">BarTender position (Top-Left)</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Num label="X" value={cc.x_mm} onChange={(v) => onChange("pos.cal_code.x_mm", v)} step={0.1} min={0} max={TAG_W_MAX} disabled={disabled} suffix="mm" />
          <Num label="Y" value={cc.y_mm} onChange={(v) => onChange("pos.cal_code.y_mm", v)} step={0.1} min={0} max={TAG_H_MAX} disabled={disabled} suffix="mm" />
          <Num label="Font pt" value={cc.font_pt} onChange={(v) => onChange("pos.cal_code.font_pt", v)} step={0.5} min={4} max={24} disabled={disabled} />
        </div>
      </div>
    );
  }

  if (String(id).startsWith("right.line.")) {
    const lineId = String(id).slice("right.line.".length);
    const line = layout.right.lines.find((l) => l.id === lineId);
    if (!line) return null;
    return (
      <div className="space-y-3">
        <Toggle label="Show this line" checked={line.show} onChange={(v) => onChange(`right.lines.${lineId}.show`, v)} disabled={disabled} />
        {lineId !== "shop_purity" && (
          <Text label="Label" value={line.label} onChange={(v) => onChange(`right.lines.${lineId}.label`, v)} disabled={disabled} />
        )}
        <Num label="Font size (9pt ≈ 25px)" value={line.font_px} onChange={(v) => onChange(`right.lines.${lineId}.font_px`, v)} step={0.5} min={5} max={40} disabled={disabled} suffix="px" />
        <Num label="Line height" value={layout.right.line_h_px} onChange={(v) => onChange("right.line_h_px", v)} step={0.5} min={6} max={40} disabled={disabled} suffix="px" />
        <PadBox>
          <Num label="Side padding" value={layout.pad_x_mm} onChange={(v) => onChange("pad_x_mm", v)} step={0.1} min={0} max={8} disabled={disabled} suffix="mm" />
          <Num label="Top/bottom pad" value={layout.pad_y_mm} onChange={(v) => onChange("pad_y_mm", v)} step={0.1} min={0} max={4} disabled={disabled} suffix="mm" />
        </PadBox>
      </div>
    );
  }

  if (id === "paper") {
    const page = pageSizeMm(layout);
    return (
      <div className="space-y-3">
        <TagSizeField
          width={layout.tag_w_mm}
          height={layout.tag_h_mm}
          disabled={disabled}
          onChange={(w, h) => onChange("__tag_size__", { w, h })}
        />
        <div className="flex flex-wrap gap-1.5">
          {TAG_SIZE_PRESETS.map((p) => {
            const active = Number(layout.tag_w_mm) === p.w && Number(layout.tag_h_mm) === p.h;
            return (
              <button
                key={`${p.w}x${p.h}`}
                type="button"
                disabled={disabled}
                onClick={() => onChange("__tag_size__", { w: p.w, h: p.h })}
                className={`h-8 rounded-[8px] border px-2.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35 disabled:opacity-50 ${
                  active
                    ? "border-[#244B39] bg-[#244B39] text-white"
                    : "border-[#D5DDD2] bg-white text-[#4F6154] hover:border-[#AAB9A7] hover:bg-[#F6F8F3]"
                }`}
              >
                {p.w} × {p.h} mm
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <Num label="Template width" value={layout.tag_w_mm} onChange={(v) => onChange("tag_w_mm", v)} step={0.5} min={TAG_W_MIN} max={TAG_W_MAX} disabled={disabled} suffix="mm" />
          <Num label="Template height" value={layout.tag_h_mm} onChange={(v) => onChange("tag_h_mm", v)} step={0.5} min={TAG_H_MIN} max={TAG_H_MAX} disabled={disabled} suffix="mm" />
          <Num label="Left margin" value={layout.margin_l_mm} onChange={(v) => onChange("margin_l_mm", v)} step={0.1} min={0} max={10} disabled={disabled} suffix="mm" />
          <Num label="Right margin" value={layout.margin_r_mm} onChange={(v) => onChange("margin_r_mm", v)} step={0.1} min={0} max={10} disabled={disabled} suffix="mm" />
          <Num label="Top margin" value={layout.margin_t_mm} onChange={(v) => onChange("margin_t_mm", v)} step={0.1} min={0} max={6} disabled={disabled} suffix="mm" />
          <Num label="Bottom margin" value={layout.margin_b_mm} onChange={(v) => onChange("margin_b_mm", v)} step={0.1} min={0} max={6} disabled={disabled} suffix="mm" />
          <Num label="Left panel" value={layout.left_mm} onChange={(v) => onChange("left_mm", v)} step={0.5} min={8} max={TAG_W_MAX - 12} disabled={disabled} suffix="mm" />
          <Num label="Right panel" value={layout.right_mm} onChange={(v) => onChange("right_mm", v)} step={0.5} min={8} max={TAG_W_MAX - 12} disabled={disabled} suffix="mm" />
          <Num label="Side padding" value={layout.pad_x_mm} onChange={(v) => onChange("pad_x_mm", v)} step={0.1} min={0} max={8} disabled={disabled} suffix="mm" />
          <Num label="Top/bottom pad" value={layout.pad_y_mm} onChange={(v) => onChange("pad_y_mm", v)} step={0.1} min={0} max={4} disabled={disabled} suffix="mm" />
        </div>
        <label className="block text-[11.5px] font-medium text-[#5F6F63]">
          Media sensing (stops vertical drift on next labels)
          <select
            className="input mt-1"
            disabled={disabled}
            value={layout.sense_mode || "continuous"}
            onChange={(e) => onChange("sense_mode", e.target.value)}
          >
            <option value="continuous">Continuous (recommended for jewellery dumbbell tags)</option>
            <option value="gap">Gap sensor</option>
            <option value="bline">Black mark (BLINE)</option>
          </select>
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Num
            label={layout.sense_mode === "continuous" ? "Extra feed (gap)" : "Gap / mark height"}
            value={layout.gap_mm ?? 4}
            onChange={(v) => onChange("gap_mm", v)}
            step={0.1}
            min={0}
            max={20}
            disabled={disabled}
            suffix="mm"
          />
          <Num
            label="Gap offset"
            value={layout.gap_offset_mm ?? 0}
            onChange={(v) => onChange("gap_offset_mm", v)}
            step={0.1}
            min={-10}
            max={10}
            disabled={disabled || layout.sense_mode === "continuous"}
            suffix="mm"
          />
        </div>
        <p className="text-[11px] text-[#737373]">
          If labels drift after the first print, keep Continuous and set Extra feed to the real space between tags (yours is 4 mm). Measure on the roll if needed.
        </p>
        <label className="block text-[11.5px] font-medium text-[#5F6F63]">
          Font (BarTender typeface)
          <select
            className="input mt-1"
            disabled={disabled}
            value={layout.font_family || "Times New Roman"}
            onChange={(e) => onChange("font_family", e.target.value)}
          >
            <option value="Times New Roman">Times New Roman</option>
            <option value="Arial">Arial</option>
            <option value="Tahoma">Tahoma</option>
            <option value="Courier New">Courier New</option>
          </select>
        </label>
        <Toggle label="Use BarTender absolute positions" checked={layout.use_absolute !== false} onChange={(v) => onChange("use_absolute", v)} disabled={disabled} />
        <p className="text-[11px] text-[#737373]">
          Page size {page.w} × {page.h} mm (template + margins) · Stem (blank wrap) ={" "}
          {Math.max(0, +(layout.tag_w_mm - layout.left_mm - layout.right_mm).toFixed(1))} mm
          {" · "}SSJ {layout.pos?.shop?.x_mm}×{layout.pos?.shop?.y_mm} · barcode {layout.pos?.barcode?.x_mm}×{layout.pos?.barcode?.y_mm} · weights {layout.pos?.weights?.x_mm}×{layout.pos?.weights?.y_mm}
        </p>
      </div>
    );
  }

  if (id === "left") {
    const box = layout.left;
    return (
      <div className="space-y-3">
        <Toggle label="Shop name / abbr" checked={box.show_shop} onChange={(v) => onChange("left.show_shop", v)} disabled={disabled} />
        <Toggle label="Purity beside shop (22K)" checked={box.show_purity !== false} onChange={(v) => onChange("left.show_purity", v)} disabled={disabled} />
        <Text label="Shop text (blank = auto abbr)" value={box.shop_text} onChange={(v) => onChange("left.shop_text", v)} disabled={disabled} placeholder="SSJ" />
        <Num label="Shop font (9pt ≈ 25px)" value={box.shop_font_px} onChange={(v) => onChange("left.shop_font_px", v)} step={0.5} min={5} max={40} disabled={disabled} suffix="px" />
        <Toggle label="Barcode" checked={box.show_barcode} onChange={(v) => onChange("left.show_barcode", v)} disabled={disabled} />
        <div className="grid grid-cols-2 gap-2">
          <Num label="Barcode height" value={box.barcode_height_px} onChange={(v) => onChange("left.barcode_height_px", v)} step={1} min={8} max={80} disabled={disabled} suffix="px" />
          <Num label="Bar thickness" value={box.barcode_bar_w} onChange={(v) => onChange("left.barcode_bar_w", v)} step={0.1} min={0.6} max={4} disabled={disabled} />
        </div>
        <Toggle label="Code under barcode" checked={box.show_code} onChange={(v) => onChange("left.show_code", v)} disabled={disabled} />
        <div className="grid grid-cols-2 gap-2">
          <Num label="Code font" value={box.code_font_px} onChange={(v) => onChange("left.code_font_px", v)} step={0.5} min={5} max={40} disabled={disabled} suffix="px" />
          <Num label="Gap" value={box.gap_px} onChange={(v) => onChange("left.gap_px", v)} step={0.5} min={0} max={16} disabled={disabled} suffix="px" />
        </div>
        <Toggle label="Cal code (left panel only)" checked={box.show_cal_code} onChange={(v) => onChange("left.show_cal_code", v)} disabled={disabled} />
        <PadBox>
          <Num label="Side padding" value={layout.pad_x_mm} onChange={(v) => onChange("pad_x_mm", v)} step={0.1} min={0} max={8} disabled={disabled} suffix="mm" />
          <Num label="Top/bottom pad" value={layout.pad_y_mm} onChange={(v) => onChange("pad_y_mm", v)} step={0.1} min={0} max={4} disabled={disabled} suffix="mm" />
        </PadBox>
      </div>
    );
  }

  if (id === "right") {
    const box = layout.right;
    const wt = layout.pos?.weights || {};
    return (
      <div className="space-y-3">
        <p className="text-[11px] font-medium text-[#737373]">BarTender weights block (Top-Left)</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Num label="X" value={wt.x_mm} onChange={(v) => onChange("pos.weights.x_mm", v)} step={0.1} min={0} max={TAG_W_MAX} disabled={disabled} suffix="mm" />
          <Num label="Y" value={wt.y_mm} onChange={(v) => onChange("pos.weights.y_mm", v)} step={0.1} min={0} max={TAG_H_MAX} disabled={disabled} suffix="mm" />
          <Num label="Width" value={wt.w_mm} onChange={(v) => onChange("pos.weights.w_mm", v)} step={0.1} min={1} max={TAG_W_MAX} disabled={disabled} suffix="mm" />
          <Num label="Height" value={wt.h_mm} onChange={(v) => onChange("pos.weights.h_mm", v)} step={0.1} min={1} max={TAG_H_MAX} disabled={disabled} suffix="mm" />
          <Num label="Line height" value={wt.line_h_mm} onChange={(v) => onChange("pos.weights.line_h_mm", v)} step={0.1} min={1} max={10} disabled={disabled} suffix="mm" />
          <Num label="Font pt (all lines)" value={wt.font_pt} onChange={(v) => onChange("__weights_font_pt__", v)} step={0.5} min={4} max={24} disabled={disabled} />
        </div>
        <Text label='Unit suffix (BarTender: " gms")' value={box.unit_suffix ?? " gms"} onChange={(v) => onChange("right.unit_suffix", v)} disabled={disabled} placeholder=" gms" />
        <label className="block text-[11.5px] font-medium text-[#5F6F63]">
          Align
          <select className="input mt-1" disabled={disabled} value={box.align} onChange={(e) => onChange("right.align", e.target.value)}>
            <option value="left">Left</option>
            <option value="center">Center</option>
          </select>
        </label>
        <p className="text-[11px] text-[#737373]">Show, rename, and reorder each row.</p>
        <div className="space-y-2">
          {box.lines.map((line, idx) => (
            <div key={line.id} className="rounded-[8px] border border-[#E0E5DD] bg-[#F8F9F5] p-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={line.show}
                  disabled={disabled}
                  onChange={(e) => onChange(`right.lines.${line.id}.show`, e.target.checked)}
                />
                <span className="text-[12px] font-medium text-[#294236] w-[110px] shrink-0">{LINE_TITLES[line.id] || line.id}</span>
                {line.id !== "shop_purity" ? (
                  <input
                    className="input flex-1"
                    disabled={disabled}
                    value={line.label}
                    onChange={(e) => onChange(`right.lines.${line.id}.label`, e.target.value)}
                  />
                ) : (
                  <span className="text-[11px] text-[#737373] flex-1">Auto from shop + purity</span>
                )}
                <button type="button" className="rounded-[7px] p-1 text-[#748078] transition-colors hover:bg-[#E9EFE7] hover:text-[#315E48] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35 disabled:opacity-40" disabled={disabled || idx === 0} onClick={() => onChange("__move_line__", { id: line.id, dir: -1 })}>
                  <ChevronUp size={14} />
                </button>
                <button type="button" className="rounded-[7px] p-1 text-[#748078] transition-colors hover:bg-[#E9EFE7] hover:text-[#315E48] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35 disabled:opacity-40" disabled={disabled || idx === box.lines.length - 1} onClick={() => onChange("__move_line__", { id: line.id, dir: 1 })}>
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export default function BarcodeLayoutEditor({ canWrite = false, unlocked = false, onLocked }) {
  const { company } = useCompany();
  const shopName = company?.name || "Sri Srinivasa Jewellers";
  const [layout, setLayout] = useState(() => createDefaultBarcodeLayout());
  const [selected, setSelected] = useState("paper");
  const [dragOn, setDragOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasSavedLayout, setHasSavedLayout] = useState(false);

  useEffect(() => {
    api.get("/settings/barcode-tag").then(async ({ data }) => {
      const raw = data?.print_layout;
      setHasSavedLayout(Boolean(raw));
      const prevVer = Number(raw?.layout_version || 0);
      const merged = mergeBarcodeLayout(raw || {});
      setLayout(merged);
      setCachedBarcodeLayout(merged);
      // Persist feed-mode / BarTender defaults when layout version advances
      if (prevVer < LAYOUT_VERSION && canWrite) {
        try {
          await api.put("/settings/barcode-tag", { print_layout: merged });
          toast.success(
            prevVer < 2
              ? "Barcode tag updated to BarTender layout (96×15)"
              : "Label feed set to Continuous — stops drift on next tags",
          );
        } catch { /* ignore */ }
      }
    }).catch(() => {
      setLayout(createDefaultBarcodeLayout());
    }).finally(() => setLoading(false));
  }, [canWrite]);

  const previewPng = useMemo(
    () => renderStripTagPng(SAMPLE_TAG_PRODUCT, shopName, { showGuides: true, scale: 3, layout }),
    [shopName, layout],
  );

  const onChange = (path, value) => {
    if (path === "__move_line__") {
      setLayout((prev) => moveRightLine(prev, value.id, value.dir));
      return;
    }
    if (path === "__tag_size__") {
      setLayout((prev) => applyTagSize(prev, value.w, value.h));
      return;
    }
    if (path === "__weights_font_pt__") {
      setLayout((prev) => applyWeightsFontPt(prev, value));
      return;
    }
    setLayout((prev) => setBarcodeLayoutPath(prev, path, value));
  };

  const save = async () => {
    setSaving(true);
    try {
      const merged = mergeBarcodeLayout(layout);
      await api.put("/settings/barcode-tag", { print_layout: merged });
      setLayout(merged);
      setCachedBarcodeLayout(merged);
      setHasSavedLayout(true);
      onLocked?.();
      toast.success("Barcode tag layout saved — print will use this");
    } catch (err) {
      toast.error(formatApiError(err) || "Could not save layout");
    } finally {
      setSaving(false);
    }
  };

  const testPrint = async () => {
    setTesting(true);
    try {
      const items = [{ product: SAMPLE_TAG_PRODUCT, qty: 1 }];
      const rawTsplBase64 = generateStripTagTSPLBase64(items, shopName, layout);
      if (!rawTsplBase64 || rawTsplBase64.length < 80) {
        toast.error("Could not build label bitmap from preview — try Save layout first");
        return;
      }
      await printHtml(generateStripTagHTML(items, shopName, layout), {
        printerType: "label",
        rawTsplBase64,
      });
    } catch {
      /* toast from printHtml */
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <p className="rounded-[10px] border border-[#DCE3D6] bg-[#FEFEFB] px-4 py-3 text-[12.5px] text-[#6F7C72]">Loading barcode tag layout…</p>;
  }

  const frozen = hasSavedLayout && !unlocked;
  const effectiveCanWrite = canWrite && !frozen;
  const stemMm = Math.max(0, layout.tag_w_mm - layout.left_mm - layout.right_mm);
  const propsTitle =
    selected === "left.shop" ? "Shop text"
    : selected === "left.barcode" ? "Barcode"
    : selected === "left.code" ? "Code"
    : selected === "left.cal_code" ? "Cal code"
    : String(selected).startsWith("right.line.") ? (LINE_TITLES[selected.slice("right.line.".length)] || "Line")
    : (WIDGET_META[selected]?.label || "Properties");
  const tagHint = selected === "paper"
    ? "Customize tag size, panel widths and print padding."
    : `Customize font, padding and layout for ${propsTitle.toLowerCase()}.`;
  const optionChips = [
    { id: "paper", label: "Tag size" },
    { id: "left", label: "Left panel" },
    { id: "left.shop", label: "Shop text" },
    { id: "left.barcode", label: "Barcode" },
    { id: "left.code", label: "Code" },
    { id: "left.cal_code", label: "Cal code (left)" },
    { id: "right", label: "Right panel" },
    ...layout.right.lines.map((line) => ({ id: `right.line.${line.id}`, label: LINE_TITLES[line.id] || line.id })),
  ];

  return (
    <div className="w-full">
      <PrintSettingsLockBanner frozen={frozen} />
      <div className="sticky top-[7.25rem] z-[5] bg-[#F7F5EE]/95 pb-3 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="min-w-0">
            <h3 className="font-display text-[15px] font-semibold text-[#294236]">Live Preview</h3>
            <p className="text-[12px] text-[#737373] mt-0.5">
              Template {layout.tag_w_mm} × {layout.tag_h_mm} mm · Page {pageSizeMm(layout).w} × {pageSizeMm(layout).h} mm.
              Click shop / barcode / a weight line.
              {dragOn ? " Gold bars resize the tag." : " Turn Draggable ON to resize by dragging."}
            </p>
          </div>
          <DragModeToggle on={dragOn} onChange={setDragOn} disabled={!effectiveCanWrite} />
        </div>
        <div className="w-full rounded-[10px] border border-[#D6DDD3] bg-[#ECEEE8] p-3">
          <BarcodeTagCanvas
            layout={layout}
            previewPng={previewPng}
            selected={selected}
            onSelect={setSelected}
            onChange={onChange}
            canWrite={effectiveCanWrite}
            draggable={dragOn}
            fillWidth
          />
          <div className="grid grid-cols-3 text-[11px] mt-2">
            <div className="text-left">
              <span className="font-semibold text-[#294236]">Left {layout.left_mm} mm</span>
              <span className="text-[#737373]"> · Barcode</span>
            </div>
            <div className="text-center">
              <span className="font-semibold text-[#294236]">Right {layout.right_mm} mm</span>
              <span className="text-[#737373]"> · Weights</span>
            </div>
            <div className="text-right">
              <span className="font-semibold text-[#737373]">Stem {stemMm} mm</span>
              <span className="text-[#A3A3A3]"> · Blank wrap</span>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full overflow-hidden rounded-[10px] border border-[#DCE3D6] bg-[#FEFEFB] shadow-[0_1px_2px_rgba(36,55,45,0.04)]">
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[#DCE3D6] bg-[#F3F5EE] px-3 py-2">
          {optionChips.map((chip) => {
            const on = selected === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setSelected(chip.id)}
                className={`h-8 shrink-0 whitespace-nowrap rounded-[8px] border px-2.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35 ${
                  on
                    ? "border-[#244B39] bg-[#244B39] text-white"
                    : "border-[#D5DDD2] bg-white text-[#526458] hover:border-[#AAB9A7] hover:bg-[#F8F9F5]"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <div className="px-4 pt-3 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h3 className="font-display text-[14.5px] font-semibold text-[#294236]">{propsTitle}</h3>
              <p className="text-[12px] text-[#737373] mt-0.5">{tagHint}</p>
            </div>
            <DesignerActionBar
              compact
              canWrite={effectiveCanWrite}
              saving={saving}
              testing={testing}
              onSave={save}
              onTest={testPrint}
              onReset={async () => {
                const defaults = createDefaultBarcodeLayout();
                setLayout(defaults);
                setCachedBarcodeLayout(defaults);
                setSelected("paper");
                if (effectiveCanWrite) {
                  setSaving(true);
                  try {
                    await api.put("/settings/barcode-tag", { print_layout: defaults });
                    toast.success("Reset & saved BarTender defaults (matches photo layout)");
                  } catch (err) {
                    toast.error(formatApiError(err) || "Could not save defaults");
                  } finally {
                    setSaving(false);
                  }
                } else {
                  toast.message("Reset to BarTender defaults — Save layout to keep");
                }
              }}
            />
          </div>
          <WidgetProps id={selected} layout={layout} onChange={onChange} canWrite={effectiveCanWrite} />
        </div>
      </div>
    </div>
  );
}
