import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Database,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Lock,
  Package,
  RefreshCw,
  Upload,
  Usb,
  Users,
} from "lucide-react";
import api, { formatApiError, getBackendUrl } from "@/lib/api";
import useConfirm from "@/hooks/useConfirm";
import ImportProgressModal from "@/components/inventory/ImportProgressModal";
import {
  emptyImportProgress,
  formatImportSummary,
  importProductsFromCsv,
} from "@/lib/productCsvImport";
import {
  SettingsActionCard,
  SettingsExportRow,
  SettingsSection,
  SettingsSplit,
  SettingsStat,
  SettingsStatGrid,
  SettingsTabFrame,
} from "@/components/settings/settingsLayout";

function FactoryResetSection({ canWrite = false }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function doReset() {
    if (confirm !== "RESET") return;
    setBusy(true);
    try {
      if (window.jewelleryCRM?.factoryReset) {
        await window.jewelleryCRM.factoryReset();
        // The reset wipes the database, but browser localStorage (cached drafts
        // like the "New Product" tag-number reservation) lives outside it and
        // would otherwise survive the reset and reuse a stale tag number.
        try { localStorage.clear(); } catch { /* non-fatal */ }
      } else {
        toast.error("Factory reset is only available in the desktop app.");
        setBusy(false);
      }
    } catch (e) {
      toast.error("Reset failed: " + e.message);
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      title="Danger zone"
      description="Permanently wipe all shop data and start fresh. Built-in catalog standards (Gold/Silver, units, purities) are restored automatically. Cannot be undone."
      tone="danger"
      actions={(
        <button
          type="button"
          disabled={!canWrite}
          onClick={() => { setOpen(true); setConfirm(""); }}
          className="px-3 py-1.5 text-[12px] font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40"
        >
          Reset All Data
        </button>
      )}
    >
      <div className="text-[12.5px] text-red-700 flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" strokeWidth={2} />
        Export or copy a USB backup before resetting. Tag/barcode numbers restart from the beginning.
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-[420px] p-6 space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-600 shrink-0" />
              <h2 className="text-[15px] font-semibold text-[#0A0A0A]">Reset All Data</h2>
            </div>
            <p className="text-[13px] text-[#525252]">
              This will permanently delete the entire database — all customers, invoices, products,
              custom catalog entries, employees, and settings. The app will restart with built-in
              catalog standards only (Gold, Silver, Grams, Piece, Tray, and standard purities).
            </p>
            <div className="p-3 bg-red-50 border border-red-200 rounded text-[12px] text-red-700 font-medium">
              This action cannot be undone. Export your data first if you need it.
            </div>
            <div>
              <label className="text-[12px] text-[#737373] block mb-1">
                Type <span className="font-mono font-bold text-[#0A0A0A]">RESET</span> to confirm
              </label>
              <input
                className="input w-full"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.toUpperCase())}
                placeholder="RESET"
                disabled={busy}
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn-secondary">
                Cancel
              </button>
              <button
                type="button"
                onClick={doReset}
                disabled={confirm !== "RESET" || busy}
                className="px-4 py-2 text-[13px] font-medium bg-red-600 text-white rounded disabled:opacity-40 hover:bg-red-700"
              >
                {busy ? "Resetting…" : "Yes, Delete Everything"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

export default function BackupExportTab({ canWrite = false }) {
  const [summary, setSummary] = useState(null);
  const [encBackups, setEncBackups] = useState(null);
  const [loading, setLoading] = useState({});
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [importFile, setImportFile] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [csvImporting, setCsvImporting] = useState({});
  const csvFileInputRef = useRef(null);
  const pendingCsvKeyRef = useRef(null);
  const inventoryFileRef = useRef(null);
  const [inventoryFile, setInventoryFile] = useState(null);
  const [inventoryRestoring, setInventoryRestoring] = useState(false);
  const customerFileRef = useRef(null);
  const [customerFile, setCustomerFile] = useState(null);
  const [customerRestoring, setCustomerRestoring] = useState(false);
  const [productImportProgress, setProductImportProgress] = useState(null);
  const [confirm, confirmModal] = useConfirm();
  const isDesktop = Boolean(window.jewelleryCRM?.exportBackupToFolder);
  const canImport = Boolean(window.jewelleryCRM?.pickBackupImportFile);

  useEffect(() => {
    api.get("/backup/summary").then(({ data }) => setSummary(data)).catch(() => {});
    api.get("/cluster/backups").then(({ data }) => setEncBackups(data)).catch(() => {});
  }, []);

  const download = async (endpoint, filename, params = {}) => {
    setLoading((p) => ({ ...p, [endpoint]: true }));
    try {
      const token = localStorage.getItem("ssj_token");
      const qs = new URLSearchParams(params).toString();
      const url = `${getBackendUrl()}/api/backup/${endpoint}${qs ? "?" + qs : ""}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error("Export failed");
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${filename} downloaded`);
    } catch {
      toast.error("Export failed. Try again.");
    } finally {
      setLoading((p) => ({ ...p, [endpoint]: false }));
    }
  };

  const downloadTemplate = async (key) => {
    setLoading((p) => ({ ...p, [`tpl-${key}`]: true }));
    try {
      const token = localStorage.getItem("ssj_token");
      const url = `${getBackendUrl()}/api/backup/templates/${key}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error("Template download failed");
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${key}_import_template.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("Could not download template. Try again.");
    } finally {
      setLoading((p) => ({ ...p, [`tpl-${key}`]: false }));
    }
  };

  const triggerCsvImport = (key) => {
    pendingCsvKeyRef.current = key;
    csvFileInputRef.current?.click();
  };

  const handleCsvFileSelected = async (e) => {
    const file = e.target.files?.[0];
    const key = pendingCsvKeyRef.current;
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file || !key) return;

    setCsvImporting((p) => ({ ...p, [key]: true }));
    try {
      const csv = await file.text();
      if (key === "products") {
        setProductImportProgress(emptyImportProgress());
        const result = await importProductsFromCsv({
          csvText: csv,
          fileName: file.name,
          onProgress: setProductImportProgress,
        });
        const summary = formatImportSummary(result);
        if (result.errors.length) {
          toast.error(`${summary}. ${result.errors.length} error(s).`);
        } else {
          toast.success(`Import complete — ${summary}.`);
        }
      } else {
        const { data } = await api.post(`/backup/import/${key}`, { csv, update_existing: true }, { timeout: 300000 });
        const errCount = (data.errors || []).length;
        const parts = [];
        if (data.created) parts.push(`${data.created} added`);
        if (data.updated) parts.push(`${data.updated} updated`);
        if (data.skipped) parts.push(`${data.skipped} skipped`);
        const summary = parts.length ? parts.join(", ") : "No rows imported";
        if (errCount) {
          const firstErrors = data.errors.slice(0, 3).map((e2) => `Row ${e2.row}: ${e2.detail}`).join(" · ");
          toast.error(`${summary}. ${errCount} error(s) — ${firstErrors}${errCount > 3 ? " …" : ""}`);
        } else {
          toast.success(`Import complete — ${summary}.`);
        }
      }
      api.get("/backup/summary").then(({ data: d }) => setSummary(d)).catch(() => {});
    } catch (err) {
      setProductImportProgress(null);
      toast.error(formatApiError(err) || "Import failed. Check the file matches the template.");
    } finally {
      setCsvImporting((p) => ({ ...p, [key]: false }));
    }
  };

  const transferToFolder = async () => {
    if (!window.jewelleryCRM?.exportBackupToFolder) {
      toast.error("USB / folder transfer is available in the desktop app. Plug in a pendrive and use the installed ERP.");
      return;
    }
    setLoading((p) => ({ ...p, transfer: true }));
    try {
      let encPath = null;
      try {
        const { data } = await api.post("/cluster/backups", { tier: "frequent" });
        encPath = data?.path || null;
        const list = await api.get("/cluster/backups");
        setEncBackups(list.data);
      } catch {
        // Encrypted archive optional
      }

      const token = localStorage.getItem("ssj_token");
      const textFiles = [];
      const rangeEndpoints = [
        { key: "invoices", name: `invoices_${from}_to_${to}.csv` },
        { key: "expenses", name: `expenses_${from}_to_${to}.csv` },
        { key: "stock-history", name: `stock-history_${from}_to_${to}.csv` },
      ];
      for (const item of rangeEndpoints) {
        try {
          const qs = new URLSearchParams({ from, to }).toString();
          const url = `${getBackendUrl()}/api/backup/${item.key}?${qs}`;
          const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!resp.ok) continue;
          const buf = await resp.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
          textFiles.push({ name: item.name, contentBase64: btoa(binary) });
        } catch {
          // skip
        }
      }

      const result = await window.jewelleryCRM.exportBackupToFolder({
        encPath,
        textFiles,
        dateFrom: from,
        dateTo: to,
      });
      if (result?.canceled) {
        toast.message("Transfer cancelled");
        return;
      }
      const csvCount = (result.files || []).filter((f) => f.kind === "csv").length;
      toast.success(
        `Backup saved to ${result.folder}`
        + (csvCount ? ` · ${csvCount} date-range CSV(s) (${from} → ${to})` : ""),
      );
    } catch (e) {
      toast.error(formatApiError(e) || e?.message || "Could not save backup to folder");
    } finally {
      setLoading((p) => ({ ...p, transfer: false }));
    }
  };

  const createEncrypted = async () => {
    setLoading((p) => ({ ...p, enc: true }));
    try {
      await api.post("/cluster/backups", { tier: "frequent" });
      toast.success("Encrypted backup created");
      const { data } = await api.get("/cluster/backups");
      setEncBackups(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading((p) => ({ ...p, enc: false }));
    }
  };

  const restoreBackup = async (b) => {
    if (!(await confirm(
      `Restore ${b.name}? This writes a decrypted DB file for drill/recovery. Restart the app after swapping the live database.`,
    ))) return;
    const dest = window.prompt(
      "Destination path for decrypted database file:",
      (b.path || "").replace(/\.enc$/i, ".restored.sqlite") || "restored.sqlite",
    );
    if (!dest) return;
    setLoading((p) => ({ ...p, restore: true }));
    try {
      await api.post("/cluster/backups/restore", {
        path: b.path,
        dest,
        reason: "Settings restore drill",
      });
      toast.success("Backup decrypted to destination — restart after replacing live DB");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading((p) => ({ ...p, restore: false }));
    }
  };

  const pickImportFile = async () => {
    if (!canImport) {
      toast.error("Import is available in the desktop app.");
      return;
    }
    try {
      const res = await window.jewelleryCRM.pickBackupImportFile();
      if (res?.canceled) return;
      setImportFile({ path: res.path, name: res.name });
    } catch (e) {
      toast.error(e?.message || "Could not open file picker");
    }
  };

  const restoreImportedFile = async () => {
    if (!importFile) return;
    if (!(await confirm(
      `Restore "${importFile.name}"? This replaces all current shop data with the contents of this backup. The app will restart automatically.`,
    ))) return;
    setImportBusy(true);
    try {
      let filePath = importFile.path;
      let deleteSource = false;
      if (/\.enc$/i.test(filePath)) {
        const dest = `${filePath.replace(/\.enc$/i, "")}.import-${Date.now()}.sqlite`;
        await api.post("/cluster/backups/restore", {
          path: filePath,
          dest,
          reason: "Manual import restore — decrypt step",
        });
        filePath = dest;
        deleteSource = true;
      }
      await window.jewelleryCRM.importRestoreBackup({ filePath, deleteSource });
      toast.success("Backup restored — the app is restarting…");
      setImportFile(null);
    } catch (e) {
      toast.error(formatApiError(e) || e?.message || "Restore failed");
    } finally {
      setImportBusy(false);
    }
  };

  const pickInventoryFile = () => inventoryFileRef.current?.click();

  const handleInventoryFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      toast.error("That file is not valid JSON. Choose an inventory backup downloaded from this screen.");
      return;
    }
    if (payload?.format !== "slgt-jewel-erp/inventory-backup") {
      toast.error('That is not an inventory backup file. Use a file created by "Download backup" below.');
      return;
    }
    setInventoryFile({ name: file.name, payload, counts: payload.counts || {} });
  };

  const restoreInventoryFile = async () => {
    if (!inventoryFile) return;
    const c = inventoryFile.counts || {};
    const ok = await confirm(
      `Restore "${inventoryFile.name}"?\n\n`
      + `This replaces your inventory with the contents of this file:\n`
      + `• ${c.products ?? "?"} products, with their stock quantities\n`
      + `• ${c.categories ?? "?"} categories\n`
      + `• ${c.catalog_items ?? "?"} metals / purities / units / collections / tags\n`
      + `• ${c.attributes ?? "?"} attribute definitions\n`
      + `• ${c.shop_counters ?? "?"} counters\n`
      + `• ${c.inventory_movements ?? "?"} stock movement records\n`
      + `  (movement history for these products is replaced)\n\n`
      + `Customers, invoices, vendors, expenses and every other module are NOT touched.`,
      { title: "Restore inventory", confirmLabel: "Restore inventory" },
    );
    if (!ok) return;
    setInventoryRestoring(true);
    try {
      const { data } = await api.post(
        "/backup/import/inventory",
        { backup: inventoryFile.payload },
        { timeout: 300000 },
      );
      const parts = [];
      if (data.products) parts.push(`${data.products} products`);
      if (data.categories) parts.push(`${data.categories} categories`);
      if (data.catalog_items) parts.push(`${data.catalog_items} catalog items`);
      if (data.attributes) parts.push(`${data.attributes} attributes`);
      if (data.inventory_movements) parts.push(`${data.inventory_movements} movements`);
      toast.success(`Inventory restored — ${parts.join(", ") || "nothing to apply"}.`);
      if (data.movements_skipped) {
        toast.message(`${data.movements_skipped} movement record(s) skipped — product not found in this database.`);
      }
      setInventoryFile(null);
      api.get("/backup/summary").then(({ data: d }) => setSummary(d)).catch(() => {});
    } catch (err) {
      toast.error(formatApiError(err) || "Restore failed — no changes were applied.");
    } finally {
      setInventoryRestoring(false);
    }
  };

  const pickCustomerFile = () => customerFileRef.current?.click();

  const handleCustomerFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      toast.error("That file is not valid JSON. Choose a customer backup downloaded from this screen.");
      return;
    }
    if (payload?.format !== "slgt-jewel-erp/customer-backup") {
      toast.error('That is not a customer backup file. Use a file created by "Download backup" below.');
      return;
    }
    setCustomerFile({ name: file.name, payload, counts: payload.counts || {} });
  };

  const restoreCustomerFile = async () => {
    if (!customerFile) return;
    const c = customerFile.counts || {};
    const ok = await confirm(
      `Restore "${customerFile.name}"?\n\n`
      + `This brings in ${c.customers ?? "?"} customer profiles:\n`
      + `• Existing customers are matched by ID, or by mobile number + name, and updated from the file\n`
      + `• Customers missing on this machine are added\n`
      + `• Customers that exist only here are left alone — nothing is deleted\n\n`
      + `Contact details, GST / PAN / Aadhaar, date of birth, anniversary, tag, notes, `
      + `purchase totals and loyalty points are restored.\n\n`
      + `Invoices, advances, vendors, products, expenses and every other module are NOT touched.`,
      { title: "Restore customers", confirmLabel: "Restore customers" },
    );
    if (!ok) return;
    setCustomerRestoring(true);
    try {
      const { data } = await api.post(
        "/backup/import/customer",
        { backup: customerFile.payload },
        { timeout: 300000 },
      );
      const parts = [];
      if (data.created) parts.push(`${data.created} added`);
      if (data.updated) parts.push(`${data.updated} updated`);
      toast.success(`Customer backup restored — ${parts.join(", ") || "nothing to apply"}.`);
      if (data.skipped) {
        const reasons = Object.entries(data.skip_reasons || {})
          .map(([reason, n]) => `${n} ${reason}`)
          .join(", ");
        toast.message(`${data.skipped} customer(s) skipped — ${reasons || "see the backup file"}.`);
      }
      setCustomerFile(null);
      api.get("/backup/summary").then(({ data: d }) => setSummary(d)).catch(() => {});
    } catch (err) {
      toast.error(formatApiError(err) || "Restore failed — no changes were applied.");
    } finally {
      setCustomerRestoring(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  const EXPORTS = [
    { key: "customers", label: "Customers", desc: "Profiles and contact details", count: summary?.customers, color: "text-blue-700 bg-blue-50" },
    { key: "products", label: "Products / Inventory", desc: "Catalogue, weights, stock", count: summary?.products, color: "text-amber-700 bg-amber-50" },
    { key: "vendors", label: "Vendors & Suppliers", desc: "Supplier profiles and balances", count: summary?.vendors, color: "text-violet-700 bg-violet-50" },
    { key: "employees", label: "Employees", desc: "Staff records and departments", count: summary?.employees, color: "text-emerald-700 bg-emerald-50" },
  ];

  const DATE_EXPORTS = [
    { key: "invoices", label: "Sales Invoices", desc: "Billing for selected dates", count: summary?.invoices, color: "text-indigo-700 bg-indigo-50" },
    { key: "expenses", label: "Expenses", desc: "Expense entries in range", count: summary?.expenses, color: "text-red-700 bg-red-50" },
    { key: "stock-history", label: "Stock History", desc: "Stock movements in range", count: summary?.stock_history, color: "text-orange-700 bg-orange-50" },
  ];

  const dateControls = (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="text-[11px] text-[#737373] block mb-1">From</label>
        <input type="date" className="input !py-1.5 !text-[12.5px]" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div>
        <label className="text-[11px] text-[#737373] block mb-1">To</label>
        <input type="date" className="input !py-1.5 !text-[12.5px]" value={to} onChange={(e) => setTo(e.target.value)} max={today} />
      </div>
    </div>
  );

  return (
    <SettingsTabFrame>
      <SettingsStatGrid>
        <SettingsStat label="Customers" value={summary?.customers} />
        <SettingsStat label="Products" value={summary?.products} />
        <SettingsStat label="Invoices" value={summary?.invoices} />
        <SettingsStat label="Vendors" value={summary?.vendors} />
        <SettingsStat label="Orders" value={summary?.orders} />
      </SettingsStatGrid>

      <SettingsSplit>
        <SettingsActionCard
          icon={Usb}
          title="Transfer to USB / folder"
          description="Full shop database snapshot plus date-range CSVs for invoices, expenses, and stock — saved to a pendrive or any folder."
          className="border-[#0A0A0A]"
          footer={(
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={loading.transfer || !canWrite}
                onClick={transferToFolder}
                className="inline-flex items-center gap-2 px-3 py-2 text-[13px] bg-[#0A0A0A] text-white disabled:opacity-50"
              >
                {loading.transfer ? <Loader2 size={14} className="animate-spin" /> : <Usb size={14} strokeWidth={1.5} />}
                {loading.transfer ? "Saving backup…" : "Save to USB / folder…"}
              </button>
              {!isDesktop && (
                <span className="text-[12px] text-amber-800">Desktop ERP app required</span>
              )}
            </div>
          )}
        >
          {dateControls}
          <div className="mt-3 text-[11.5px] text-[#737373]">
            CSV range: <span className="font-medium text-[#0A0A0A]">{from}</span> → <span className="font-medium text-[#0A0A0A]">{to}</span>
          </div>
        </SettingsActionCard>

        <SettingsActionCard
          icon={Lock}
          title="Encrypted database backups"
          description="AES-256-GCM archives on this PC. Replication is not a backup — keep encrypted snapshots and store the recovery key offline."
          footer={(
            <button
              type="button"
              disabled={loading.enc || !canWrite}
              onClick={createEncrypted}
              className="inline-flex items-center gap-2 px-3 py-2 text-[13px] bg-[#0A0A0A] text-white disabled:opacity-50"
            >
              {loading.enc ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} strokeWidth={1.5} />}
              {loading.enc ? "Encrypting…" : "Create Encrypted Backup"}
            </button>
          )}
        >
          <div className="max-h-[220px] overflow-y-auto space-y-3 text-[12px] text-[#737373] pr-1">
            {["frequent", "daily", "weekly", "monthly"].map((tier) => (
              <div key={tier}>
                <div className="font-medium text-[#525252] capitalize mb-1">{tier}</div>
                {(encBackups?.backups?.[tier] || []).length === 0 ? (
                  <div className="pl-2 text-[#a3a3a3]">No files</div>
                ) : (
                  (encBackups.backups[tier] || []).slice(0, 4).map((b) => (
                    <div key={b.path || b.name} className="flex items-center justify-between gap-2 pl-2 border-l border-[#E5E7EB] py-0.5">
                      <span className="truncate font-mono text-[11.5px]">{b.name}</span>
                      <button
                        type="button"
                        className="text-[11px] text-red-700 underline shrink-0"
                        disabled={loading.restore || !canWrite}
                        onClick={() => restoreBackup(b)}
                      >
                        Restore…
                      </button>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        </SettingsActionCard>
      </SettingsSplit>

      <SettingsActionCard
        icon={Package}
        title="Inventory backup (stock + catalog)"
        description="One file for the whole Inventory module: products with their current stock quantities, the full category tree, metals / purities / units / collections / tags, attribute definitions, showcase counters and the stock movement ledger. Customers, invoices, vendors and every other module are deliberately excluded."
        footer={(
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => download("inventory", `inventory_backup_${today}.json`)}
              disabled={loading.inventory || !canWrite}
              className="inline-flex items-center gap-2 px-3 py-2 text-[13px] bg-[#0A0A0A] text-white disabled:opacity-50"
            >
              {loading.inventory ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} strokeWidth={1.5} />}
              {loading.inventory ? "Preparing…" : "Download backup"}
            </button>
            <button
              type="button"
              onClick={pickInventoryFile}
              disabled={inventoryRestoring || !canWrite}
              className="inline-flex items-center gap-2 px-3 py-2 text-[13px] bg-white text-[#0A0A0A] border border-[#0A0A0A] disabled:opacity-50"
            >
              <FolderOpen size={14} strokeWidth={1.5} /> Choose file to restore…
            </button>
            <input
              ref={inventoryFileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleInventoryFileSelected}
            />
          </div>
        )}
      >
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-[#525252]">
          {[
            ["Products", summary?.products],
            ["Categories", summary?.categories],
            ["Metals / purities / units", summary?.catalog_items],
            ["Attributes", summary?.attributes],
            ["Counters", summary?.shop_counters],
            ["Stock movements", summary?.inventory_movements],
          ].map(([label, value]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-[#0A0A0A] tabular-nums">{value ?? "—"}</span>
              {label}
            </span>
          ))}
        </div>

        {inventoryFile ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 p-3 border border-amber-200 bg-amber-50 rounded-lg">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-amber-900 truncate">{inventoryFile.name}</div>
              <div className="text-[11.5px] text-amber-700">
                {inventoryFile.counts?.products ?? "?"} products · {inventoryFile.counts?.categories ?? "?"} categories ·{" "}
                {inventoryFile.counts?.catalog_items ?? "?"} catalog items · {inventoryFile.counts?.inventory_movements ?? "?"} movements
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setInventoryFile(null)}
                disabled={inventoryRestoring}
                className="btn-secondary !text-[12px] !py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={restoreInventoryFile}
                disabled={inventoryRestoring || !canWrite}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-red-600 text-white rounded disabled:opacity-50"
              >
                {inventoryRestoring ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} strokeWidth={1.5} />}
                {inventoryRestoring ? "Restoring…" : "Restore inventory"}
              </button>
            </div>
          </div>
        ) : null}
      </SettingsActionCard>

      <SettingsActionCard
        icon={Users}
        title="Customer backup"
        description="One file with every customer profile: contact details, GST / PAN / Aadhaar, date of birth and anniversary, tag, notes, purchase totals, loyalty points and their CUST-001 serial numbers. Invoices, advances and every other module are deliberately excluded."
        footer={(
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => download("customer", `customer_backup_${today}.json`)}
              disabled={loading.customer || !canWrite}
              className="inline-flex items-center gap-2 px-3 py-2 text-[13px] bg-[#0A0A0A] text-white disabled:opacity-50"
            >
              {loading.customer ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} strokeWidth={1.5} />}
              {loading.customer ? "Preparing…" : "Download backup"}
            </button>
            <button
              type="button"
              onClick={pickCustomerFile}
              disabled={customerRestoring || !canWrite}
              className="inline-flex items-center gap-2 px-3 py-2 text-[13px] bg-white text-[#0A0A0A] border border-[#0A0A0A] disabled:opacity-50"
            >
              <FolderOpen size={14} strokeWidth={1.5} /> Choose file to restore…
            </button>
            <input
              ref={customerFileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleCustomerFileSelected}
            />
          </div>
        )}
      >
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-[#525252]">
          {[
            ["Customers", summary?.customers],
          ].map(([label, value]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-[#0A0A0A] tabular-nums">{value ?? "—"}</span>
              {label}
            </span>
          ))}
        </div>

        {customerFile ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 p-3 border border-amber-200 bg-amber-50 rounded-lg">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-amber-900 truncate">{customerFile.name}</div>
              <div className="text-[11.5px] text-amber-700">
                {customerFile.counts?.customers ?? "?"} customer profiles
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setCustomerFile(null)}
                disabled={customerRestoring}
                className="btn-secondary !text-[12px] !py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={restoreCustomerFile}
                disabled={customerRestoring || !canWrite}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-red-600 text-white rounded disabled:opacity-50"
              >
                {customerRestoring ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} strokeWidth={1.5} />}
                {customerRestoring ? "Restoring…" : "Restore customers"}
              </button>
            </div>
          </div>
        ) : null}
      </SettingsActionCard>

      <SettingsSection
        title="Import Backup File"
        description="Restore your shop data from a previously saved backup (.sqlite snapshot or .enc encrypted archive). This replaces all current data — the app restarts automatically once the restore finishes."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={pickImportFile}
            disabled={importBusy || !canWrite}
            className="inline-flex items-center gap-2 px-3 py-2 text-[13px] bg-[#0A0A0A] text-white disabled:opacity-50"
          >
            <FolderOpen size={14} strokeWidth={1.5} /> Choose backup file…
          </button>
          {!canImport && (
            <span className="text-[12px] text-amber-800">Desktop ERP app required</span>
          )}
          {importFile && (
            <div className="flex items-center gap-2 text-[12.5px] text-[#0A0A0A]">
              <span className="font-mono truncate max-w-[260px]">{importFile.name}</span>
              <button
                type="button"
                onClick={restoreImportedFile}
                disabled={importBusy || !canWrite}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-[12.5px] bg-red-600 text-white rounded disabled:opacity-50"
              >
                {importBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                {importBusy ? "Restoring…" : "Restore"}
              </button>
            </div>
          )}
        </div>
        <p className="text-[11.5px] text-[#737373] mt-3">
          A safety copy of your current database is kept automatically before the swap, in case something goes wrong.
        </p>
      </SettingsSection>

      <SettingsSplit>
        <SettingsSection
          title="Full data export"
          description="Download complete master records as CSV for Excel or Google Sheets."
        >
          <div className="space-y-2">
            {EXPORTS.map((e) => (
              <SettingsExportRow
                key={e.key}
                label={e.label}
                description={e.desc}
                badge={`${e.count ?? "—"} records`}
                badgeClassName={e.color}
                action={(
                  <button
                    type="button"
                    onClick={() => download(e.key, `${e.key}_${today}.csv`)}
                    disabled={loading[e.key]}
                    className="btn-secondary flex items-center gap-1.5 !text-[12px] !py-1.5 shrink-0"
                  >
                    {loading[e.key] ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} strokeWidth={1.5} />}
                    {loading[e.key] ? "…" : "CSV"}
                  </button>
                )}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Date range export"
          description="Filter transactional records by From–To before exporting."
          actions={dateControls}
        >
          <div className="space-y-2">
            {DATE_EXPORTS.map((e) => (
              <SettingsExportRow
                key={e.key}
                label={e.label}
                description={e.desc}
                badge={`${e.count ?? "—"} total`}
                badgeClassName={e.color}
                action={(
                  <button
                    type="button"
                    onClick={() => download(e.key, `${e.key}_${from}_to_${to}.csv`, { from, to })}
                    disabled={loading[e.key]}
                    className="btn-secondary flex items-center gap-1.5 !text-[12px] !py-1.5 shrink-0"
                  >
                    {loading[e.key] ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} strokeWidth={1.5} />}
                    {loading[e.key] ? "…" : "CSV"}
                  </button>
                )}
              />
            ))}
          </div>
        </SettingsSection>
      </SettingsSplit>

      <SettingsSection
        title="Import from CSV"
        description="Bring data in from a spreadsheet — download the template (or use the file exported above / from Inventory's own Export CSV), fill it in, then upload it here. Existing records are matched and updated; new rows are added. This works entirely in the browser — no desktop app required."
      >
        <input
          ref={csvFileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleCsvFileSelected}
        />
        <div className="space-y-2">
          {EXPORTS.map((e) => (
            <SettingsExportRow
              key={e.key}
              label={e.label}
              description={e.desc}
              badge={`${e.count ?? "—"} records`}
              badgeClassName={e.color}
              action={(
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => downloadTemplate(e.key)}
                    disabled={loading[`tpl-${e.key}`]}
                    className="btn-secondary flex items-center gap-1.5 !text-[12px] !py-1.5"
                    title="Download a blank CSV template with the right columns"
                  >
                    {loading[`tpl-${e.key}`] ? <RefreshCw size={12} className="animate-spin" /> : <FileText size={12} strokeWidth={1.5} />}
                    Template
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerCsvImport(e.key)}
                    disabled={csvImporting[e.key] || !canWrite}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-[#0A0A0A] text-white rounded disabled:opacity-50"
                  >
                    {csvImporting[e.key] ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} strokeWidth={1.5} />}
                    {csvImporting[e.key] ? "Importing…" : "Upload CSV"}
                  </button>
                </div>
              )}
            />
          ))}
        </div>
      </SettingsSection>

      <div className="w-full p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <div className="text-[12.5px] font-semibold text-amber-800 mb-1">Recommended: weekly USB + encrypted backup</div>
        <div className="text-[12px] text-amber-700">
          Export customers, products, and invoices every week. Store copies on a USB drive and keep an encrypted snapshot on this PC.
        </div>
      </div>

      <FactoryResetSection canWrite={canWrite} />

      <ImportProgressModal
        open={Boolean(productImportProgress)}
        title="Importing products"
        progress={productImportProgress}
        onClose={() => setProductImportProgress(null)}
      />

      {confirmModal}
    </SettingsTabFrame>
  );
}
