import { createContext, useContext, useEffect, useState, useCallback } from "react";

export const AUTHORITY_STATES = {
  CLOUD_COORDINATED: "CLOUD_COORDINATED",
  LAN_COORDINATED:   "LAN_COORDINATED",
  ISOLATED:          "ISOLATED",
  UNKNOWN:           "UNKNOWN",
};

const AuthorityCtx = createContext({
  state:       AUTHORITY_STATES.UNKNOWN,
  detail:      null,
  canTransact: () => ({ allowed: false, state: "UNKNOWN", reason: "Not initialised" }),
  isDesktop:   false,
});

export function AuthorityProvider({ children }) {
  const isDesktop = Boolean(window.jewelleryCRM?.isDesktop);
  const [state,  setState]  = useState(AUTHORITY_STATES.UNKNOWN);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!isDesktop) {
      // Browser / dev mode — assume cloud connected
      setState(AUTHORITY_STATES.CLOUD_COORDINATED);
      return undefined;
    }

    const refresh = () => {
      window.jewelleryCRM.getAuthorityState()
        .then((d) => {
          setState(d.state ?? AUTHORITY_STATES.UNKNOWN);
          setDetail(d);
        })
        .catch(() => {});
    };

    refresh();
    window.jewelleryCRM.onAuthorityStateChanged((data) => {
      setState(data.state ?? AUTHORITY_STATES.UNKNOWN);
      setDetail(data.detail ?? data);
    });
    window.jewelleryCRM.onBackendReady?.(() => refresh());
    return undefined;
  }, [isDesktop]);

  const canTransact = useCallback(
    async (txType = "any") => {
      if (!isDesktop) return { allowed: true, state: AUTHORITY_STATES.CLOUD_COORDINATED };
      try {
        return await window.jewelleryCRM.canTransact(txType);
      } catch {
        return { allowed: false, state: AUTHORITY_STATES.UNKNOWN, reason: "IPC error" };
      }
    },
    [isDesktop],
  );

  return (
    <AuthorityCtx.Provider value={{ state, detail, canTransact, isDesktop }}>
      {children}
    </AuthorityCtx.Provider>
  );
}

export const useAuthority = () => useContext(AuthorityCtx);
