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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl flex flex-col" style={{ width: 480, maxHeight: "85vh" }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
          <div>
            <p className="text-[14px] font-semibold text-[#0A0A0A]">Stone Details</p>
            <p className="text-[11px] text-[#737373] mt-0.5">{item?.name || item?.product_name}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#F5F5F5] text-[#737373]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {stones.length === 0 ? (
            <div className="text-center py-8 text-[13px] text-[#a3a3a3] border border-dashed border-[#E5E7EB] rounded-md">
              No stone details recorded for this item
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-[#E5E7EB]">
                  {["Stone Type", "Count", "Weight (g)", "Price (₹)"].map((h) => (
                    <th key={h} className="text-left text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] pb-2 pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F5F5F5]">
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
        <div className="px-5 py-3.5 border-t border-[#E5E7EB] flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-[#0A0A0A]">Total Stone Charges</span>
          <span className="text-[13px] font-semibold font-mono" style={{ color: accentColor }}>{fmtINR(total)}</span>
        </div>
      </div>
    </div>
  );
}
