import { useRef } from "react";
import { SAMPLE_INVOICE } from "@/lib/invoiceLayout";
import { fmtINRPlain } from "@/lib/format";
import { applyLetterheadToLayout, normalizeLetterhead } from "@/lib/invoiceLetterhead";
import { lineDescription, lineVaGrams, lineProductValueExStone, headerMetalRateLines, headerHallmark } from "@/lib/invoiceBillDisplay";

export const PREVIEW_SCALE = 0.78;

export function pagePixels(layout) {
  const wIn = Number(layout?.page_w_in) || 5.7;
  const hIn = Number(layout?.page_h_in) || 8.27;
  return { w: Math.round(wIn * 96), h: Math.round(hIn * 96), wIn, hIn };
}

function money(n) {
  return fmtINRPlain(n);
}

function startDrag(e, { value, onChange, min, max, scale = PREVIEW_SCALE, axis = "y", step = 1 }) {
  e.preventDefault();
  e.stopPropagation();
  const origin = Number(value) || 0;
  const start = axis === "y" ? e.clientY : e.clientX;
  const ptr = e.pointerId;
  e.currentTarget.setPointerCapture?.(ptr);
  const move = (ev) => {
    const now = axis === "y" ? ev.clientY : ev.clientX;
    const delta = (now - start) / scale;
    const raw = origin + (axis === "y" || axis === "x" ? delta : delta);
    const snapped = step >= 1 ? Math.round(raw) : Math.round(raw / step) * step;
    onChange(Math.min(max, Math.max(min, snapped)));
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function EdgeHandle({ side, label, onPointerDown, active }) {
  const pos =
    side === "bottom"
      ? "left-0 right-0 -bottom-1 h-2.5 cursor-ns-resize"
      : side === "top"
        ? "left-0 right-0 -top-1 h-2.5 cursor-ns-resize"
        : side === "left"
          ? "top-0 bottom-0 -left-1 w-2.5 cursor-ew-resize"
          : "top-0 bottom-0 -right-1 w-2.5 cursor-ew-resize";
  return (
    <div
      className={`absolute z-20 ${pos} ${active ? "bg-[#C08E2D]/70" : "bg-transparent hover:bg-[#C08E2D]/50"}`}
      title={label}
      onPointerDown={onPointerDown}
    />
  );
}

function isWidgetActive(id, selected) {
  if (!selected) return false;
  if (selected === id) return true;
  if (id === "title" && (String(selected).startsWith("title.") || String(selected).startsWith("meta."))) return true;
  if (id === "info" && String(selected).startsWith("info.")) return true;
  if (id === "items" && String(selected).startsWith("items.")) return true;
  if (id === "signatures" && String(selected).startsWith("signatures.")) return true;
  return false;
}

function WidgetBox({ id, selected, onSelect, mb, padT, padB, canWrite, onChange, children, style, draggable, scale = PREVIEW_SCALE }) {
  const active = isWidgetActive(id, selected);
  const showDrag = Boolean(draggable && canWrite);
  return (
    <div
      className={`relative ${active ? "outline outline-2 outline-[#C08E2D] outline-offset-[-1px] bg-[#C08E2D]/[0.06]" : "hover:outline hover:outline-1 hover:outline-[#C08E2D]/50"}`}
      style={{ marginBottom: mb || 0, cursor: "pointer", ...style }}
      onClick={(e) => { e.stopPropagation(); onSelect(id); }}
    >
      {children}
      {showDrag && (
        <>
          {padT != null && (
            <EdgeHandle
              side="top"
              active={active}
              label="Inner top space"
              onPointerDown={(e) => startDrag(e, { value: padT, onChange: (v) => onChange(`${id}.pad_t`, v), min: 0, max: 40, scale })}
            />
          )}
          {padB != null && (
            <EdgeHandle
              side="bottom"
              active={active}
              label="Inner bottom space"
              onPointerDown={(e) => startDrag(e, { value: padB, onChange: (v) => onChange(`${id}.pad_b`, v), min: 0, max: 40, scale })}
            />
          )}
        </>
      )}
      {showDrag && (
        <div
          className={`absolute left-0 right-0 z-30 ${active ? "bg-[#C08E2D]" : "bg-[#C08E2D]/40 hover:bg-[#C08E2D]"} cursor-ns-resize`}
          style={{ height: Math.max(8, Number(mb) || 0), bottom: -(Math.max(8, Number(mb) || 0)) }}
          title={`Space below: ${mb || 0}px — drag to change`}
          onPointerDown={(e) => startDrag(e, { value: mb || 0, onChange: (v) => onChange(`${id}.mb`, v), min: 0, max: 48, scale })}
        />
      )}
    </div>
  );
}

function SubHit({ id, selected, onSelect, children, style, block }) {
  const active = selected === id;
  return (
    <span
      role="button"
      className={`${block ? "block" : "inline-block"} rounded-[2px] ${
        active ? "outline outline-1 outline-[#C08E2D] bg-[#C08E2D]/15" : "hover:outline hover:outline-1 hover:outline-[#C08E2D]/50"
      }`}
      style={style}
      onClick={(e) => { e.stopPropagation(); onSelect(id); }}
    >
      {children}
    </span>
  );
}

function borderStyle(L, box, fallback = "both") {
  const mode = box?.border && box.border !== "inherit" ? box.border : (L.show_lines ? fallback : "none");
  if (mode === "none") return {};
  const w = `${L.border_pt || 1}px`;
  if (mode === "double") return { borderTop: `${w} double #000`, borderBottom: `${w} double #000` };
  if (mode === "bottom") return { borderBottom: `${w} solid #000` };
  if (mode === "top") return { borderTop: `${w} solid #000` };
  return { borderTop: `${w} solid #000`, borderBottom: `${w} solid #000` };
}

function pad(box) {
  return `${box.pad_t ?? 0}px ${box.pad_r ?? 0}px ${box.pad_b ?? 0}px ${box.pad_l ?? 0}px`;
}

function alignCss(a) {
  return a === "right" ? "right" : a === "center" ? "center" : "left";
}

export default function InvoiceA5Canvas({
  layout: L,
  company,
  selected,
  onSelect,
  onChange,
  canWrite,
  draggable = false,
  scale = PREVIEW_SCALE,
}) {
  const letterhead = normalizeLetterhead(company, { channel: "print" });
  const pageLayout = applyLetterheadToLayout(L, company, { channel: "print" }) || L;
  const { w: A5_W, h: A5_H, hIn } = pagePixels(pageLayout);
  const PREVIEW_W = Math.round(A5_W * scale);
  const PREVIEW_H = Math.round(A5_H * scale);
  const pageRef = useRef(null);
  const shop = {
    name: company?.name || "Jewellery Shop",
    gstin: company?.gst_number || company?.gstin || "36XXXXX1234X1Z5",
    state: company?.state || "Telangana",
  };
  const inv = SAMPLE_INVOICE;
  const cols = (L.items?.columns || []).filter((c) => c.show);
  const usedCols = cols.length ? cols : (L.items?.columns || []).slice(0, 3);
  const T = L.title;
  const M = L.meta;
  const I = L.info;
  const IT = L.items;
  const B = L.breakdown;
  const N = L.net;
  const P = L.payments;
  const W = L.words;
  const NT = L.note;
  const S = L.signatures;
  const dateStr = `${String(new Date(inv.created_at).getDate()).padStart(2, "0")}-${String(new Date(inv.created_at).getMonth() + 1).padStart(2, "0")}-${new Date(inv.created_at).getFullYear()}`;
  const gstPct = Number(inv.gst_pct) || 3;
  const grandTotal = Number(inv.grand_total) || 0;
  const taxableAmt = Number(inv.subtotal) || 0;
  const totalQty = inv.items.reduce((s, it) => s + (it.quantity || 1), 0);
  const totals = inv.items.reduce((acc, it) => {
    acc.gross += Number(it.gross_weight) || 0;
    acc.net += Number(it.net_weight) || 0;
    acc.va += lineVaGrams(it);
    acc.amount += lineProductValueExStone(it);
    return acc;
  }, { gross: 0, net: 0, va: 0, amount: 0 });
  const metalLines = headerMetalRateLines(inv.items);
  const headerMark = headerHallmark(inv.items);

  const colVal = (col, it) => {
    if (col.id === "qty") return it.quantity || 1;
    if (col.id === "desc") return lineDescription(it);
    if (col.id === "hsn") return it.hsn_code;
    if (col.id === "purity") return it.purity;
    if (col.id === "gross") return Number(it.gross_weight).toFixed(3);
    if (col.id === "net") return Number(it.net_weight).toFixed(3);
    if (col.id === "va") return lineVaGrams(it).toFixed(3);
    if (col.id === "value") return `₹${money(lineProductValueExStone(it))}`;
    return "";
  };
  const footVal = (col) => {
    if (col.id === "qty") return totalQty;
    if (col.id === "gross") return totals.gross.toFixed(3);
    if (col.id === "net") return totals.net.toFixed(3);
    if (col.id === "va") return totals.va.toFixed(3);
    if (col.id === "value") return `₹${money(totals.amount)}`;
    return "";
  };

  const blocks = {
    title: T.show || M.show_invoice_no || M.show_date ? (
      <WidgetBox id="title" selected={selected} onSelect={onSelect} mb={T.mb} padT={T.pad_t} padB={T.pad_b} canWrite={canWrite} onChange={onChange} draggable={draggable} scale={scale}
        style={{ ...borderStyle(L, T), padding: pad(T), position: "relative", minHeight: "1.6em" }}>
        {T.show && (
          <SubHit id="title.text" selected={selected} onSelect={onSelect} block
            style={{ fontSize: `${T.font_pt}pt`, fontWeight: T.bold ? 700 : 400, letterSpacing: `${T.letter_spacing}em`, textAlign: T.align, paddingRight: (M.show_invoice_no || M.show_date) ? "7.5em" : 0 }}>
            {T.text}
          </SubHit>
        )}
        <div style={{ position: "absolute", right: T.pad_r, top: "50%", transform: "translateY(-50%)", textAlign: alignCss(M.align), lineHeight: 1.55 }}>
          {M.show_invoice_no && (
            <SubHit id="meta.invoice" selected={selected} onSelect={onSelect} block style={{ fontSize: `${M.invoice_font_pt || M.font_pt}pt` }}>
              {M.invoice_label} <strong>{inv.invoice_no}</strong>
            </SubHit>
          )}
          {M.show_date && (
            <SubHit id="meta.date" selected={selected} onSelect={onSelect} block style={{ fontSize: `${M.date_font_pt || M.font_pt}pt` }}>
              {M.date_label} {dateStr}
            </SubHit>
          )}
        </div>
      </WidgetBox>
    ) : null,
    info: I.show ? (
      <WidgetBox id="info" selected={selected} onSelect={onSelect} mb={I.mb} padT={I.pad_t} padB={I.pad_b} canWrite={canWrite} onChange={onChange} draggable={draggable} scale={scale}
        style={{ ...borderStyle(L, I, "bottom"), padding: pad(I), display: "grid", gridTemplateColumns: `${I.left_width}% ${100 - I.left_width}%`, lineHeight: I.line_h }}>
        <div className="relative pr-2" style={{ display: "flex", flexDirection: "column", gap: `${I.line_gap ?? 1}px` }}>
          {I.show_gold_rate && metalLines.map((line, idx) => (
            <SubHit key={`metal-${idx}`} id="info.gold" selected={selected} onSelect={onSelect} block style={{ fontSize: `${I.gold_pt || I.font_pt}pt` }}>
              {line.metal && line.rate > 0
                ? <>{line.metal} : ₹{money(line.rate)}/g</>
                : (line.metal || (line.rate > 0 ? <>₹{money(line.rate)}/g</> : null))}
            </SubHit>
          ))}
          {headerMark ? (
            <div style={{ fontSize: `${I.gold_pt || I.font_pt}pt` }}>Hallmark No : {headerMark}</div>
          ) : null}
          {I.show_gstin && shop.gstin && (
            <SubHit id="info.gstin" selected={selected} onSelect={onSelect} block style={{ fontSize: `${I.gstin_pt || I.font_pt}pt` }}>
              GSTIN : {shop.gstin}
            </SubHit>
          )}
          {draggable && canWrite && (
            <div
              className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize z-20 hover:bg-[#C08E2D]/60"
              title="Drag to resize left / right columns"
              onPointerDown={(e) => startDrag(e, { value: I.left_width, onChange: (v) => onChange("info.left_width", v), min: 25, max: 75, axis: "x", scale: scale * 3 })}
            />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: `${I.line_gap ?? 1}px` }}>
          {I.show_customer && (
            <SubHit id="info.customer" selected={selected} onSelect={onSelect} block style={{ fontSize: `${I.customer_pt || I.font_pt}pt` }}>
              <div>Customer : <strong>{inv.customer_name}</strong></div>
            </SubHit>
          )}
          {inv.customer_address && (
            <div style={{ fontSize: `${I.place_pt || I.font_pt}pt` }}>Address : {inv.customer_address}</div>
          )}
          {I.show_phone && inv.customer_mobile && (
            <SubHit id="info.phone" selected={selected} onSelect={onSelect} block style={{ fontSize: `${I.phone_pt || I.font_pt}pt` }}>
              Mobile : {inv.customer_mobile}
            </SubHit>
          )}
          {inv.pan_number && (
            <div style={{ fontSize: `${I.place_pt || I.font_pt}pt` }}>PAN No : {inv.pan_number}</div>
          )}
          {inv.aadhaar_number && (
            <div style={{ fontSize: `${I.place_pt || I.font_pt}pt` }}>Aadhaar No : {inv.aadhaar_number}</div>
          )}
        </div>
      </WidgetBox>
    ) : null,
    items: IT.show ? (
      <WidgetBox id="items" selected={selected} onSelect={onSelect} mb={IT.mb} canWrite={canWrite} onChange={onChange} draggable={draggable} scale={scale}>
        <table className="w-full border-collapse" style={{ tableLayout: "fixed", fontSize: `${IT.body_pt}pt` }}>
          <colgroup>
            {usedCols.map((c) => <col key={c.id} style={{ width: `${c.width}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              {usedCols.map((c, idx) => (
                <th key={c.id} className="relative" style={{
                  background: selected === `items.col.${c.id}` ? "#C08E2D" : IT.header_bg, color: IT.header_fg,
                  padding: `${IT.head_pad_y}px ${IT.cell_pad_x}px`,
                  fontSize: `${IT.header_pt}pt`,
                  textAlign: alignCss(c.align),
                  cursor: "pointer",
                }}
                  onClick={(e) => { e.stopPropagation(); onSelect(`items.col.${c.id}`); }}
                >
                  {c.label}
                  {draggable && canWrite && idx < usedCols.length - 1 && (
                    <div
                      className="absolute top-0 bottom-0 right-0 w-2 cursor-col-resize z-20 hover:bg-white/40"
                      title={`Column width ${c.width}% — drag`}
                      onPointerDown={(e) => startDrag(e, {
                        value: c.width,
                        onChange: (v) => onChange(`items.columns.${c.id}.width`, v),
                        min: 4, max: 50, axis: "x", scale: scale * 4,
                      })}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={i}>
                {usedCols.map((c) => (
                  <td key={c.id} style={{
                    padding: `${IT.cell_pad_y}px ${IT.cell_pad_x}px`,
                    textAlign: alignCss(c.align),
                    borderBottom: L.show_lines ? "1px dotted #bbb" : "none",
                    outline: selected === `items.col.${c.id}` ? "1px solid #C08E2D" : "none",
                    cursor: "pointer",
                  }}
                    onClick={(e) => { e.stopPropagation(); onSelect(`items.col.${c.id}`); }}
                  >{colVal(c, it)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {usedCols.map((c) => (
                <td key={c.id} style={{
                  padding: `${IT.cell_pad_y}px ${IT.cell_pad_x}px`,
                  fontWeight: 700,
                  textAlign: alignCss(c.align),
                  background: IT.footer_bg,
                  borderTop: L.show_lines ? "1.5px solid #000" : "none",
                  fontSize: `${IT.footer_pt}pt`,
                }}>{footVal(c)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
        {draggable && canWrite && (
          <div
            className="h-2 cursor-ns-resize bg-[#C08E2D]/40 hover:bg-[#C08E2D]"
            title="Row padding — drag"
            onPointerDown={(e) => startDrag(e, { value: IT.cell_pad_y, onChange: (v) => onChange("items.cell_pad_y", v), min: 0, max: 14, scale })}
          />
        )}
      </WidgetBox>
    ) : null,
    breakdown: B.show ? (
      <WidgetBox id="breakdown" selected={selected} onSelect={onSelect} mb={B.mb} padT={B.pad_t} padB={B.pad_b} canWrite={canWrite} onChange={onChange} draggable={draggable} scale={scale}
        style={{ ...borderStyle(L, B, "bottom"), padding: pad(B), display: "flex", justifyContent: B.align === "left" ? "flex-start" : "flex-end" }}>
        <table style={{ fontSize: `${B.font_pt}pt`, width: `${B.width_pct}%`, borderCollapse: "collapse" }}>
          <tbody>
            <tr><td>{B.taxable_label}</td><td className="text-right font-mono">{money(taxableAmt)}</td></tr>
            <tr><td>CGST {(gstPct / 2).toFixed(1)}%</td><td className="text-right font-mono">{money(inv.cgst_amount)}</td></tr>
            <tr><td>SGST {(gstPct / 2).toFixed(1)}%</td><td className="text-right font-mono">{money(inv.sgst_amount)}</td></tr>
          </tbody>
        </table>
        {draggable && canWrite && (
          <div
            className="absolute top-0 bottom-0 cursor-ew-resize w-2 hover:bg-[#C08E2D]/50"
            style={{ [B.align === "left" ? "left" : "right"]: `${100 - B.width_pct}%` }}
            title="Block width — drag"
            onPointerDown={(e) => startDrag(e, { value: B.width_pct, onChange: (v) => onChange("breakdown.width_pct", v), min: 30, max: 80, axis: "x", scale: scale * 3 })}
          />
        )}
      </WidgetBox>
    ) : null,
    net: N.show ? (
      <WidgetBox id="net" selected={selected} onSelect={onSelect} mb={N.mb} padT={N.pad_t} padB={N.pad_b} canWrite={canWrite} onChange={onChange} draggable={draggable} scale={scale}
        style={{ ...borderStyle(L, N), padding: pad(N), display: "flex", fontWeight: N.bold ? 700 : 400, fontSize: `${N.font_pt}pt`, background: N.bg, gap: 14 }}>
        <span>{totalQty}</span>
        {usedCols.some((c) => c.id === "gross") && <span>{totals.gross.toFixed(3)}</span>}
        {usedCols.some((c) => c.id === "net") && <span>{totals.net.toFixed(3)}</span>}
        <span className="flex-1" />
        <span>{N.label}  {money(grandTotal)}</span>
      </WidgetBox>
    ) : null,
    payments: P.show ? (
      <WidgetBox id="payments" selected={selected} onSelect={onSelect} mb={P.mb} padT={P.pad_t} padB={P.pad_b} canWrite={canWrite} onChange={onChange} draggable={draggable} scale={scale}
        style={{ ...borderStyle(L, P, "bottom"), padding: pad(P), fontSize: `${P.font_pt}pt` }}>
        {(inv.payments || []).map((p, i) => (
          <div key={i} className="flex justify-between" style={{ maxWidth: 180 }}>
            <span>{String(p.mode || "cash").replace(/_/g, " ").toUpperCase()}</span>
            <span className="font-mono">₹{money(p.amount)}</span>
          </div>
        ))}
      </WidgetBox>
    ) : null,
    words: W.show ? (
      <WidgetBox id="words" selected={selected} onSelect={onSelect} mb={W.mb} padT={W.pad_t} padB={W.pad_b} canWrite={canWrite} onChange={onChange} draggable={draggable} scale={scale}
        style={{ ...borderStyle(L, W, "bottom"), padding: pad(W), fontSize: `${W.font_pt}pt` }}>
        {W.prefix} <strong>Forty Six Thousand Six Hundred Thirty Eight {W.suffix}</strong>
      </WidgetBox>
    ) : null,
    note: NT.show && NT.text ? (
      <WidgetBox id="note" selected={selected} onSelect={onSelect} mb={NT.mb} padT={NT.pad_t} padB={NT.pad_b} canWrite={canWrite} onChange={onChange} draggable={draggable} scale={scale}
        style={{ padding: pad(NT), fontSize: `${NT.font_pt}pt`, textAlign: NT.align }}>
        {NT.text}
      </WidgetBox>
    ) : null,
    signatures: S.show ? (
      <WidgetBox id="signatures" selected={selected} onSelect={onSelect} mb={S.mb} padT={S.pad_t} padB={S.pad_b} canWrite={canWrite} onChange={onChange} draggable={draggable} scale={scale}
        style={{ padding: pad(S), display: "flex", justifyContent: "space-between", lineHeight: 1.7 }}>
        <SubHit id="signatures.left" selected={selected} onSelect={onSelect} style={{ fontSize: `${S.left_font_pt || S.font_pt}pt`, textAlign: "center" }}>
          {S.left_text}<br />{"_".repeat(16)}
        </SubHit>
        <SubHit id="signatures.right" selected={selected} onSelect={onSelect} style={{ fontSize: `${S.right_font_pt || S.font_pt}pt`, textAlign: "center" }}>
          For {shop.name}<br />{"_".repeat(16)}<br /><span style={{ fontSize: "6.5pt", color: "#555" }}>{S.right_label}</span>
        </SubHit>
      </WidgetBox>
    ) : null,
  };

  return (
    <div className="relative bg-white shadow-md overflow-hidden" style={{ width: PREVIEW_W, height: PREVIEW_H }}>
      <div
        ref={pageRef}
        className="absolute top-0 left-0 bg-white text-black"
        style={{
          width: A5_W,
          height: A5_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: `${L.font_pt}pt`,
          lineHeight: L.line_h,
          padding: `${L.header_in}in ${L.side_in}in ${L.footer_in}in ${L.side_in}in`,
          boxSizing: "border-box",
          position: letterhead.enabled ? "relative" : undefined,
        }}
        onClick={() => onSelect("paper")}
      >
        {letterhead.enabled && (
          <img
            src={letterhead.image}
            alt=""
            className="pointer-events-none"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              zIndex: 0,
            }}
          />
        )}
        <div style={letterhead.enabled ? { position: "relative", zIndex: 1 } : undefined}>
        {(L.section_order || []).map((id) => <div key={id}>{blocks[id]}</div>)}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onSelect("paper")}
        onPointerDown={draggable && canWrite ? (e) => startDrag(e, {
          value: L.header_in,
          onChange: (v) => onChange("header_in", v),
          min: 0.4, max: 2.4, step: 0.05, scale: 96 * scale,
        }) : undefined}
        className={`absolute inset-x-0 top-0 z-10 text-[9px] font-semibold flex items-end justify-center pb-1 border-b border-dashed ${
          draggable ? "cursor-ns-resize" : "cursor-pointer"
        } ${
          selected === "paper"
            ? letterhead.enabled
              ? "bg-rose-400/25 text-rose-950 border-rose-500"
              : "bg-rose-400/45 text-rose-950 border-rose-500"
            : letterhead.enabled
              ? "bg-rose-400/15 text-rose-950 border-rose-400"
              : "bg-rose-400/30 text-rose-950 border-rose-400"
        }`}
        style={{ height: `${(L.header_in / hIn) * 100}%` }}
        title="Drag to change header blank"
      >
        {letterhead.enabled ? "Letterhead header" : "Pre-printed header"}{draggable ? " · drag to resize" : ""}
      </button>
      <button
        type="button"
        onClick={() => onSelect("paper")}
        onPointerDown={draggable && canWrite ? (e) => startDrag(e, {
          value: L.footer_in,
          onChange: (v) => onChange("footer_in", v),
          min: 0.3, max: 1.8, step: 0.05, scale: 96 * scale,
        }) : undefined}
        className={`absolute inset-x-0 bottom-0 z-10 text-[9px] font-semibold flex items-start justify-center pt-1 border-t border-dashed ${
          draggable ? "cursor-ns-resize" : "cursor-pointer"
        } ${
          selected === "paper"
            ? letterhead.enabled
              ? "bg-rose-400/25 text-rose-950 border-rose-500"
              : "bg-rose-400/45 text-rose-950 border-rose-500"
            : letterhead.enabled
              ? "bg-rose-400/15 text-rose-950 border-rose-400"
              : "bg-rose-400/30 text-rose-950 border-rose-400"
        }`}
        style={{ height: `${(L.footer_in / hIn) * 100}%` }}
        title="Drag to change footer blank"
      >
        {letterhead.enabled ? "Letterhead footer" : "Pre-printed footer"}{draggable ? " · drag to resize" : ""}
      </button>
    </div>
  );
}
