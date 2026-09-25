import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  Boxes,
  ScanBarcode,
  Users2,
  Coins,
  LineChart,
  Settings,
  LogOut,
  Bell,
  Search,
  Layers,
  Megaphone,
  Wallet,
  UserCog,
  X,
  ShoppingCart,
  Truck,
  ClipboardList,
  FileText,
  Tag,
  PackageCheck,
  Layers3,
  Activity,
  Crown,
  CheckCircle2,
  Loader2,
  ArrowLeftRight,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useBusinessDate } from "@/context/BusinessDateContext";
import { useApplicationFeatures } from "@/context/ApplicationFeatureContext";
import { T } from "@/constants/testIds";
import { fmtDateTime, fmtDate, fmtINR } from "@/lib/format";
import { formatRoleLabel, hasFullAccessRole, isShopOwnerRole, isReservedAdminEmail } from "@/lib/roleLabel";
import { useState, useEffect, useRef } from "react";
import TestModeBanner from "@/components/TestModeBanner";
import { useAccountsTestMode } from "@/hooks/useAccountsTestMode";
import api, { formatApiError, triggerBackgroundSync } from "@/lib/api";
import ApiLoadingBar from "@/components/common/ApiLoadingBar";
import ConnectivityBanner from "@/components/layout/ConnectivityBanner";
import HiddenBillPasswordDialog from "@/components/pos/HiddenBillPasswordDialog";
import { useHiddenBillsUnlocked } from "@/lib/hiddenBillsUnlock";
import { useDashboardHiddenUnlocked } from "@/lib/dashboardHiddenUnlock";
import { toast } from "sonner";
import slgtLogo from "@/assets/slgt-logo.png";
import { APP_WINDOW_TITLE } from "@/lib/appBrand";

// `feature` = Application Management key gating this item (see
// frontend/src/config/applicationFeatures.js). Items with no `feature` are
// never licensable (Settings/System Health/Hidden Bills) and are always
// shown to whoever already passes the existing `can(module,"view")`/ownerOnly
// checks below — this key is purely additive, layered above RBAC, not a
// replacement for it.
const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, tid: T.navDashboard, module: "dashboard", feature: "dashboard", section: "Overview" },
  { to: "/pos", label: "POS Billing", icon: ScanBarcode, tid: T.navPos, module: "pos", feature: "pos", section: "Commerce" },
  { to: "/inventory", label: "Inventory", icon: Boxes, tid: T.navInventory, module: "inventory", feature: "inventory", section: "Commerce" },
  { to: "/barcodes", label: "Barcode Manager", icon: Tag, tid: "nav-barcodes", module: "inventory", feature: "barcode_management", section: "Commerce" },
  { to: "/catalog", label: "Catalog", icon: Layers, tid: "nav-catalog", module: "catalog", feature: "catalog", section: "Commerce" },
  { to: "/customers", label: "Customers", icon: Users2, tid: T.navCustomers, module: "customers", feature: "customers", section: "Commerce" },
  { to: "/promotions", label: "Promotions", icon: Megaphone, tid: "nav-promotions", module: "promotions", feature: "promotions", section: "Commerce" },
  { to: "/quotations", label: "Estimations", icon: FileText, tid: "nav-quotations", module: "quotations", feature: "quotations", section: "Commerce" },
  { to: "/orders", label: "Orders", icon: ClipboardList, tid: "nav-orders", module: "orders", feature: "orders", section: "Commerce" },
  { to: "/barcode-stock-check", label: "Barcode Stock Check", icon: PackageCheck, tid: "nav-barcode-stock-check", module: "barcode_stock_check", feature: "barcode_stock_check", section: "Commerce" },
  { to: "/schemes", label: "Gold Schemes", icon: Coins, tid: T.navSchemes, module: "gold_schemes", feature: "gold_schemes", section: "Programs" },
  { to: "/scheme-plans", label: "Scheme Management", icon: Layers3, tid: T.navSchemePlans, module: "gold_schemes", feature: "gold_schemes", section: "Programs" },
  { to: "/vendors", label: "Vendors", icon: Truck, tid: "nav-vendors", module: "vendors", feature: "vendors", section: "Purchase" },
  { to: "/purchases", label: "Purchases", icon: ShoppingCart, tid: "nav-purchases", module: "purchases", feature: "purchases", section: "Purchase" },
  { to: "/accounts", label: "Accounts", icon: Wallet, tid: "nav-accounts", module: "accounts", feature: "accounts", section: "Finance" },
  { to: "/hidden-bills", label: "Hidden Bills", icon: Crown, tid: "nav-hidden-bills", module: "accounts", section: "Finance", ownerOnly: true, requiresPin: true },
  { to: "/employees", label: "Employees", icon: UserCog, tid: "nav-employees", module: "employees", feature: "employees", section: "Finance" },
  { to: "/reports", label: "Reports", icon: LineChart, tid: T.navReports, module: "reports", feature: "reports", section: "Insights" },
  { to: "/settings", label: "Settings", icon: Settings, tid: T.navSettings, module: "settings", section: "Configure" },
  { to: "/system-health", label: "System Health", icon: Activity, tid: "nav-system-health", module: "settings", section: "Configure" },
];

