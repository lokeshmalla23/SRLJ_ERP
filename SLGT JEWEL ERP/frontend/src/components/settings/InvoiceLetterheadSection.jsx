import { useRef, useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/settings/settingsLayout";
import useConfirm from "@/hooks/useConfirm";
import {
  LETTERHEAD_PAPER,
  formatLetterheadBytes,
  letterheadAspectWarning,
  normalizeLetterhead,
  validateLetterheadFile,
} from "@/lib/invoiceLetterhead";

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#67766B]">{label}</span>
      {children}
    </label>
  );
}

export default function InvoiceLetterheadSection({ form, setField, disabled = false, actions = null }) {
  const inputRef = useRef(null);
  const [confirm, confirmModal] = useConfirm();
  const [aspectWarning, setAspectWarning] = useState(null);
  const lh = normalizeLetterhead(form);
  const paper = LETTERHEAD_PAPER[lh.paper_size];
  const previewW = lh.paper_size === "A4" ? 168 : lh.paper_size === "A6" ? 112 : 140;

  const applyImage = (file) => {
    const check = validateLetterheadFile(file);
    if (!check.ok) {
      toast.error(check.message);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const img = new Image();
      img.onload = () => {
        const warn = letterheadAspectWarning(img.naturalWidth, img.naturalHeight, lh.paper_size);
        setAspectWarning(warn);
        if (warn) toast.warning(warn);
        setField("invoice_letterhead_image", dataUrl);
        setField("invoice_letterhead_file_name", file.name || "");
        setField("invoice_letterhead_file_size", file.size || 0);
        setField("invoice_letterhead_width_px", img.naturalWidth || 0);
        setField("invoice_letterhead_height_px", img.naturalHeight || 0);
      };
      img.onerror = () => {
        toast.error("Could not read that image. Try PNG, JPG, or WebP.");
      };
      img.src = dataUrl;
    };
    reader.onerror = () => toast.error("Could not read that file");
    reader.readAsDataURL(file);
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || disabled) return;
    applyImage(file);
  };

  const onPaperChange = (nextSize) => {
    setField("invoice_letterhead_paper_size", nextSize);
    if (form.invoice_letterhead_width_px && form.invoice_letterhead_height_px) {
      const warn = letterheadAspectWarning(
        form.invoice_letterhead_width_px,
        form.invoice_letterhead_height_px,
        nextSize,
      );
      setAspectWarning(warn);
    }
  };

  const removeLetterhead = async () => {
    if (disabled) return;
    const ok = await confirm("Remove the invoice letterhead image? Company logo and other profile details will not change.", {
      title: "Remove letterhead",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setField("invoice_letterhead_image", "");
    setField("invoice_letterhead_file_name", "");
    setField("invoice_letterhead_file_size", 0);
    setField("invoice_letterhead_width_px", 0);
    setField("invoice_letterhead_height_px", 0);
    setField("invoice_letterhead_enabled", false);
    setField("invoice_letterhead_on_print", false);
    setField("invoice_letterhead_on_download", false);
    setAspectWarning(null);
  };

  return (
    <SettingsSection
      title="Invoice Letterhead"
      description="Upload one full-page letterhead image. Turn Print and Download on or off in Settings → Billing. Header and footer blanks in Invoice Print keep content out of the pre-printed areas."
      actions={actions}
    >
      {confirmModal}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Paper Size">
          <select
            className="input"
            value={lh.paper_size}
            disabled={disabled}
            onChange={(e) => onPaperChange(e.target.value)}
          >
            {Object.values(LETTERHEAD_PAPER).map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-[#a3a3a3] mt-1">
            {paper.wMm} × {paper.hMm} mm · {paper.wIn} × {paper.hIn} in
          </p>
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Letterhead Image">
          <div className="flex flex-wrap items-start gap-4">
            <div
              className="flex items-center justify-center overflow-hidden rounded-[9px] border border-[#C9D2C6] bg-[#F0F2EC] shadow-[0_1px_2px_rgba(36,55,45,0.06)]"
              style={{
                width: previewW,
                aspectRatio: `${paper.wMm} / ${paper.hMm}`,
              }}
            >
              {lh.image ? (
                <img
                  src={lh.image}
                  alt="Invoice letterhead preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-[10px] text-[#a3a3a3] px-2 text-center">No letterhead</span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {!disabled && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="btn-secondary cursor-pointer">
                    {lh.image ? "Replace letterhead" : "Upload letterhead"}
                    <input
                      ref={inputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                      className="hidden"
                      onChange={onFile}
                      disabled={disabled}
                    />
                  </label>
                  {lh.image && (
                    <button type="button" className="btn-secondary" onClick={removeLetterhead}>
                      Remove
                    </button>
                  )}
                </div>
              )}
              {lh.image ? (
                <p className="text-[12px] text-[#525252]">
                  {lh.file_name || "letterhead"}
                  {lh.file_size ? ` · ${formatLetterheadBytes(lh.file_size)}` : ""}
                  {` · ${lh.paper_size}`}
                  {lh.width_px && lh.height_px ? ` · ${lh.width_px}×${lh.height_px} px` : ""}
                </p>
              ) : (
                <p className="text-[12px] text-[#737373]">PNG, JPG or WebP. Maximum 5 MB.</p>
              )}
              {(aspectWarning || letterheadAspectWarning(lh.width_px, lh.height_px, lh.paper_size)) && (
                <p className="rounded-[9px] border border-[#E7D5AA] bg-[#FBF7ED] px-2.5 py-1.5 text-[12px] text-[#755D25]">
                  {aspectWarning || letterheadAspectWarning(lh.width_px, lh.height_px, lh.paper_size)}
                </p>
              )}
            </div>
          </div>
        </Field>
      </div>

      <p className="text-[11.5px] text-[#a3a3a3] mt-3">
        For best printing quality, upload a letterhead image designed at the selected paper size and preferably 300 DPI.
        Then turn Print and Download on in Settings → Billing. Header Blank and Footer Blank on Invoice Print reserve the safe areas so ERP text does not overlap the letterhead header or footer.
      </p>
    </SettingsSection>
  );
}
