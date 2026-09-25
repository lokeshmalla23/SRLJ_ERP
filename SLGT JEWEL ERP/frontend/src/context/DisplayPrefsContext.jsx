import { createContext, useCallback, useContext, useEffect } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { setShowTransactionTime } from "@/lib/format";

const DisplayPrefsContext = createContext({ refresh: async () => {} });

/** Keeps fmtDateTime()'s global "show time" flag (lib/format.js) in sync with
 *  the persisted Settings → Billing → "Show Transaction Time" preference. */
export function DisplayPrefsProvider({ children }) {
  const { user } = useAuth();

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await api.get("/settings/invoice");
      setShowTransactionTime(data?.show_transaction_time !== false);
    } catch {
      // keep last-known value on transient failure
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChanged = () => { refresh(); };
    window.addEventListener("displayPrefs:changed", onChanged);
    return () => window.removeEventListener("displayPrefs:changed", onChanged);
  }, [refresh]);

  return (
    <DisplayPrefsContext.Provider value={{ refresh }}>
      {children}
    </DisplayPrefsContext.Provider>
  );
}

export function useDisplayPrefs() {
  return useContext(DisplayPrefsContext);
}

/** Dispatch after saving Billing settings so this session's display updates immediately. */
export function notifyDisplayPrefsChanged() {
  window.dispatchEvent(new Event("displayPrefs:changed"));
}
