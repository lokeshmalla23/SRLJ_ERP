import "@/App.css";
import { HashRouter as BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AuthorityProvider } from "@/context/AuthorityContext";
import { CompanyProvider } from "@/context/CompanyContext";
import { BusinessDateProvider } from "@/context/BusinessDateContext";
import { DisplayPrefsProvider } from "@/context/DisplayPrefsContext";
import { ApplicationFeatureProvider, useApplicationFeatures } from "@/context/ApplicationFeatureContext";
import { SectionVisibilityProvider } from "@/context/SectionVisibilityContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import ErrorBoundary from "@/components/ErrorBoundary";
import AppShell from "@/components/layout/AppShell";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Inventory from "@/pages/Inventory";
import ProductForm from "@/pages/ProductForm";
import POS from "@/pages/POS";
import Customers from "@/pages/Customers";
import CustomerDetail from "@/pages/CustomerDetail";
import GoldSchemes from "@/pages/GoldSchemes";
import SchemePlans from "@/pages/SchemePlans";
import Reports from "@/pages/Reports";
import SettingsPage from "@/pages/Settings";
import Catalog from "@/pages/Catalog";
import Promotions from "@/pages/Promotions";
import Accounts from "@/pages/Accounts";
import Employees from "@/pages/Employees";
import Vendors from "@/pages/Vendors";
import Purchases from "@/pages/Purchases";
import Orders from "@/pages/Orders";
import Quotations from "@/pages/Quotations";
import BarcodeManager from "@/pages/BarcodeManager";
import BarcodeStockCheck from "@/pages/BarcodeStockCheck";
import SystemHealth from "@/pages/SystemHealth";
import HiddenBills from "@/pages/HiddenBills";
import useEnterKeyNavigation from "@/hooks/useEnterKeyNavigation";
import useBlockWheelOnFocusedFields from "@/hooks/useBlockWheelOnFocusedFields";
import { installGlobalErrorHandlers } from "@/lib/globalErrors";
import { useRealtime } from "@/hooks/useRealtime";
import { APP_WINDOW_TITLE } from "@/lib/appBrand";
import slgtLogo from "@/assets/slgt-logo.png";

// "/" renders Dashboard when allowed; otherwise a shell landing so the sidebar stays available.
function HomeRoute() {
  const { user, can } = useAuth();
  const { isEnabled } = useApplicationFeatures();
  if (!user || (can("dashboard") && isEnabled("dashboard"))) return <Dashboard />;
  return <StaffHome />;
}

/** Workers without Dashboard access land here (with sidebar) after leaving POS. */
function StaffHome() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] || "there";
  return (
    <div className="max-w-lg py-10">
      <h1 className="font-display text-[26px] font-semibold text-[#0A0A0A] tracking-tight">
        Namaste, {firstName}.
      </h1>
      <p className="text-[14px] text-[#737373] mt-2 leading-relaxed">
        Use the side menu to open POS, Customers, Reports, or any other module you have access to.
      </p>
    </div>
  );
}

// Shell wraps pages that live inside the sidebar layout.
// Pass module to enforce a permission check before rendering.
function Shell({ children, module, action = "view", feature }) {
  return (
    <ProtectedRoute module={module} action={action} feature={feature}>
      <AppShell>
        <RouteErrorBoundary title="This page failed to load">
          {children}
        </RouteErrorBoundary>
      </AppShell>
    </ProtectedRoute>
  );
}

// POS has its own full-screen shell (no sidebar).
function PosShell({ children }) {
  return (
    <ProtectedRoute module="pos" action="view" feature="pos">
      <RouteErrorBoundary title="POS failed to load">
        {children}
      </RouteErrorBoundary>
    </ProtectedRoute>
  );
}

