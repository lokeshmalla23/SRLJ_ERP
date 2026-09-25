import { goToAccountsSetup } from "@/lib/accountsSetup";
import { useNavigate } from "react-router-dom";

/**
 * Visible PRE_ACCOUNTS / TEST MODE indicator. Does not block billing.
 */
export default function TestModeBanner({ compact = false, className = "" }) {
  const navigate = useNavigate();
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border border-[#DCCBAA] bg-[#FBF7ED] text-[#173F32] shadow-[0_2px_8px_rgba(23,63,50,0.06)] ${
        compact ? "px-3 py-2 text-[11.5px]" : "rounded-xl px-4 py-3 text-[13px]"
      } ${className}`}
      role="status"
    >
      <div className="flex min-w-0 items-start gap-2.5 leading-snug">
        <span
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#B49042] shadow-[0_0_0_3px_rgba(180,144,66,0.13)] ${
            compact ? "mt-1" : "mt-1.5"
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className={compact ? "font-semibold" : "font-semibold text-[13.5px]"}>
            TEST MODE — Accounts Setup not completed
          </div>
          {!compact && (
            <div className="mt-0.5 text-[12px] text-[#5E6B63]">
              Transactions created now are for testing and will not affect Live Accounts or GL.
            </div>
          )}
          {compact && (
            <span className="font-normal text-[#5E6B63]">
              Test transactions will not affect Live Accounts or GL.
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => goToAccountsSetup(navigate)}
        className={`shrink-0 rounded-md border border-[#D8C49A] bg-[#FCFAF4] font-semibold text-[#6F5729] shadow-sm transition-colors hover:border-[#B49042] hover:bg-[#F4EBD8] focus:outline-none focus:ring-2 focus:ring-[#B49042]/35 ${
          compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-[12px]"
        }`}
      >
        Complete Accounts Setup
      </button>
    </div>
  );
}

export function TestBadge({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-[#D8C49A] bg-[#F6F0E4] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6F5729] ${className}`}
    >
      TEST / PRE-ACCOUNTS
    </span>
  );
}
