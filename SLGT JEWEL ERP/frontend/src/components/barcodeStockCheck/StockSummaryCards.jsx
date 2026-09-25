import { fmtNum } from "@/lib/format";

const GOLD = "#B49042";

export default function StockSummaryCards({ summary, scopeLabel }) {
  const s = summary || {};
  const progress = s.expected_pieces > 0 ? Math.round((s.scanned_pieces / s.expected_pieces) * 100) : 0;

  const cards = [
    { label: "Expected Pieces", value: fmtNum(s.expected_pieces || 0), accent: "#D8CBA8" },
    { label: "Scanned Pieces", value: fmtNum(s.scanned_pieces || 0), cls: "text-green-700", accent: "#86EFAC" },
    { label: "Pending Pieces", value: fmtNum(s.pending_pieces || 0), cls: s.pending_pieces > 0 ? "text-amber-600" : "text-[#0A0A0A]", accent: s.pending_pieces > 0 ? "#FCD34D" : "#E5E7EB" },
    { label: "Progress", value: `${progress}%`, cls: progress >= 100 ? "text-green-700" : "text-[#0A0A0A]", accent: GOLD },
  ];

  const barcodeCards = [
    { label: "Expected Barcodes", value: fmtNum(s.expected_barcodes || 0) },
    { label: "Completed Barcodes", value: fmtNum(s.completed_barcodes || 0), cls: "text-green-700" },
    { label: "Pending Barcodes", value: fmtNum(s.pending_barcodes || 0), cls: s.pending_barcodes > 0 ? "text-amber-600" : "text-[#0A0A0A]" },
  ];

  return (
    <div className="mb-6 space-y-3">
      {scopeLabel && (
        <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#a3a3a3]">
          Checking: <span className="text-[#0A0A0A] font-bold">{scopeLabel}</span>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card !py-4 border-t-2" style={{ borderTopColor: c.accent }}>
            <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#737373]">{c.label}</div>
            <div className={`font-display text-[26px] font-semibold mt-2 tabular-nums ${c.cls || "text-[#0A0A0A]"}`}>{c.value}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {barcodeCards.map((c) => (
          <div key={c.label} className="card !p-3">
            <div className="text-[10px] uppercase tracking-[0.1em] font-medium text-[#a3a3a3]">{c.label}</div>
            <div className={`font-display text-[17px] font-semibold mt-1 tabular-nums ${c.cls || "text-[#0A0A0A]"}`}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
