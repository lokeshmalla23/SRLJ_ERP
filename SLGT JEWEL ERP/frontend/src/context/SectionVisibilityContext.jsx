import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/**
 * Section-level visibility within the Reports & Analytics and Accounts &
 * Finance modules — a finer-grained sibling of ApplicationFeatureContext
 * (which licenses whole modules). Keys are "<module>:<category|item>:<id>",
 * e.g. "reports:category:financial" or "accounts:item:daily-closing".
 *
 * Same fail-soft/fetch-once-per-user/window-event-refresh shape as
 * ApplicationFeatureContext — an unreachable backend or an unset key must
 * never hide a section that was visible a moment ago.
 */
const SectionVisibilityContext = createContext({
  sections: {},
  loading: true,
  isSectionVisible: () => true,
  refresh: async () => {},
});

export function SectionVisibilityProvider({ children }) {
  const { user } = useAuth();
  const [sections, setSections] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setSections(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get("/settings/section-visibility");
      setSections(data?.sections && typeof data.sections === "object" ? data.sections : {});
    } catch {
      // Fail-soft: never hide a section just because this fetch failed.
      setSections({});
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUpdated = () => { refresh(); };
    window.addEventListener("section-visibility:updated", onUpdated);
    return () => window.removeEventListener("section-visibility:updated", onUpdated);
  }, [refresh]);

  const value = useMemo(() => {
    const s = sections || {};
    return {
      sections: s,
      loading,
      // Unknown/unloaded key defaults to visible — never hides a section due
      // to a slow request or a key added after this shop's config was saved.
      isSectionVisible: (module, level, id) => s[`${module}:${level}:${id}`] !== false,
      refresh,
    };
  }, [sections, loading, refresh]);

  return (
    <SectionVisibilityContext.Provider value={value}>
      {children}
    </SectionVisibilityContext.Provider>
  );
}

export function useSectionVisibility() {
  return useContext(SectionVisibilityContext);
}

/** Dispatch after Settings → Application Management saves a section toggle. */
export function notifySectionVisibilityUpdated() {
  window.dispatchEvent(new Event("section-visibility:updated"));
}
