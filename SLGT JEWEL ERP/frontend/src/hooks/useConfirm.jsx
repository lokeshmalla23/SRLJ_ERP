import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import ConfirmDialog from "@/components/ConfirmDialog";

/**
 * Promise-based replacement for window.confirm().
 *
 * Electron's native window.confirm() is a blocking Chromium dialog; after it
 * closes, the app window can be left in a state where clicks land but
 * nothing focuses (no cursor, no text selection) until the OS window loses
 * and regains focus. Routing confirmations through this hook avoids the
 * native dialog entirely.
 *
 * Usage:
 *   const [confirm, confirmModal] = useConfirm();
 *   const onDelete = async () => {
 *     if (!(await confirm("Delete this item?"))) return;
 *     ...
 *   };
 *   return <>...{confirmModal}</>;
 */
export default function useConfirm() {
  const [state, setState] = useState(null);

  const confirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setState({ message, ...opts, resolve });
    });
  }, []);

  const settle = useCallback((value) => {
    setState((s) => {
      s?.resolve?.(value);
      return null;
    });
  }, []);

  const confirmModal = state && typeof document !== "undefined"
    ? createPortal(
        <ConfirmDialog
          open
          title={state.title}
          message={state.message}
          confirmLabel={state.confirmLabel}
          cancelLabel={state.cancelLabel}
          danger={state.danger ?? true}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        />,
        document.body,
      )
    : null;

  return [confirm, confirmModal];
}
