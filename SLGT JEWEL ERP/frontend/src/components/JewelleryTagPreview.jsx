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
    <div className={`border border-[#E5E7EB] rounded-lg shadow-sm bg-white overflow-hidden ${className}`}>
      <div className="bg-[#E8E8EA] px-2 py-3">
        {png ? (
          <img
            src={png}
            alt="Full jewellery tag preview"
            className="block w-full h-auto bg-white rounded-sm shadow-sm"
            style={{ imageRendering: "auto" }}
          />
        ) : (
          <div className="h-16 w-full bg-[#F4F4F5] rounded-sm" />
        )}
      </div>

      <div className="grid grid-cols-3 text-[10px] border-t border-[#F4F4F5]">
        <div className="text-center py-1.5 px-1 border-r border-dashed border-[#E5E7EB]">
          <div className="font-semibold text-[#0A0A0A]">Left {layout.left_mm} mm</div>
          <div className="text-[#737373]">Shop barcode / code</div>
        </div>
        <div className="text-center py-1.5 px-1 border-r border-dashed border-[#E5E7EB]">
          <div className="font-semibold text-[#0A0A0A]">Right {layout.right_mm} mm</div>
          <div className="text-[#737373]">Purity • G.W • N.W • St.W</div>
        </div>
        <div className="text-center py-1.5 px-1">
          <div className="font-semibold text-[#737373]">Stem {stem} mm</div>
          <div className="text-[#A3A3A3]">Blank (Wrap)</div>
        </div>
      </div>

      <div className="text-center text-[10px] text-[#737373] py-1.5 bg-[#F9F9F9] border-t border-[#F4F4F5] leading-snug px-2">
        Dotted line = fold • Dashed box = padding • Guides not printed
      </div>
    </div>
  );
}
