import { useEffect, useState } from "react";
import api from "@/lib/api";
import {
  getRememberedOpeningSetup,
  isAccountsSetupCompleteEvent,
  isTestModeFromSetup,
  liveSetupFromEvent,
  rememberOpeningSetup,
} from "@/lib/accountsSetup";

/**
 * TEST MODE banner flag. Updates immediately on go-live instead of waiting
 * for a route change.
 */
export function useAccountsTestMode(refreshKey) {
  const [testMode, setTestMode] = useState(() => {
    const cached = getRememberedOpeningSetup();
    return cached ? isTestModeFromSetup(cached) : false;
  });

  useEffect(() => {
    let cancelled = false;

    const apply = (data) => {
      const next = rememberOpeningSetup(data);
      if (!cancelled && next) setTestMode(isTestModeFromSetup(next));
    };

    const cached = getRememberedOpeningSetup();
    if (cached) apply(cached);

    api.get("/accounts/opening-setup")
      .then(({ data }) => apply(data))
      .catch(() => {
        if (!cancelled) setTestMode(false);
      });

    const onRealtime = (e) => {
      const detail = e.detail || {};
      if (isAccountsSetupCompleteEvent(detail)) {
        apply(liveSetupFromEvent(detail));
        setTestMode(false);
        return;
      }
    };
    window.addEventListener("realtime", onRealtime);
    return () => {
      cancelled = true;
      window.removeEventListener("realtime", onRealtime);
    };
  }, [refreshKey]);

  return testMode;
}
