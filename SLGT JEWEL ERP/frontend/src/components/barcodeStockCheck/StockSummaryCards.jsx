import { fmtNum } from "@/lib/format";

const FOREST = "#214F3A";
const CHAMPAGNE = "#D9A441";

export default function StockSummaryCards({ summary, scopeLabel }) {
  const s = summary || {};
  const progress = s.expected_pieces > 0 ? Math.round((s.scanned_pieces / s.expected_pieces) * 100) : 0;

  const cards = [
    { label: "Expected Pieces", value: fmtNum(s.expected_pieces || 0), accent: CHAMPAGNE },
    { label: "Scanned Pieces", value: fmtNum(s.scanned_pieces || 0), cls: "text-[#214F3A]", accent: "#2F6B4F" },
    { label: "Pending Pieces", value: fmtNum(s.pending_pieces || 0), cls: s.pending_pieces > 0 ? "text-amber-600" : "text-[#17201C]", accent: s.pending_pieces > 0 ? "#FCD34D" : "#D3DCD5" },
    { label: "Progress", value: `${progress}%`, cls: progress >= 100 ? "text-[#214F3A]" : "text-[#17201C]", accent: FOREST },
  ];

  const barcodeCards = [
    { label: "Expected Barcodes", value: fmtNum(s.expected_barcodes || 0) },
    { label: "Completed Barcodes", value: fmtNum(s.completed_barcodes || 0), cls: "text-[#214F3A]" },
    { label: "Pending Barcodes", value: fmtNum(s.pending_barcodes || 0), cls: s.pending_barcodes > 0 ? "text-amber-600" : "text-[#17201C]" },
  ];

  return (
    <div className="mb-6 space-y-3">
      {scopeLabel && (
        <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#89928C]">
          Checking: <span className="text-[#17201C] font-bold">{scopeLabel}</span>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card !py-4 border-t-2 !rounded-xl !border-[#E2E7E2] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(23,56,42,0.04)]" style={{ borderTopColor: c.accent }}>
            <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#6F7772]">{c.label}</div>
            <div className={`font-display text-[26px] font-semibold mt-2 tabular-nums ${c.cls || "text-[#17201C]"}`}>{c.value}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {barcodeCards.map((c) => (
          <div key={c.label} className="card !p-3 !rounded-[10px] !border-[#E2E7E2] bg-[#FAF7EF] shadow-none">
            <div className="text-[10px] uppercase tracking-[0.1em] font-medium text-[#89928C]">{c.label}</div>
            <div className={`font-display text-[17px] font-semibold mt-1 tabular-nums ${c.cls || "text-[#17201C]"}`}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