function BackendErrorScreen({ error, onRetry }) {
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background:
          "radial-gradient(circle at 50% 18%, rgba(220, 197, 140, 0.16), transparent 34%), linear-gradient(145deg, #173F32 0%, #102C24 100%)",
        color: "#FCFAF4",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(1rem, 4vw, 2rem)",
        fontFamily: "Manrope, sans-serif",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          maxWidth: 600,
          width: "100%",
          background: "#FCFAF4",
          color: "#173F32",
          border: "1px solid rgba(220, 197, 140, 0.72)",
          borderRadius: 20,
          padding: "clamp(1.25rem, 4vw, 2rem)",
          boxShadow: "0 24px 70px rgba(6, 24, 18, 0.32)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 52,
              height: 52,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              background: "#173F32",
              border: "1px solid #B49042",
              borderRadius: 14,
              boxShadow: "0 8px 20px rgba(23, 63, 50, 0.18)",
            }}
          >
            <img
              src={slgtLogo}
              alt=""
              style={{ width: 38, height: 38, objectFit: "contain", padding: 2, mixBlendMode: "screen" }}
            />
          </div>
          <div
            style={{
              color: "#7A6232",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              lineHeight: 1.4,
            }}
          >
            {APP_WINDOW_TITLE}
          </div>
        </div>

        <div
          style={{
            height: 1,
            margin: "20px 0",
            background: "linear-gradient(90deg, #D8C49A 0%, rgba(216, 196, 154, 0.18) 72%, transparent 100%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div
            style={{
              width: 42,
              height: 42,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#F8ECE7",
              color: "#984B3B",
              border: "1px solid #E7C9BD",
              borderRadius: 12,
              fontSize: 20,
              lineHeight: 1,
            }}
            aria-hidden="true"
          >
            ⚠
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.3, color: "#173F32" }}>
              Backend failed to start
            </h1>
            <p style={{ margin: "7px 0 0", fontSize: 13.5, color: "#5E6B63", lineHeight: 1.65 }}>
              The local database service could not start. This usually means a schema error or missing file.
              Check the logs below and contact support if needed.
            </p>
          </div>
        </div>

        <pre
          style={{
            background: "#173F32",
            border: "1px solid #315C4A",
            borderRadius: 12,
            padding: "14px 16px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            lineHeight: 1.55,
            color: "#F2D8C9",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 240,
            overflowY: "auto",
            margin: "20px 0 0",
          }}
        >
          {error || 'Unknown error'}
        </pre>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
          <button
            type="button"
            onClick={onRetry}
            style={{
              background: "#173F32",
              color: "#FCFAF4",
              border: "1px solid #173F32",
              borderRadius: 9,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 650,
              cursor: "pointer",
              boxShadow: "0 6px 16px rgba(23, 63, 50, 0.16)",
            }}
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => window.electronAPI?.openLogsFolder?.() || window.jewelleryCRM?.openLogsFolder?.()}
            style={{
              background: "#F6F0E4",
              color: "#315445",
              border: "1px solid #D8C8A6",
              borderRadius: 9,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Open Logs Folder
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  useEnterKeyNavigation();
  useBlockWheelOnFocusedFields();
  useRealtime();
  const [backendError, setBackendError] = useState(null);

  useEffect(() => {
    installGlobalErrorHandlers();
  }, []);

  useEffect(() => {
    const api = window.jewelleryCRM;
    if (!api?.onBackendError) return;
    api.onBackendError((data) => {
      setBackendError(data?.error || data?.message || 'Backend process crashed');
    });
  }, []);

  if (backendError) {
    return (
      <BackendErrorScreen
        error={backendError}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="App">
      <ErrorBoundary title="App failed to start" resetKey="root">
        <AuthorityProvider>
          <AuthProvider>
            <CompanyProvider>
            <BusinessDateProvider>
            <DisplayPrefsProvider>
            <ApplicationFeatureProvider>
            <SectionVisibilityProvider>
            <BrowserRouter>
              <Toaster
                position="top-right"
                richColors
                closeButton
                toastOptions={{
                  style: {
                    "--normal-bg": "#FCFAF4",
                    "--normal-border": "#DCCBAA",
                    "--normal-text": "#173F32",
                    "--normal-bg-hover": "#F6F0E4",
                    "--normal-border-hover": "#C9B587",
                    "--success-bg": "#EEF5F0",
                    "--success-border": "#C8DCCD",
                    "--success-text": "#24513F",
                    "--info-bg": "#F4F3EA",
                    "--info-border": "#D8D5BD",
                    "--info-text": "#4D5E51",
                    "--warning-bg": "#FBF5E8",
                    "--warning-border": "#E7D3A7",
                    "--warning-text": "#7A5E26",
                    "--error-bg": "#FBF0EC",
                    "--error-border": "#E9C8BC",
                    "--error-text": "#8A3F32",
                    "--border-radius": "10px",
                    fontFamily: "Manrope, sans-serif",
                    fontSize: "13px",
                    boxShadow: "0 8px 28px rgba(23, 63, 50, 0.12)",
                  },
                }}
              />
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/" element={<Shell><HomeRoute /></Shell>} />
                <Route path="/pos" element={<PosShell><POS /></PosShell>} />
                <Route path="/inventory" element={<Shell module="inventory" feature="inventory"><Inventory /></Shell>} />
                <Route path="/inventory/new" element={<Shell module="inventory" action="create" feature="inventory"><ProductForm /></Shell>} />
                <Route path="/inventory/:id" element={<Shell module="inventory" feature="inventory"><ProductForm /></Shell>} />
                <Route path="/catalog" element={<Shell module="catalog" feature="catalog"><Catalog /></Shell>} />
                <Route path="/customers" element={<Shell module="customers" feature="customers"><Customers /></Shell>} />
                <Route path="/customers/:id" element={<Shell module="customers" feature="customers"><CustomerDetail /></Shell>} />
                <Route path="/promotions" element={<Shell module="promotions" feature="promotions"><Promotions /></Shell>} />
                <Route path="/schemes" element={<Shell module="gold_schemes" feature="gold_schemes"><GoldSchemes /></Shell>} />
                <Route path="/scheme-plans" element={<Shell module="gold_schemes" feature="gold_schemes"><SchemePlans /></Shell>} />
                <Route path="/reports" element={<Shell module="reports" feature="reports"><Reports /></Shell>} />
                <Route path="/settings" element={<Shell module="settings"><SettingsPage /></Shell>} />
                <Route path="/accounts" element={<Shell module="accounts" feature="accounts"><Accounts /></Shell>} />
                <Route path="/employees" element={<Shell module="employees" feature="employees"><Employees /></Shell>} />
                <Route path="/vendors" element={<Shell module="vendors" feature="vendors"><Vendors /></Shell>} />
                <Route path="/purchases" element={<Shell module="purchases" feature="purchases"><Purchases /></Shell>} />
                <Route path="/orders" element={<Shell module="orders" feature="orders"><Orders /></Shell>} />
                <Route path="/barcode-stock-check" element={<Shell module="barcode_stock_check" feature="barcode_stock_check"><BarcodeStockCheck /></Shell>} />
                <Route path="/quotations" element={<Shell module="quotations" feature="quotations"><Quotations /></Shell>} />
                <Route path="/barcodes" element={<Shell module="inventory" feature="barcode_management"><BarcodeManager /></Shell>} />
                <Route path="/system-health" element={<Shell module="settings"><SystemHealth /></Shell>} />
                <Route path="/hidden-bills" element={<Shell><HiddenBills /></Shell>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
            </SectionVisibilityProvider>
            </ApplicationFeatureProvider>
            </DisplayPrefsProvider>
            </BusinessDateProvider>
            </CompanyProvider>
          </AuthProvider>
        </AuthorityProvider>
      </ErrorBoundary>
    </div>
  );
}

export default App;
