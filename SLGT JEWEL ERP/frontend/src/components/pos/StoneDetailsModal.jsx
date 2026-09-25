import { useEffect } from "react";
import { X } from "lucide-react";
import MoneyInput from "@/components/ui/MoneyInput";
import { fmtINR } from "@/lib/format";

/**
 * Stone Details drill-in modal ("Stone charges" breakdown row) — shared by
 * POS Billing and Estimation editing so both reuse the exact same stone
 * pricing UI/behavior instead of duplicating it.
 */
export default function StoneDetailsModal({ item, onClose, onChangePrice, accentColor = "#C08E2D" }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stones = Array.isArray(item?.stones) ? item.stones : [];
  const total = stones.reduce((s, r) => s + (Number(r?.price) || 0), 0);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#20352A]/40 backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="bg-[#FFFDF8] rounded-[14px] border border-[#DCE3D6] shadow-[0_18px_50px_rgba(35,58,43,0.18)] flex flex-col" style={{ width: 480, maxHeight: "85vh" }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#DCE3D6]">
          <div>
            <p className="text-[14px] font-semibold text-[#2F3A32]">Stone Details</p>
            <p className="text-[11px] text-[#6E786F] mt-0.5">{item?.name || item?.product_name}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#F1F4ED] text-[#8D998F] hover:text-[#244B39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] transition-colors">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 bg-[#FFFDF8]">
          {stones.length === 0 ? (
            <div className="text-center py-8 text-[13px] text-[#8D998F] border border-dashed border-[#DCE3D6] rounded-[9px] bg-[#F1F4ED]">
              No stone details recorded for this item
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-[#DCE3D6]">
                  {["Stone Type", "Count", "Weight (g)", "Price (₹)"].map((h) => (
                    <th key={h} className="text-left text-[11px] uppercase tracking-[0.09em] font-semibold text-[#6E786F] pb-2 pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E8E0]">
                {stones.map((s, idx) => {
                  const grams = Math.round((Number(s.total_carat) || 0) * 0.2 * 1000) / 1000;
                  return (
                    <tr key={idx}>
                      <td className="py-2 pr-3">{s.stone_type || "—"}</td>
                      <td className="py-2 pr-3 font-mono">{s.count || 0}</td>
                      <td className="py-2 pr-3 font-mono">{grams.toFixed(3)}</td>
                      <td className="py-2 pr-3 w-[120px]">
                        <MoneyInput
                          value={s.price ?? 0}
                          className="input font-mono text-[12.5px]"
                          onValueChange={(_, amount) => onChangePrice?.(idx, amount)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-3.5 border-t border-[#DCE3D6] flex items-center justify-between bg-[#F7F8F2]">
          <span className="text-[12.5px] font-semibold text-[#2F3A32]">Total Stone Charges</span>
          <span className="text-[13px] font-semibold font-mono" style={{ color: accentColor }}>{fmtINR(total)}</span>
        </div>
      </div>
    </div>
  );
}
