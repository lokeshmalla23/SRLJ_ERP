import { goToAccountsSetup } from "@/lib/accountsSetup";
import { useNavigate } from "react-router-dom";

/**
 * Visible PRE_ACCOUNTS / TEST MODE indicator. Does not block billing.
 */
export default function TestModeBanner({ compact = false, className = "" }) {
  const navigate = useNavigate();
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border border-amber-300 bg-amber-50 text-amber-950 ${
        compact ? "px-3 py-1.5 text-[11.5px]" : "px-4 py-2.5 text-[13px] rounded-xl"
      } ${className}`}
      role="status"
    >
      <div className="min-w-0 leading-snug">
        <div className={compact ? "font-semibold" : "font-semibold text-[13.5px]"}>
          TEST MODE — Accounts Setup not completed
        </div>
        {!compact && (
          <div className="text-[12px] text-amber-900/90 mt-0.5">
            Transactions created now are for testing and will not affect Live Accounts or GL.
          </div>
        )}
        {compact && (
          <span className="ml-2 font-normal text-amber-900/90">
            Test transactions will not affect Live Accounts or GL.
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => goToAccountsSetup(navigate)}
        className="shrink-0 font-semibold text-[#8A6A2D] hover:underline"
      >
        Complete Accounts Setup
      </button>
    </div>
  );
}

export function TestBadge({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-900 border border-amber-300 ${className}`}
    >
      TEST / PRE-ACCOUNTS
    </span>
  );
}
