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
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#0a0a0a', color: '#fff',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem', fontFamily: 'Manrope, sans-serif',
    }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#f87171' }}>
          Backend failed to start
        </h1>
        <p style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 24, lineHeight: 1.6 }}>
          The local database service could not start. This usually means a schema error or missing file.
          Check the logs below and contact support if needed.
        </p>
        <pre style={{
          background: '#18181b', border: '1px solid #3f3f46',
          borderRadius: 8, padding: '1rem', fontSize: 12,
          color: '#fca5a5', overflowX: 'auto', whiteSpace: 'pre-wrap',
          wordBreak: 'break-word', maxHeight: 240, overflowY: 'auto',
          marginBottom: 24,
        }}>
          {error || 'Unknown error'}
        </pre>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onRetry}
            style={{
              background: '#fff', color: '#000', border: 'none',
              borderRadius: 6, padding: '10px 20px', fontSize: 14,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            Retry
          </button>
          <button
            onClick={() => window.electronAPI?.openLogsFolder?.() || window.jewelleryCRM?.openLogsFolder?.()}
            style={{
              background: 'transparent', color: '#a1a1aa',
              border: '1px solid #3f3f46', borderRadius: 6,
              padding: '10px 20px', fontSize: 14, cursor: 'pointer',
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
                    background: "#0A0A0A",
                    color: "white",
                    border: "1px solid #262626",
                    fontFamily: "Manrope, sans-serif",
                    fontSize: "13px",
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
