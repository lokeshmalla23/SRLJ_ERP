import { useRef, useState } from "react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { hasFullAccessRole } from "@/lib/roleLabel";
import HiddenBillPasswordDialog from "@/components/pos/HiddenBillPasswordDialog";

/**
 * Triple-click title + PIN dialog + lock badge — same flow as Accounts / Reports.
 */
export function useHiddenBillUnlockGate(unlocked, setUnlocked) {
  const { user } = useAuth();
  const isOwner = hasFullAccessRole(user?.role);
  const titleClicksRef = useRef({ count: 0, timer: null });
  const [hiddenPwOpen, setHiddenPwOpen] = useState(false);
  const [hiddenPwBusy, setHiddenPwBusy] = useState(false);
  const [hiddenPwError, setHiddenPwError] = useState("");

  const handleTitleClick = () => {
    if (!isOwner || unlocked) return;
    const state = titleClicksRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.count += 1;
    if (state.count >= 3) {
      state.count = 0;
      state.timer = null;
      setHiddenPwError("");
      setHiddenPwOpen(true);
    } else {
      state.timer = setTimeout(() => {
        state.count = 0;
        state.timer = null;
      }, 2500);
    }
  };

  const lockButton = unlocked ? (
    <button
      type="button"
      onClick={() => setUnlocked(false)}
      className="flex items-center gap-1.5 rounded-full bg-[#B49042]/15 px-3 py-1.5 text-xs font-semibold text-[#B49042] hover:bg-[#B49042]/25"
      title="Hidden bill figures are included — click to lock again"
    >
      Hidden bills included · Lock
    </button>
  ) : null;

  const dialog = (
    <HiddenBillPasswordDialog
      open={hiddenPwOpen}
      busy={hiddenPwBusy}
      error={hiddenPwError}
      onClose={() => {
        if (hiddenPwBusy) return;
        setHiddenPwOpen(false);
        setHiddenPwError("");
      }}
      onSubmit={async (pin) => {
        setHiddenPwBusy(true);
        setHiddenPwError("");
        try {
          await api.post("/settings/verify-hidden-bill-password", { password: pin });
          setUnlocked(true);
          setHiddenPwOpen(false);
          toast.success("Hidden bill figures unlocked");
        } catch (err) {
          const msg = formatApiError(err) || "Incorrect password";
          setHiddenPwError(msg);
          toast.error(
            msg.includes("Incorrect") || msg.includes("password") ? "Wrong PIN — try again" : msg,
          );
        } finally {
          setHiddenPwBusy(false);
        }
      }}
    />
  );

  return {
    isOwner,
    handleTitleClick,
    lockButton,
    dialog,
    titleHint: isOwner && !unlocked ? "Triple-click to unlock hidden bill figures" : undefined,
  };
}
