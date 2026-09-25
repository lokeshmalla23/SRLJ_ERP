import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { APP_WINDOW_TITLE } from "@/lib/appBrand";

const CompanyContext = createContext({
  company: null,
  loading: true,
  refresh: async () => {},
  displayName: "Jewellery Shop",
  ownerName: "Shop Owner",
  logo: null,
  tagline: "",
  gstNumber: "",
  address: "",
  phone: "",
  invoicePrefix: "",
});

export function CompanyProvider({ children }) {
  const { user } = useAuth();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setCompany(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get("/settings/company");
      setCompany(data && typeof data === "object" ? data : {});
    } catch {
      setCompany({});
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUpdated = () => { refresh(); };
    window.addEventListener("company:updated", onUpdated);
    return () => window.removeEventListener("company:updated", onUpdated);
  }, [refresh]);

  useEffect(() => {
    document.title = APP_WINDOW_TITLE;
  }, [user]);

  const value = useMemo(() => {
    const c = company || {};
    return {
      company: c,
      loading,
      refresh,
      displayName: c.name?.trim() || "Jewellery Shop",
      ownerName: (c.owner_name || c.shop_owner_name || "").trim() || "Shop Owner",
      logo: c.logo || c.logo_url || null,
      tagline: c.tagline || "",
      gstNumber: c.gst_number || c.gstin || "",
      address: c.address || "",
      phone: c.phone || "",
      invoicePrefix: (c.invoice_prefix || c.prefix || "").toString().trim().toUpperCase(),
    };
  }, [company, loading, refresh]);

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}

/** Dispatch after Settings → Company save so shell refreshes immediately. */
export function notifyCompanyUpdated() {
  window.dispatchEvent(new Event("company:updated"));
}
