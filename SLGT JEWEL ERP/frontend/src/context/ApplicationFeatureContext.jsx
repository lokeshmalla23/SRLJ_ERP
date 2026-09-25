import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/**
 * Application Management (shop-level module licensing) — separate from RBAC.
 * `AuthContext.can(module, action)` answers "what can this user do"; this
 * answers "did this shop license this module at all". A module disabled here
 * is inaccessible regardless of permissions, including for owners.
 *
 * Modeled directly on CompanyContext: fetch once after `user` is known,
 * fail-soft (never blocks the app on a network hiccup — defaults everything
 * to enabled), and refetch on a window event dispatched after a Settings save.
 */
const ApplicationFeatureContext = createContext({
  features: {},
  loading: true,
  isEnabled: () => true,
  refresh: async () => {},
});

export function ApplicationFeatureProvider({ children }) {
  const { user } = useAuth();
  const [features, setFeatures] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setFeatures(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get("/settings/application-management");
      setFeatures(data?.features && typeof data.features === "object" ? data.features : {});
    } catch {
      // Fail-soft: an unreachable backend must never hide modules that were
      // working a moment ago — treat as "nothing configured" (all enabled).
      setFeatures({});
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUpdated = () => { refresh(); };
    window.addEventListener("application-features:updated", onUpdated);
    return () => window.removeEventListener("application-features:updated", onUpdated);
  }, [refresh]);

  const value = useMemo(() => {
    const f = features || {};
    return {
      features: f,
      loading,
      // Unknown/unloaded key defaults to enabled — never hides a module due
      // to a slow request or a key added after this shop's config was last saved.
      isEnabled: (key) => f[key] !== false,
      refresh,
    };
  }, [features, loading, refresh]);

  return (
    <ApplicationFeatureContext.Provider value={value}>
      {children}
    </ApplicationFeatureContext.Provider>
  );
}

export function useApplicationFeatures() {
  return useContext(ApplicationFeatureContext);
}

/** Dispatch after Settings → Application Management save so the sidebar/routes refresh immediately. */
export function notifyApplicationFeaturesUpdated() {
  window.dispatchEvent(new Event("application-features:updated"));
}
