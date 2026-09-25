import { useEffect, useState } from "react";
import { renderStripTagPng } from "@/lib/labelPrint";
import { getCachedBarcodeLayout, loadBarcodeLayout } from "@/lib/barcodeLayout";

/**
 * On-screen jewellery tag preview — full tag visible, fold + padding guides.
 * Print path uses renderStripTagPng without guides / at 1× scale.
 */
export default function JewelleryTagPreview({ product, shopName, className = "", layout: layoutProp = null }) {
  const [layout, setLayout] = useState(layoutProp || getCachedBarcodeLayout());

  useEffect(() => {
    if (layoutProp) {
      setLayout(layoutProp);
      return;
    }
    loadBarcodeLayout().then(setLayout).catch(() => {});
  }, [layoutProp]);

  const png = product
    ? renderStripTagPng(product, shopName, { showGuides: true, scale: 3, layout })
    : null;

  const stem = Math.max(0, +(layout.tag_w_mm - layout.left_mm - layout.right_mm).toFixed(1));

  return (
    <div className={`overflow-hidden rounded-xl border border-[#E2E7E2] bg-[#FFFDF9] shadow-soft ${className}`}>
      <div className="border-b border-[#E2E7E2] bg-[linear-gradient(135deg,#FAF7EF_0%,#EEF3F7_100%)] px-2 py-3">
        {png ? (
          <img
            src={png}
            alt="Full jewellery tag preview"
            className="block h-auto w-full rounded-sm bg-white shadow-soft"
            style={{ imageRendering: "auto" }}
          />
        ) : (
          <div className="h-16 w-full rounded-lg border border-dashed border-[#D3DCD5] bg-[#F1F4F0] shadow-[inset_0_1px_2px_rgba(23,56,42,0.04)]" />
        )}
      </div>

      <div className="grid grid-cols-3 border-b border-[#E2E7E2] bg-[#FFFDF9] text-[10px]">
        <div className="border-r border-dashed border-[#D3DCD5] bg-[#FBFAF6] px-1 py-1.5 text-center">
          <div className="font-semibold text-[#214F3A]">Left {layout.left_mm} mm</div>
          <div className="text-[#6F7772]">Shop barcode / code</div>
        </div>
        <div className="border-r border-dashed border-[#D3DCD5] bg-[#FAF7EF] px-1 py-1.5 text-center">
          <div className="font-semibold text-[#214F3A]">Right {layout.right_mm} mm</div>
          <div className="text-[#6F7772]">Purity • G.W • N.W • St.W</div>
        </div>
        <div className="bg-[#F7F9F6] px-1 py-1.5 text-center">
          <div className="font-semibold text-[#52677A]">Stem {stem} mm</div>
          <div className="text-[#89928C]">Blank (Wrap)</div>
        </div>
      </div>

      <div className="bg-[#F1F4F0] px-2 py-1.5 text-center text-[10px] leading-snug text-[#6F7772]">
        Dotted line = fold • Dashed box = padding • Guides not printed
      </div>
    </div>
  );
}
