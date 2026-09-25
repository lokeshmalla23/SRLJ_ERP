import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { playStockAlertSound } from "@/lib/stockAlert";

const FIELD_LABEL = {
  DUPLICATE_MOBILE: "mobile number",
  DUPLICATE_AADHAAR: "Aadhaar number",
  DUPLICATE_PAN: "PAN number",
};

const FIELD_KEY = {
  DUPLICATE_MOBILE: "mobile",
  DUPLICATE_AADHAAR: "aadhaar_number",
  DUPLICATE_PAN: "pan_number",
};

/**
 * Shown when POST/PATCH /customers, or POST /invoices (KYC captured at
 * billing time), 409s because the mobile/Aadhaar/PAN just entered already
 * belongs to another customer. `error` is the raw API error object — pass it
 * straight from the catch block (dupInfo(err) below extracts what it needs,
 * so callers don't need to know the response shape). The customers routes
 * put `existing`/`matches` at the top level; the billing route nests it under
 * `details` — check both.
 *
 * Mobile is a contact/search field, not a unique identifier, so several
 * customers can legitimately share one — `matches` lists all of them and the
 * dialog lets the user pick the right one or confirm this really is a new,
 * distinct person. Aadhaar/PAN are true unique IDs, so those stay a hard
 * block with no "create anyway" option.
 */
export function dupInfo(err) {
  const data = err?.response?.data;
  const code = data?.code;
  if (!code || !FIELD_LABEL[code]) return null;
  const existing = data.existing || data.details?.existing || null;
  const matches = data.matches || data.details?.matches || (existing ? [existing] : []);
  return {
    code,
    fieldLabel: FIELD_LABEL[code],
    fieldKey: FIELD_KEY[code],
    existing,
    matches,
  };
}

export default function DuplicateCustomerDialog({
  info,
  onViewCustomer,
  onCreateAnyway,
  onClose,
  viewing,
  creating,
}) {
  // Reuses the same "Stock Alert Sound" configured in Settings — same idea:
  // catch the cashier's attention the moment a blocking popup appears.
  useEffect(() => {
    if (info) playStockAlertSound();
  }, [info]);

  if (!info) return null;
  const { fieldLabel, fieldKey, matches = [] } = info;
  const isMobile = info.code === "DUPLICATE_MOBILE";
  const multiple = matches.length > 1;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-2xl w-full max-w-sm">
        <div className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5 text-amber-500"><AlertTriangle size={20} strokeWidth={1.75} /></div>
            <div>
              <p className="text-[14px] font-semibold text-[#0A0A0A]">
                {multiple ? "Multiple matching customers" : "Already registered"}
              </p>
              <p className="text-[13px] text-[#525252] mt-1">
                {multiple
                  ? `${matches.length} existing customers use this ${fieldLabel}.`
                  : `This ${fieldLabel} is already used by another customer.`}
                {isMobile && " Pick the correct one, or continue to add this as a new customer."}
              </p>
            </div>
          </div>
          {matches.length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {matches.map((m) => {
                const matchedValue = m?.[fieldKey] || m?.mobile;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onViewCustomer(m)}
                    disabled={viewing || creating}
                    className="w-full text-left bg-[#F5F5F5] hover:bg-[#EFEFEF] rounded-md px-3 py-2.5 text-[13px] disabled:opacity-60"
                  >
                    <p className="font-medium text-[#0A0A0A]">{m.name}</p>
                    <p className="text-[#737373] font-mono">{matchedValue}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-5 py-3.5 border-t border-[#E5E7EB] flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-[13px]">
            Cancel
          </button>
          {isMobile && onCreateAnyway && (
            <button
              type="button"
              onClick={onCreateAnyway}
              disabled={viewing || creating}
              className="btn-secondary text-[13px]"
            >
              {creating ? "Creating…" : "Create new customer anyway"}
            </button>
          )}
          {!multiple && matches[0] && (
            <button
              type="button"
              onClick={() => onViewCustomer(matches[0])}
              disabled={viewing || creating}
              className="btn-primary text-[13px]"
            >
              {viewing ? "Loading…" : isMobile ? "Use this customer" : "View this customer"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
