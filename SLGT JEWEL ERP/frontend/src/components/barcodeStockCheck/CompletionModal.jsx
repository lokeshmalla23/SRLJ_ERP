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
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#17201C]/55 backdrop-blur-sm p-4">
      <div className="bg-[#FFFDF9] rounded-2xl border border-[#E2E7E2] shadow-[0_18px_48px_rgba(23,56,42,0.12)] w-full max-w-sm overflow-hidden text-center">
        <div className="px-6 pt-8 pb-2">
          <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-[#EAF2ED] border border-[#CBDED2] flex items-center justify-center">
            <CheckCircle2 size={30} className="text-[#214F3A]" strokeWidth={1.75} />
          </div>
          <div className="font-display text-[17px] font-bold text-[#17201C] tracking-tight">{title}</div>
          <p className="text-[12.5px] text-[#6F7772] mt-2 leading-relaxed">{description}</p>
        </div>
        <div className="px-6 py-4 space-y-1.5 text-[13px]">
          <div className="flex justify-between"><span className="text-[#6F7772]">Total Products</span><span className="font-semibold text-[#17201C] tabular-nums">{fmtNum(summary?.expected_pieces || 0)}</span></div>
          <div className="flex justify-between"><span className="text-[#6F7772]">Checked</span><span className="font-semibold text-[#214F3A] tabular-nums">{fmtNum(summary?.scanned_pieces || 0)}</span></div>
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
