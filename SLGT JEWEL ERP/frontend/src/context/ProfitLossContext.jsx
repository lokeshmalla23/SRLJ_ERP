import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/**
 * Profit & Loss feature gate (Settings → Application Management → Profit & Loss).
 * The backend `profit_loss` setting is authoritative and refuses P&L / Balance
 * Sheet APIs when OFF; this context only decides what to render and whether
 * to call those APIs at all.
 *
 * Unlike ApplicationFeatureContext this fails CLOSED: the setting defaults to
 * OFF and the client does not want stray profit figures, so an unloaded or
 * unreachable flag means "P&L hidden".
 */
const ProfitLossContext = createContext({
  enabled: false,
  loading: true,
  refresh: async () => {},
});

export function ProfitLossProvider({ children }) {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setEnabled(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get("/settings/profit-loss");
      setEnabled(data?.enabled === true);
    } catch {
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUpdated = () => { refresh(); };
    window.addEventListener("profit-loss:updated", onUpdated);
    return () => window.removeEventListener("profit-loss:updated", onUpdated);
  }, [refresh]);

  const value = useMemo(() => ({ enabled, loading, refresh }), [enabled, loading, refresh]);

  return <ProfitLossContext.Provider value={value}>{children}</ProfitLossContext.Provider>;
}

export function useProfitLoss() {
  return useContext(ProfitLossContext);
}

/** Dispatch after the Application Management P&L toggle changes. */
export function notifyProfitLossUpdated() {
  window.dispatchEvent(new Event("profit-loss:updated"));
}
