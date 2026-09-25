import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { printHtml } from "@/lib/printHtml";
import { generateInvoicePrintHTML } from "@/lib/invoicePrint";
import {
  DEFAULT_INVOICE_LAYOUT,
  SECTION_META,
  SUBWIDGET_META,
  SAMPLE_INVOICE,
  mergeInvoiceLayout,
  moveColumn,
  setCachedInvoiceLayout,
  setLayoutPath,
  widgetLabel,
  widgetParent,
} from "@/lib/invoiceLayout";
import { useCompany } from "@/context/CompanyContext";
import { DragModeToggle, DesignerActionBar, DesignerPreviewHeader, PrintDesignerFrame, PrintSettingsLockBanner } from "@/components/settings/settingsLayout";
import LayoutNum from "@/components/settings/LayoutNum";
import InvoiceA5Canvas, { PREVIEW_SCALE } from "@/components/settings/InvoiceA5Canvas";
import { applyLetterheadToLayout, normalizeLetterhead } from "@/lib/invoiceLetterhead";

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

function Select({ label, value, onChange, disabled, options }) {
  return (
    <label className="block text-[11.5px] font-medium text-[#5F6F63]">
      {label}
      <select className="input mt-1" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
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

function PadGrid({ box, prefix, onChange, disabled }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
        <Num label="Pad top" value={box.pad_t} onChange={(v) => onChange(`${prefix}.pad_t`, v)} step={1} min={0} max={40} disabled={disabled} suffix="px" />
        <Num label="Pad bottom" value={box.pad_b} onChange={(v) => onChange(`${prefix}.pad_b`, v)} step={1} min={0} max={40} disabled={disabled} suffix="px" />
        <Num label="Pad right" value={box.pad_r} onChange={(v) => onChange(`${prefix}.pad_r`, v)} step={1} min={0} max={40} disabled={disabled} suffix="px" />
        <Num label="Pad left" value={box.pad_l} onChange={(v) => onChange(`${prefix}.pad_l`, v)} step={1} min={0} max={40} disabled={disabled} suffix="px" />
      </div>
      <Num label="Space below" value={box.mb} onChange={(v) => onChange(`${prefix}.mb`, v)} step={1} min={0} max={40} disabled={disabled} suffix="px" />
    </div>
  );
}

const ALIGN_OPTS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const BORDER_OPTS = [
  { value: "inherit", label: "Follow global lines" },
  { value: "both", label: "Top + bottom" },
  { value: "top", label: "Top only" },
  { value: "bottom", label: "Bottom only" },
  { value: "double", label: "Double" },
  { value: "none", label: "None" },
];

function sectionVisible(layout, id) {
  if (id === "title") return layout.title.show || layout.meta.show_invoice_no || layout.meta.show_date;
  if (id === "info") return layout.info.show;
  if (id === "items") return layout.items.show;
  if (id === "breakdown") return layout.breakdown.show;
  if (id === "net") return layout.net.show;
  if (id === "payments") return layout.payments.show;
  if (id === "words") return layout.words.show;
  if (id === "note") return layout.note.show;
  if (id === "signatures") return layout.signatures.show;
  return true;
}

function setSectionVisible(layout, id, show) {
  if (id === "title") {
    let next = setLayoutPath(layout, "title.show", show);
    next = setLayoutPath(next, "meta.show_invoice_no", show);
    next = setLayoutPath(next, "meta.show_date", show);
    return next;
  }
  if (id === "info") return setLayoutPath(layout, "info.show", show);
  if (id === "items") return setLayoutPath(layout, "items.show", show);
  if (id === "breakdown") return setLayoutPath(layout, "breakdown.show", show);
  if (id === "net") return setLayoutPath(layout, "net.show", show);
  if (id === "payments") return setLayoutPath(layout, "payments.show", show);
  if (id === "words") return setLayoutPath(layout, "words.show", show);
  if (id === "note") return setLayoutPath(layout, "note.show", show);
  if (id === "signatures") return setLayoutPath(layout, "signatures.show", show);
  return layout;
}

function WidgetProps({ id, layout, onChange, canWrite, letterheadOn = false, letterheadPaper = "A5" }) {
  const disabled = !canWrite;

  if (id === "title.text") {
    const box = layout.title;
    return (
      <div className="space-y-3">
        <Toggle label="Show title" checked={box.show} onChange={(v) => onChange("title.show", v)} disabled={disabled} />
        <Text label="Title text" value={box.text} onChange={(v) => onChange("title.text", v)} disabled={disabled} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Font size" value={box.font_pt} onChange={(v) => onChange("title.font_pt", v)} step={0.5} min={6} max={32} disabled={disabled} suffix="pt" />
          <Select label="Align" value={box.align} onChange={(v) => onChange("title.align", v)} disabled={disabled} options={ALIGN_OPTS} />
          <Num label="Letter spacing" value={box.letter_spacing} onChange={(v) => onChange("title.letter_spacing", v)} step={0.01} min={0} max={0.4} disabled={disabled} suffix="em" />
          <Toggle label="Bold" checked={box.bold} onChange={(v) => onChange("title.bold", v)} disabled={disabled} />
        </div>
        <PadGrid box={box} prefix="title" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "meta.invoice") {
    const meta = layout.meta;
    return (
      <div className="space-y-3">
        <Toggle label="Show invoice number" checked={meta.show_invoice_no} onChange={(v) => onChange("meta.show_invoice_no", v)} disabled={disabled} />
        <Text label="Label" value={meta.invoice_label} onChange={(v) => onChange("meta.invoice_label", v)} disabled={disabled} />
        <Num label="Font size" value={meta.invoice_font_pt} onChange={(v) => onChange("meta.invoice_font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <Select label="Align" value={meta.align} onChange={(v) => onChange("meta.align", v)} disabled={disabled} options={ALIGN_OPTS} />
        <PadGrid box={layout.title} prefix="title" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "meta.date") {
    const meta = layout.meta;
    return (
      <div className="space-y-3">
        <Toggle label="Show date" checked={meta.show_date} onChange={(v) => onChange("meta.show_date", v)} disabled={disabled} />
        <Text label="Label" value={meta.date_label} onChange={(v) => onChange("meta.date_label", v)} disabled={disabled} />
        <Num label="Font size" value={meta.date_font_pt} onChange={(v) => onChange("meta.date_font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <PadGrid box={layout.title} prefix="title" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "info.gold") {
    const box = layout.info;
    return (
      <div className="space-y-3">
        <Toggle label="Show gold rate" checked={box.show_gold_rate} onChange={(v) => onChange("info.show_gold_rate", v)} disabled={disabled} />
        <Text label="Gold label" value={box.gold_label} onChange={(v) => onChange("info.gold_label", v)} disabled={disabled} />
        <Text label="Quality text" value={box.quality_text} onChange={(v) => onChange("info.quality_text", v)} disabled={disabled} />
        <Num label="Font size" value={box.gold_pt} onChange={(v) => onChange("info.gold_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <Num label="Space below this line" value={box.line_gap} onChange={(v) => onChange("info.line_gap", v)} step={0.5} min={0} max={12} disabled={disabled} suffix="px" />
        <PadGrid box={box} prefix="info" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "info.gstin") {
    const box = layout.info;
    return (
      <div className="space-y-3">
        <Toggle label="Show GSTIN" checked={box.show_gstin} onChange={(v) => onChange("info.show_gstin", v)} disabled={disabled} />
        <Num label="Font size" value={box.gstin_pt} onChange={(v) => onChange("info.gstin_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <Num label="Space below this line" value={box.line_gap} onChange={(v) => onChange("info.line_gap", v)} step={0.5} min={0} max={12} disabled={disabled} suffix="px" />
        <PadGrid box={box} prefix="info" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "info.customer") {
    const box = layout.info;
    return (
      <div className="space-y-3">
        <Toggle label="Show customer" checked={box.show_customer} onChange={(v) => onChange("info.show_customer", v)} disabled={disabled} />
        <Text label="Heading" value={box.customer_label} onChange={(v) => onChange("info.customer_label", v)} disabled={disabled} />
        <Num label="Font size" value={box.customer_pt} onChange={(v) => onChange("info.customer_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <Num label="Space below this line" value={box.line_gap} onChange={(v) => onChange("info.line_gap", v)} step={0.5} min={0} max={12} disabled={disabled} suffix="px" />
        <PadGrid box={box} prefix="info" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "info.phone") {
    const box = layout.info;
    return (
      <div className="space-y-3">
        <Toggle label="Show phone" checked={box.show_phone} onChange={(v) => onChange("info.show_phone", v)} disabled={disabled} />
        <Num label="Font size" value={box.phone_pt} onChange={(v) => onChange("info.phone_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <Num label="Space below this line" value={box.line_gap} onChange={(v) => onChange("info.line_gap", v)} step={0.5} min={0} max={12} disabled={disabled} suffix="px" />
        <PadGrid box={box} prefix="info" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "info.place") {
    const box = layout.info;
    return (
      <div className="space-y-3">
        <Toggle label="Show place of supply" checked={box.show_place_of_supply} onChange={(v) => onChange("info.show_place_of_supply", v)} disabled={disabled} />
        <Text label="Label" value={box.place_label} onChange={(v) => onChange("info.place_label", v)} disabled={disabled} />
        <Num label="Font size" value={box.place_pt} onChange={(v) => onChange("info.place_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <Num label="Space below this line" value={box.line_gap} onChange={(v) => onChange("info.line_gap", v)} step={0.5} min={0} max={12} disabled={disabled} suffix="px" />
        <PadGrid box={box} prefix="info" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "signatures.left") {
    const box = layout.signatures;
    return (
      <div className="space-y-3">
        <Text label="Left text" value={box.left_text} onChange={(v) => onChange("signatures.left_text", v)} disabled={disabled} />
        <Num label="Font size" value={box.left_font_pt} onChange={(v) => onChange("signatures.left_font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <PadGrid box={box} prefix="signatures" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "signatures.right") {
    const box = layout.signatures;
    return (
      <div className="space-y-3">
        <Text label="Right label" value={box.right_label} onChange={(v) => onChange("signatures.right_label", v)} disabled={disabled} />
        <Num label="Font size" value={box.right_font_pt} onChange={(v) => onChange("signatures.right_font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <Num label="Line length" value={box.line_w} onChange={(v) => onChange("signatures.line_w", v)} step={4} min={60} max={220} disabled={disabled} suffix="px" />
        <PadGrid box={box} prefix="signatures" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (String(id).startsWith("items.col.")) {
    const colId = String(id).slice("items.col.".length);
    const col = layout.items.columns.find((c) => c.id === colId);
    if (!col) return null;
    return (
      <div className="space-y-3">
        <Toggle label="Show column" checked={col.show} onChange={(v) => onChange(`items.columns.${colId}.show`, v)} disabled={disabled} />
        <Text label="Header text" value={col.label} onChange={(v) => onChange(`items.columns.${colId}.label`, v)} disabled={disabled} />
        <Num label="Width" value={col.width} onChange={(v) => onChange(`items.columns.${colId}.width`, v)} step={1} min={4} max={50} disabled={disabled} suffix="%" />
        <Select label="Align" value={col.align} onChange={(v) => onChange(`items.columns.${colId}.align`, v)} disabled={disabled} options={ALIGN_OPTS} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Cell pad X" value={layout.items.cell_pad_x} onChange={(v) => onChange("items.cell_pad_x", v)} step={1} min={0} max={12} disabled={disabled} suffix="px" />
          <Num label="Cell pad Y" value={layout.items.cell_pad_y} onChange={(v) => onChange("items.cell_pad_y", v)} step={1} min={0} max={14} disabled={disabled} suffix="px" />
          <Num label="Header pad Y" value={layout.items.head_pad_y} onChange={(v) => onChange("items.head_pad_y", v)} step={1} min={0} max={12} disabled={disabled} suffix="px" />
          <Num label="Space below table" value={layout.items.mb} onChange={(v) => onChange("items.mb", v)} step={1} min={0} max={24} disabled={disabled} suffix="px" />
        </div>
      </div>
    );
  }

  if (id === "paper") {
    return (
      <div className="space-y-3">
        {letterheadOn && (
          <p className="rounded-[9px] border border-[#DCE3D6] bg-[#F5F7F1] px-2.5 py-2 text-[12px] text-[#5F6F63]">
            Page size is {letterheadPaper} from Settings → Company → Invoice Letterhead. Header blank, footer blank and side margin still apply so content stays in the printable area.
          </p>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Page width" value={layout.page_w_in} onChange={(v) => onChange("page_w_in", v)} step={0.05} min={4.5} max={8.5} disabled={disabled || letterheadOn} suffix="in" />
          <Num label="Page height" value={layout.page_h_in} onChange={(v) => onChange("page_h_in", v)} step={0.05} min={6} max={12} disabled={disabled || letterheadOn} suffix="in" />
          <Num label="Header blank" value={layout.header_in} onChange={(v) => onChange("header_in", v)} step={0.05} min={0.2} max={3} disabled={disabled} suffix="in" />
          <Num label="Footer blank" value={layout.footer_in} onChange={(v) => onChange("footer_in", v)} step={0.05} min={0.2} max={3} disabled={disabled} suffix="in" />
          <Num label="Side margin" value={layout.side_in} onChange={(v) => onChange("side_in", v)} step={0.01} min={0.02} max={1.2} disabled={disabled} suffix="in" />
          <Num label="Body font" value={layout.font_pt} onChange={(v) => onChange("font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
          <Num label="Line height" value={layout.line_h} onChange={(v) => onChange("line_h", v)} step={0.05} min={1} max={2.2} disabled={disabled} />
          <Num label="Line thickness" value={layout.border_pt} onChange={(v) => onChange("border_pt", v)} step={0.1} min={0.4} max={3} disabled={disabled} suffix="pt" />
        </div>
        <Toggle label="Divider lines on" checked={layout.show_lines} onChange={(v) => onChange("show_lines", v)} disabled={disabled} />
      </div>
    );
  }

  if (id === "title") {
    const box = layout.title;
    const meta = layout.meta;
    return (
      <div className="space-y-3">
        <Toggle label="Show title" checked={box.show} onChange={(v) => onChange("title.show", v)} disabled={disabled} />
        <Text label="Title text" value={box.text} onChange={(v) => onChange("title.text", v)} disabled={disabled} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Title size" value={box.font_pt} onChange={(v) => onChange("title.font_pt", v)} step={0.5} min={6} max={32} disabled={disabled} suffix="pt" />
          <Select label="Title align" value={box.align} onChange={(v) => onChange("title.align", v)} disabled={disabled} options={ALIGN_OPTS} />
          <Num label="Letter spacing" value={box.letter_spacing} onChange={(v) => onChange("title.letter_spacing", v)} step={0.01} min={0} max={0.4} disabled={disabled} suffix="em" />
          <Toggle label="Bold title" checked={box.bold} onChange={(v) => onChange("title.bold", v)} disabled={disabled} />
        </div>
        <Select label="Border" value={box.border} onChange={(v) => onChange("title.border", v)} disabled={disabled} options={BORDER_OPTS} />
        <PadGrid box={box} prefix="title" onChange={onChange} disabled={disabled} />
        <div className="border-t border-[#DCE3D6] pt-3 space-y-2">
          <p className="text-[11px] font-semibold text-[#737373] uppercase tracking-wide">Invoice no / date</p>
          <Toggle label="Invoice number" checked={meta.show_invoice_no} onChange={(v) => onChange("meta.show_invoice_no", v)} disabled={disabled} />
          <Toggle label="Date" checked={meta.show_date} onChange={(v) => onChange("meta.show_date", v)} disabled={disabled} />
          <Text label="Invoice label" value={meta.invoice_label} onChange={(v) => onChange("meta.invoice_label", v)} disabled={disabled} />
          <Text label="Date label" value={meta.date_label} onChange={(v) => onChange("meta.date_label", v)} disabled={disabled} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
            <Num label="Meta size" value={meta.font_pt} onChange={(v) => onChange("meta.font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
            <Select label="Meta align" value={meta.align} onChange={(v) => onChange("meta.align", v)} disabled={disabled} options={ALIGN_OPTS} />
          </div>
        </div>
      </div>
    );
  }

  if (id === "info") {
    const box = layout.info;
    return (
      <div className="space-y-3">
        <Toggle label="Show block" checked={box.show} onChange={(v) => onChange("info.show", v)} disabled={disabled} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Toggle label="Gold rate" checked={box.show_gold_rate} onChange={(v) => onChange("info.show_gold_rate", v)} disabled={disabled} />
          <Toggle label="GSTIN" checked={box.show_gstin} onChange={(v) => onChange("info.show_gstin", v)} disabled={disabled} />
          <Toggle label="Customer" checked={box.show_customer} onChange={(v) => onChange("info.show_customer", v)} disabled={disabled} />
          <Toggle label="Phone" checked={box.show_phone} onChange={(v) => onChange("info.show_phone", v)} disabled={disabled} />
          <Toggle label="Place of supply" checked={box.show_place_of_supply} onChange={(v) => onChange("info.show_place_of_supply", v)} disabled={disabled} />
        </div>
        <Text label="Gold label" value={box.gold_label} onChange={(v) => onChange("info.gold_label", v)} disabled={disabled} />
        <Text label="Quality text" value={box.quality_text} onChange={(v) => onChange("info.quality_text", v)} disabled={disabled} />
        <Text label="Customer heading" value={box.customer_label} onChange={(v) => onChange("info.customer_label", v)} disabled={disabled} />
        <Text label="Place label" value={box.place_label} onChange={(v) => onChange("info.place_label", v)} disabled={disabled} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Font size" value={box.font_pt} onChange={(v) => onChange("info.font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
          <Num label="Left column %" value={box.left_width} onChange={(v) => onChange("info.left_width", v)} step={1} min={25} max={75} disabled={disabled} suffix="%" />
          <Num label="Line height" value={box.line_h} onChange={(v) => onChange("info.line_h", v)} step={0.05} min={1} max={2.2} disabled={disabled} />
          <Num label="Line gap" value={box.line_gap} onChange={(v) => onChange("info.line_gap", v)} step={0.5} min={0} max={12} disabled={disabled} suffix="px" />
        </div>
        <Select label="Border" value={box.border} onChange={(v) => onChange("info.border", v)} disabled={disabled} options={BORDER_OPTS} />
        <PadGrid box={box} prefix="info" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "items") {
    const box = layout.items;
    const widthSum = box.columns.reduce((s, c) => s + (c.show ? c.width : 0), 0);
    return (
      <div className="space-y-3">
        <Toggle label="Show table" checked={box.show} onChange={(v) => onChange("items.show", v)} disabled={disabled} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Header font" value={box.header_pt} onChange={(v) => onChange("items.header_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
          <Num label="Body font" value={box.body_pt} onChange={(v) => onChange("items.body_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
          <Num label="Footer font" value={box.footer_pt} onChange={(v) => onChange("items.footer_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
          <Num label="Cell pad X" value={box.cell_pad_x} onChange={(v) => onChange("items.cell_pad_x", v)} step={1} min={0} max={12} disabled={disabled} suffix="px" />
          <Num label="Cell pad Y" value={box.cell_pad_y} onChange={(v) => onChange("items.cell_pad_y", v)} step={1} min={0} max={14} disabled={disabled} suffix="px" />
          <Num label="Header pad Y" value={box.head_pad_y} onChange={(v) => onChange("items.head_pad_y", v)} step={1} min={0} max={12} disabled={disabled} suffix="px" />
          <Num label="Space below" value={box.mb} onChange={(v) => onChange("items.mb", v)} step={1} min={0} max={24} disabled={disabled} suffix="px" />
        </div>
        <p className="text-[11px] text-[#737373]">
          Columns — drag width, rename, hide, or reorder. Visible widths sum {widthSum}%.
        </p>
        <div className="space-y-2">
          {box.columns.map((col, idx) => (
            <div key={col.id} className="rounded-[8px] border border-[#E0E5DD] bg-[#F8F9F5] p-2">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={col.show} disabled={disabled} onChange={(e) => onChange(`items.columns.${col.id}.show`, e.target.checked)} />
                <input
                  className="input flex-1"
                  disabled={disabled}
                  value={col.label}
                  onChange={(e) => onChange(`items.columns.${col.id}.label`, e.target.value)}
                />
                <button type="button" className="p-1 text-[#737373]" disabled={disabled || idx === 0} onClick={() => onChange("__move_col__", { id: col.id, dir: -1 })}>
                  <ChevronUp size={14} />
                </button>
                <button type="button" className="p-1 text-[#737373]" disabled={disabled || idx === box.columns.length - 1} onClick={() => onChange("__move_col__", { id: col.id, dir: 1 })}>
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="range"
                  min={4}
                  max={50}
                  disabled={disabled || !col.show}
                  value={col.width}
                  className="h-1.5 flex-1 accent-[#315E48]"
                  onChange={(e) => onChange(`items.columns.${col.id}.width`, Number(e.target.value))}
                />
                <span className="text-[11px] w-10 text-right tabular-nums">{col.width}%</span>
                <select
                  className="input w-[88px]"
                  disabled={disabled}
                  value={col.align}
                  onChange={(e) => onChange(`items.columns.${col.id}.align`, e.target.value)}
                >
                  {ALIGN_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (id === "breakdown") {
    const box = layout.breakdown;
    return (
      <div className="space-y-3">
        <Toggle label="Show tax breakdown" checked={box.show} onChange={(v) => onChange("breakdown.show", v)} disabled={disabled} />
        <Text label="Taxable label" value={box.taxable_label} onChange={(v) => onChange("breakdown.taxable_label", v)} disabled={disabled} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Font size" value={box.font_pt} onChange={(v) => onChange("breakdown.font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
          <Num label="Block width" value={box.width_pct} onChange={(v) => onChange("breakdown.width_pct", v)} step={1} min={30} max={80} disabled={disabled} suffix="%" />
          <Select label="Align block" value={box.align} onChange={(v) => onChange("breakdown.align", v)} disabled={disabled} options={ALIGN_OPTS.filter((o) => o.value !== "center")} />
        </div>
        <Select label="Border" value={box.border} onChange={(v) => onChange("breakdown.border", v)} disabled={disabled} options={BORDER_OPTS} />
        <PadGrid box={box} prefix="breakdown" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "net") {
    const box = layout.net;
    return (
      <div className="space-y-3">
        <Toggle label="Show net row" checked={box.show} onChange={(v) => onChange("net.show", v)} disabled={disabled} />
        <Text label="Label" value={box.label} onChange={(v) => onChange("net.label", v)} disabled={disabled} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Font size" value={box.font_pt} onChange={(v) => onChange("net.font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
          <Toggle label="Bold" checked={box.bold} onChange={(v) => onChange("net.bold", v)} disabled={disabled} />
        </div>
        <Select label="Border" value={box.border} onChange={(v) => onChange("net.border", v)} disabled={disabled} options={BORDER_OPTS} />
        <PadGrid box={box} prefix="net" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "payments") {
    const box = layout.payments;
    return (
      <div className="space-y-3">
        <Toggle label="Show payments" checked={box.show} onChange={(v) => onChange("payments.show", v)} disabled={disabled} />
        <Num label="Font size" value={box.font_pt} onChange={(v) => onChange("payments.font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <Select label="Border" value={box.border} onChange={(v) => onChange("payments.border", v)} disabled={disabled} options={BORDER_OPTS} />
        <PadGrid box={box} prefix="payments" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "words") {
    const box = layout.words;
    return (
      <div className="space-y-3">
        <Toggle label="Show amount in words" checked={box.show} onChange={(v) => onChange("words.show", v)} disabled={disabled} />
        <Text label="Prefix" value={box.prefix} onChange={(v) => onChange("words.prefix", v)} disabled={disabled} />
        <Text label="Suffix" value={box.suffix} onChange={(v) => onChange("words.suffix", v)} disabled={disabled} />
        <Num label="Font size" value={box.font_pt} onChange={(v) => onChange("words.font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
        <Select label="Border" value={box.border} onChange={(v) => onChange("words.border", v)} disabled={disabled} options={BORDER_OPTS} />
        <PadGrid box={box} prefix="words" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "note") {
    const box = layout.note;
    return (
      <div className="space-y-3">
        <Toggle label="Show note" checked={box.show} onChange={(v) => onChange("note.show", v)} disabled={disabled} />
        <Text label="Note text" value={box.text} onChange={(v) => onChange("note.text", v)} disabled={disabled} placeholder="Printed under amount in words" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Font size" value={box.font_pt} onChange={(v) => onChange("note.font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
          <Select label="Align" value={box.align} onChange={(v) => onChange("note.align", v)} disabled={disabled} options={ALIGN_OPTS} />
        </div>
        <Select label="Border" value={box.border} onChange={(v) => onChange("note.border", v)} disabled={disabled} options={BORDER_OPTS} />
        <PadGrid box={box} prefix="note" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  if (id === "signatures") {
    const box = layout.signatures;
    return (
      <div className="space-y-3">
        <Toggle label="Show signatures" checked={box.show} onChange={(v) => onChange("signatures.show", v)} disabled={disabled} />
        <Text label="Left text" value={box.left_text} onChange={(v) => onChange("signatures.left_text", v)} disabled={disabled} />
        <Text label="Right label" value={box.right_label} onChange={(v) => onChange("signatures.right_label", v)} disabled={disabled} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
          <Num label="Font size" value={box.font_pt} onChange={(v) => onChange("signatures.font_pt", v)} step={0.5} min={5} max={28} disabled={disabled} suffix="pt" />
          <Num label="Line length" value={box.line_w} onChange={(v) => onChange("signatures.line_w", v)} step={4} min={60} max={220} disabled={disabled} suffix="px" />
        </div>
        <PadGrid box={box} prefix="signatures" onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  return null;
}

const TITLE_CHILDREN = ["title.text", "meta.invoice", "meta.date"];
const INFO_CHILDREN = ["info.gold", "info.gstin", "info.customer", "info.phone", "info.place"];
const SIG_CHILDREN = ["signatures.left", "signatures.right"];

function customizeHint(id, layout) {
  if (id === "paper") return "Customize page size, letterhead blanks and body font.";
  const name = (widgetLabel(id, layout) || "this section").toLowerCase();
  return `Customize font, padding and layout for ${name}.`;
}

function SubList({ ids, selected, onSelect, labels }) {
  return (
    <div className="ml-6 pb-1.5 space-y-0.5">
      {ids.map((sid) => (
        <button
          key={sid}
          type="button"
          className={`w-full rounded-[7px] px-2 py-1.5 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35 ${
            selected === sid ? "bg-[#EAF1E8] font-semibold text-[#315E48]" : "text-[#66746A] hover:bg-[#F3F5EF] hover:text-[#34463A]"
          }`}
          onClick={() => onSelect(sid)}
        >
          {labels?.[sid] || SUBWIDGET_META[sid]?.label || sid}
        </button>
      ))}
    </div>
  );
}

export default function InvoiceLayoutEditor({ canWrite = false, unlocked = false, onLocked }) {
  const { company } = useCompany();
  const [layout, setLayout] = useState(DEFAULT_INVOICE_LAYOUT);
  const [selected, setSelected] = useState("paper");
  const [dragOn, setDragOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasSavedLayout, setHasSavedLayout] = useState(false);

  useEffect(() => {
    api.get("/settings/invoice").then(({ data }) => {
      setHasSavedLayout(Boolean(data?.print_layout));
      const merged = mergeInvoiceLayout(data?.print_layout);
      setLayout(merged);
      setCachedInvoiceLayout(merged);
    }).catch(() => {
      setLayout(DEFAULT_INVOICE_LAYOUT);
    }).finally(() => setLoading(false));
  }, []);

  const frozen = hasSavedLayout && !unlocked;
  const effectiveCanWrite = canWrite && !frozen;

  const onChange = (path, value) => {
    if (path === "__move_col__") {
      setLayout((prev) => moveColumn(prev, value.id, value.dir));
      return;
    }
    setLayout((prev) => setLayoutPath(prev, path, value));
  };

  const save = async () => {
    setSaving(true);
    try {
      const merged = mergeInvoiceLayout(layout);
      await api.put("/settings/invoice", { print_layout: merged });
      setLayout(merged);
      setCachedInvoiceLayout(merged);
      setHasSavedLayout(true);
      onLocked?.();
      toast.success("Invoice print layout saved — POS will use this");
    } catch (err) {
      toast.error(formatApiError(err) || "Could not save layout");
    } finally {
      setSaving(false);
    }
  };

  const testPrint = async () => {
    setTesting(true);
    try {
      await printHtml(
        generateInvoicePrintHTML(SAMPLE_INVOICE, company || {}, "print", layout),
        { printerType: "invoice" },
      );
    } catch {
      /* toast from printHtml */
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <p className="rounded-[10px] border border-[#DCE3D6] bg-[#FEFEFB] px-4 py-3 text-[12.5px] text-[#6F7C72]">Loading invoice layout…</p>;
  }

  const expandedId = selected === "paper" ? "paper" : widgetParent(selected);
  const otherIds = ["paper", ...(layout.section_order || [])];
  const letterhead = normalizeLetterhead(company, { channel: "print" });
  const previewLayout = applyLetterheadToLayout(layout, company, { channel: "print" });

  return (
    <PrintDesignerFrame
      left={(
        <div className="space-y-3">
          <PrintSettingsLockBanner frozen={frozen} />
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12.5px] text-[#737373] leading-snug">
              Click a section to customize your invoice layout
            </p>
            <DragModeToggle on={dragOn} onChange={setDragOn} disabled={!effectiveCanWrite} />
          </div>

          <div className="rounded-[10px] border border-[#DCE3D6] bg-[#FEFEFB] shadow-[0_1px_2px_rgba(36,55,45,0.04)]">
            <div className="px-3.5 pt-3 pb-1.5">
              <h3 className="font-display text-[14.5px] font-semibold text-[#294236]">{widgetLabel(selected, layout) || "Edit"}</h3>
              <p className="text-[12px] text-[#737373] mt-0.5">{customizeHint(selected, layout)}</p>
            </div>
            <div className="px-3.5 pb-2">
              <WidgetProps id={selected} layout={layout} onChange={onChange} canWrite={effectiveCanWrite} letterheadOn={letterhead.enabled} letterheadPaper={letterhead.paper_size} />
            </div>
            <div className="px-3.5 pb-3">
              <DesignerActionBar
                canWrite={effectiveCanWrite}
                saving={saving}
                testing={testing}
                onSave={save}
                onTest={testPrint}
                onReset={() => { setLayout(mergeInvoiceLayout(DEFAULT_INVOICE_LAYOUT)); setSelected("paper"); }}
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-[10px] border border-[#DCE3D6] bg-[#FEFEFB] shadow-[0_1px_2px_rgba(36,55,45,0.04)]">
            <p className="border-b border-[#DCE3D6] bg-[#F3F5EE] px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.09em] text-[#5F7064]">Other Sections</p>
            {otherIds.map((id) => {
              const visible = id === "paper" ? true : sectionVisible(layout, id);
              const expanded = expandedId === id;
              const kids = id === "title" ? TITLE_CHILDREN : id === "info" ? INFO_CHILDREN : id === "signatures" ? SIG_CHILDREN : id === "items" ? layout.items.columns.map((c) => `items.col.${c.id}`) : [];
              const colLabels = id === "items" ? Object.fromEntries(layout.items.columns.map((c) => [`items.col.${c.id}`, c.label])) : null;
              return (
                <div key={id} className="border-b border-[#DCE3D6] last:border-b-0">
                  <div className={`flex items-center transition-colors ${expanded ? "bg-[#F0F4ED]" : "hover:bg-[#F8F9F5]"}`}>
                    <button
                      type="button"
                      className="flex-1 px-3.5 py-2 text-left text-[12.5px] font-medium text-[#34463A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#78917C]/35"
                      onClick={() => setSelected(id)}
                    >
                      {SECTION_META[id]?.label || id}
                    </button>
                    {id !== "paper" && (
                      <button
                        type="button"
                        className="rounded-[7px] p-1.5 text-[#748078] transition-colors hover:bg-[#E9EFE7] hover:text-[#315E48] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35"
                        disabled={!effectiveCanWrite}
                        onClick={() => setLayout((prev) => setSectionVisible(prev, id, !visible))}
                        title={visible ? "Hide" : "Show"}
                      >
                        {visible ? <Eye size={15} /> : <EyeOff size={15} />}
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-[7px] p-1.5 text-[#8A958D] transition-colors hover:bg-[#E9EFE7] hover:text-[#315E48] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35"
                      onClick={() => setSelected(id)}
                      aria-label={expanded ? "Collapse" : "Expand"}
                    >
                      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                  </div>
                  {expanded && kids.length > 0 && (
                    <SubList ids={kids} selected={selected} onSelect={setSelected} labels={colLabels} />
                  )}
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
            subtitle={`${previewLayout.page_w_in} × ${previewLayout.page_h_in} in${letterhead.enabled ? ` · ${letterhead.paper_size} letterhead` : ""}. Click any text to edit it. ${dragOn ? "Gold bars resize by dragging." : "Turn Draggable ON to resize by dragging."}`}
          />
          <div className="overflow-auto rounded-[10px] border border-[#D6DDD3] bg-[#ECEEE8] p-2.5 shadow-inner">
            <InvoiceA5Canvas
              layout={layout}
              company={company}
              selected={selected}
              onSelect={setSelected}
              onChange={onChange}
              canWrite={effectiveCanWrite}
              draggable={dragOn}
              scale={PREVIEW_SCALE}
            />
          </div>
        </div>
      )}
    />
  );
}
