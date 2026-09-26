import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const POLL_MS = 60000;

const BusinessDateContext = createContext({
  date: null,
  realToday: null,
  daysStale: 0,
  isStale: false,
  dateMismatch: false,
  autoDayClose: false,
  loading: true,
  refresh: async () => {},
});

export function BusinessDateProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState({ date: null, realToday: null, daysStale: 0, isStale: false, dateMismatch: false, autoDayClose: false });
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setState({ date: null, realToday: null, daysStale: 0, isStale: false, dateMismatch: false, autoDayClose: false });
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/accounts/active-billing-date");
      setState({
        date: data?.date || null,
        realToday: data?.real_today || null,
        daysStale: Number(data?.days_stale) || 0,
        isStale: Boolean(data?.is_stale),
        dateMismatch: Boolean(data?.date_mismatch),
        // Close Day turned OFF — date is always the real date; hide it from the UI.
        autoDayClose: Boolean(data?.auto_day_close),
      });
    } catch {
      // keep last-known value on transient failure
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return undefined;
    pollRef.current = setInterval(refresh, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [user, refresh]);

  useEffect(() => {
    const onChanged = () => { refresh(); };
    window.addEventListener("businessDate:changed", onChanged);
    return () => window.removeEventListener("businessDate:changed", onChanged);
  }, [refresh]);

  const value = useMemo(() => ({
    ...state,
    loading,
    refresh,
  }), [state, loading, refresh]);

  return (
    <BusinessDateContext.Provider value={value}>
      {children}
    </BusinessDateContext.Provider>
  );
}

export function useBusinessDate() {
  return useContext(BusinessDateContext);
}

/** Dispatch after a successful Day Close so the header/POS refresh immediately. */
export function notifyBusinessDateChanged() {
  window.dispatchEvent(new Event("businessDate:changed"));
}
