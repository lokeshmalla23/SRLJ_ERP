import { CheckCircle2 } from "lucide-react";
import { fmtNum } from "@/lib/format";

export default function CompletionModal({ summary, categoryName, onDone }) {
  const title = categoryName
    ? `${categoryName.toUpperCase()} CATEGORY COMPLETED`
    : "STOCK CHECK COMPLETED";
  const description = categoryName
    ? `All products in the ${categoryName} category have been successfully checked.`
    : "All products have been successfully checked.";

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden text-center">
        <div className="px-6 pt-8 pb-2">
          <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-green-50 flex items-center justify-center">
            <CheckCircle2 size={30} className="text-green-600" strokeWidth={1.75} />
          </div>
          <div className="font-display text-[17px] font-bold text-[#0A0A0A] tracking-tight">{title}</div>
          <p className="text-[12.5px] text-[#737373] mt-2 leading-relaxed">{description}</p>
        </div>
        <div className="px-6 py-4 space-y-1.5 text-[13px]">
          <div className="flex justify-between"><span className="text-[#737373]">Total Products</span><span className="font-semibold text-[#0A0A0A] tabular-nums">{fmtNum(summary?.expected_pieces || 0)}</span></div>
          <div className="flex justify-between"><span className="text-[#737373]">Checked</span><span className="font-semibold text-green-700 tabular-nums">{fmtNum(summary?.scanned_pieces || 0)}</span></div>
        </div>
        <div className="px-6 pb-6 pt-2">
          <button type="button" className="btn-primary w-full justify-center" onClick={onDone}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