function Sidebar({ onRequestHiddenUnlock }) {
  const { user, logout, can } = useAuth();
  const { isEnabled } = useApplicationFeatures();
  const { displayName, logo, tagline, ownerName } = useCompany();
  const [hiddenUnlocked] = useHiddenBillsUnlocked();
  const brandTapRef = useRef({ count: 0, timer: null });
  const role = String(user?.role || "");
  const isOwner = hasFullAccessRole(role) || isReservedAdminEmail(user?.email);
  const isShopOwner = isShopOwnerRole(role) && !isReservedAdminEmail(user?.email);
  const footerName = isShopOwner
    ? (ownerName || user?.name || "Staff")
    : (user?.name || "Staff");
  const roleLabel = isReservedAdminEmail(user?.email)
    ? "Super Admin"
    : isShopOwner
      ? "Shop Owner"
      : formatRoleLabel(user?.role, ownerName, user?.email);
  const showRoleLine = footerName.trim().toLowerCase() !== String(roleLabel).trim().toLowerCase();

  const nameLines = String(displayName || "Jewellery Shop").trim().split(/\s+/);
  const brandLine1 = nameLines.length > 1
    ? nameLines.slice(0, Math.ceil(nameLines.length / 2)).join(" ")
    : displayName;
  const brandLine2 = nameLines.length > 1
    ? nameLines.slice(Math.ceil(nameLines.length / 2)).join(" ")
    : null;

  const grouped = NAV.reduce((acc, item) => {
    acc[item.section] = acc[item.section] || [];
    acc[item.section].push(item);
    return acc;
  }, {});

  return (
    <aside
      data-testid={T.sidebar}
      className="w-64 border-r border-[#E5E7EB] bg-[#F9FAFB] fixed inset-y-0 left-0 flex flex-col"
    >
      <div className="h-16 border-b border-[#E5E7EB] flex items-center px-5 gap-3">
        <button
          type="button"
          className="flex items-center gap-3 text-left min-w-0"
          title={isOwner ? "Triple-tap to unlock Hidden Bills" : undefined}
          onClick={() => {
            if (!isOwner) return;
            const ref = brandTapRef.current;
            ref.count += 1;
            if (ref.timer) clearTimeout(ref.timer);
            if (ref.count >= 3) {
              ref.count = 0;
              onRequestHiddenUnlock?.();
              return;
            }
            ref.timer = setTimeout(() => { ref.count = 0; }, 450);
          }}
        >
          <div className="h-10 w-10 rounded-md bg-black flex items-center justify-center flex-shrink-0 overflow-hidden border border-[#E5E7EB]">
            {logo ? (
              <img src={logo} alt="" className="h-full w-full object-contain bg-white" />
            ) : (
              <img src={slgtLogo} alt={APP_WINDOW_TITLE} className="h-full w-full object-contain" />
            )}
          </div>
          <div className="leading-tight min-w-0">
            <div className="font-display text-[13px] font-semibold text-[#0A0A0A] leading-tight truncate" title={displayName}>
              {brandLine2 ? <>{brandLine1}<br />{brandLine2}</> : brandLine1}
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#737373] truncate">
              {tagline || "Jewellery ERP"}
            </div>
          </div>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {Object.entries(grouped).map(([section, items]) => {
          const visible = items.filter((i) => {
            if (i.ownerOnly) {
              if (!isOwner) return false;
            }
            if (i.requiresPin && !hiddenUnlocked) return false;
            if (i.feature && !isEnabled(i.feature)) return false;
            return can(i.module, "view");
          });
          if (visible.length === 0) return null;
          return (
            <div key={section} className="mb-2">
              <div className="side-label">{section}</div>
              <div className="flex flex-col gap-0.5">
                {visible.map((it) => {
                  const Icon = it.icon;
                  return (
                    <NavLink
                      key={it.to}
                      to={it.to}
                      end={it.to === "/"}
                      data-testid={it.tid}
                      className={({ isActive }) =>
                        `side-item ${isActive ? "active" : ""}`
                      }
                    >
                      <Icon size={16} strokeWidth={1.5} className="side-icon text-[#737373]" />
                      <span>{it.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-[#E5E7EB] p-3">
        <div className="flex items-center gap-3 p-2 rounded-md">
          <div className="h-9 w-9 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center font-display text-[13px]">
            {(footerName || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-[13px] font-medium text-[#0A0A0A] truncate">{footerName}</div>
            {showRoleLine && (
              <div className="text-[11px] text-[#737373] truncate">{roleLabel}</div>
            )}
          </div>
          <button
            data-testid={T.sidebarLogout}
            onClick={logout}
            className="text-[#737373] hover:text-[#0A0A0A] p-1.5 rounded-md hover:bg-white transition-colors"
            aria-label="Logout"
          >
            <LogOut size={15} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.get(`/search?q=${encodeURIComponent(query)}`);
        setResults(data);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const go = (path) => { navigate(path); setOpen(false); setQuery(""); setResults(null); };

  return (
    <div ref={ref} className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a3a3a3]" strokeWidth={1.5} />
      <input
        placeholder="Search products, customers, invoices…"
        className="input pl-9 w-80"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && (query || loading) && (
        <div className="absolute top-full mt-1 w-full bg-white border border-[#E5E7EB] rounded-lg shadow-lg z-50 overflow-hidden">
          {loading && <div className="px-4 py-3 text-[13px] text-[#737373]">Searching…</div>}
          {results && !loading && (
            <>
              {results.customers?.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-[#a3a3a3] bg-[#F9FAFB]">Customers</div>
                  {results.customers.map((c) => (
                    <button key={c.id} onClick={() => go(`/customers/${c.id}`)}
                      className="w-full text-left px-4 py-2.5 hover:bg-[#F9FAFB] flex items-center gap-3">
                      <Users2 size={14} className="text-[#737373]" strokeWidth={1.5} />
                      <div>
                        <div className="text-[13px] font-medium text-[#0A0A0A]">{c.name}</div>
                        <div className="text-[11px] text-[#737373]">{c.mobile}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {results.products?.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-[#a3a3a3] bg-[#F9FAFB]">Products</div>
                  {results.products.map((p) => (
                    <button key={p.id} onClick={() => go(`/inventory/${p.id}`)}
                      className="w-full text-left px-4 py-2.5 hover:bg-[#F9FAFB] flex items-center gap-3">
                      <Boxes size={14} className="text-[#737373]" strokeWidth={1.5} />
                      <div>
                        <div className="text-[13px] font-medium text-[#0A0A0A]">{p.name}</div>
                        <div className="text-[11px] text-[#737373]">{p.code || p.barcode || ""}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {results.invoices?.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-[#a3a3a3] bg-[#F9FAFB]">Invoices</div>
                  {results.invoices.map((inv) => (
                    <button key={inv.id} onClick={() => go(`/customers?invoice=${inv.id}`)}
                      className="w-full text-left px-4 py-2.5 hover:bg-[#F9FAFB] flex items-center gap-3">
                      <LineChart size={14} className="text-[#737373]" strokeWidth={1.5} />
                      <div>
                        <div className="text-[13px] font-medium text-[#0A0A0A]">{inv.invoice_no}</div>
                        <div className="text-[11px] text-[#737373]">{inv.customer_name} · {fmtINR(inv.grand_total)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!results.customers?.length && !results.products?.length && !results.invoices?.length && (
                <div className="px-4 py-3 text-[13px] text-[#737373]">No results for "{query}"</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function fmtRelTime(ts) {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function parseNotifData(raw) {
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
  return raw;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const load = async () => {
    try {
      const { data } = await api.get("/notifications?limit=30");
      setItems(data.notifications || []);
      setUnread(data.unread_count || 0);
    } catch { /* silent */ }
  };

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markAllRead = async () => {
    try {
      await api.put("/notifications/read-all");
      setUnread(0);
      setItems((p) => p.map((n) => ({ ...n, is_read: true })));
    } catch { /* silent */ }
  };

  const deleteOne = async (id, wasUnread) => {
    try {
      await api.delete(`/notifications/${id}`);
      setItems((p) => p.filter((n) => n.id !== id));
      if (wasUnread) setUnread((p) => Math.max(0, p - 1));
    } catch { /* silent */ }
  };

  const typeColors = {
    low_stock:     "bg-amber-100 text-amber-700",
    out_of_stock:  "bg-red-100 text-red-700",
    scheme_due:    "bg-blue-100 text-blue-700",
    daily_closing: "bg-purple-100 text-purple-700",
    info:          "bg-[#F3F4F6] text-[#525252]",
  };

  const typeLabel = {
    low_stock: "Low Stock", out_of_stock: "Out of Stock",
    scheme_due: "Scheme Due", daily_closing: "Daily Closing", info: "Info",
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen((p) => !p); if (!open) load(); }}
        className="btn-secondary relative"
        aria-label="Notifications"
      >
        <Bell size={15} strokeWidth={1.5} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[340px] bg-white border border-[#E5E7EB] rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB] bg-[#FAFAFA]">
            <div className="flex items-center gap-2">
              <Bell size={13} strokeWidth={1.5} className="text-[#525252]" />
              <span className="text-[13px] font-semibold text-[#0A0A0A]">Notifications</span>
              {unread > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{unread}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button onClick={markAllRead} className="text-[11px] text-[#525252] hover:text-[#0A0A0A] transition-colors">
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-[#a3a3a3] hover:text-[#0A0A0A] transition-colors">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[360px] overflow-y-auto divide-y divide-[#F3F4F6]">
            {items.length === 0 && (
              <div className="px-4 py-8 text-center">
                <Bell size={24} strokeWidth={1} className="mx-auto text-[#D1D5DB] mb-2" />
                <div className="text-[13px] text-[#737373]">All caught up!</div>
                <div className="text-[11px] text-[#a3a3a3] mt-0.5">No new notifications</div>
              </div>
            )}
            {items.map((n) => {
              const d = parseNotifData(n.data);
              const isUnread = !n.is_read;
              const stockQty = d.stock_qty ?? d.qty_after;
              const unit = d.unit || "pcs";
              return (
                <div
                  key={n.id}
                  className={`group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[#F9FAFB] ${isUnread ? "bg-blue-50/30" : ""}`}
                >
                  {/* Type dot */}
                  <div className="flex-shrink-0 mt-0.5">
                    <span className={`inline-block h-2 w-2 rounded-full mt-1.5 ${isUnread ? "bg-blue-500" : "bg-transparent"}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${typeColors[n.type] || typeColors.info}`}>
                        {typeLabel[n.type] || n.type}
                      </span>
                      <span className="text-[10px] text-[#a3a3a3]">{fmtRelTime(n.createdAt)}</span>
                    </div>
                    <div className="text-[12.5px] font-semibold text-[#0A0A0A] leading-snug">{n.title}</div>
                    <div className="text-[11.5px] text-[#737373] mt-0.5 leading-snug">{n.message}</div>
                    {stockQty != null && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${n.type === "out_of_stock" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {n.type === "out_of_stock" ? "Out of stock" : `${stockQty} ${unit} remaining`}
                        </span>
                        {d.threshold != null && (
                          <span className="text-[10px] text-[#a3a3a3]">reorder at {d.threshold}</span>
                        )}
                      </div>
                    )}
                    {d.metal && (
                      <div className="text-[10px] text-[#a3a3a3] mt-1 capitalize">{d.metal} · {d.form_type}</div>
                    )}
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => deleteOne(n.id, isUnread)}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[#a3a3a3] hover:text-red-500 p-0.5"
                    title="Dismiss"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="px-4 py-2 border-t border-[#E5E7EB] bg-[#FAFAFA] text-[10px] text-[#a3a3a3] text-center">
              Showing {items.length} notification{items.length !== 1 ? "s" : ""} · Updates every 30s
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Topbar() {
  const location = useLocation();
  const { displayName } = useCompany();
  const { date: businessDate, isStale: isBusinessDateStale, daysStale: businessDaysStale } = useBusinessDate();
  const { user } = useAuth();
  const isOwner = hasFullAccessRole(user?.role);
  const [dashHiddenUnlocked, setDashHiddenUnlocked] = useDashboardHiddenUnlocked();
  const [dashPwOpen, setDashPwOpen] = useState(false);
  const [dashPwBusy, setDashPwBusy] = useState(false);
  const [dashPwError, setDashPwError] = useState("");
  const dashClicksRef = useRef({ count: 0, timer: null });

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const titles = {
    "/": "Dashboard",
    "/pos": "POS · Billing",
    "/inventory": "Inventory",
    "/barcodes": "Barcode Manager",
    "/catalog": "Catalog · Master Data",
    "/customers": "Customers",
    "/promotions": "Promotions & Marketing",
    "/schemes": "Gold Saving Schemes",
    "/accounts": "Accounts & Finance",
    "/employees": "Employees",
    "/vendors": "Vendors & Suppliers",
    "/purchases": "Purchase Management",
    "/quotations": "Estimations",
    "/orders": "Order Management",
    "/barcode-stock-check": "Barcode Stock Check",
    "/reports": "Reports & Analytics",
    "/settings": "Settings",
    "/system-health": "System Health",
  };
  const base = "/" + (location.pathname.split("/")[1] || "");
  const title = titles[base] || displayName;
  const isDashboardRoute = base === "/";

  const handleTitleClick = () => {
    if (!isDashboardRoute || !isOwner || dashHiddenUnlocked) return;
    const state = dashClicksRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.count += 1;
    if (state.count >= 3) {
      state.count = 0;
      state.timer = null;
      setDashPwError("");
      setDashPwOpen(true);
    } else {
      state.timer = setTimeout(() => {
        state.count = 0;
        state.timer = null;
      }, 2500);
    }
  };

  return (
    <div className="h-16 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-xl sticky top-0 z-20 flex items-center justify-between px-8">
      <div className="flex items-center gap-4">
        <h1
          className="select-none font-display text-[18px] font-medium text-[#0A0A0A] tracking-tight"
          onClick={isDashboardRoute ? handleTitleClick : undefined}
          title={isDashboardRoute && isOwner && !dashHiddenUnlocked ? "Triple-click to unlock hidden bill figures" : undefined}
        >
          {title}
        </h1>
        <span className="text-[11px] text-[#a3a3a3] font-mono">{fmtDateTime(now)}</span>
        {businessDate && (
          <span
            className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
              isBusinessDateStale ? "bg-red-50 text-red-700" : "bg-[#F5F5F4] text-[#737373]"
            }`}
            title={
              isBusinessDateStale
                ? `Business day not closed for ${businessDaysStale} day(s) — go to Accounts → Daily Closing`
                : "Current billing date"
            }
          >
            Transaction date: {fmtDate(businessDate)}
          </span>
        )}
        {isDashboardRoute && dashHiddenUnlocked ? (
          <button
            type="button"
            onClick={() => setDashHiddenUnlocked(false)}
            className="flex items-center gap-1.5 rounded-full bg-[#B49042]/15 px-3 py-1.5 text-xs font-semibold text-[#B49042] hover:bg-[#B49042]/25"
            title="Hidden bill figures are included — click to lock again"
          >
            Hidden bills included · Lock
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <GlobalSearch />
        <NotificationBell />
      </div>

      {dashPwOpen && createPortal(
        <HiddenBillPasswordDialog
          open={dashPwOpen}
          busy={dashPwBusy}
          error={dashPwError}
          onClose={() => {
            if (dashPwBusy) return;
            setDashPwOpen(false);
            setDashPwError("");
          }}
          onSubmit={async (pin) => {
            setDashPwBusy(true);
            setDashPwError("");
            try {
              await api.post("/settings/verify-hidden-bill-password", { password: pin });
              setDashHiddenUnlocked(true);
              setDashPwOpen(false);
              toast.success("Hidden bill figures unlocked");
            } catch (err) {
              const msg = formatApiError(err) || "Incorrect password";
              setDashPwError(msg);
              toast.error(
                msg.includes("Incorrect") || msg.includes("password") ? "Wrong PIN — try again" : msg,
              );
            } finally {
              setDashPwBusy(false);
            }
          }}
        />,
        document.body,
      )}
    </div>
  );
}

// ─── Ownership Acceptance Modal (shown on client PCs being promoted) ──────────

function AcceptOwnershipModal({ onDismiss, transferToken, deviceId }) {
  const [steps, setSteps] = useState([
    {
      id: "pull",
      label: "Downloading database file from owner PC over LAN",
      state: "pending",
    },
    { id: "promote", label: "Starting as new owner PC", state: "pending" },
    { id: "reload", label: "Opening CRM as owner", state: "pending" },
  ]);
  const [accepted, setAccepted] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  function setStep(id, state) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, state } : s));
  }

  async function accept() {
    setAccepted(true);
    try {
      if (!transferToken || !deviceId) {
        throw new Error("Missing transfer authorization — wait for owner to re-initiate transfer");
      }
      setStep("pull", "active");

      // Always LAN: download SQLite file from owner PC (requires transfer token)
      const ownerUrl = (await window.jewelleryCRM?.getConfig())?.branch_api_url
        || window.location.origin.replace(/:\d+$/, ":8080");

      const token = localStorage.getItem("ssj_token") || "";
      const response = await fetch(`${ownerUrl}/api/devices/export-db`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "X-Transfer-Token": transferToken,
          "X-Device-Id": deviceId,
        },
      });
      if (!response.ok) throw new Error(`Export failed: ${response.status} ${response.statusText}`);

      const total = parseInt(response.headers.get("content-length") || "0", 10);
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) setProgress(Math.round((received / total) * 100));
      }
      setProgress(100);

      const buffer = await new Blob(chunks).arrayBuffer();
      if (!window.jewelleryCRM?.saveExportFile) throw new Error("saveExportFile IPC not available");
      const { tempPath, size } = await window.jewelleryCRM.saveExportFile({
        buffer,
        fileName: "ownership-transfer.sqlite.tmp",
      });
      if (size < 1024) throw new Error("Downloaded file is too small — transfer may be corrupted");

      setStep("pull", "done");
      setStep("promote", "active");

      if (!window.jewelleryCRM?.replaceAndRestartDb) throw new Error("replaceAndRestartDb IPC not available");
      await window.jewelleryCRM.replaceAndRestartDb({ tempFilePath: tempPath });

      // Notify owner that transfer is complete (same transfer authorization)
      try {
        await api.post("/devices/transfer/complete", {
          transfer_token: transferToken,
          device_id: deviceId,
        }, {
          headers: {
            "X-Transfer-Token": transferToken,
            "X-Device-Id": deviceId,
          },
        });
      } catch { /* best effort */ }
      setStep("promote", "done");
      setStep("reload", "active");

      if (window.jewelleryCRM) {
        await window.jewelleryCRM.setConfig({ mode: "host", setup_complete: true });
        await new Promise(r => setTimeout(r, 1000));
        setStep("reload", "done");
        await new Promise(r => setTimeout(r, 800));
        window.jewelleryCRM.completeSetupAndReload();
      } else {
        setStep("reload", "done");
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (err) {
      setSteps(prev => prev.map(s => s.state === "active" ? { ...s, state: "error" } : s));
      setError(err.message || "Failed to accept ownership");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-full p-2">
              <Crown size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-[16px]">Ownership Transfer</h2>
              <p className="text-amber-100 text-[12px] mt-0.5">The shop owner is transferring ownership to this PC</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          {!accepted ? (
            <>
              <p className="text-[13px] text-[#374151] mb-4">
                This PC will become the new <strong>owner/host</strong> of the shop. All client PCs will connect to this PC over the LAN. Shop data is copied from the current owner PC (local database).
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onDismiss}
                  className="flex-1 py-2.5 border border-[#E5E7EB] rounded-lg text-[13px] text-[#737373] hover:bg-[#F9FAFB] transition-colors"
                >
                  Decline
                </button>
                <button
                  onClick={accept}
                  className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg text-[13px] font-semibold hover:bg-amber-600 transition-colors"
                >
                  Accept &amp; Become Owner
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-1">
              {steps.map(step => (
                <div key={step.id} className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors ${
                  step.state === "active" ? "bg-amber-50" : step.state === "done" ? "bg-green-50" : "bg-transparent"
                }`}>
                  <div className="flex-shrink-0">
                    {step.state === "done" && <CheckCircle2 size={18} className="text-green-500" />}
                    {step.state === "active" && <Loader2 size={18} className="animate-spin text-amber-500" />}
                    {step.state === "error" && <span className="text-red-500 text-[16px]">✗</span>}
                    {step.state === "pending" && <span className="w-5 h-5 rounded-full border-2 border-[#D1D5DB] inline-block" />}
                  </div>
                  <span className={`text-[13px] font-medium ${
                    step.state === "active" ? "text-amber-700" : step.state === "done" ? "text-green-700" : "text-[#9CA3AF]"
                  }`}>{step.label}</span>
                </div>
              ))}
              {error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-[13px]">{error}</p>
                  <button onClick={onDismiss} className="mt-2 text-red-500 text-[12px] underline">Dismiss</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BusinessDateMismatchModal({ businessDate, realToday, onAllow, onDontAllow }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-full p-2">
              <ClipboardList size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-[16px]">Day Not Closed</h2>
              <p className="text-amber-100 text-[12px] mt-0.5">Your transaction date has not caught up to today</p>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          <p className="text-[13px] text-[#374151] mb-4">
            The transaction date is still <strong>{fmtDate(businessDate)}</strong>, but today is{" "}
            <strong>{fmtDate(realToday)}</strong>. New bills and entries will keep using{" "}
            <strong>{fmtDate(businessDate)}</strong> until the day is closed in Accounts → Daily Ops.
          </p>
          <p className="text-[13px] text-[#374151] mb-4">
            Do you want to continue working on <strong>{fmtDate(businessDate)}</strong>, or go close the day now?
          </p>
          <div className="flex gap-3">
            <button
              onClick={onDontAllow}
              className="flex-1 py-2.5 border border-[#E5E7EB] rounded-lg text-[13px] text-[#737373] hover:bg-[#F9FAFB] transition-colors"
            >
              Don't Allow
            </button>
            <button
              onClick={onAllow}
              className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg text-[13px] font-semibold hover:bg-amber-600 transition-colors"
            >
              Allow
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AppShell({ children }) {
  const [pendingOwnership, setPendingOwnership] = useState(false);
  const [transferAuth, setTransferAuth] = useState({ token: null, deviceId: null });
  const [hiddenPwOpen, setHiddenPwOpen] = useState(false);
  const [hiddenPwBusy, setHiddenPwBusy] = useState(false);
  const [hiddenPwError, setHiddenPwError] = useState("");
  const [hiddenUnlocked, setUnlocked] = useHiddenBillsUnlocked();
  const location = useLocation();
  const navigate = useNavigate();
  const heartbeatRef = useRef(null);
  const {
    date: businessDate,
    realToday: businessRealToday,
    dateMismatch: businessDateMismatch,
    loading: businessDateLoading,
  } = useBusinessDate();
  const [dateMismatchPrompt, setDateMismatchPrompt] = useState(null);
  const testMode = useAccountsTestMode(location.pathname);

  // Once per real calendar day: if the transaction date hasn't been advanced
  // to match today (Close Day wasn't clicked), ask whether to keep going or
  // jump to Daily Ops to close the day.
  useEffect(() => {
    if (businessDateLoading || !businessDateMismatch || !businessDate || !businessRealToday) return;
    let lastShownDate = null;
    try { lastShownDate = localStorage.getItem("bizDateMismatchPrompt.lastShownDate"); } catch { /* ignore */ }
    if (lastShownDate === businessRealToday) return;
    setDateMismatchPrompt({ date: businessDate, realToday: businessRealToday });
  }, [businessDateLoading, businessDateMismatch, businessDate, businessRealToday]);

  function dismissDateMismatchPrompt() {
    if (dateMismatchPrompt) {
      try { localStorage.setItem("bizDateMismatchPrompt.lastShownDate", dateMismatchPrompt.realToday); } catch { /* ignore */ }
    }
    setDateMismatchPrompt(null);
  }

  // Leaving Hidden Bills locks the menu again (must re-enter PIN)
  useEffect(() => {
    if (location.pathname !== "/hidden-bills" && hiddenUnlocked) {
      setUnlocked(false);
    }
  }, [location.pathname, hiddenUnlocked, setUnlocked]);

  // Direct URL to /hidden-bills without unlock → prompt for PIN
  useEffect(() => {
    if (location.pathname === "/hidden-bills" && !hiddenUnlocked) {
      setHiddenPwError("");
      setHiddenPwOpen(true);
    }
  }, [location.pathname, hiddenUnlocked]);

  useEffect(() => {
    triggerBackgroundSync();
    const onOnline = () => triggerBackgroundSync();
    window.addEventListener("online", onOnline);

    // Heartbeat: detect if this PC is being promoted to owner
    const deviceId = localStorage.getItem("ssj_device_identifier");
    if (deviceId) {
      const sendHeartbeat = async () => {
        try {
          const { data } = await api.post("/devices/heartbeat", { device_id: deviceId });
          if (data.pending_action === "accept_ownership" && data.transfer_token) {
            setTransferAuth({
              token: data.transfer_token,
              deviceId: data.target_device_id || deviceId,
            });
            setPendingOwnership(true);
            clearInterval(heartbeatRef.current);
          }
        } catch { /* ignore — connectivity may be intermittent */ }
      };
      sendHeartbeat();
      heartbeatRef.current = setInterval(sendHeartbeat, 20000);
    }

    return () => {
      window.removeEventListener("online", onOnline);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <ApiLoadingBar />
      <Sidebar
        onRequestHiddenUnlock={() => {
          setHiddenPwError("");
          setHiddenPwOpen(true);
        }}
      />
      <div className="pl-64">
        <ConnectivityBanner />
        <Topbar />
        {testMode && (
          <div className="px-8 pt-4">
            <TestModeBanner />
          </div>
        )}
        <main className="p-8 fade-in">{children}</main>
      </div>
      {pendingOwnership && (
        <AcceptOwnershipModal
          transferToken={transferAuth.token}
          deviceId={transferAuth.deviceId}
          onDismiss={() => setPendingOwnership(false)}
        />
      )}
      {dateMismatchPrompt && (
        <BusinessDateMismatchModal
          businessDate={dateMismatchPrompt.date}
          realToday={dateMismatchPrompt.realToday}
          onAllow={dismissDateMismatchPrompt}
          onDontAllow={() => {
            dismissDateMismatchPrompt();
            try { localStorage.setItem("accounts.section", "daily-closing"); } catch { /* ignore */ }
            navigate("/accounts");
          }}
        />
      )}
      <HiddenBillPasswordDialog
        open={hiddenPwOpen}
        busy={hiddenPwBusy}
        error={hiddenPwError}
        onClose={() => {
          if (hiddenPwBusy) return;
          setHiddenPwOpen(false);
          setHiddenPwError("");
          // Closing PIN without unlock hides the option and leaves the page
          if (!hiddenUnlocked && location.pathname === "/hidden-bills") {
            navigate("/", { replace: true });
          }
        }}
        onSubmit={async (pin) => {
          setHiddenPwBusy(true);
          setHiddenPwError("");
          try {
            await api.post("/settings/verify-hidden-bill-password", { password: pin });
            setUnlocked(true);
            setHiddenPwOpen(false);
            toast.success("Hidden Bills unlocked");
            if (location.pathname !== "/hidden-bills") {
              navigate("/hidden-bills");
            }
          } catch (err) {
            const msg = formatApiError(err) || "Incorrect password";
            setHiddenPwError(msg);
            toast.error(
              msg.includes("Incorrect") || msg.includes("password")
                ? "Wrong PIN — try again"
                : msg,
            );
          } finally {
            setHiddenPwBusy(false);
          }
        }}
      />
    </div>
  );
}
