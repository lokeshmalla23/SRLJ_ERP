import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { hideInitialLoader } from "@/lib/initialLoader";
import { hasPermission } from "@/lib/permissions";
import { appNavigate } from "@/lib/appNavigate";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    try {
      // Desktop cold start: require email/password again. sessionStorage clears when
      // the Electron window is closed, so a new launch always shows Sign in.
      // Ctrl+R within the same window keeps sessionStorage and stays signed in.
      if (window.jewelleryCRM?.isDesktop && !sessionStorage.getItem("ssj_session_ok")) {
        localStorage.removeItem("ssj_token");
        localStorage.removeItem("ssj_offline_user");
        localStorage.removeItem("ssj_offline_session");
        setUser(false);
        return;
      }

      const token = localStorage.getItem("ssj_token");
      if (!token) {
        setUser(false);
        return;
      }
      // Offline session sentinel — still require a prior explicit Sign in this window
      if (token === "__offline__" || String(token).startsWith("offline.")) {
        const stored = localStorage.getItem("ssj_offline_user");
        const session = localStorage.getItem("ssj_offline_session");
        if (stored && sessionStorage.getItem("ssj_session_ok")) {
          setUser({
            ...JSON.parse(stored),
            _offlineMode: true,
            _offlineSession: session ? JSON.parse(session) : { type: "offline", permissions_limited: true },
          });
        } else {
          localStorage.removeItem("ssj_token");
          localStorage.removeItem("ssj_offline_user");
          localStorage.removeItem("ssj_offline_session");
          setUser(false);
        }
        return;
      }
      const { data } = await api.get("/auth/me", { timeout: 8000 });
      setUser(data);
      sessionStorage.setItem("ssj_session_ok", "1");
      // Existing paired clients: adopt shop LAN HMAC secret if missing
      try {
        if (window.jewelleryCRM?.notifyPairingComplete) {
          const deviceId = localStorage.getItem("ssj_device_identifier");
          const { data: cred } = await api.get("/devices/lan-credential", {
            headers: deviceId ? { "X-Device-Id": deviceId } : {},
            timeout: 5000,
          });
          if (cred?.lan_shared_key) {
            await window.jewelleryCRM.notifyPairingComplete({
              shop_id: cred.shop_id,
              device_id: deviceId,
              lan_shared_key: cred.lan_shared_key,
            });
          }
        }
      } catch { /* non-fatal — host may be local or device not registered */ }
    } catch (err) {
      // Desktop cold-start: backend may not be up yet — keep token and retry on backend:ready
      const isNetwork = !err?.response;
      if (isNetwork && window.jewelleryCRM?.isDesktop && sessionStorage.getItem("ssj_session_ok")) {
        console.warn("[auth] /auth/me network error — keeping session for retry");
        return;
      }
      localStorage.removeItem("ssj_token");
      sessionStorage.removeItem("ssj_session_ok");
      setUser(false);
    } finally {
      setLoading(false);
      hideInitialLoader();
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Guarantee login fields stay interactive even if session check is slow
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(false);
      hideInitialLoader();
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  // When embedded backend finishes starting, re-bootstrap session
  useEffect(() => {
    if (!window.jewelleryCRM?.onBackendReady) return undefined;
    const unsub = window.jewelleryCRM.onBackendReady(() => {
      bootstrap();
    });
    return typeof unsub === "function" ? unsub : undefined;
  }, [bootstrap]);

  const login = async (email, password) => {
    const emailNorm = String(email || "").trim();
    const pass = String(password || "");
    if (!emailNorm || !pass) {
      const e = new Error("Email and password are required");
      e.response = { data: { detail: e.message } };
      throw e;
    }
    try {
      const { data } = await api.post("/auth/login", { email: emailNorm, password: pass });
      localStorage.setItem("ssj_token", data.access_token);
      sessionStorage.setItem("ssj_session_ok", "1");
      setUser(data.user);
      // Cache credential locally for offline fallback (desktop only)
      if (window.jewelleryCRM?.cacheCredential && data.user) {
        // Fetch own bcrypt hash from the authenticated endpoint and cache it
        api.get("/auth/credential").then((credRes) => {
          window.jewelleryCRM.cacheCredential({
            ...data.user,
            password_hash: credRes.data?.password_hash || null,
          }).catch(() => {});
        }).catch(() => {});
      }
      return data.user;
    } catch (err) {
      // Network error in desktop mode → try offline credential cache
      const isNetworkError = !err?.response && window.jewelleryCRM?.loginOffline;
      if (!isNetworkError) throw err;

      const result = await window.jewelleryCRM.loginOffline(email, password);
      if (!result.ok) {
        const e = new Error(result.reason || "Offline login failed");
        e.response = { data: { detail: e.message } };
        throw e;
      }
      // Offline session — distinct from JWT
      const offlineSession = {
        type: 'offline',
        user: result.user,
        device_id: null,
        permissions_limited: true,
        allowed: ['view_inventory', 'view_invoices', 'draft_quotation'],
        denied: ['sell_unique', 'change_gold_rate', 'stock_adjust', 'finalize_payment', 'promote_host'],
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      };
      localStorage.setItem("ssj_token", `offline.${btoa(JSON.stringify({ v: 1, at: Date.now() }))}`);
      localStorage.setItem("ssj_offline_session", JSON.stringify(offlineSession));
      localStorage.setItem("ssj_offline_user", JSON.stringify(result.user));
      sessionStorage.setItem("ssj_session_ok", "1");
      setUser({
        ...result.user,
        _offlineMode: true,
        _offlineSession: offlineSession,
      });
      return result.user;
    }
  };

  const logout = () => {
    localStorage.removeItem("ssj_token");
    localStorage.removeItem("ssj_offline_user");
    localStorage.removeItem("ssj_offline_session");
    sessionStorage.removeItem("ssj_session_ok");
    setUser(false);
    // Return to sign-in
    appNavigate("/login");
  };

  const can = useCallback(
    (module, action = "view") => {
      if (!user) return false;
      if (user.role === "shop_owner" || user.role === "owner" || user.role === "super_admin") return true;
      return hasPermission(user.permissions, module, action);
    },
    [user],
  );

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, can, refresh: bootstrap }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
