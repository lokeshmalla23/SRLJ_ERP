import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import { initApiBackend } from "@/lib/api";
import ErrorBoundary from "@/components/ErrorBoundary";
import { installBlockWheelOnFocusedFields } from "@/hooks/useBlockWheelOnFocusedFields";

// Install as early as possible (before React) so Electron never ticks number fields on scroll
installBlockWheelOnFocusedFields();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

async function boot() {
  try {
    await initApiBackend();
  } catch (err) {
    console.error("[boot] initApiBackend failed", err);
    // Still mount the app — API calls will surface errors in UI/toasts
  }

  const rootEl = document.getElementById("root");
  if (!rootEl) {
    document.body.innerHTML = `
      <div style="font-family:system-ui;padding:40px;text-align:center">
        <h1 style="font-size:18px">App container missing</h1>
        <p style="color:#737373;font-size:13px">#root element was not found in index.html</p>
      </div>`;
    return;
  }

  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <ErrorBoundary title="Application failed to start">
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

boot().catch((err) => {
  console.error("[boot] fatal", err);
  const rootEl = document.getElementById("root");
  if (rootEl) {
    rootEl.innerHTML = `
      <div style="font-family:system-ui;padding:40px;max-width:560px;margin:80px auto;text-align:center">
        <div style="font-size:16px;font-weight:600;margin-bottom:8px">App failed to start</div>
        <pre style="text-align:left;background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:12px;border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-word">${String(err?.message || err)}</pre>
        <button onclick="location.reload()" style="margin-top:16px;padding:8px 16px;background:#0A0A0A;color:#fff;border:0;border-radius:8px;cursor:pointer">Reload</button>
      </div>`;
  }
});
