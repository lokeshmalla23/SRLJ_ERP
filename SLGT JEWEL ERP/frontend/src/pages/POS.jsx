import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  Search, Plus, ScanBarcode, User2,   Printer,
  X, ChevronDown, RefreshCw, Coins, Calculator, Save, Clock,
  CheckCircle2, Tag, ArrowLeftRight,
  Pencil, Trash2, MoreHorizontal, Gift, Wallet,
  Calendar, Lightbulb, Camera, Image as ImageIcon, LayoutDashboard, Eye, EyeOff, Hourglass, Download,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, getBackendUrl, getLanStatus, canAuthoritativeWrite, LAN_STATUS } from "@/lib/api";
import MoneyInput from "@/components/ui/MoneyInput";
import WeightInput from "@/components/ui/WeightInput";
import { sanitizeWeightDraft, formatWeight, roundWeight } from "@/lib/weightInput";
import BreakRow from "@/components/pos/BreakRow";
import StoneDetailsModal from "@/components/pos/StoneDetailsModal";
import RefundEntryModal from "@/components/pos/RefundEntryModal";
import PrintPreviewModal from "@/components/PrintPreviewModal";
import { fmtINR, fmtDate, parseMoneyInput } from "@/lib/format";
import { asArray } from "@/lib/jsonFields";
import { toMoneyNumber } from "@/lib/money";
import { calcLineAmounts, calcInvoiceTotals, calcOldGoldValue, resolveLineRate, OLD_GOLD_PURITY_SUGGESTIONS, OLD_SILVER_PURITY_SUGGESTIONS } from "@/lib/billingCalc";
import { lineDescription, hasOldGoldPayment, hasOldSilverPayment, exchangePaymentSnap, exchangeSnapShowsRate } from "@/lib/invoiceBillDisplay";
import { T } from "@/constants/testIds";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useBusinessDate } from "@/context/BusinessDateContext";
import useConfirm from "@/hooks/useConfirm";
import { useAuthority, AUTHORITY_STATES } from "@/context/AuthorityContext";
import { formatRoleLabel, hasFullAccessRole } from "@/lib/roleLabel";
import { printHtml } from "@/lib/printHtml";
import { generateInvoicePrintHTMLAsync, downloadInvoicePdf } from "@/lib/invoicePrint";
import { sendPosInvoiceOnWhatsApp } from "@/lib/posWhatsApp";
import PureMetalPanel, {
  PureMetalRateStrip,
  PosModeToggle,
  PureMetalBillSummary,
} from "@/components/pos/PureMetalPanel";
import PendingSales from "@/components/PendingSales";
import HiddenBillPasswordDialog from "@/components/pos/HiddenBillPasswordDialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import StockAlertDialog from "@/components/StockAlertDialog";
import TestModeBanner, { TestBadge } from "@/components/TestModeBanner";
import DuplicateCustomerDialog, { dupInfo } from "@/components/customers/DuplicateCustomerDialog";
import { playStockAlertSound } from "@/lib/stockAlert";
import { isPreAccountsInvoice } from "@/lib/accountsSetup";
import { useAccountsTestMode } from "@/hooks/useAccountsTestMode";
import useHidBarcodeScanner from "@/hooks/useHidBarcodeScanner";
import slgtLogo from "@/assets/slgt-logo.png";
import { APP_WINDOW_TITLE } from "@/lib/appBrand";
import { invoiceOccurredAt, sortByOccurredAtDesc } from "@/lib/occurredAt";
import { HIDDEN_UNLOCK_BG, HIDDEN_UNLOCK_EDGE } from "@/lib/hiddenUnlockSurface";

const GOLD = "#B18A3E";
const FOREST = "#245B4B";
const FOREST_HOVER = "#1B493C";
const DANGER = "#A24D4D";
const POS_CANVAS = "#F3EFE7";
const POS_PAPER = "#FFFDF9";
const POS_LINE = "#DDD8CF";

/** Compress image file to a JPEG data-URL for storage (max edge ~1280px). */
function readImageAsDataUrl(file, maxEdge = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("Please choose an image file"));
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      reject(new Error("Image must be under 12 MB"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image"));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Fixed-position menu via portal — avoids overflow:hidden clipping in POS layout */
function PosFixedMenu({ open, anchorRef, menuRef, children, maxHeight = 224, onClose }) {
  const [box, setBox] = useState(null);

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return undefined;
    }
    const sync = () => {
      const el = anchorRef?.current;
      if (!el) {
        // Anchor gone → drop shield so inputs stay clickable
        onClose?.();
        return;
      }
      const r = el.getBoundingClientRect();
      // Off-screen / zero-size anchor → close (prevents invisible full-screen blocker)
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > window.innerHeight) {
        onClose?.();
        return;
      }
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const h = Math.min(maxHeight, Math.max(120, spaceBelow));
      setBox({
        top: r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 180),
        maxHeight: h,
      });
    };
    sync();
    window.addEventListener("resize", sync);
    // Close on scroll so a stuck portal can't cover inputs after scrolling
    const onScroll = () => {
      onClose?.();
    };
    window.addEventListener("scroll", onScroll, true);
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    // Safety: never leave the click shield up indefinitely
    const safety = window.setTimeout(() => onClose?.(), 60_000);
    const onVis = () => {
      if (document.hidden) onClose?.();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(safety);
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [open, anchorRef, maxHeight, onClose]);

  if (!open || !box || typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Catch clicks outside — do NOT preventDefault (that blocks focusing inputs) */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 54 }}
        aria-hidden
        onMouseDown={() => {
          onClose?.();
        }}
      />
      <div
        ref={menuRef}
        role="listbox"
        className="pos-redesign-menu fixed bg-white border border-[#DDD8CF] rounded-xl shadow-lg overflow-y-auto"
        style={{
          top: box.top,
          left: box.left,
          width: box.width,
          maxHeight: box.maxHeight,
          zIndex: 55,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

const DEFAULT_PAYMENT_MODES = ["cash", "upi", "card", "bank_transfer", "cheque", "old_gold_exchange", "old_silver_exchange"];
const EXCHANGE_PAYMENT_MODES = new Set(["old_gold_exchange", "old_silver_exchange"]);
const cashierPaymentModes = (modes) => (modes || []).filter((m) => !EXCHANGE_PAYMENT_MODES.has(m));
const CASH_DENOMS = [2000, 500, 200, 100, 50, 20, 10];

// ─── Bill-hold storage ────────────────────────────────────────────────────────
const HOLD_KEY = "ssj_held_bills";
function getHeldBills() { try { return JSON.parse(localStorage.getItem(HOLD_KEY) || "[]"); } catch { return []; } }
function saveHeldBills(bills) { localStorage.setItem(HOLD_KEY, JSON.stringify(bills)); }

function isHiddenHistoryInvoice(inv) {
  if (!inv) return false;
  if (/-H-/i.test(String(inv.invoice_no || inv.invoiceNo || ""))) return true;
  const v = inv.is_hidden ?? inv.isHidden;
  return v === true || v === 1 || v === "1" || String(v).trim().toLowerCase() === "true";
}

/** Isolated clock — avoids re-rendering the entire POS every second while typing. */
function PosLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const datePart = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const timePart = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return (
    <>
      <span className="font-medium">{datePart}</span>
      <span className="text-[#77766F]">{timePart}</span>
    </>
  );
}

export default function POS() {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const isOwner = hasFullAccessRole(user?.role);
  const { ownerName } = useCompany();
  const { date: businessDate, isStale: isBusinessDateStale } = useBusinessDate();
  const [confirmStaleDay, staleDayModal] = useConfirm();
  const canJewelleryPos = can("pos", "jewellery");
  const canPureMetalPos = can("pos", "pure_metal");
  const { state: authorityStateVal, canTransact } = useAuthority();

  // ── Core data ──────────────────────────────────────────────────────────────
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [goldRate, setGoldRate] = useState(null); // ₹ per gram, 24K — null until loaded from settings
  const [cartRateSnapshot, setCartRateSnapshot] = useState(null); // rate locked when first item added
  const [rate22kSetting, setRate22kSetting] = useState(null);
  const [rate18kSetting, setRate18kSetting] = useState(null);
  const [pureSilverRate, setPureSilverRate] = useState(null);
  const [silverRate, setSilverRate] = useState(null);
  const [platinumRate, setPlatinumRate] = useState(null);
  const [rateLoaded, setRateLoaded] = useState(false);
  const [company, setCompany] = useState({ name: "Jewellery Shop" });
  // Settings → Company Profile toggle. Defaults to ON (opt-out) so a shop
  // that hasn't touched it keeps the same always-on behavior POS billing
  // already had before this toggle existed.
  const aadhaarMandatoryAbove50k = company?.aadhaar_mandatory_above_50000 !== false;
  /** POS billing surface: jewellery tags vs pure gold/silver by weight */
  const [posMode, setPosMode] = useState("jewellery"); // "jewellery" | "pure_metal"
  const [pmMetal, setPmMetal] = useState("24k"); // "24k" | "silver"
  const [pmWeight, setPmWeight] = useState("");
  const [pmProductId, setPmProductId] = useState("");
  const [pmQty, setPmQty] = useState("");
  const [pureProducts, setPureProducts] = useState([]);
  const [pmOverQty, setPmOverQty] = useState(null); // { requested, available, name }
  const [pmRate, setPmRate] = useState("");
  const [pmRateLocked, setPmRateLocked] = useState(true);
  const [pmOtherCharges, setPmOtherCharges] = useState("");
  const [pmPrevGold, setPmPrevGold] = useState(null);
  const [pmPrevSilver, setPmPrevSilver] = useState(null);
  const [connStatus, setConnStatus] = useState({ ok: true, billingAllowed: true, lastSync: null, detail: null });
  const [paymentModes, setPaymentModes] = useState(DEFAULT_PAYMENT_MODES);
  const [gstPct, setGstPct] = useState(3);
  const [advanceBalance, setAdvanceBalance] = useState(0);
  const [advanceApplying, setAdvanceApplying] = useState(false);

  // ── Customer schemes (active / matured) ────────────────────────────────────
  const [customerSchemes, setCustomerSchemes] = useState([]);
  const [schemePanelOpen, setSchemePanelOpen] = useState(false);
  const [appliedScheme, setAppliedScheme] = useState(null); // full scheme row when applied

  // ── Load estimation into POS ───────────────────────────────────────────────
  const [estimationLoading, setEstimationLoading] = useState(false);
  const [loadedQuotation, setLoadedQuotation] = useState(null); // { id, quote_no, price_locked, advance_paid, remaining_amount, valid_until, advance_id, status }
  const [bookedBlock, setBookedBlock] = useState(null); // active booking blocking add-to-cart
  const [bookingCheckBusy, setBookingCheckBusy] = useState(false);
  // Pending target mode while the "clear current bill?" confirm is open (null = closed)
  const [modeSwitchConfirm, setModeSwitchConfirm] = useState(null);

  // ── Product search / filter state ──────────────────────────────────────────
  const [q, setQ] = useState("");
  const [barcode, setBarcode] = useState("");
  const [barcodeSuggestions, setBarcodeSuggestions] = useState([]);
  const [barcodeDropOpen, setBarcodeDropOpen] = useState(false);
  const [barcodeHighlight, setBarcodeHighlight] = useState(0);
  const [barcodeSearching, setBarcodeSearching] = useState(false);
  const [activeCat, setActiveCat] = useState("All");
  const [metalFilter, setMetalFilter] = useState("All");
  const [purityFilter, setPurityFilter] = useState("All");

  // ── Cart ───────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState([]);
  const [expandedItem, setExpandedItem] = useState(null);
  const [stoneModalIndex, setStoneModalIndex] = useState(null);
  const [stockAlert, setStockAlert] = useState({ open: false, title: "Out of Stock", message: "" });
  const showStockAlert = (productName, message, title = "Out of Stock") => {
    setStockAlert({ open: true, title, message: productName ? `"${productName}" — ${message}` : message });
    playStockAlertSound();
  };

  // ── Customer ───────────────────────────────────────────────────────────────
  const [custSearch, setCustSearch] = useState("");
  const [custDropOpen, setCustDropOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [panNumber, setPanNumber] = useState("");
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [detailedStoneBill, setDetailedStoneBill] = useState(false);
  const [newCustOpen, setNewCustOpen] = useState(false);
  const [newCustSaving, setNewCustSaving] = useState(false);
  const [dupCustomer, setDupCustomer] = useState(null);
  const [dupViewing, setDupViewing] = useState(false);
  const [newCustForm, setNewCustForm] = useState({
    name: "",
    mobile: "",
    email: "",
    address: "",
    pan_number: "",
    aadhaar_number: "",
    pan_image: "",
    tag: "regular",
    dob: "",
    anniversary: "",
  });
  const [panSourceOpen, setPanSourceOpen] = useState(false);
  const panGalleryRef = useRef(null);
  const panCameraRef = useRef(null);

  const openNewCustomer = () => {
    setCustDropOpen(false);
    setEmpDropOpen(false);
    setPanSourceOpen(false);
    const typed = (custSearch || "").trim();
    const looksPhone = /^[\d+\s-]{6,}$/.test(typed);
    setNewCustForm({
      name: looksPhone ? "" : typed,
      mobile: looksPhone ? typed.replace(/\s+/g, "") : "",
      email: "",
      address: "",
      pan_number: "",
      aadhaar_number: "",
      pan_image: "",
      tag: "regular",
      dob: "",
      anniversary: "",
    });
    setNewCustOpen(true);
  };

  const onPanImagePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setNewCustForm((f) => ({ ...f, pan_image: dataUrl }));
      setPanSourceOpen(false);
      toast.success("PAN card image attached");
    } catch (err) {
      toast.error(err?.message || "Could not use that image");
    }
  };

  // Shared by "customer created" and "use the existing match instead" —
  // both end with the same customer attached to this bill.
  const attachCustomer = (data) => {
    setCustomers((list) => [data, ...list.filter((c) => c.id !== data.id)]);
    setSelectedCustomer(data);
    setWalkInCustomer(false);
    setPosFieldErrors((err) => ({ ...err, customer: false }));
    if (data.pan_number) setPanNumber(data.pan_number);
    if (data.aadhaar_number) setAadhaarNumber(data.aadhaar_number);
    setCustSearch("");
    setCustDropOpen(false);
    setPanSourceOpen(false);
    setNewCustOpen(false);
  };

  const saveNewCustomer = async (e, { force = false } = {}) => {
    e?.preventDefault?.();
    const name = newCustForm.name.trim();
    const mobile = newCustForm.mobile.trim();
    if (!name || !mobile) {
      toast.error("Name and mobile are required");
      return;
    }
    setNewCustSaving(true);
    try {
      const { data } = await api.post("/customers", {
        name,
        mobile,
        email: newCustForm.email.trim() || undefined,
        address: newCustForm.address.trim() || undefined,
        pan_number: newCustForm.pan_number.trim().toUpperCase() || undefined,
        aadhaar_number: newCustForm.aadhaar_number.trim() || undefined,
        pan_image: newCustForm.pan_image || undefined,
        tag: newCustForm.tag || "regular",
        dob: newCustForm.dob || undefined,
        anniversary: newCustForm.anniversary || undefined,
        allow_duplicate_mobile: force || undefined,
      });
      attachCustomer(data);
      toast.success(`Customer ${data.name} added`);
    } catch (err) {
      const info = dupInfo(err);
      if (info) setDupCustomer(info);
      else toast.error(formatApiError(err) || "Failed to create customer");
    } finally {
      setNewCustSaving(false);
    }
  };

  const useExistingCustomer = async (existing) => {
    setDupViewing(true);
    try {
      const { data } = await api.get(`/customers/${existing.id}`);
      attachCustomer(data);
      setDupCustomer(null);
      toast.success(`Using existing customer "${data.name}"`);
    } catch (err) {
      toast.error(formatApiError(err) || "Could not load that customer");
    } finally {
      setDupViewing(false);
    }
  };
  // ── Salesperson ────────────────────────────────────────────────────────────
  const [salesperson, setSalesperson] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [empDropOpen, setEmpDropOpen] = useState(false);
  const [empSearch, setEmpSearch] = useState("");
  const [walkInCustomer, setWalkInCustomer] = useState(false);
  const [posFieldErrors, setPosFieldErrors] = useState({ salesperson: false, customer: false });

  // ── Discount / old gold ────────────────────────────────────────────────────
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState("flat"); // flat | pct
  const [oldGold, setOldGold] = useState({ weight: "", purity: "22K", rate: "", active: false });
  const [oldSilver, setOldSilver] = useState({ weight: "", purity: "925", rate: "", active: false });
  // Settings → Application Management toggle, per metal. Defaults to OFF
  // (automatic weight × rate) until an ERP Administrator turns manual entry on.
  const [oldMetalManual, setOldMetalManual] = useState({ gold: false, silver: false });

  // ── Grand total override ───────────────────────────────────────────────────
  const [grandEditOpen, setGrandEditOpen] = useState(false);
  const [grandInput, setGrandInput] = useState("");
  const [checkoutError, setCheckoutError] = useState(null);
  const testMode = useAccountsTestMode();

  // ── Payments ───────────────────────────────────────────────────────────────
  const [payments, setPayments] = useState([{ mode: "cash", amount: "", description: "" }]);
  const [paymentNoteOpen, setPaymentNoteOpen] = useState([]);
  const [cashGiven, setCashGiven] = useState("");
  const [denomCounts, setDenomCounts] = useState({});
  const [showDenoms, setShowDenoms] = useState(false);

  // ── Bill hold ──────────────────────────────────────────────────────────────
  const [heldBills, setHeldBills] = useState(getHeldBills);
  const [recallOpen, setRecallOpen] = useState(false);
  const [pendingSalesOpen, setPendingSalesOpen] = useState(false);

  // ── Invoice / UI state ─────────────────────────────────────────────────────
  const [hiddenBillMode, setHiddenBillMode] = useState(false);
  const [hiddenPwOpen, setHiddenPwOpen] = useState(false);
  const [hiddenPwBusy, setHiddenPwBusy] = useState(false);
  const [hiddenPwError, setHiddenPwError] = useState("");
  // PIN unlocks Hidden Bill billing and reveals the History "Show hidden bills"
  // control. That control swaps History to hidden bills only (not mixed with
  // normal POS). Lock clears billing mode, the control, and hidden history.
  const [hiddenAccessUnlocked, setHiddenAccessUnlocked] = useState(false);
  const [includeHiddenInHistory, setIncludeHiddenInHistory] = useState(false);
  const hiddenTapRef = useRef({ count: 0, timer: null });
  const [busy, setBusy] = useState(false);
  /** Stable idempotency key for the in-flight logical checkout (retries reuse it). */
  const checkoutRequestIdRef = useRef(null);
  const checkoutLeaseIdsRef = useRef([]);
  const [lastInvoice, setLastInvoice] = useState(null);

  // ── Right panel tabs ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("summary"); // summary | payment | history
  const [historyInvoices, setHistoryInvoices] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearchInput, setHistorySearchInput] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [viewInvoiceOpen, setViewInvoiceOpen] = useState(false);
  const [viewInvoiceData, setViewInvoiceData] = useState(null);
  const [viewInvoiceLoading, setViewInvoiceLoading] = useState(false);

  const lockHiddenAccess = useCallback(() => {
    setHiddenBillMode(false);
    setHiddenAccessUnlocked(false);
    setIncludeHiddenInHistory(false);
    setHistoryInvoices((rows) => rows.filter((inv) => !isHiddenHistoryInvoice(inv)));
    setViewInvoiceData((cur) => {
      if (cur && isHiddenHistoryInvoice(cur)) {
        setViewInvoiceOpen(false);
        return null;
      }
      return cur;
    });
  }, []);

  // ── Discount edit inline ───────────────────────────────────────────────────
  const [discountEditOpen, setDiscountEditOpen] = useState(false);
  const discountInputRef = useRef(null);

  const goldRateRef = useRef(goldRate);
  useEffect(() => { goldRateRef.current = goldRate; }, [goldRate]);

  const barcodeRef = useRef(null);
  const barcodeAnchorRef = useRef(null);
  const barcodeMenuRef = useRef(null);
  const barcodeAbortRef = useRef(null);
  const empDropRef = useRef(null);
  const empAnchorRef = useRef(null);
  const empMenuRef = useRef(null);
  const custDropRef = useRef(null);
  const custAnchorRef = useRef(null);
  const custMenuRef = useRef(null);

  useEffect(() => {
    const unwrap = (data) => {
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.employees)) return data.employees;
      if (Array.isArray(data?.customers)) return data.customers;
      if (Array.isArray(data?.products)) return data.products;
      if (Array.isArray(data?.items)) return data.items;
      return [];
    };
    api.get("/products", { params: { sellable: 1 } }).then(({ data }) => setProducts(unwrap(data))).catch(() => {}).finally(() => setProductsLoading(false));
    api.get("/customers")
      .then(({ data }) => setCustomers(unwrap(data)))
      .catch((err) => toast.error(formatApiError(err) || "Failed to load customers"));
    api.get("/categories").then(({ data }) => setCategories(unwrap(data))).catch(() => {});
    api.get("/employees")
      .then(({ data }) => setEmployees(unwrap(data).filter((e) => !e.status || e.status === "active")))
      .catch((err) => toast.error(formatApiError(err) || "Failed to load salespersons"));
    api.get("/settings/gold-rate").then(({ data }) => {
      const rate = Number(data?.gold_24k) || 0;
      setGoldRate(rate);
      setRate22kSetting(Number(data?.gold_22k) || null);
      setRate18kSetting(Number(data?.gold_18k) || null);
      setPureSilverRate(Number(data?.pure_silver) || null);
      setSilverRate(Number(data?.silver) || null);
      setPlatinumRate(Number(data?.platinum) || null);
    }).catch(() => setGoldRate(0)).finally(() => setRateLoaded(true));
    api.get("/settings/company").then(({ data }) => {
      if (data && Object.keys(data).length) setCompany(data);
    }).catch(() => {});
    api.get("/settings/invoice").then(({ data }) => {
      if (data?.gst_pct != null) setGstPct(Number(data.gst_pct) || 3);
      if (Array.isArray(data?.payment_modes) && data.payment_modes.length) {
        setPaymentModes(data.payment_modes);
      }
    }).catch(() => {});
    api.get("/settings/old-metal-exchange").then(({ data }) => {
      setOldMetalManual({ gold: data?.manual?.gold === true, silver: data?.manual?.silver === true });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const refreshCompany = () => {
      api.get("/settings/company").then(({ data }) => {
        if (data && Object.keys(data).length) setCompany(data);
      }).catch(() => {});
    };
    window.addEventListener("company:updated", refreshCompany);
    return () => window.removeEventListener("company:updated", refreshCompany);
  }, []);

  // Keep active mode within RBAC-allowed set
  useEffect(() => {
    if (posMode === "jewellery" && !canJewelleryPos && canPureMetalPos) {
      setPosMode("pure_metal");
    } else if (posMode === "pure_metal" && !canPureMetalPos && canJewelleryPos) {
      setPosMode("jewellery");
    }
  }, [canJewelleryPos, canPureMetalPos, posMode]);
  useEffect(() => {
    if (posMode !== "pure_metal" || !pmRateLocked) return;
    const live = pmMetal === "24k" ? goldRate : pureSilverRate;
    if (live != null && live !== "") setPmRate(String(live));
  }, [posMode, pmMetal, pmRateLocked, goldRate, pureSilverRate]);

  const loadPureProducts = useCallback(() => {
    api.get("/pure-products")
      .then(({ data }) => setPureProducts(Array.isArray(data) ? data : []))
      .catch(() => setPureProducts([]));
  }, []);

  useEffect(() => {
    if (posMode === "pure_metal") loadPureProducts();
  }, [posMode, loadPureProducts]);

  // Derive weight from coin qty, or validate bulk pure sell weight
  useEffect(() => {
    if (posMode !== "pure_metal") return;
    const pp = pureProducts.find((p) => p.id === pmProductId);
    if (!pp) {
      setPmWeight("");
      return;
    }
    const isBulk = String(pp.form_type).toLowerCase() === "pure"
      || String(pp.form_type).toLowerCase() === "biscuit";
    const available = Number(pp.stock_qty) || 0;

    if (isBulk) {
      const wtRaw = String(pmWeight || "").trim();
      if (!wtRaw) return;
      const wt = Number(wtRaw);
      if (!Number.isFinite(wt) || wt <= 0) return;
      if (wt > available + 0.0005) {
        setPmOverQty({
          requested: wt,
          available,
          name: pp.name,
          unit: " g",
        });
        setPmWeight(available > 0 ? String(available) : "");
      }
      return;
    }

    const qtyRaw = String(pmQty || "").trim();
    if (!qtyRaw) {
      setPmWeight("");
      return;
    }
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) {
      setPmWeight("");
      return;
    }
    if (!Number.isInteger(qty) || qty > available) {
      setPmOverQty({
        requested: Number.isFinite(qty) ? qty : qtyRaw,
        available,
        name: pp.name,
        unit: "",
      });
      setPmQty(available > 0 ? String(available) : "");
      const capped = available > 0 ? available : 0;
      const wt = Math.round((Number(pp.weight_g) || 0) * capped * 1000) / 1000;
      setPmWeight(capped > 0 ? String(wt) : "");
      return;
    }
    const wt = Math.round((Number(pp.weight_g) || 0) * qty * 1000) / 1000;
    setPmWeight(String(wt));
  }, [posMode, pmProductId, pmQty, pmWeight, pureProducts]);

  // Mirror pure-metal form into cart so totals / checkout / hold reuse jewellery pipeline
  useEffect(() => {
    if (posMode !== "pure_metal") return;
    const weight = Number(pmWeight) || 0;
    const rate = parseMoneyInput(pmRate);
    const other = parseMoneyInput(pmOtherCharges);
    const pp = pureProducts.find((p) => p.id === pmProductId);
    if (!pp || weight <= 0 || rate <= 0) {
      setCart((prev) => (prev.length === 0 ? prev : []));
      setCartRateSnapshot(null);
      return;
    }
    const isBulk = String(pp.form_type).toLowerCase() === "pure"
      || String(pp.form_type).toLowerCase() === "biscuit";
    const qty = isBulk ? 1 : (Number(pmQty) || 0);
    if (!isBulk && qty <= 0) {
      setCart((prev) => (prev.length === 0 ? prev : []));
      setCartRateSnapshot(null);
      return;
    }
    const metalValue = toMoneyNumber(weight * rate);
    setCart([{
      id: "pure-metal-line",
      product_id: null,
      pure_product_id: pp.id,
      pure_form: isBulk ? "pure" : "coin",
      pure_stock_decrement: isBulk ? weight : qty,
      is_pure_metal: true,
      line_type: "pure_metal",
      name: pp.name,
      metal: pmMetal === "24k" ? "Gold" : "Silver",
      purity: pmMetal === "24k" ? "24K" : "PureSilver",
      purity_name: pmMetal === "24k" ? "24K" : "Pure Silver",
      gross_weight: weight,
      net_weight: weight,
      stone_weight: 0,
      wastage_pct: 0,
      making_charges: other,
      making_charge_type: "fixed",
      stone_charges: 0,
      quantity: qty,
      unit_weight_g: isBulk ? null : (Number(pp.weight_g) || 0),
      price_override: metalValue,
      rate,
      hsn_code: pmMetal === "24k" ? "7108" : "7106",
      inventory_mode: "quantity",
    }]);
    setCartRateSnapshot(pmMetal === "24k" ? (Number(goldRate) || rate) : (Number(goldRate) || null));
  }, [posMode, pmMetal, pmWeight, pmRate, pmOtherCharges, goldRate, pmProductId, pmQty, pureProducts]);

  useEffect(() => {
    const cid = selectedCustomer?.id;
    if (!cid) {
      setAdvanceBalance(0);
      setCustomerSchemes([]);
      setAppliedScheme(null);
      setSchemePanelOpen(false);
      setPayments((prev) => {
        const next = prev.filter((p) => p.mode !== "advance");
        return next.length ? next : [{ mode: "cash", amount: "", description: "" }];
      });
      return;
    }
    api.get(`/advances/balance/${cid}`)
      .then(({ data }) => setAdvanceBalance(Number(data?.balance) || 0))
      .catch(() => setAdvanceBalance(0));
  }, [selectedCustomer?.id]);

  useEffect(() => {
    const cid = selectedCustomer?.id;
    if (!cid) return undefined;
    let cancelled = false;
    api.get(`/schemes?customer_id=${encodeURIComponent(cid)}&status=active,matured${goldRate ? `&gold_rate=${goldRate}` : ""}`)
      .then(({ data }) => {
        if (cancelled) return;
        const list = asArray(data).filter((s) => s.status === "active" || s.status === "matured");
        setCustomerSchemes(list);
        setAppliedScheme((prev) => {
          if (!prev) return null;
          return list.find((s) => s.id === prev.id) || null;
        });
      })
      .catch(() => {
        if (!cancelled) setCustomerSchemes([]);
      });
    return () => { cancelled = true; };
  }, [selectedCustomer?.id, goldRate]);

  useEffect(() => {
    // Changing customer must not keep previous customer's advance on the payment list.
    // Keep booking advance when a price-locked estimation is loaded.
    if (loadedQuotation?.price_locked || loadedQuotation?.advance_id) return;
    setPayments((prev) => {
      const next = prev.filter((p) => p.mode !== "advance");
      return next.length ? next : prev;
    });
  }, [selectedCustomer?.id, loadedQuotation?.price_locked, loadedQuotation?.advance_id]);

  /** Accumulated scheme gold grams (each payment at that day's rate). */
  const schemeStoredGrams = useCallback((scheme) => {
    if (!scheme) return 0;
    if (Number(scheme.redeemable_grams) > 0) return Number(scheme.redeemable_grams);
    return asArray(scheme.payments).reduce((sum, p) => {
      const g = Number(p.grams_credited);
      if (g > 0) return sum + g;
      const rate = Number(p.gold_rate_at_payment);
      const amt = Number(p.amount) || 0;
      if (rate > 0 && amt > 0) return sum + amt / rate;
      return sum;
    }, 0);
  }, []);

  // Close dropdowns on outside click (include portal menus)
  useEffect(() => {
    const inside = (ref, target) => ref.current && ref.current.contains(target);
    const onDoc = (e) => {
      const t = e.target;
      if (!inside(empDropRef, t) && !inside(empMenuRef, t)) setEmpDropOpen(false);
      if (!inside(custDropRef, t) && !inside(custMenuRef, t)) setCustDropOpen(false);
      if (!inside(barcodeAnchorRef, t) && !inside(barcodeMenuRef, t)) setBarcodeDropOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // (live clock lives in <PosLiveClock /> so it does not re-render the whole POS)
  // ── Connectivity / billing gate for status bar ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      // In LAN_COORDINATED mode the follower PC has no local backend — the
      // authority state machine already confirmed the host is reachable and
      // billing is allowed, so skip the local health probe entirely.
      if (authorityStateVal === AUTHORITY_STATES.LAN_COORDINATED) {
        if (!cancelled) setConnStatus((s) => ({ ...s, ok: true, billingAllowed: true }));
        return;
      }
      try {
        let body = {};
        let ok = false;
        // Main PC: probe local backend via Electron IPC (bypasses Chromium network stack).
        // Client PC: api.get routes through desktopLocalAdapter → Node http → main PC URL.
        //   Never probe 127.0.0.1 on a client PC — that's the local replica which always
        //   returns billing_allowed:false, causing a false "billing paused" state.
        if (window.jewelleryCRM?.localRequest && getLanStatus() === LAN_STATUS.HOST) {
          const res = await window.jewelleryCRM.localRequest({
            method: "GET",
            path: "/api/health",
            timeoutMs: 4000,
          });
          ok = res.status >= 200 && res.status < 300;
          body = res.data || {};
        } else {
          const { data } = await api.get("/health", { timeout: 4000 });
          ok = true;
          body = data || {};
        }
        let lastSync = null;
        try {
          const { data } = await api.get("/sync/status");
          lastSync = data?.last_sync_at || null;
        } catch { /* optional */ }
        const billingAllowed = ok && body?.billing_allowed !== false && body?.authority?.authoritative !== false;
        if (!cancelled) {
          setConnStatus((prev) => {
            const next = {
              ok: ok && body?.ready !== false,
              billingAllowed,
              lastSync,
              detail: body?.authority?.code || (!ok ? "BRANCH_UNREACHABLE" : null),
            };
            if (
              prev.ok === next.ok
              && prev.billingAllowed === next.billingAllowed
              && prev.lastSync === next.lastSync
              && prev.detail === next.detail
            ) {
              return prev;
            }
            return next;
          });
        }
      } catch {
        if (!cancelled) {
          setConnStatus((s) => ({
            ...s,
            ok: false,
            billingAllowed: false,
            detail: "BRANCH_UNREACHABLE",
          }));
        }
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    const onReady = () => { tick(); };
    const onLanReady = () => { tick(); };
    window.jewelleryCRM?.onBackendReady?.(onReady);
    window.addEventListener("lan-status-ready", onLanReady);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("lan-status-ready", onLanReady);
    };
  }, [authorityStateVal]);

  // ── Barcode / name autocomplete (debounced) ────────────────────────────────
  // Same UX as customer search: dropdown opens on type. Tag/barcode stay
  // prefix matches; product name is a contains match on the same field.
  useEffect(() => {
    const term = barcode.trim();
    if (!term || /^QT[-_]?\d/i.test(term) || /^QT-/i.test(term)) {
      setBarcodeSuggestions([]);
      setBarcodeDropOpen(false);
      setBarcodeHighlight(0);
      setBarcodeSearching(false);
      barcodeAbortRef.current?.abort();
      return undefined;
    }
    setBarcodeSearching(true);
    const handle = setTimeout(() => {
      barcodeAbortRef.current?.abort();
      const controller = new AbortController();
      barcodeAbortRef.current = controller;
      api.get("/products/barcode-search", { params: { q: term, limit: 12 }, signal: controller.signal })
        .then(({ data }) => {
          setBarcodeSuggestions(Array.isArray(data) ? data : []);
          setBarcodeHighlight(0);
        })
        .catch(() => {})
        .finally(() => setBarcodeSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [barcode]);

  // ── History tab fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    setEmpDropOpen(false);
    setCustDropOpen(false);
    setBarcodeDropOpen(false);
  }, [activeTab]);

  // Debounce the free-text search (invoice no. / phone / customer name / Aadhaar / PAN)
  useEffect(() => {
    const t = setTimeout(() => setHistorySearch(historySearchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [historySearchInput]);

  useEffect(() => {
    if (activeTab !== "history") return;
    let cancelled = false;
    setHistoryLoading(true);
    api.get("/invoices", {
      params: {
        limit: 25,
        q: historySearch || undefined,
        from_date: historyFrom || undefined,
        to_date: historyTo || undefined,
        include_hidden: hiddenAccessUnlocked && includeHiddenInHistory ? 1 : undefined,
        hidden_only: hiddenAccessUnlocked && includeHiddenInHistory ? 1 : undefined,
      },
    })
      .then(({ data }) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : (data?.invoices || []);
        const allowHidden = hiddenAccessUnlocked && includeHiddenInHistory;
        setHistoryInvoices(
          allowHidden
            ? rows.filter((inv) => isHiddenHistoryInvoice(inv))
            : rows.filter((inv) => !isHiddenHistoryInvoice(inv)),
        );
      })
      .catch(() => {
        if (!cancelled) setHistoryInvoices([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeTab, historySearch, historyFrom, historyTo, includeHiddenInHistory, hiddenAccessUnlocked]);

  const openInvoiceView = async (id) => {
    setViewInvoiceOpen(true);
    setViewInvoiceData(null);
    setViewInvoiceLoading(true);
    try {
      const { data } = await api.get(`/invoices/${id}`, {
        params: hiddenAccessUnlocked && includeHiddenInHistory ? { include_hidden: 1 } : undefined,
      });
      setViewInvoiceData(data);
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to load invoice");
      setViewInvoiceOpen(false);
    } finally {
      setViewInvoiceLoading(false);
    }
  };

  const visibleHistoryInvoices = useMemo(() => {
    const list = hiddenAccessUnlocked && includeHiddenInHistory
      ? historyInvoices.filter((inv) => isHiddenHistoryInvoice(inv))
      : historyInvoices.filter((inv) => !isHiddenHistoryInvoice(inv));
    return sortByOccurredAtDesc(list);
  }, [historyInvoices, hiddenAccessUnlocked, includeHiddenInHistory]);

  // ── Filtered products ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = products;
    if (activeCat !== "All") list = list.filter((p) => p.category_name === activeCat || p.category_id === activeCat);
    if (metalFilter !== "All") list = list.filter((p) => p.metal_name === metalFilter);
    if (purityFilter !== "All") list = list.filter((p) => p.purity_name === purityFilter);
    const term = q.toLowerCase();
    if (term) list = list.filter((p) =>
      p.name?.toLowerCase().includes(term) ||
      (p.code || "").toLowerCase().includes(term) ||
      (p.barcode || "").toLowerCase().includes(term)
    );
    return list.slice(0, 30);
  }, [products, q, activeCat, metalFilter, purityFilter]);

  const catList = useMemo(() => {
    const names = [...new Set(products.map((p) => p.category_name).filter(Boolean))];
    return ["All", ...names];
  }, [products]);

  const metalList = useMemo(() => {
    const names = [...new Set(products.map((p) => p.metal_name).filter(Boolean))];
    return ["All", ...names];
  }, [products]);

  const purityList = useMemo(() => {
    const names = [...new Set(products.map((p) => p.purity_name).filter(Boolean))];
    return ["All", ...names];
  }, [products]);

  // ── Customer filter ────────────────────────────────────────────────────────
  const filteredCustomers = useMemo(() => {
    const t = custSearch.toLowerCase();
    if (!t) return customers.slice(0, 8);
    return customers.filter((c) => c.name?.toLowerCase().includes(t) || c.mobile?.includes(t)).slice(0, 8);
  }, [customers, custSearch]);

  // ── Salesperson filter ──────────────────────────────────────────────────────
  const filteredEmployees = useMemo(() => {
    const t = empSearch.toLowerCase();
    if (!t) return employees;
    return employees.filter((e) =>
      e.name?.toLowerCase().includes(t) ||
      (e.code || e.employee_code || "").toLowerCase().includes(t)
    );
  }, [employees, empSearch]);

  // ── Cart operations ────────────────────────────────────────────────────────
  // Unique tags: one physical piece → one cart line; block duplicate product_id/barcode.
  // Quantity items: block adding more than what's actually in stock across this bill.
  const addProduct = useCallback((p) => {
    const isUnique = p.inventory_mode === "unique_tag" || p.inventory_mode === "unique" || p.track_type === "unique";
    const isTrayItemCheck = p.unit_code === "tray" || (p.tray_total_weight > 0 && !p.unit_code);
    setCartRateSnapshot((snap) => snap === null ? goldRateRef.current : snap);
    setCart((c) => {
      if (isUnique) {
        const dup = c.some((x) => x.product_id === p.id || (p.barcode && x.barcode === p.barcode));
        if (dup) {
          showStockAlert(p.name, "This tag is already on the bill — it's a single, one-of-a-kind piece.");
          return c;
        }
      } else if (!isTrayItemCheck) {
        const availableStock = Number(p.stock_qty) || 0;
        const alreadyInCart = c
          .filter((x) => x.product_id === p.id)
          .reduce((s, x) => s + (Number(x.quantity) || 0), 0);
        if (availableStock > 0 && alreadyInCart + 1 > availableStock) {
          showStockAlert(
            p.name,
            `Only ${availableStock} in stock, and you already have ${alreadyInCart} of it on this bill.`,
          );
          return c;
        }
      }
      const stones = (() => {
        let raw = p.stone_details;
        if (typeof raw === "string") {
          try { raw = JSON.parse(raw); } catch { raw = []; }
        }
        return Array.isArray(raw) ? raw : [];
      })();
      const stoneNames = [...new Set(stones.map((r) => r?.stone_type).filter(Boolean))].join(", ");
      const isTrayItem = p.unit_code === "tray" || (p.tray_total_weight > 0 && !p.unit_code);
      const isPieceItem = p.unit_code === "pc";
      const trayStockQty = Number(p.stock_qty) || 0;
      const trayTotalWeight = roundWeight(p.tray_total_weight);
      return [...c, {
        product_id: p.id,
        name: p.name,
        code: p.code || "",
        barcode: p.barcode || "",
        metal: p.metal_name || p.metal_type || "",
        purity: p.purity_name || p.purity || "",
        purity_code: p.purity_code || null,
        category_id: p.category_id || null,
        category_name: p.category_name || "",
        subcategory_id: p.subcategory_id || null,
        subcategory_name: p.subcategory_name || "",
        hsn_code: p.hsn_code || "7113",
        gross_weight: p.gross_weight || 0,
        net_weight: p.net_weight || 0,
        stone_weight: Number(p.stone_weight) > 0
          ? Number(p.stone_weight)
          : Math.max(0, Number(p.gross_weight || 0) - Number(p.net_weight || 0)),
        making_charges: p.making_charges || 0,
        making_charge_type: p.making_charge_type || "fixed",
        wastage_pct: p.wastage_pct || 0,
        stone_charges: stones.reduce((s, r) => s + (Number(r?.price) || 0), 0),
        stone_names: stoneNames,
        stones: stones.map((s) => ({
          stone_type: s?.stone_type || "",
          count: Number(s?.count) || 0,
          total_carat: Number(s?.total_carat) || 0,
          price: Number(s?.price) || 0,
        })),
        hallmark: p.hallmark || "",
        quantity: 1,
        // Piece unit: flat per-piece price entered on the product — there's no
        // weight to price off, so it must be carried in as the line's price
        // override or it silently prices at zero (no weight × rate to fall back on).
        price_override: isPieceItem ? (Number(p.selling_price) || null) : null,
        rate_override: null,
        wastage_amount_override: null,
        making_amount_override: null,
        inventory_mode: p.inventory_mode || (isUnique ? "unique_tag" : "quantity"),
        available_stock: Number(p.stock_qty) || 0,
        is_tray: isTrayItem,
        tray_stock_qty: trayStockQty,
        tray_total_weight: trayTotalWeight,
        tray_pieces_sold: isTrayItem ? 1 : undefined,
        tray_weight_sold: isTrayItem ? 0 : undefined,
        tray_weight_input: isTrayItem ? "0" : undefined,
      }];
    });
    barcodeRef.current?.focus();
  }, []);

  /** Block adding tags held on another customer's booked estimation — show dialog. */
  const tryAddProduct = useCallback(async (p) => {
    if (!p?.id) return;
    // Already billing this booking and this tag is on it — allow
    const loadedIds = asArray(loadedQuotation?.items).map((it) => it.product_id || it.id).filter(Boolean);
    if (loadedQuotation?.id && loadedIds.includes(p.id)) {
      addProduct(p);
      return;
    }
    setBookingCheckBusy(true);
    try {
      const { data } = await api.get("/quotations/active-booking", {
        params: { product_id: p.id },
      });
      if (data?.booked) {
        if (loadedQuotation?.id && loadedQuotation.id === data.quotation_id) {
          addProduct(p);
          return;
        }
        setBookedBlock({ ...data, _product: p });
        return;
      }
    } catch {
      // Network hiccup — still attempt add; checkout will enforce booking
    } finally {
      setBookingCheckBusy(false);
    }
    addProduct(p);
  }, [addProduct, loadedQuotation]);

  const selectBarcodeSuggestion = async (p) => {
    await tryAddProduct(p);
    setBarcode("");
    setBarcodeSuggestions([]);
    setBarcodeDropOpen(false);
    setBarcodeHighlight(0);
  };

  /** Shared lookup for focused barcode box + global HID wedge scans. */
  const processScannedCodeRef = useRef(null);
  processScannedCodeRef.current = async (rawCode, { allowSuggestions = false } = {}) => {
    const code = String(rawCode || "").trim();
    if (!code || estimationLoading || bookingCheckBusy) return;

    // Estimation ID (e.g. QT-2026-001) — same field as tag/barcode
    if (/^QT[-_]?\d/i.test(code) || /^QT-/i.test(code)) {
      setBarcode("");
      setBarcodeSuggestions([]);
      setBarcodeDropOpen(false);
      await loadEstimation(code);
      return;
    }

    const p = products.find((x) => x.barcode === code || x.code === code.toUpperCase());
    if (p) {
      await tryAddProduct(p);
      setBarcode("");
      setBarcodeSuggestions([]);
      setBarcodeDropOpen(false);
      return;
    }
    // Fallback: if suggestions exist (focused box), take the highlighted/first match
    if (allowSuggestions && barcodeSuggestions.length > 0) {
      await selectBarcodeSuggestion(barcodeSuggestions[barcodeHighlight] || barcodeSuggestions[0]);
      return;
    }
    // Name typed in the scan box (HID wedge still requires exact tag/barcode)
    if (allowSuggestions) {
      const t = code.toLowerCase();
      const nameHits = products.filter((x) => (x.name || "").toLowerCase().includes(t));
      if (nameHits.length === 1) {
        await tryAddProduct(nameHits[0]);
        setBarcode("");
        setBarcodeSuggestions([]);
        setBarcodeDropOpen(false);
        return;
      }
      if (nameHits.length > 1) {
        setBarcodeSuggestions(nameHits.slice(0, 12));
        setBarcodeDropOpen(true);
        setBarcodeHighlight(0);
        return;
      }
    }
    // Exact barcode may be booked (hidden from sellable list) — ask booking API
    try {
      const { data } = await api.get("/quotations/active-booking", { params: { barcode: code } });
      if (data?.booked) {
        setBookedBlock(data);
        setBarcode("");
        return;
      }
    } catch { /* ignore */ }
    toast.error("No product, name, or estimation found");
  };

  const scan = async (e) => {
    e.preventDefault();
    await processScannedCodeRef.current?.(barcode, { allowSuggestions: true });
  };

  // Global HID scanner: works even when the barcode field is not focused
  useHidBarcodeScanner(
    (code) => processScannedCodeRef.current?.(code),
    {
      enabled: posMode === "jewellery",
      shouldIgnore: () => document.activeElement === barcodeRef.current,
    },
  );

  const onBarcodeKeyDown = (e) => {
    const code = barcode.trim();
    const isEst = /^QT[-_]?\d/i.test(code) || /^QT-/i.test(code);
    // Prefer estimation load over product suggestion when Est No is typed
    if (e.key === "Enter" && isEst) {
      e.preventDefault();
      scan(e);
      return;
    }
    if (barcodeDropOpen && barcodeSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setBarcodeHighlight((h) => (h + 1) % barcodeSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setBarcodeHighlight((h) => (h - 1 + barcodeSuggestions.length) % barcodeSuggestions.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectBarcodeSuggestion(barcodeSuggestions[barcodeHighlight]);
        return;
      }
    }
    if (e.key === "Escape") setBarcodeDropOpen(false);
  };

  const updateItem = (i, patch) => setCart((c) => c.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const removeItem = (i) => { setCart((c) => c.filter((_, idx) => idx !== i)); if (expandedItem === i) setExpandedItem(null); };
  const updateStonePrice = (itemIndex, stoneIndex, amount) => setCart((c) => c.map((x, idx) => {
    if (idx !== itemIndex) return x;
    const stones = Array.isArray(x.stones) ? x.stones.slice() : [];
    stones[stoneIndex] = { ...stones[stoneIndex], price: amount };
    const stone_charges = stones.reduce((s, r) => s + (Number(r?.price) || 0), 0);
    return { ...x, stones, stone_charges };
  }));

  // ── Totals (same formulas as backend billingCalc — ROUND_HALF_UP to 2 dp) ──
  const purityRateMap = {};
  if (goldRate != null) purityRateMap['24K'] = goldRate;
  if (rate22kSetting != null) purityRateMap['22K'] = rate22kSetting;
  if (rate18kSetting != null) purityRateMap['18K'] = rate18kSetting;
  if (silverRate != null) purityRateMap['Silver'] = silverRate;
  if (pureSilverRate != null) purityRateMap['PureSilver'] = pureSilverRate;
  if (platinumRate != null) purityRateMap.Platinum = platinumRate;

  const itemTotals = cart.map((it) => {
    try {
      // Tray: price the entered weight once (qty=1) — never the product's
      // stored per-unit weight, and never multiplied again by pieces sold.
      // Pure metal: price_override is already total metal value; pieces are for stock only.
      const calcItem = it.is_tray
        ? { ...it, net_weight: Number(it.tray_weight_sold) || 0, gross_weight: Number(it.tray_weight_sold) || 0, quantity: 1 }
        : (it.is_pure_metal || it.line_type === "pure_metal")
          ? { ...it, quantity: 1 }
          : it;
      const amounts = calcLineAmounts(calcItem, goldRate || 0, purityRateMap);
      return {
        goldValue: amounts.gold_value,
        wastageAmt: amounts.wastage_amount,
        making: amounts.making_amount,
        stone: amounts.stone_charges,
        base: amounts.computed_base,
        lineBase: amounts.unit_price,
        lineTotal: amounts.line_total,
      };
    } catch (err) {
      console.error("[POS] calcLineAmounts failed:", err);
      return { goldValue: 0, wastageAmt: 0, making: 0, stone: 0, base: 0, lineBase: 0, lineTotal: 0 };
    }
  });

  const oldGoldValue = oldGold.active
    ? calcOldGoldValue({ weight: oldGold.weight, purity: oldGold.purity, rate: oldGold.rate, manual: oldMetalManual.gold })
    : 0;
  const oldSilverValue = oldSilver.active
    ? calcOldGoldValue({ weight: oldSilver.weight, purity: oldSilver.purity, rate: oldSilver.rate, manual: oldMetalManual.silver })
    : 0;

  // Old Gold / Old Silver Exchange are PAYMENTS, not deductions — the cashier
  // never enters them as separate payment rows; they're derived from
  // weight/purity/rate and automatically included alongside cash/UPI/etc.
  const oldGoldPaymentEntry = oldGold.active && oldGoldValue > 0
    ? {
        mode: "old_gold_exchange",
        amount: oldGoldValue,
        description: "Old Gold Exchange",
        old_gold: {
          weight: Number(oldGold.weight) || 0,
          purity: oldGold.purity || "22K",
          rate: Number(oldGold.rate) || 0,
          ...(oldMetalManual.gold ? { manual: true } : {}),
        },
      }
    : null;
  const oldSilverPaymentEntry = oldSilver.active && oldSilverValue > 0
    ? {
        mode: "old_silver_exchange",
        amount: oldSilverValue,
        description: "Old Silver Exchange",
        old_silver: {
          weight: Number(oldSilver.weight) || 0,
          purity: oldSilver.purity || "925",
          rate: Number(oldSilver.rate) || 0,
          ...(oldMetalManual.silver ? { manual: true } : {}),
        },
      }
    : null;
  const exchangePayments = [oldGoldPaymentEntry, oldSilverPaymentEntry].filter(Boolean);
  const effectivePayments = exchangePayments.length ? [...exchangePayments, ...payments] : payments;

  // Scheme credit = stored gold grams × today's rate (not cash collected)
  const appliedSchemeGrams = schemeStoredGrams(appliedScheme);
  const schemeCreditValue = useMemo(() => {
    if (!appliedScheme) return 0;
    const grams = appliedSchemeGrams;
    const rate = Number(rate22kSetting) || Number(goldRate) || 0;
    if (grams > 0 && rate > 0) return toMoneyNumber(grams * rate);
    return Number(appliedScheme.redeemable_amount) || Number(appliedScheme.total_paid) || 0;
  }, [appliedScheme, appliedSchemeGrams, goldRate, rate22kSetting]);

  // Hidden bills now carry GST the same as a normal bill — only their
  // visibility in reports/accounts differs (until unlocked).
  const effectiveGstPct = gstPct;

  const billTotals = calcInvoiceTotals({
    lineTotals: itemTotals.map((t) => t.lineTotal),
    discount,
    discountType,
    gstPct: effectiveGstPct,
    oldGoldValue,
    oldSilverValue,
    schemeCredit: schemeCreditValue,
  });

  const subtotal = billTotals.subtotal;
  const discountAmt = billTotals.discount;
  const afterDiscount = billTotals.after_discount;
  const gst = billTotals.gst_amount;
  const cgstAmt = billTotals.cgst_amount;
  const sgstAmt = billTotals.sgst_amount;
  const grand = billTotals.grand_total;
  const roundOff = billTotals.round_off;
  const schemeCreditAmt = billTotals.scheme_credit || 0;

  const paidTotal = toMoneyNumber(effectivePayments.reduce((s, p) => s + parseMoneyInput(p.amount), 0));
  const balance = toMoneyNumber(grand - paidTotal);
  const creditSaleAllowed = Boolean(selectedCustomer?.id) && !hiddenBillMode;
  const cashPayment = payments.find((p) => p.mode === "cash");
  const changeAmt = cashGiven
    ? Math.max(0, toMoneyNumber(parseMoneyInput(cashGiven) - (cashPayment ? parseMoneyInput(cashPayment.amount) : grand)))
    : 0;

  // Denom total
  const denomTotal = CASH_DENOMS.reduce((s, d) => s + d * (Number(denomCounts[d] || 0)), 0);

  // ── Bill summary breakdown ──────────────────────────────────────────────────
  const totalGoldValue = toMoneyNumber(itemTotals.reduce((s, t) => s + t.goldValue, 0));
  const totalWastage = toMoneyNumber(itemTotals.reduce((s, t) => s + t.wastageAmt, 0));
  const totalMaking = toMoneyNumber(itemTotals.reduce((s, t) => s + t.making, 0));
  const totalStone = toMoneyNumber(itemTotals.reduce((s, t) => s + t.stone, 0));

  // Dynamic label: derive purity from cart items
  const cartPurities = [...new Set(cart.map((it) => it.purity_name || it.purity || "").filter(Boolean))];
  const metalValueLabel = cartPurities.length === 1 ? `Metal Value (${cartPurities[0]})` : "Metal Value";

  // ── Grand total override handler ───────────────────────────────────────────
  const applyGrandOverride = () => {
    const target = toMoneyNumber(parseMoneyInput(grandInput));
    if (!target || target <= 0 || target >= grand) { setGrandEditOpen(false); return; }
    const gstFactor = 1 + (effectiveGstPct / 100);
    // Old Gold is a payment now — it no longer factors into grand total, only
    // discount and scheme credit shape it.
    const newDiscountAmt = Math.max(0, toMoneyNumber(subtotal - (target + schemeCreditAmt) / gstFactor));
    setDiscount(Math.round(newDiscountAmt * 100) / 100);
    setDiscountType("flat");
    setGrandEditOpen(false);
    setGrandInput("");
  };

  // ── Payment helpers ────────────────────────────────────────────────────────
  // Old Gold / Old Silver Exchange (when active) are always settled first —
  // cash/UPI/etc rows only need to cover what's left after them.
  const remainingAfterExchange = Math.max(0, toMoneyNumber(
    grand - (oldGoldPaymentEntry?.amount || 0) - (oldSilverPaymentEntry?.amount || 0),
  ));
  const settleFull = () => { setPayments([{ mode: "cash", amount: remainingAfterExchange, description: "" }]); setPaymentNoteOpen([]); };
  const addPayment = () => {
    const remaining = Math.max(0, toMoneyNumber(grand - paidTotal));
    setPayments((p) => [...p, { mode: "upi", amount: remaining || "", description: "" }]);
  };
  const removePayment = (i) => {
    setPayments((p) => {
      const next = p.filter((_, idx) => idx !== i);
      if (next.length === 1) return next;
      const remaining = Math.max(0, toMoneyNumber(remainingAfterExchange - next.slice(0, -1).reduce((s, x) => s + parseMoneyInput(x.amount), 0)));
      return next.map((x, idx) => (idx === next.length - 1 ? { ...x, amount: remaining || "" } : x));
    });
  };
  const updatePaymentAmount = (i, value) => {
    setPayments((prev) => {
      const next = prev.map((x, idx) => (idx === i ? { ...x, amount: value } : x));
      if (i !== next.length - 1) {
        const remaining = Math.max(0, toMoneyNumber(remainingAfterExchange - next.slice(0, -1).reduce((s, x) => s + parseMoneyInput(x.amount), 0)));
        next[next.length - 1] = { ...next[next.length - 1], amount: remaining || "" };
      }
      return next;
    });
  };
  const updatePaymentDescription = (i, value) => {
    setPayments((prev) => prev.map((x, idx) => idx === i ? { ...x, description: value } : x));
  };
  const togglePaymentNote = (i) => {
    setPaymentNoteOpen((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  };

  const clearPureMetalForm = () => {
    setPmWeight("");
    setPmProductId("");
    setPmQty("");
    setPmOverQty(null);
    setPmOtherCharges("");
    setPmRateLocked(true);
    const live = pmMetal === "24k" ? goldRate : pureSilverRate;
    setPmRate(live != null ? String(live) : "");
  };

  const applyPosModeSwitch = (mode) => {
    const keepHidden = hiddenBillMode;
    clearAll();
    if (keepHidden) setHiddenBillMode(true);
    clearPureMetalForm();
    setPosMode(mode);
    if (mode === "pure_metal") {
      setPmMetal("24k");
      setPmRateLocked(true);
      setPmRate(goldRate != null ? String(goldRate) : "");
      setActiveTab("summary");
    }
  };

  const switchPosMode = (mode) => {
    if (mode === posMode) return;
    if (mode === "jewellery" && !canJewelleryPos) return toast.error("Jewellery POS is not allowed for your login");
    if (mode === "pure_metal" && !canPureMetalPos) return toast.error("Pure Gold / Silver POS is not allowed for your login");
    const hasWork = cart.length > 0 || (posMode === "pure_metal" && (Number(pmWeight) > 0 || pmProductId));
    if (hasWork) {
      setModeSwitchConfirm(mode);
      return;
    }
    applyPosModeSwitch(mode);
  };

  // ── Bill hold ──────────────────────────────────────────────────────────────
  const holdBill = () => {
    if (cart.length === 0) return toast.error(posMode === "pure_metal" ? "Select item and quantity first" : "Cart is empty");
    const bill = {
      id: Date.now(),
      cart,
      selectedCustomer,
      discount,
      discountType,
      payments,
      cartRateSnapshot,
      posMode,
      detailedStoneBill,
      pmMetal,
      pmWeight,
      pmProductId,
      pmQty,
      pmRate,
      pmRateLocked,
      pmOtherCharges,
      oldGold,
      oldSilver,
      heldAt: new Date().toLocaleTimeString(),
    };
    const updated = [...heldBills, bill];
    setHeldBills(updated);
    saveHeldBills(updated);
    clearAll();
    clearPureMetalForm();
    toast.success("Bill put on hold");
  };

  const recallBill = (bill) => {
    setPosMode(bill.posMode || "jewellery");
    if (bill.posMode === "pure_metal") {
      setPmMetal(bill.pmMetal || "24k");
      setPmWeight(bill.pmWeight || "");
      setPmProductId(bill.pmProductId || bill.cart?.[0]?.pure_product_id || "");
      setPmQty(bill.pmQty || String(bill.cart?.[0]?.quantity || ""));
      setPmRate(bill.pmRate || "");
      setPmRateLocked(bill.pmRateLocked !== false);
      setPmOtherCharges(bill.pmOtherCharges || "");
      loadPureProducts();
    }
    setCart(bill.cart);
    setCartRateSnapshot(bill.cartRateSnapshot ?? null);
    setSelectedCustomer(bill.selectedCustomer);
    setDetailedStoneBill(Boolean(bill.detailedStoneBill));
    setDiscount(bill.discount);
    setDiscountType(bill.discountType);
    setPayments(bill.payments);
    if (bill.oldGold) setOldGold(bill.oldGold);
    if (bill.oldSilver) setOldSilver(bill.oldSilver);
    const updated = heldBills.filter((b) => b.id !== bill.id);
    setHeldBills(updated);
    saveHeldBills(updated);
    setRecallOpen(false);
    toast.success("Bill recalled");
  };

  const clearAll = () => {
    setCart([]); setCartRateSnapshot(null); setDiscount(0); setDiscountType("flat"); setGrandEditOpen(false); setGrandInput("");
    setCheckoutError(null);
    setPayments([{ mode: "cash", amount: "", description: "" }]); setSelectedCustomer(null);
    setWalkInCustomer(false);
    setPosFieldErrors({ salesperson: false, customer: false });
    setCustSearch(""); setPanNumber(""); setAadhaarNumber(""); setDetailedStoneBill(false);
    setOldGold({ weight: "", purity: "22K", rate: "", active: false });
    setOldSilver({ weight: "", purity: "925", rate: "", active: false });
    setCashGiven(""); setDenomCounts({});
    setCustomerSchemes([]); setAppliedScheme(null); setSchemePanelOpen(false);
    setLoadedQuotation(null);
    if (posMode === "pure_metal") clearPureMetalForm();
    // Abandon in-flight checkout identity so the next Pay starts a new request_id
    checkoutRequestIdRef.current = null;
    checkoutLeaseIdsRef.current = [];
  };

  const applyScheme = (scheme) => {
    setAppliedScheme(scheme);
    setSchemePanelOpen(false);
    const grams = schemeStoredGrams(scheme);
    const rate = Number(rate22kSetting) || Number(goldRate) || 0;
    const credit = grams > 0 && rate > 0
      ? toMoneyNumber(grams * rate)
      : Number(scheme.redeemable_amount) || 0;
    const paidMonths = asArray(scheme.payments).length;
    const duration = Number(scheme.duration_months) || 0;
    const midScheme = scheme.status !== "matured" && duration > 0 && paidMonths < duration;
    toast.success(
      grams > 0
        ? `Scheme applied — ${grams.toFixed(3)}g × today's rate = ${fmtINR(credit)}`
        : midScheme
          ? `Scheme applied — ${fmtINR(credit)} paid till date (will be marked Breaked, no bonus)`
          : `Scheme “${scheme.plan_name}” applied — ${fmtINR(credit)} maturity credit`,
    );
  };

  const clearScheme = () => {
    setAppliedScheme(null);
    toast.message("Scheme credit removed");
  };

  const loadEstimation = async (rawNo) => {
    const no = String(rawNo || "").trim().toUpperCase();
    if (!no) return toast.error("Enter estimation number (e.g. QT-2026-001)");
    setBarcodeDropOpen(false);
    setCustDropOpen(false);
    setEmpDropOpen(false);
    setEstimationLoading(true);
    try {
      const { data: q } = await api.get(`/quotations/by-no/${encodeURIComponent(no)}`);
      if (!q) throw new Error("Estimation not found");
      if (q.status === "converted") {
        toast.error(`Estimation ${q.quote_no} is already converted`);
        return;
      }
      if (q.status === "expired" || q.status === "cancelled") {
        toast.error(`Estimation ${q.quote_no} is ${q.status}`);
        return;
      }
      const items = asArray(q.items);
      if (!items.length) {
        toast.error("Estimation has no products");
        return;
      }
      const priceLocked = Boolean(q.price_locked) || q.status === "booked";
      const advancePaid = Number(q.advance_paid) || 0;
      const remainingMeta = q.remaining_amount != null
        ? Number(q.remaining_amount)
        : Math.max(0, Number(q.grand_total || 0) - advancePaid);
      const lockedRate = Number(q.gold_rate) > 0 ? Number(q.gold_rate) : (Number(goldRate) || 0);

      const cartLines = items.map((it) => {
        // Tray: gross/net weight sitting on the item is the tray's full weight,
        // not what was actually sold — tray_weight_sold is authoritative, same
        // substitution estimation print/POS billing apply everywhere else.
        const soldWeight = it.is_tray ? (Number(it.tray_weight_sold) || 0) : null;
        let overrideRaw = it.price_override ?? it.unit_price ?? it.line_total ?? null;
        let override = overrideRaw != null && overrideRaw !== "" ? Number(overrideRaw) : null;
        if (!(override > 0)) {
          try {
            const amounts = calcLineAmounts({
              ...it,
              purity: it.purity || it.purity_name || "",
              quantity: it.is_tray ? 1 : (it.quantity || it.qty || 1),
              ...(it.is_tray ? { gross_weight: soldWeight, net_weight: soldWeight } : {}),
              price_override: null,
            }, lockedRate, purityRateMap);
            override = priceLocked ? (Number(amounts.unit_price) || null) : null;
          } catch {
            override = null;
          }
        }
        return {
          product_id: it.product_id || it.id,
          name: it.product_name || it.name || "Item",
          code: it.code || "",
          barcode: it.barcode || "",
          metal: it.metal || it.metal_name || "",
          purity: it.purity || it.purity_name || "",
          category_id: it.category_id || null,
          category_name: it.category_name || it.category || "",
          subcategory_id: it.subcategory_id || null,
          subcategory_name: it.subcategory_name || it.subcategory || "",
          hsn_code: it.hsn_code || "7113",
          gross_weight: it.is_tray ? soldWeight : (it.gross_weight || 0),
          net_weight: it.is_tray ? soldWeight : (it.net_weight || 0),
          stone_weight: it.stone_weight || 0,
          making_charges: it.making_charges || 0,
          making_charge_type: it.making_charge_type || "fixed",
          wastage_pct: it.wastage_pct || 0,
          stone_charges: it.stone_charges || 0,
          stones: Array.isArray(it.stones) ? it.stones : undefined,
          hallmark: it.hallmark || "",
          quantity: it.quantity || it.qty || 1,
          price_override: override > 0 ? override : null,
          rate_override: it.rate_override ?? null,
          wastage_amount_override: it.wastage_amount_override ?? null,
          making_amount_override: it.making_amount_override ?? null,
          inventory_mode: it.inventory_mode || "unique_tag",
          is_tray: Boolean(it.is_tray),
          tray_stock_qty: it.tray_stock_qty || 0,
          tray_total_weight: it.tray_total_weight || 0,
          tray_pieces_sold: it.tray_pieces_sold || 1,
          tray_weight_sold: it.tray_weight_sold || 0,
          _price_locked: priceLocked && override > 0,
        };
      });

      // Bill total from cart so payment matches what cashier sees
      let billGrand = 0;
      try {
        const lineTotals = cartLines.map((it) => {
          const calcItem = it.is_tray
            ? { ...it, net_weight: Number(it.tray_weight_sold) || 0, gross_weight: Number(it.tray_weight_sold) || 0, quantity: 1 }
            : it;
          const amounts = calcLineAmounts(
            { ...calcItem, price_override: calcItem.price_override > 0 ? calcItem.price_override : null },
            lockedRate,
            purityRateMap,
          );
          return amounts.line_total;
        });
        billGrand = Number(calcInvoiceTotals({
          lineTotals,
          discount: Number(q.discount) || 0,
          discountType: q.discount_type === "pct" ? "pct" : "flat",
          gstPct: Number(q.gst_pct != null ? q.gst_pct : gstPct) || 3,
          oldGoldValue: 0,
          schemeCredit: 0,
        }).grand_total) || 0;
      } catch {
        billGrand = Number(q.grand_total) || 0;
      }

      setCart(cartLines);
      setCartRateSnapshot(lockedRate || goldRate);
      if (lockedRate > 0) setGoldRate(lockedRate);
      setDiscount(Number(q.discount) || 0);
      setDiscountType(q.discount_type === "pct" ? "pct" : "flat");
      if (q.gst_pct != null) setGstPct(Number(q.gst_pct) || 3);
      // Carry the Old Metal Exchange calculated in Estimation into POS so the
      // cashier doesn't have to re-enter weight/purity/rate at checkout.
      if (q.old_gold && q.old_gold.active) {
        setOldGold({
          active: true,
          weight: q.old_gold.weight != null ? String(q.old_gold.weight) : "",
          purity: q.old_gold.purity || "22K",
          rate: q.old_gold.rate != null ? String(q.old_gold.rate) : "",
        });
      }
      if (q.old_silver && q.old_silver.active) {
        setOldSilver({
          active: true,
          weight: q.old_silver.weight != null ? String(q.old_silver.weight) : "",
          purity: q.old_silver.purity || "925",
          rate: q.old_silver.rate != null ? String(q.old_silver.rate) : "",
        });
      }
      if (q.customer_id) {
        const fromList = customers.find((c) => c.id === q.customer_id);
        setSelectedCustomer(fromList || {
          id: q.customer_id,
          name: q.customer_name,
          mobile: q.customer_mobile,
        });
        setWalkInCustomer(false);
      } else if (q.customer_name) {
        setSelectedCustomer(null);
        setWalkInCustomer(true);
      }
      if (q.salesperson_id) {
        const emp = employees.find((e) => e.id === q.salesperson_id);
        if (emp) setSalesperson(emp);
      }

      // Old gold carried over from the estimation (setOldGold above) settles
      // part of the bill too, but that state update hasn't taken effect yet
      // in this same synchronous pass — compute its value directly from `q`
      // rather than reading the (still stale) `oldGold`/`oldGoldValue` state,
      // otherwise the auto-filled Cash due ends up billGrand-minus-advance
      // only, ignoring old gold entirely (until the cashier manually retypes
      // the amount, which recalculates against the by-then-updated state).
      const qOldGoldValue = q.old_gold && q.old_gold.active
        ? calcOldGoldValue({ weight: q.old_gold.weight, purity: q.old_gold.purity, rate: q.old_gold.rate })
        : 0;
      const qOldSilverValue = q.old_silver && q.old_silver.active
        ? calcOldGoldValue({ weight: q.old_silver.weight, purity: q.old_silver.purity, rate: q.old_silver.rate })
        : 0;
      const netAfterExchange = Math.max(0, toMoneyNumber(billGrand - qOldGoldValue - qOldSilverValue));
      const advApply = Math.min(advancePaid, netAfterExchange);
      const cashDue = Math.max(0, toMoneyNumber(netAfterExchange - advApply));

      setLoadedQuotation({
        id: q.id,
        quote_no: q.quote_no,
        price_locked: priceLocked,
        advance_paid: advancePaid,
        remaining_amount: cashDue > 0 ? cashDue : remainingMeta,
        valid_until: q.valid_until || null,
        advance_id: q.advance_id || null,
        advance_ids: Array.isArray(q.advance_ids) ? q.advance_ids : (q.advance_id ? [q.advance_id] : []),
        status: q.status,
        bill_grand: billGrand,
        items: cartLines,
      });
      setActiveTab(q.status === "booked" ? "payment" : "summary");
      setBarcode("");

      if (q.status === "booked") {
        if (!(billGrand > 0)) {
          setPayments([{ mode: "cash", amount: "", description: "" }]);
          toast.error("Bill total is ₹0 — check gold rate / item weights before collecting payment");
        } else {
          const payLines = [];
          if (advApply > 0.009) {
            payLines.push({
              mode: "advance",
              amount: String(advApply),
              description: `Booking ${q.quote_no}`,
            });
          }
          if (cashDue > 0.009) {
            payLines.push({ mode: "cash", amount: String(cashDue), description: "Balance due" });
          } else if (!payLines.length) {
            payLines.push({ mode: "cash", amount: String(billGrand), description: "" });
          }
          setPayments(payLines);
          toast.success(
            `Loaded ${q.quote_no} · bill ${fmtINR(billGrand)} · pay now ${fmtINR(cashDue)}`,
          );
        }
      } else {
        setPayments([{ mode: "cash", amount: "", description: "" }]);
        toast.success(`Loaded estimation ${q.quote_no} — review bill summary`);
      }
    } catch (err) {
      toast.error(formatApiError(err) || "Could not load estimation");
    } finally {
      setEstimationLoading(false);
      setBarcodeDropOpen(false);
      setCustDropOpen(false);
      setEmpDropOpen(false);
      barcodeRef.current?.focus();
    }
  };

  const unlinkEstimation = () => {
    setLoadedQuotation(null);
    setPayments([{ mode: "cash", amount: "", description: "" }]);
    setCart((prev) => prev.map((it) => {
      const next = { ...it, _price_locked: false };
      if (!(Number(next.price_override) > 0)) next.price_override = null;
      return next;
    }));
    setBarcodeDropOpen(false);
    setCustDropOpen(false);
    setEmpDropOpen(false);
    setEstimationLoading(false);
    setBarcode("");
    setTimeout(() => barcodeRef.current?.focus(), 0);
    toast.message("Estimation unlinked — you can scan a new Est No");
  };

  const customerSelected = Boolean(selectedCustomer) || walkInCustomer;

  const goToPayment = () => {
    const missingSp = !salesperson;
    const missingCust = !customerSelected;
    if (missingSp || missingCust) {
      setPosFieldErrors({ salesperson: missingSp, customer: missingCust });
      if (missingSp && missingCust) toast.error("Select salesperson and customer");
      else if (missingSp) toast.error("Select salesperson");
      else toast.error("Select customer");
      return false;
    }
    setPosFieldErrors({ salesperson: false, customer: false });
    setActiveTab("payment");
    return true;
  };

  // ── Checkout ───────────────────────────────────────────────────────────────
  const checkout = async () => {
    if (user?._offlineMode) {
      return toast.error(
        "Offline session — viewing only. Connect to the shop host to finalize sales, payments, or stock changes.",
        { duration: 6000 }
      );
    }

    if (!rateLoaded) return toast.error("Gold rate is still loading — please wait");
    if (cart.length === 0) return toast.error(posMode === "pure_metal" ? "Select item and quantity first" : "Cart is empty");
    if (busy) return;

    // Tray lines: pieces and weight are entered independently — validate both
    // against available stock before hitting the server (server re-validates too).
    for (const it of cart) {
      if (!it.is_tray) continue;
      const pieces = Number(it.tray_pieces_sold);
      const weight = Number(it.tray_weight_sold);
      if (!Number.isInteger(pieces) || pieces <= 0) {
        return toast.error(`${it.name}: enter a valid number of pieces`);
      }
      if (pieces > (it.tray_stock_qty || 0)) {
        return toast.error(`${it.name}: only ${it.tray_stock_qty} piece(s) available`);
      }
      if (!Number.isFinite(weight) || weight <= 0) {
        return toast.error(`${it.name}: enter the weight sold`);
      }
      if (weight > (it.tray_total_weight || 0)) {
        return toast.error(`${it.name}: only ${formatWeight(it.tray_total_weight)}g available`);
      }
    }

    // Old Gold Exchange is a payment — it can never exceed the invoice payable
    // amount. Block checkout rather than silently create a negative balance.
    if (oldGold.active && oldGoldValue > grand + 0.5) {
      return toast.error(
        `Old Gold Exchange (${fmtINR(oldGoldValue)}) exceeds the invoice total (${fmtINR(grand)}). `
        + `Reduce the old gold weight/rate, or use the buyback/refund flow for the excess.`,
        { duration: 6000 },
      );
    }
    if (oldSilver.active && oldSilverValue > grand + 0.5) {
      return toast.error(
        `Old Silver Exchange (${fmtINR(oldSilverValue)}) exceeds the invoice total (${fmtINR(grand)}). `
        + `Reduce the old silver weight/rate, or use the buyback/refund flow for the excess.`,
        { duration: 6000 },
      );
    }
    if (oldGoldValue + oldSilverValue > grand + 0.5) {
      return toast.error(
        `Old Gold + Old Silver Exchange (${fmtINR(oldGoldValue + oldSilverValue)}) exceeds the invoice total (${fmtINR(grand)}). `
        + `Reduce the exchange weight/rate so both together do not exceed the bill.`,
        { duration: 6000 },
      );
    }

    // Check authority state — ISOLATED means save as Draft Sale
    if (authorityStateVal === AUTHORITY_STATES.ISOLATED) {
      const gate = await canTransact("any");
      if (gate?.draft) {
        setBusy(true);
        try {
          const draftItems = cart.map((it) => (
            it.is_pure_metal || it.line_type === "pure_metal"
              ? {
                  line_type: "pure_metal",
                  is_pure_metal: true,
                  pure_product_id: it.pure_product_id || null,
                  pure_form: it.pure_form || null,
                  pure_stock_decrement: it.pure_stock_decrement ?? null,
                  name: it.name,
                  quantity: it.quantity || 1,
                  gross_weight: it.gross_weight,
                  net_weight: it.net_weight,
                  purity: it.purity || it.purity_name,
                  metal: it.metal,
                  rate: it.rate,
                  price_override: it.price_override,
                  making_charges: it.making_charges || 0,
                  unit_price: it.price_override,
                  line_total: parseMoneyInput(it.price_override) + parseMoneyInput(it.making_charges),
                  hsn_code: it.hsn_code,
                }
              : {
                  product_id: it.product_id || it.id,
                  name: it.name,
                  quantity: it.is_tray ? (it.tray_pieces_sold || 1) : (it.quantity || 1),
                  gross_weight: it.gross_weight,
                  net_weight: it.net_weight,
                  stone_weight: it.stone_weight,
                  wastage_pct: it.wastage_pct,
                  making_charges: it.making_charges,
                  making_charge_type: it.making_charge_type,
                  stone_charges: it.stone_charges || 0,
                  stones: Array.isArray(it.stones) ? it.stones : undefined,
                  hallmark: it.hallmark || "",
                  metal: it.metal || it.metal_name || "",
                  category_id: it.category_id || null,
                  category_name: it.category_name || "",
                  subcategory_id: it.subcategory_id || null,
                  subcategory_name: it.subcategory_name || "",
                  purity: it.purity || it.purity_name,
                  price_override: it.price_override,
                  rate_override: it.rate_override ?? null,
                  wastage_amount_override: it.wastage_amount_override ?? null,
                  making_amount_override: it.making_amount_override ?? null,
                  unit_price: it.unit_price,
                  line_total: it.line_total,
                  ...(it.is_tray ? { tray_weight_sold: it.tray_weight_sold || 0 } : {}),
                }
          ));
          await api.post("/draft-sales", {
            cashier_id: user?.id || null,
            customer_id: selectedCustomer?.id || null,
            items: draftItems,
            subtotal: subtotal,
            discount_amount: parseMoneyInput(discount),
            total: grand,
            quoted_gold_rate: goldRate || null,
            notes: null,
          });
          toast.success("Host offline — sale saved as Pending Sale", { duration: 5000 });
          checkoutRequestIdRef.current = null;
          checkoutLeaseIdsRef.current = [];
          clearAll();
        } catch (err) {
          toast.error(formatApiError(err) || "Failed to save draft sale");
        } finally {
          setBusy(false);
        }
        return;
      }
    }

    if (!connStatus.billingAllowed || !connStatus.ok) {
      return toast.error("Branch Service unavailable — wait for the local API, then retry");
    }

    if (balance < -0.5) {
      return toast.error(`Overpaid by ${fmtINR(Math.abs(balance))} — reduce the payment amount`);
    }
    if (balance > 0.5) {
      if (hiddenBillMode) {
        return toast.error("Hidden bills must be fully paid");
      }
      if (!selectedCustomer?.id) {
        return toast.error("Select a customer to save the remaining as outstanding");
      }
    }

    if (grand > 200000 && !panNumber.trim()) {
      setActiveTab("payment");
      toast.error("PAN card is mandatory for transactions above ₹2,00,000");
      return;
    }

    if (aadhaarMandatoryAbove50k && grand > 50000 && !aadhaarNumber.trim()) {
      setActiveTab("payment");
      toast.error("Aadhaar number is mandatory for transactions above ₹50,000");
      return;
    }

    if (isBusinessDateStale) {
      const proceed = await confirmStaleDay(
        `Your business day (${businessDate}) hasn't been closed yet. You can continue billing on ${businessDate}, or go close it now in Accounts.`,
        { title: "Day not closed", confirmLabel: `Continue billing on ${businessDate}`, cancelLabel: "Go close day", danger: false },
      );
      if (!proceed) {
        try { localStorage.setItem("accounts.section", "daily-closing"); } catch { /* ignore */ }
        navigate("/accounts");
        return;
      }
    }

    if (balance > 0.5 && creditSaleAllowed) {
      const proceedCredit = await confirmStaleDay(
        `${fmtINR(balance)} will remain outstanding on ${selectedCustomer.name}'s account. Collect later from the customer page or Reports → Customer Outstanding.`,
        {
          title: "Save as credit sale?",
          confirmLabel: "Save outstanding",
          cancelLabel: "Go back",
          danger: false,
        },
      );
      if (!proceedCredit) return;
    }

    setBusy(true);
    // One stable request_id per logical checkout — reused on network retry until success/clear
    if (!checkoutRequestIdRef.current) {
      checkoutRequestIdRef.current = (crypto?.randomUUID?.() || `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }
    const requestId = checkoutRequestIdRef.current;
    const deviceId = localStorage.getItem("ssj_device_identifier") || undefined;

    // Reserve unique jewellery tags before committing the invoice.
    // Booked estimations already hold long-lived reserves — skip short checkout leases.
    const uniqueLines = cart.filter(
      (it) => it.inventory_mode === "unique_tag" || it.inventory_mode === "unique" || it.track_type === "unique",
    );
    const skipCheckoutReserve = loadedQuotation?.status === "booked" || loadedQuotation?.price_locked;
    if (!skipCheckoutReserve) {
      try {
        for (const it of uniqueLines) {
          const productId = it.product_id || it.id;
          const { data: reserveRes } = await api.post("/authority/reserve", {
            entity_type: "product",
            entity_id: productId,
            request_id: requestId,
            device_id: deviceId,
          });
          if (reserveRes?.granted === false) {
            throw Object.assign(new Error(reserveRes.reason || "Item is currently reserved at another counter."), {
              response: { data: { detail: reserveRes.reason, code: reserveRes.code || "ITEM_RESERVED" } },
            });
          }
          if (reserveRes?.lease_id) checkoutLeaseIdsRef.current.push(reserveRes.lease_id);
        }
      } catch (err) {
        const detail = formatApiError(err);
        toast.error(detail || "Item is currently reserved at another counter.");
        setBusy(false);
        return;
      }
    }

    const payload = {
      request_id: requestId,
      customer_id: selectedCustomer?.id || null,
      customer_name: selectedCustomer?.name || "Walk-in Customer",
      customer_mobile: selectedCustomer?.mobile || "",
      customer_address: selectedCustomer?.address || "",
      pan_number: panNumber || null,
      aadhaar_number: aadhaarNumber || null,
      detailed_stone_bill: detailedStoneBill,
      salesperson_id: salesperson?.id || null,
      items: cart.map((it) => (
        it.is_pure_metal || it.line_type === "pure_metal"
              ? {
                  line_type: "pure_metal",
                  is_pure_metal: true,
                  pure_product_id: it.pure_product_id || null,
                  pure_form: it.pure_form || null,
                  pure_stock_decrement: it.pure_stock_decrement ?? null,
                  name: it.name,
                  product_name: it.name,
                  quantity: it.quantity || 1,
                  gross_weight: it.gross_weight,
                  net_weight: it.net_weight,
                  purity: it.purity || it.purity_name,
                  metal: it.metal,
                  rate: it.rate,
                  price_override: it.price_override,
                  making_charges: it.making_charges || 0,
                  other_charges: it.making_charges || 0,
                  hsn_code: it.hsn_code,
                }
          : {
              product_id: it.product_id || it.id,
              quantity: it.is_tray ? (it.tray_pieces_sold || 1) : (it.quantity || 1),
              gross_weight: it.gross_weight,
              net_weight: it.net_weight,
              stone_weight: it.stone_weight,
              wastage_pct: it.wastage_pct,
              making_charges: it.making_charges,
              making_charge_type: it.making_charge_type,
              stone_charges: it.stone_charges || 0,
              stones: Array.isArray(it.stones) ? it.stones : undefined,
              hallmark: it.hallmark || "",
              metal: it.metal || it.metal_name || "",
              metal_name: it.metal || it.metal_name || "",
              category_id: it.category_id || null,
              category_name: it.category_name || "",
              subcategory_id: it.subcategory_id || null,
              subcategory_name: it.subcategory_name || "",
              purity: it.purity || it.purity_name,
              price_override: it.price_override,
              rate_override: it.rate_override ?? null,
              wastage_amount_override: it.wastage_amount_override ?? null,
              making_amount_override: it.making_amount_override ?? null,
              ...(it.is_tray ? { tray_weight_sold: it.tray_weight_sold || 0 } : {}),
            }
      )),
      discount: parseMoneyInput(discount),
      discount_type: discountType,
      // Client totals are preview only — server recalculates
      gst_pct: effectiveGstPct,
      old_gold: oldGold.active ? oldGold : undefined,
      old_gold_value: oldGoldValue,
      old_silver: oldSilver.active ? oldSilver : undefined,
      old_silver_value: oldSilverValue,
      scheme_id: appliedScheme?.id || undefined,
      scheme_credit: schemeCreditAmt > 0 ? schemeCreditAmt : undefined,
      quotation_id: loadedQuotation?.id || undefined,
      prefer_advance_id: loadedQuotation?.advance_id || undefined,
      prefer_advance_ids: loadedQuotation?.advance_ids?.length
        ? loadedQuotation.advance_ids
        : (loadedQuotation?.advance_id ? [loadedQuotation.advance_id] : undefined),
      round_off: roundOff,
      grand_total: grand,
      gold_rate: cartRateSnapshot ?? goldRate,
      gold_22k: rate22kSetting ?? undefined,
      gold_18k: rate18kSetting ?? undefined,
      silver_rate: silverRate ?? undefined,
      pure_silver_rate: pureSilverRate ?? undefined,
      platinum_rate: platinumRate ?? undefined,
      payments: effectivePayments.filter((p) => parseMoneyInput(p.amount) > 0),
      is_hidden: Boolean(hiddenBillMode),
      allow_partial: creditSaleAllowed,
    };
    try {
      const { data } = await api.post("/invoices", payload);
      const dueSaved = Number(data.balance_due) || 0;
      toast.success(
        hiddenBillMode
          ? `Hidden bill ${data.invoice_no} saved (owner only)`
          : dueSaved > 0.5
            ? `Invoice ${data.invoice_no} created — ${fmtINR(dueSaved)} outstanding`
            : isPreAccountsInvoice(data)
              ? `Test invoice ${data.invoice_no} created`
              : `Invoice ${data.invoice_no} created!`,
      );
      setCheckoutError(null);
      // The backend only persists a subset of the payload — carry the rest
      // (discount type, old-gold value, round-off, rate used) through for the printed bill.
      setLastInvoice({
        ...data,
        discount_type: data.discount_type || discountType,
        old_gold_value: data.old_gold_value ?? oldGoldValue,
        old_silver_value: data.old_silver_value ?? oldSilverValue,
        round_off: data.round_off ?? roundOff,
        gold_rate: data.gold_rate ?? goldRate,
        pan_number: panNumber || null,
        aadhaar_number: data.aadhaar_number ?? (aadhaarNumber || null),
        customer_address: data.customer_address ?? selectedCustomer?.address ?? null,
        detailed_stone_bill: data.detailed_stone_bill ?? detailedStoneBill,
      });
      // Save PAN/Aadhaar to customer record if entered and they didn't have one
      if (panNumber.trim() && selectedCustomer?.id && !selectedCustomer.pan_number) {
        api.patch(`/customers/${selectedCustomer.id}`, { pan_number: panNumber.trim() })
          .then(({ data: updatedCust }) => {
            setSelectedCustomer((c) => c ? { ...c, pan_number: updatedCust.pan_number } : c);
          })
          .catch(() => {}); // non-fatal — PAN is already saved on the invoice
      }
      if (aadhaarNumber.trim() && selectedCustomer?.id && !selectedCustomer.aadhaar_number) {
        api.patch(`/customers/${selectedCustomer.id}`, { aadhaar_number: aadhaarNumber.trim() })
          .then(({ data: updatedCust }) => {
            setSelectedCustomer((c) => c ? { ...c, aadhaar_number: updatedCust.aadhaar_number } : c);
          })
          .catch(() => {}); // non-fatal — Aadhaar is already saved on the invoice
      }
      checkoutRequestIdRef.current = null;
      checkoutLeaseIdsRef.current = [];
      clearAll();
      if (posMode === "pure_metal") loadPureProducts();
    } catch (err) {
      const code = err?.response?.data?.code;
      const detail = formatApiError(err);
      if (code === "DUPLICATE_PAN" || code === "DUPLICATE_AADHAAR") {
        const info = dupInfo(err);
        if (info) {
          setDupCustomer(info);
          setActiveTab("payment");
        }
      }
      if (code === "INSUFFICIENT_STOCK" && posMode === "pure_metal") {
        const pp = pureProducts.find((p) => p.id === pmProductId);
        setPmOverQty({
          requested: Number(pmQty) || 0,
          available: Number(pp?.stock_qty) || 0,
          name: pp?.name || "selected item",
        });
        loadPureProducts();
      }
      // Release unique reservations on hard failure (keep request_id for retry on network errors)
      const status = err?.response?.status;
      if (status && status !== 0 && status < 500 && code !== "DUPLICATE") {
        for (const leaseId of checkoutLeaseIdsRef.current) {
          try { await api.post("/authority/release", { lease_id: leaseId }); } catch { /* */ }
        }
        checkoutLeaseIdsRef.current = [];
        // Business rejection → new attempt needs a fresh request_id
        if (code === "ITEM_ALREADY_SOLD" || code === "INSUFFICIENT_STOCK" || code === "ITEM_RESERVED") {
          checkoutRequestIdRef.current = null;
        }
      }
      setCheckoutError(detail);
      toast.error(detail);
    } finally {
      setBusy(false);
    }
  };

  // Keyboard shortcuts — must run after grand/checkout/holdBill are defined
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        setEmpDropOpen(false);
        setCustDropOpen(false);
        setBarcodeDropOpen(false);
        barcodeRef.current?.focus();
      }
      if (e.key === "F5") { e.preventDefault(); setActiveTab("summary"); setDiscountEditOpen(true); setTimeout(() => discountInputRef.current?.focus(), 100); }
      if (e.key === "F6") { e.preventDefault(); setOldGold((g) => ({ ...g, active: !g.active })); setActiveTab("summary"); }
      if (e.key === "F7") { e.preventDefault(); holdBill(); }
      if (e.key === "F8") { e.preventDefault(); setRecallOpen((v) => !v); }
      if (e.key === "F12") {
        e.preventDefault();
        if (activeTab === "payment") {
          if (authorityStateVal === AUTHORITY_STATES.ISOLATED) {
            toast.error("Isolated mode — billing paused. Reconnect to network.", { duration: 5000 });
            return;
          }
          if (!connStatus.ok || !connStatus.billingAllowed) {
            toast.error("Branch Service unavailable — billing paused");
            return;
          }
          checkout();
        } else {
          goToPayment();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, cart, heldBills, grand, balance, busy, rateLoaded, connStatus, salesperson, selectedCustomer, walkInCustomer, hiddenBillMode]);

  // ── Derived display values ──────────────────────────────────────────────────
  const invoiceLabel = lastInvoice?.invoice_no || "INV-PENDING";
  const rate22k = rate22kSetting ?? (goldRate ? +(goldRate * 0.9167).toFixed(0) : null);
  const rate18k = rate18kSetting ?? (goldRate ? +(goldRate * 0.75).toFixed(0) : null);
  const rate24k = goldRate || null;
  const ratePureSilver = pureSilverRate ?? null;
  const rateSilver = silverRate ?? null;
  const userName = user?.name || "Cashier";
  const userRole = formatRoleLabel(user?.role, ownerName, user?.email);
  const userInitial = (userName.trim()[0] || "C").toUpperCase();
  // Tray unit: it.net_weight holds the tray's whole pooled weight (not a
  // per-piece figure) and it.quantity is pieces sold — the weight actually
  // being sold on this line is tray_weight_sold, not net_weight × quantity.
  const totalNetWt = cart.reduce(
    (s, it) => s + (it.is_tray ? Number(it.tray_weight_sold || 0) : Number(it.net_weight || 0) * (it.quantity || 1)),
    0,
  );
  const lineRate = (it) => resolveLineRate(it, goldRate, purityRateMap);

  return (
    <div
      className={`pos-redesign h-screen flex flex-col overflow-hidden${hiddenBillMode ? " pos-hidden-unlock" : ""}`}
      style={{
        "--pos-canvas": POS_CANVAS,
        "--pos-paper": POS_PAPER,
        "--pos-line": POS_LINE,
        "--pos-forest": FOREST,
        background: hiddenBillMode ? HIDDEN_UNLOCK_BG : POS_CANVAS,
      }}
      data-testid="pos-page"
    >
      <style>{`
        .pos-redesign-menu {
          background: ${POS_PAPER};
          border-color: ${POS_LINE};
          box-shadow: 0 10px 24px rgba(54, 45, 31, 0.12);
        }
        .pos-redesign .input,
        .pos-redesign input:not([type="checkbox"]):not([type="radio"]):not([type="file"]),
        .pos-redesign select,
        .pos-redesign textarea {
          border-radius: 10px;
        }
        .pos-redesign:not(.pos-hidden-unlock) .input {
          border-color: var(--pos-line);
          background-color: var(--pos-paper);
        }
        .pos-redesign:not(.pos-hidden-unlock) .input:focus {
          border-color: var(--pos-forest);
          box-shadow: 0 0 0 2px rgba(36, 91, 75, 0.11);
        }
        .pos-redesign:not(.pos-hidden-unlock) button:focus-visible {
          outline: 2px solid rgba(36, 91, 75, 0.34);
          outline-offset: 2px;
        }
        .pos-redesign.pos-hidden-unlock .pos-redesign-surface,
        .pos-redesign.pos-hidden-unlock [class~="bg-[#FFFDF9]"],
        .pos-redesign.pos-hidden-unlock [class~="bg-[#FAF7F0]"],
        .pos-redesign.pos-hidden-unlock [class~="bg-[#F7F3EA]"],
        .pos-redesign.pos-hidden-unlock [class~="bg-[#F7F4ED]"] {
          background: ${HIDDEN_UNLOCK_BG} !important;
          border-color: ${HIDDEN_UNLOCK_EDGE} !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pos-mode-toggle"] [aria-selected="true"] {
          background: var(--pos-forest) !important;
          color: #FFFDF9 !important;
          box-shadow: 0 2px 7px rgba(27, 73, 60, 0.18) !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pos-mode-toggle"] [aria-selected="false"]:hover {
          background: #E9F0EC !important;
          color: var(--pos-forest) !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) .pos-rate-strip > div {
          background: #173D32 !important;
          border-color: #34594D !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) .pos-rate-strip > div > div:first-child > div {
          background: #21483C !important;
          border-color: #486B60 !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) .pos-rate-strip > div > div:first-child > div > div:nth-child(2) > div:first-child {
          color: #C6A65F !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) .pos-rate-strip > div > div:first-child > div > div:nth-child(2) {
          color: #FFFDF9 !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) .pos-rate-strip > div > button {
          background: #21483C !important;
          border-color: #5A746A !important;
          color: #D4BC7A !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pure-metal-panel"] > div:first-child,
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pm-bill-summary"] {
          background: ${POS_PAPER} !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pure-metal-panel"] > div:first-child button.border:not(.border-2) {
          background: #E9F0EC !important;
          border-color: ${FOREST} !important;
          color: ${FOREST} !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pure-metal-panel"] input:not([type="radio"]),
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pure-metal-panel"] select {
          border-color: ${POS_LINE};
          background: ${POS_PAPER};
        }
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pure-metal-panel"] input:disabled {
          background: #F1EFE9 !important;
          color: #69716D;
        }
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pure-metal-panel"] input:focus,
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pure-metal-panel"] select:focus {
          border-color: ${FOREST};
          box-shadow: 0 0 0 2px rgba(36, 91, 75, 0.11);
        }
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pm-bill-summary"] > div:nth-child(5) > span:last-child {
          color: ${FOREST} !important;
        }
        .pos-redesign:not(.pos-hidden-unlock) [data-testid="pm-bill-summary"] > button {
          background: ${FOREST} !important;
          border-radius: 10px;
        }
      `}</style>

      {/* ══ HEADER ═══════════════════════════════════════════════════════════ */}
      <header
        className="pos-redesign-surface flex-shrink-0 border-b"
        style={{
          background: hiddenBillMode ? HIDDEN_UNLOCK_BG : POS_PAPER,
          borderColor: hiddenBillMode ? HIDDEN_UNLOCK_EDGE : POS_LINE,
        }}
      >
        {hiddenBillMode && (
          <div className="px-4 py-1.5 text-[12px] font-semibold text-center text-white" style={{ background: "#0A0A0A" }}>
            Hidden Bill mode — this checkout and the next ones stay hidden until you Lock
            <button
              type="button"
              className="ml-3 underline font-normal text-[#D4D4D4]"
              onClick={() => {
                lockHiddenAccess();
                toast.success("Hidden Bill locked — hidden bills are hidden again");
              }}
            >
              Lock
            </button>
          </div>
        )}
        {testMode && <TestModeBanner compact className="rounded-none border-x-0 border-t-0" />}
        {/* Row 1: Brand + Date / Invoice / User */}
        <div className="flex items-center px-4 gap-3" style={{ height: 52 }}>
          {/* Brand → Dashboard */}
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-2.5 min-w-0 text-left"
            title="Dashboard"
          >
            <div className="h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden bg-white border border-[#DDD8CF] shadow-[0_1px_2px_rgba(54,45,31,0.06)]">
              {company?.logo ? (
                <img src={company.logo} alt="" className="h-full w-full object-contain" />
              ) : (
                <img src={slgtLogo} alt={APP_WINDOW_TITLE} className="h-full w-full object-contain" />
              )}
            </div>
            <div className="hidden min-[1101px]:block text-[15px] font-semibold text-[#25332E] leading-tight truncate max-w-[200px]" style={{ fontFamily: "Georgia, serif" }}>
              {company?.name || "Jewellery Shop"}
            </div>
          </button>

          {/* POS mode toggle — fitted cream pill on active option */}
          {(canJewelleryPos || canPureMetalPos) && (
            <PosModeToggle
              mode={posMode}
              onChange={switchPosMode}
              showJewellery={canJewelleryPos}
              showPureMetal={canPureMetalPos}
            />
          )}

          <div className="flex-1" />

          {/* Date / Invoice / User */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="hidden min-[1101px]:flex items-center gap-1.5 text-[12px] text-[#25332E] tabular-nums whitespace-nowrap">
              <Calendar size={13} className="text-[#77766F]" strokeWidth={1.6} />
              <PosLiveClock />
            </div>

            <div className="px-2.5 py-1 rounded-[10px] border border-[#DDD8CF] bg-[#F7F3EA] text-[11.5px] whitespace-nowrap">
              <span className="text-[#77766F]">Invoice No. </span>
              <span className="font-semibold font-mono" style={{ color: FOREST }}>{invoiceLabel}</span>
            </div>

            <div className="flex items-center gap-2 pl-1 border-l border-[#DDD8CF]">
              {/* Triple-tap avatar / name (beside Dashboard) → Hidden Bill PIN */}
              <button
                type="button"
                className="flex items-center gap-2 select-none"
                onClick={() => {
                  const ref = hiddenTapRef.current;
                  ref.count += 1;
                  if (ref.timer) clearTimeout(ref.timer);
                  if (ref.count >= 3) {
                    ref.count = 0;
                    setHiddenPwError("");
                    setHiddenPwOpen(true);
                    return;
                  }
                  ref.timer = setTimeout(() => { ref.count = 0; }, 450);
                }}
              >
                <div className="h-8 w-8 rounded-xl flex items-center justify-center text-white text-[12px] font-semibold shadow-[0_1px_2px_rgba(27,73,60,0.16)]" style={{ background: FOREST }}>
                  {userInitial}
                </div>
                <div className="hidden min-[1101px]:block text-[12px] font-medium text-[#25332E] whitespace-nowrap text-left">
                  {userName} <span className="text-[#77766F] font-normal">({String(userRole).replace(/_/g, " ")})</span>
                </div>
              </button>
              <button
                type="button"
                title="Back to Dashboard"
                onClick={() => navigate("/")}
                className="h-8 px-2.5 rounded-[10px] border border-[#DDD8CF] flex items-center gap-1.5 text-[#77766F] hover:border-[#245B4B] hover:text-[#245B4B] transition-colors"
              >
                <LayoutDashboard size={14} strokeWidth={1.6} />
                <span className="hidden min-[1101px]:inline text-[11.5px] font-medium">Dashboard</span>
              </button>
            </div>
          </div>
        </div>

        {/* Row 2: Live rate strip */}
        {posMode === "pure_metal" ? (
          <div className="pos-rate-strip">
            <PureMetalRateStrip
            goldRate={rateLoaded ? rate24k : null}
            silverRate={rateLoaded ? ratePureSilver : null}
            goldDelta={(() => {
              if (pmPrevGold == null || rate24k == null || !pmPrevGold) return null;
              const amount = Number(rate24k) - Number(pmPrevGold);
              if (!amount) return null;
              const pct = (amount / Number(pmPrevGold)) * 100;
              return { amount, pct };
            })()}
            silverDelta={(() => {
              if (pmPrevSilver == null || ratePureSilver == null || !pmPrevSilver) return null;
              const amount = Number(ratePureSilver) - Number(pmPrevSilver);
              if (!amount) return null;
              const pct = (amount / Number(pmPrevSilver)) * 100;
              return { amount, pct };
            })()}
            onRefresh={() => {
              api.get("/settings/gold-rate").then(({ data }) => {
                const rate = Number(data?.gold_24k) || 0;
                const silver = Number(data?.pure_silver) || null;
                if (goldRate) setPmPrevGold(goldRate);
                if (pureSilverRate) setPmPrevSilver(pureSilverRate);
                setGoldRate(rate);
                setRate22kSetting(Number(data?.gold_22k) || null);
                setRate18kSetting(Number(data?.gold_18k) || null);
                setPureSilverRate(silver);
                setSilverRate(Number(data?.silver) || null);
                setPlatinumRate(Number(data?.platinum) || null);
                toast.success("Rates refreshed");
              }).catch(() => toast.error("Could not refresh rates"));
            }}
            />
          </div>
        ) : (
        <div className="relative flex items-stretch border-t border-[#34594D]" style={{ height: 48, background: "#173D32" }}>
          {/* Centered rates */}
          <div className="flex items-stretch justify-center flex-1">
            <RateCard label="24K GOLD" value={rateLoaded && rate24k != null ? fmtINR(rate24k, { decimals: 0 }) : "—"} />
            <RateCard label="22K GOLD" value={rateLoaded && rate22k != null ? fmtINR(rate22k, { decimals: 0 }) : "—"} />
            <RateCard label="18K GOLD" value={rateLoaded && rate18k != null ? fmtINR(rate18k, { decimals: 0 }) : "—"} />
            <RateCard label="PURE SILVER" value={rateLoaded && ratePureSilver != null ? fmtINR(ratePureSilver, { decimals: 0 }) : "—"} />
            <RateCard label="SILVER" value={rateLoaded && rateSilver != null ? fmtINR(rateSilver, { decimals: 0 }) : "—"} />
          </div>

          {/* Refresh — pinned to right */}
          <div className="absolute right-3 top-0 h-full flex items-center gap-1.5">
            <button
              type="button"
              title="Refresh rates"
              onClick={() => {
                api.get("/settings/gold-rate").then(({ data }) => {
                  const rate = Number(data?.gold_24k) || 0;
                  if (cart.length > 0 && cartRateSnapshot !== null && rate !== cartRateSnapshot) {
                    toast(`Rate changed ${fmtINR(cartRateSnapshot, { decimals: 0 })} → ${fmtINR(rate, { decimals: 0 })}. Cart totals updated.`, { icon: "⚠️" });
                    setCartRateSnapshot(rate);
                  }
                  setGoldRate(rate);
                  setRate22kSetting(Number(data?.gold_22k) || null);
                  setRate18kSetting(Number(data?.gold_18k) || null);
                  setPureSilverRate(Number(data?.pure_silver) || null);
                  setSilverRate(Number(data?.silver) || null);
                  setPlatinumRate(Number(data?.platinum) || null);
                  if (cart.length === 0) toast.success("Rates refreshed");
                }).catch(() => toast.error("Could not refresh rates"));
              }}
              className="h-7 w-7 rounded-[10px] border border-[#5A746A] flex items-center justify-center text-[#D4BC7A] hover:bg-[#2A5548] hover:text-white transition-colors"
            >
              <RefreshCw size={12} strokeWidth={1.75} />
            </button>
          </div>
        </div>
        )}
      </header>

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN AREA
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ─── LEFT PANEL ──────────────────────────────────────────────────── */}
        <div className="pos-redesign-surface flex flex-col flex-1 min-w-0 min-h-0 border-r border-[#DDD8CF] bg-[#FAF7F0] shadow-[1px_0_5px_rgba(54,45,31,0.04)]">

          {posMode === "pure_metal" ? (
            <>
              <PureMetalPanel
                metal={pmMetal}
                onMetalChange={(m) => {
                  setPmMetal(m);
                  setPmProductId("");
                  setPmQty("");
                  setPmWeight("");
                  if (pmRateLocked) {
                    const live = m === "24k" ? goldRate : pureSilverRate;
                    if (live != null) setPmRate(String(live));
                  }
                }}
                pureProducts={pureProducts}
                selectedProductId={pmProductId}
                onProductChange={(id) => {
                  setPmProductId(id);
                  setPmQty("");
                  setPmWeight("");
                }}
                qty={pmQty}
                onQtyChange={setPmQty}
                weight={pmWeight}
                onWeightChange={setPmWeight}
                overQtyDialog={pmOverQty}
                onCloseOverQtyDialog={() => setPmOverQty(null)}
                rate={pmRate}
                onRateChange={(v) => { setPmRateLocked(false); setPmRate(v); }}
                rateLocked={pmRateLocked}
                onToggleRateLock={() => {
                  setPmRateLocked((locked) => {
                    if (locked) return false;
                    const live = pmMetal === "24k" ? goldRate : pureSilverRate;
                    if (live != null) setPmRate(String(live));
                    return true;
                  });
                }}
                liveRate={pmMetal === "24k" ? goldRate : pureSilverRate}
                otherCharges={pmOtherCharges}
                onOtherChargesChange={setPmOtherCharges}
                discount={discount}
                onDiscountChange={setDiscount}
                discountType={discountType}
                onDiscountTypeChange={setDiscountType}
                custSearch={custSearch}
                onCustSearchChange={(e) => {
                  if (selectedCustomer) setSelectedCustomer(null);
                  if (walkInCustomer) setWalkInCustomer(false);
                  setCustSearch(e.target.value);
                  setCustDropOpen(true);
                  setEmpDropOpen(false);
                }}
                selectedCustomer={selectedCustomer}
                walkInCustomer={walkInCustomer}
                onClearCustomer={() => {
                  setSelectedCustomer(null);
                  setWalkInCustomer(false);
                  setCustSearch("");
                  setCustDropOpen(true);
                }}
                onFocusCustomer={() => {
                  if (selectedCustomer) { setSelectedCustomer(null); setCustSearch(""); }
                  if (walkInCustomer) { setWalkInCustomer(false); setCustSearch(""); }
                  setCustDropOpen(true);
                  setEmpDropOpen(false);
                }}
                onCustomerKeyDown={(e) => {
                  if (e.key === "Enter" && custDropOpen && !selectedCustomer && filteredCustomers.length > 0) {
                    e.preventDefault();
                    setSelectedCustomer(filteredCustomers[0]);
                    setWalkInCustomer(false);
                    setPosFieldErrors((err) => ({ ...err, customer: false }));
                    if (filteredCustomers[0]?.pan_number) setPanNumber(filteredCustomers[0].pan_number);
                    if (filteredCustomers[0]?.aadhaar_number) setAadhaarNumber(filteredCustomers[0].aadhaar_number);
                    setCustDropOpen(false);
                    setCustSearch("");
                  }
                  if (e.key === "Escape") setCustDropOpen(false);
                }}
                custDropOpen={custDropOpen}
                custAnchorRef={custAnchorRef}
                custDropRef={custDropRef}
                posFieldErrors={posFieldErrors}
                onOpenNewCustomer={() => setNewCustOpen(true)}
                salesperson={salesperson}
                empSearch={empSearch}
                onEmpSearchChange={(e) => {
                  if (salesperson) setSalesperson(null);
                  setEmpSearch(e.target.value);
                  setEmpDropOpen(true);
                  setCustDropOpen(false);
                }}
                onClearSalesperson={() => { setSalesperson(null); setEmpSearch(""); setEmpDropOpen(true); }}
                onFocusSalesperson={() => {
                  if (salesperson) { setSalesperson(null); setEmpSearch(""); }
                  setEmpDropOpen(true);
                  setCustDropOpen(false);
                }}
                onSalespersonKeyDown={(e) => {
                  if (e.key === "Enter" && empDropOpen && !salesperson && filteredEmployees.length > 0) {
                    e.preventDefault();
                    setSalesperson(filteredEmployees[0]);
                    setEmpDropOpen(false);
                    setEmpSearch("");
                    setPosFieldErrors((err) => ({ ...err, salesperson: false }));
                  }
                  if (e.key === "Escape") setEmpDropOpen(false);
                }}
                empDropOpen={empDropOpen}
                empAnchorRef={empAnchorRef}
                empDropRef={empDropRef}
                employees={employees}
              />
              <PosFixedMenu open={empDropOpen} anchorRef={empAnchorRef} menuRef={empMenuRef} onClose={() => setEmpDropOpen(false)}>
                {filteredEmployees.length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-[#8B8F88]">No match</div>
                ) : (
                  filteredEmployees.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSalesperson(emp);
                        setEmpDropOpen(false);
                        setEmpSearch("");
                        setPosFieldErrors((er) => ({ ...er, salesperson: false }));
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#FAF7F0] border-b border-[#F3F4F6] last:border-0"
                    >
                      <span className="text-[12px] font-medium text-[#0A0A0A]">
                        {(emp.code || emp.employee_code) ? `${emp.code || emp.employee_code} | ` : ""}{emp.name}
                      </span>
                    </button>
                  ))
                )}
              </PosFixedMenu>
              <PosFixedMenu open={custDropOpen} anchorRef={custAnchorRef} menuRef={custMenuRef} onClose={() => setCustDropOpen(false)}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  className="w-full text-left px-3 py-2 hover:bg-[#FAF7F0] text-[12px] text-[#69716D] border-b border-[#F3F4F6]"
                  onClick={() => {
                    setWalkInCustomer(true);
                    setSelectedCustomer(null);
                    setCustDropOpen(false);
                    setCustSearch("");
                    setPosFieldErrors((err) => ({ ...err, customer: false }));
                  }}
                >
                  Walk-in Customer
                </button>
                {filteredCustomers.length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-[#8B8F88]">No match</div>
                ) : (
                  filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSelectedCustomer(c);
                        setWalkInCustomer(false);
                        setPosFieldErrors((err) => ({ ...err, customer: false }));
                        if (c.pan_number) setPanNumber(c.pan_number);
                        if (c.aadhaar_number) setAadhaarNumber(c.aadhaar_number);
                        setCustDropOpen(false);
                        setCustSearch("");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#FAF7F0] border-b border-[#F3F4F6] last:border-0"
                    >
                      <div className="text-[12px] font-medium text-[#0A0A0A]">{c.name}</div>
                      <div className="text-[11px] text-[#69716D]">{c.mobile}</div>
                    </button>
                  ))
                )}
              </PosFixedMenu>
            </>
          ) : (
          <>
          {/* Row 1: Salesperson + Customer — overflow visible so dropdowns can paint */}
          <div className="pos-redesign-surface relative z-40 flex items-stretch gap-0 border-b border-[#DDD8CF] flex-shrink-0 bg-[#FFFDF9]" style={{ minHeight: 64 }}>

            {/* Salesperson */}
            <div className="flex flex-col justify-center px-3 py-2 border-r border-[#DDD8CF]" style={{ width: "45%" }} ref={empDropRef}>
              <label className="text-[11px] font-bold text-[#4E5954] uppercase tracking-[0.08em] mb-1" >Sales person <span style={{ color: GOLD }} >*</span> </label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1" ref={empAnchorRef}>
                  <input
                    className={`w-full border rounded-[10px] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(54,45,31,0.03)] px-2.5 py-1.5 text-[12.5px] pr-8 outline-none transition-colors ${
                      posFieldErrors.salesperson
                        ? "border-red-500 ring-1 ring-red-500 focus:border-red-500"
                        : "border-[#DDD8CF] focus:border-[#245B4B]"
                    }`}
                    placeholder="Search salesperson…"
                    value={salesperson
                      ? `${salesperson.code || salesperson.employee_code ? `${salesperson.code || salesperson.employee_code} | ` : ""}${salesperson.name}`
                      : empSearch}
                    onChange={(e) => {
                      if (salesperson) setSalesperson(null);
                      setEmpSearch(e.target.value);
                      setEmpDropOpen(true);
                      setCustDropOpen(false);
                    }}
                    onFocus={() => {
                      if (salesperson) {
                        setSalesperson(null);
                        setEmpSearch("");
                      }
                      setEmpDropOpen(true);
                      setCustDropOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && empDropOpen && !salesperson && filteredEmployees.length > 0) {
                        e.preventDefault();
                        setSalesperson(filteredEmployees[0]);
                        setEmpDropOpen(false);
                        setEmpSearch("");
                        setPosFieldErrors((e) => ({ ...e, salesperson: false }));
                      }
                      if (e.key === "Escape") setEmpDropOpen(false);
                    }}
                  />
                  {(salesperson || empSearch) && (
                    <button
                      type="button"
                      onClick={() => { setSalesperson(null); setEmpSearch(""); setEmpDropOpen(true); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8B8F88] hover:text-red-500"
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  )}
                  <PosFixedMenu open={empDropOpen} anchorRef={empAnchorRef} menuRef={empMenuRef} onClose={() => setEmpDropOpen(false)}>
                    {employees.length === 0 ? (
                      <div className="px-3 py-2 text-[12px] text-[#8B8F88]">No employees found — add staff under Employees</div>
                    ) : filteredEmployees.length === 0 ? (
                      <div className="px-3 py-2 text-[12px] text-[#8B8F88]">No matching salesperson</div>
                    ) : (
                      filteredEmployees.map((emp) => (
                        <button
                          key={emp.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSalesperson(emp);
                            setEmpDropOpen(false);
                            setEmpSearch("");
                            setPosFieldErrors((e) => ({ ...e, salesperson: false }));
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-[#FAF7F0] border-b border-[#F3F4F6] last:border-0"
                        >
                          <span className="text-[12px] font-medium text-[#0A0A0A]">
                            {(emp.code || emp.employee_code) ? `${emp.code || emp.employee_code} | ` : ""}{emp.name}
                          </span>
                        </button>
                      ))
                    )}
                  </PosFixedMenu>
                </div>
                <button
                  type="button"
                  onClick={() => { setEmpDropOpen((v) => !v); setCustDropOpen(false); }}
                  className="flex-shrink-0 h-8 w-8 rounded-[10px] border border-[#DDD8CF] flex items-center justify-center text-[#69716D] hover:border-[#245B4B] hover:text-[#245B4B] transition-colors"
                  title="Browse salespersons"
                >
                  <ChevronDown size={12} strokeWidth={1.5} className={empDropOpen ? "rotate-180" : ""} />
                </button>
              </div>
            </div>

            {/* Customer */}
            <div className="flex flex-col justify-center px-3 py-2 flex-1" ref={custDropRef}>
              <label className="text-[11px] font-bold text-[#4E5954] uppercase tracking-[0.08em] mb-1">Customer <span style={{ color: GOLD }}>*</span></label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1" ref={custAnchorRef}>
                  <input
                    className={`w-full border rounded-[10px] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(54,45,31,0.03)] px-2.5 py-1.5 text-[12.5px] pr-8 outline-none transition-colors ${
                      posFieldErrors.customer
                        ? "border-red-500 ring-1 ring-red-500 focus:border-red-500"
                        : "border-[#DDD8CF] focus:border-[#245B4B]"
                    }`}
                    placeholder="Phone number or name…"
                    value={selectedCustomer
                      ? `${selectedCustomer.mobile || ""} | ${selectedCustomer.name}`
                      : walkInCustomer
                        ? "Walk-in Customer"
                        : custSearch}
                    onChange={(e) => {
                      if (selectedCustomer) setSelectedCustomer(null);
                      if (walkInCustomer) setWalkInCustomer(false);
                      setCustSearch(e.target.value);
                      setCustDropOpen(true);
                      setEmpDropOpen(false);
                    }}
                    onFocus={() => {
                      if (selectedCustomer) {
                        setSelectedCustomer(null);
                        setCustSearch("");
                      }
                      if (walkInCustomer) {
                        setWalkInCustomer(false);
                        setCustSearch("");
                      }
                      setCustDropOpen(true);
                      setEmpDropOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && custDropOpen && !selectedCustomer && filteredCustomers.length > 0) {
                        e.preventDefault();
                        setSelectedCustomer(filteredCustomers[0]);
                        setWalkInCustomer(false);
                        setPosFieldErrors((err) => ({ ...err, customer: false }));
                        if (filteredCustomers[0]?.pan_number) setPanNumber(filteredCustomers[0].pan_number);
                        if (filteredCustomers[0]?.aadhaar_number) setAadhaarNumber(filteredCustomers[0].aadhaar_number);
                        setCustDropOpen(false);
                        setCustSearch("");
                      }
                      if (e.key === "Escape") setCustDropOpen(false);
                    }}
                  />
                  {(selectedCustomer || walkInCustomer || custSearch) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(null);
                        setWalkInCustomer(false);
                        setCustSearch("");
                        setCustDropOpen(true);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8B8F88] hover:text-red-500"
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
                <PosFixedMenu open={custDropOpen} anchorRef={custAnchorRef} menuRef={custMenuRef} onClose={() => setCustDropOpen(false)}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    className="w-full text-left px-3 py-2 hover:bg-[#FAF7F0] text-[12px] text-[#69716D] border-b border-[#F3F4F6]"
                    onClick={() => {
                      setSelectedCustomer(null);
                      setWalkInCustomer(true);
                      setPosFieldErrors((err) => ({ ...err, customer: false }));
                      setCustDropOpen(false);
                      setCustSearch("");
                    }}
                  >
                    Walk-in Customer
                  </button>
                  {filteredCustomers.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-[#8B8F88]">No customers found</div>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedCustomer(c);
                          setWalkInCustomer(false);
                          setPosFieldErrors((err) => ({ ...err, customer: false }));
                          if (c.pan_number) setPanNumber(c.pan_number);
                          if (c.aadhaar_number) setAadhaarNumber(c.aadhaar_number);
                          setCustDropOpen(false);
                          setCustSearch("");
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-[#FAF7F0] border-b border-[#F3F4F6] last:border-0"
                      >
                        <div className="text-[12.5px] font-medium text-[#0A0A0A]">{c.name}</div>
                        <div className="text-[10.5px] text-[#69716D]">{c.mobile}{c.tag === "vip" ? " · VIP" : ""}</div>
                      </button>
                    ))
                  )}
                </PosFixedMenu>
                <button
                  type="button"
                  onClick={() => { setCustDropOpen((v) => !v); setEmpDropOpen(false); }}
                  className="flex-shrink-0 h-8 w-8 rounded-[10px] border border-[#DDD8CF] flex items-center justify-center text-[#69716D] hover:border-[#245B4B] hover:text-[#245B4B] transition-colors"
                  title="Search customers"
                >
                  <Search size={12} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  className="flex-shrink-0 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border transition-colors whitespace-nowrap shadow-[0_1px_2px_rgba(54,45,31,0.03)]"
                  style={{ borderColor: FOREST, color: FOREST, background: "#E9F0EC" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = FOREST; e.currentTarget.style.color = "white"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#E9F0EC"; e.currentTarget.style.color = FOREST; }}
                  onClick={openNewCustomer}
                >
                  + New Customer
                </button>
                {customerSchemes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSchemePanelOpen((v) => !v)}
                    className="flex-shrink-0 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border transition-colors whitespace-nowrap flex items-center gap-1.5"
                    style={{
                      borderColor: FOREST,
                      color: FOREST,
                      background: schemePanelOpen || appliedScheme ? "#E9F0EC" : "transparent",
                    }}
                    title="Apply customer scheme to this bill"
                  >
                    <Wallet size={12} strokeWidth={1.75} />
                    Schemes ({customerSchemes.length})
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Row 2: Scan Tag / Barcode / Estimation */}
          <div className="pos-redesign-surface border-b border-[#DDD8CF] bg-[#FFFDF9] px-3 py-2 flex-shrink-0" style={{ minHeight: 56 }}>
            <div className="text-[11px] font-bold text-[#4E5954] uppercase tracking-[0.08em] mb-1 flex items-center gap-2">
              <span>Scan Tag / Barcode / Est No</span>
              {loadedQuotation && (
                <span className="ml-auto normal-case tracking-normal text-[11px] font-mono font-semibold flex items-center gap-2" style={{ color: GOLD }}>
                  <span>
                    Est {loadedQuotation.quote_no}
                    {loadedQuotation.price_locked ? " · locked" : ""}
                    {loadedQuotation.advance_paid > 0
                      ? ` · adv ${fmtINR(loadedQuotation.advance_paid)} · due ${fmtINR(loadedQuotation.remaining_amount || 0)}`
                      : ""}
                    {loadedQuotation.valid_until ? ` · by ${loadedQuotation.valid_until}` : ""}
                  </span>
                  <button
                    type="button"
                    className="text-[#8B8F88] hover:text-red-500"
                    onClick={unlinkEstimation}
                    title="Unlink estimation and free the scan box"
                  >
                    <X size={11} strokeWidth={1.5} />
                  </button>
                </span>
              )}
              {estimationLoading && (
                <span className="ml-auto text-[11px] font-medium normal-case tracking-normal text-[#69716D]">Loading estimation…</span>
              )}
            </div>
            <form onSubmit={scan} className="flex items-center gap-2">
              <div className="relative flex-1" ref={barcodeAnchorRef}>
                <ScanBarcode size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#245B4B" }} strokeWidth={1.5} />
                <input
                  ref={barcodeRef}
                  data-testid={T.posBarcode}
                  autoFocus
                  autoComplete="off"
                  disabled={estimationLoading}
                  className="w-full border border-[#DDD8CF] rounded-[10px] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(54,45,31,0.03)] pl-9 pr-8 py-1.5 text-[13px] font-mono outline-none focus:border-[#245B4B] transition-colors disabled:opacity-60"
                  placeholder="Tag / barcode / name / Est No (QT-2026-001)"
                  value={barcode}
                  onChange={(e) => {
                    const val = e.target.value;
                    setBarcode(val);
                    const t = val.trim();
                    // Don't open product suggestions for estimation numbers
                    const isEst = /^QT[-_]?\d/i.test(t) || /^QT-/i.test(t);
                    setBarcodeDropOpen(!!t && !isEst);
                  }}
                  onFocus={() => {
                    const t = barcode.trim();
                    const isEst = /^QT[-_]?\d/i.test(t) || /^QT-/i.test(t);
                    if (t && !isEst) setBarcodeDropOpen(true);
                  }}
                  onKeyDown={onBarcodeKeyDown}
                />
                {barcode && (
                  <button
                    type="button"
                    onClick={() => {
                      setBarcode("");
                      setBarcodeSuggestions([]);
                      setBarcodeDropOpen(false);
                      barcodeRef.current?.focus();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8B8F88] hover:text-red-500"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                )}
                <PosFixedMenu open={barcodeDropOpen} anchorRef={barcodeAnchorRef} menuRef={barcodeMenuRef} maxHeight={220} onClose={() => setBarcodeDropOpen(false)}>
                  {barcodeSearching && barcodeSuggestions.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-[#8B8F88]">Searching…</div>
                  ) : barcodeSuggestions.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-[#8B8F88]">No matching tag, barcode, or name</div>
                  ) : (
                    barcodeSuggestions.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setBarcodeHighlight(i)}
                        onClick={() => selectBarcodeSuggestion(p)}
                        className={`w-full text-left px-3 py-2 border-b border-[#F3F4F6] last:border-0 ${
                          i === barcodeHighlight ? "bg-[#FAF7F0]" : "hover:bg-[#FAF7F0]"
                        }`}
                      >
                        <div className="text-[12.5px] font-mono font-medium text-[#0A0A0A]">{p.barcode}</div>
                        <div className="text-[10.5px] text-[#69716D]">
                          {p.name}{p.purity_name ? ` · ${p.purity_name}` : ""}
                        </div>
                      </button>
                    ))
                  )}
                </PosFixedMenu>
              </div>
              <button
                type="submit"
                disabled={estimationLoading}
                className="flex-shrink-0 px-5 py-2 rounded-[10px] text-[13px] font-semibold text-white transition-colors shadow-[0_2px_5px_rgba(27,73,60,0.16)] disabled:opacity-50"
                style={{ background: FOREST }}
                onMouseEnter={(e) => { if (!estimationLoading) e.currentTarget.style.background = FOREST_HOVER; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = FOREST; }}
              >
                {estimationLoading ? "…" : "Add (F2)"}
              </button>
            </form>
          </div>

          {/* Row 3: Scheme list OR Items Table */}
          {schemePanelOpen ? (
            <div className="flex-1 overflow-hidden flex flex-col bg-[#FAF7F0]">
              <div className="pos-redesign-surface flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-[#E8E1D5] bg-[#FFFDF9]">
                <div className="text-[12px] font-bold tracking-wide text-[#25332E] flex items-center gap-1.5">
                  <Wallet size={13} style={{ color: GOLD }} strokeWidth={1.75} />
                  CUSTOMER SCHEMES
                </div>
                <button
                  type="button"
                  onClick={() => setSchemePanelOpen(false)}
                  className="text-[11px] text-[#69716D] hover:text-[#245B4B] flex items-center gap-1"
                >
                  <X size={12} strokeWidth={1.5} /> Close
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {customerSchemes.length === 0 ? (
                  <div className="text-center text-[12px] text-[#8B8F88] py-10">No active or matured schemes</div>
                ) : (
                  customerSchemes.map((s) => {
                    const grams = schemeStoredGrams(s);
                    const rate = Number(rate22kSetting) || Number(goldRate) || 0;
                    const credit = grams > 0 && rate > 0
                      ? toMoneyNumber(grams * rate)
                      : Number(s.redeemable_amount) || Number(s.total_paid) || 0;
                    const selected = appliedScheme?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => applyScheme(s)}
                        className={`w-full text-left rounded-xl border px-3 py-3 transition-colors ${
                          selected ? "border-[#245B4B] bg-[#E9F0EC]" : "border-[#DDD8CF] bg-white hover:border-[#245B4B]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[13px] font-semibold text-[#0A0A0A]">{s.plan_name}</div>
                            <div className="text-[11px] text-[#69716D] mt-0.5">
                              {s.status === "matured" ? (
                                <span className="text-emerald-600 font-medium">matured</span>
                              ) : (
                                <span className="text-amber-700 font-medium">active — break if used now</span>
                              )}
                              {" · "}
                              {asArray(s.payments).length}/{s.duration_months} installments
                            </div>
                            <div className="text-[11px] text-[#4E5954] mt-1">
                              Paid {fmtINR(Number(s.total_paid) || 0)}
                              {grams > 0
                                ? ` → stored ${grams.toFixed(3)}g`
                                : s.redeemable_credit_type === "amount" || s.scheme_type === "fixed_amount"
                                  ? (s.status === "matured"
                                    ? ` → maturity ${fmtINR(Number(s.maturity_value || s.redeemable_amount) || 0)}`
                                    : " · cash saving")
                                  : ""}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[13px] font-bold tabular-nums" style={{ color: GOLD }}>
                              {grams > 0 ? `${grams.toFixed(3)}g` : fmtINR(credit)}
                            </div>
                            <div className="text-[10px] text-[#69716D]">
                              {grams > 0 ? `≈ ${fmtINR(credit)} today` : "cash credit"}
                            </div>
                          </div>
                        </div>
                        {selected && (
                          <div className="mt-2 text-[11px] text-[#245B4B] font-medium">Applied to this bill</div>
                        )}
                      </button>
                    );
                  })
                )}
                {appliedScheme && (
                  <button
                    type="button"
                    onClick={clearScheme}
                    className="w-full mt-2 py-2 text-[12px] text-[#A24D4D] border border-red-200 rounded-[10px] hover:bg-red-50"
                  >
                    Remove scheme credit
                  </button>
                )}
              </div>
            </div>
          ) : (
          <div className="flex-1 overflow-hidden flex flex-col" data-testid={T.posCart}>
            <div className="pos-redesign-surface flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-[#E8E1D5] bg-[#FFFDF9]">
              <div className="text-[11px] font-bold tracking-[0.08em] text-[#4E5954]">
                ITEMS <span style={{ color: GOLD }}>({cart.length})</span>
              </div>
              <div className="text-[12px] text-[#686D68]">
                Total Net Weight:{" "}
                <span className="font-semibold text-[#25332E] tabular-nums">{totalNetWt.toFixed(3)} g</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto bg-[#FFFDF9]">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-[#77766F] select-none">
                <div className="h-12 w-12 rounded-xl border border-[#DDD8CF] bg-[#F7F3EA] flex items-center justify-center shadow-[0_1px_2px_rgba(54,45,31,0.04)]">
                  <ScanBarcode size={24} strokeWidth={1.25} style={{ color: FOREST }} />
                </div>
                <div className="text-[12.5px] font-medium text-[#69716D]">Scan a tag or enter barcode to begin</div>
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-[#F7F3EA] z-10 border-b border-[#E3DCCD]">
                  <tr>
                    {["S.No", "Tag No / Barcode", "Item Description", "Purity", "Gross Wt (g)", "Stone Wt (g)", "Net Wt (g)", "Rate (₹/g)", "Making (₹)", "Amount (₹)", "Action"].map((h) => (
                      <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#77766F] px-2.5 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDE7DC]">
                  {cart.map((it, i) => {
                    const t = itemTotals[i];
                    const isExpanded = expandedItem === i;
                    const tag = it.barcode || it.code || "—";
                    const rate = lineRate(it);
                    return (
                      <Fragment key={`${it.product_id || "line"}-${i}`}>
                        <tr className="hover:bg-[#FAF7F0] transition-colors cursor-pointer" onClick={() => setExpandedItem(isExpanded ? null : i)}>
                          <td className="px-2.5 py-2.5 text-[#77766F]">{i + 1}</td>
                          <td className="px-2.5 py-2.5">
                            <span className="font-mono text-[11.5px] font-semibold" style={{ color: GOLD }}>{tag}</span>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <div className="font-medium text-[#25332E] leading-tight">{it.name}</div>
                            {it.stone_names && <div className="text-[11.5px] text-[#77766F] leading-tight">{it.stone_names}</div>}
                            {it.hallmark && <div className="text-[12px]" style={{ color: GOLD }}>BIS {it.hallmark}</div>}
                          </td>
                          <td className="px-2.5 py-2.5 text-[#4E5954] whitespace-nowrap">{it.purity || "—"}</td>
                          <td className="px-2.5 py-2.5 font-mono tabular-nums text-[#4E5954]">{Number(it.gross_weight).toFixed(3)}</td>
                          <td className="px-2.5 py-2.5 font-mono tabular-nums text-[#4E5954]">{Number(it.stone_weight).toFixed(3)}</td>
                          <td className="px-2.5 py-2.5 font-mono tabular-nums text-[#4E5954]">{Number(it.net_weight).toFixed(3)}</td>
                          <td className="px-2.5 py-2.5 font-mono tabular-nums text-[#4E5954]" onClick={(e) => e.stopPropagation()}>
                            {it.rate_override != null ? (
                              <div className="flex items-center gap-1">
                                <MoneyInput
                                  className="w-16 text-right border rounded text-[11px] px-1 py-0 font-mono"
                                  style={{ borderColor: FOREST }}
                                  value={it.rate_override}
                                  onValueChange={(_, n) => updateItem(i, { rate_override: n })}
                                />
                                <button type="button" onClick={() => updateItem(i, { rate_override: null })}
                                  className="text-[#77766F] hover:text-[#A24D4D]" title="Reset to market rate">
                                  <X size={10} strokeWidth={1.5} />
                                </button>
                              </div>
                            ) : (
                              <button type="button" className="flex items-center gap-1 hover:opacity-80" title="Override rate"
                                onClick={() => updateItem(i, { rate_override: rate || 0 })}>
                                <span>{rate != null ? fmtINR(rate, { decimals: 0 }) : "—"}</span>
                                <Pencil size={9} strokeWidth={1.5} className="text-[#9A958A]" />
                              </button>
                            )}
                          </td>
                          <td className="px-2.5 py-2.5 font-mono tabular-nums text-[#4E5954]">{fmtINR(t.making)}</td>
                          <td className="px-2.5 py-2.5 font-semibold text-[#25332E] tabular-nums font-mono">{fmtINR(t.lineTotal)}</td>
                          <td className="px-2.5 py-2.5">
                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <button type="button" onClick={() => setExpandedItem(isExpanded ? null : i)}
                                className="h-7 w-7 rounded-[10px] flex items-center justify-center text-[#77766F] hover:text-[#245B4B] hover:bg-[#E9F0EC] transition-colors" title="Edit">
                                <Pencil size={12} strokeWidth={1.5} />
                              </button>
                              <button type="button" onClick={() => removeItem(i)}
                                className="h-7 w-7 rounded-[10px] flex items-center justify-center text-[#77766F] hover:text-[#A24D4D] hover:bg-red-50 transition-colors" title="Remove">
                                <Trash2 size={12} strokeWidth={1.5} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={11} className="px-4 py-2 bg-[#FAF7F0] border-b border-[#E3DCCD]">
                              <div className="flex gap-6 items-start">
                                <div className="flex-1 space-y-1 text-[11px]">
                                  <BreakRow label={`Gold value (${it.purity} · ${it.is_tray ? (Number(it.tray_weight_sold) || 0) : it.net_weight}g × ${fmtINR(rate ?? goldRate, { decimals: 0 })})`} val={t.goldValue} />
                                  <BreakRow
                                    label={`Wastage (${it.wastage_pct}%)`}
                                    val={t.wastageAmt}
                                    editable
                                    onChange={(_, n) => updateItem(i, { wastage_amount_override: n })}
                                    overridden={it.wastage_amount_override != null}
                                    onReset={() => updateItem(i, { wastage_amount_override: null })}
                                  />
                                  <BreakRow
                                    label="Making charges"
                                    val={t.making}
                                    editable
                                    onChange={(_, n) => updateItem(i, { making_amount_override: n })}
                                    overridden={it.making_amount_override != null}
                                    onReset={() => updateItem(i, { making_amount_override: null })}
                                  />
                                  <BreakRow
                                    label="Stone charges"
                                    labelAction={() => setStoneModalIndex(i)}
                                    val={t.stone}
                                    editable
                                    onChange={(_, n) => updateItem(i, { stone_charges: n })}
                                  />
                                  <div className="border-t border-[#DDD8CF] pt-1 flex justify-between font-semibold text-[#0A0A0A]">
                                    <span>Unit Price</span>
                                    <div className="flex items-center gap-1">
                                      {it.price_override !== null ? (
                                        <MoneyInput
                                          className="w-20 text-right border rounded text-[11px] px-1 py-0 font-mono"
                                          style={{ borderColor: FOREST }}
                                          value={it.price_override}
                                          readOnly={Boolean(it._price_locked || loadedQuotation?.price_locked)}
                                          onValueChange={(raw) => {
                                            if (it._price_locked || loadedQuotation?.price_locked) return;
                                            updateItem(i, { price_override: raw });
                                          }} />
                                      ) : (
                                        <span>{fmtINR(t.base)}</span>
                                      )}
                                      {!(it._price_locked || loadedQuotation?.price_locked) && (
                                      <button type="button" onClick={() => updateItem(i, { price_override: it.price_override !== null ? null : +t.base.toFixed(2) })}
                                        className="text-[12px] text-[#69716D] hover:opacity-80" style={{ color: FOREST }} title="Override price">
                                        <Tag size={10} strokeWidth={1.5} />
                                      </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {it.is_tray ? (
                                  <div className="flex flex-col gap-3">
                                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-700 font-medium">
                                      Available: {it.tray_stock_qty} pcs · {formatWeight(it.tray_total_weight)}g
                                    </div>
                                    <div className="flex gap-4">
                                      <div className="flex flex-col items-center gap-1">
                                        <span className="text-[12px] text-[#69716D] uppercase tracking-wide">No. of Pieces</span>
                                        <div className="flex items-center gap-1">
                                          <button type="button" onClick={() => {
                                            const pieces = Math.max(1, (it.tray_pieces_sold || 1) - 1);
                                            updateItem(i, { tray_pieces_sold: pieces, quantity: pieces });
                                          }} className="h-6 w-6 rounded-[10px] border border-[#DDD8CF] text-[#4E5954] hover:bg-[#F7F4ED] text-[13px] font-medium flex items-center justify-center">−</button>
                                          <input type="text" inputMode="decimal" min="1" step="1" max={it.tray_stock_qty}
                                            className="w-12 text-center border border-[#DDD8CF] rounded-[10px] text-[12px] py-0.5 font-mono"
                                            value={it.tray_pieces_sold || 1}
                                            onChange={(e) => {
                                              const pieces = Math.max(1, Math.min(it.tray_stock_qty || 1, Math.round(Number(e.target.value)) || 1));
                                              updateItem(i, { tray_pieces_sold: pieces, quantity: pieces });
                                            }} />
                                          <button type="button" onClick={() => {
                                            const pieces = Math.min(it.tray_stock_qty || 1, (it.tray_pieces_sold || 1) + 1);
                                            updateItem(i, { tray_pieces_sold: pieces, quantity: pieces });
                                          }} className="h-6 w-6 rounded-[10px] border border-[#DDD8CF] text-[#4E5954] hover:bg-[#F7F4ED] text-[13px] font-medium flex items-center justify-center">+</button>
                                        </div>
                                      </div>
                                      <div className="flex flex-col items-center gap-1">
                                        <span className="text-[12px] text-[#69716D] uppercase tracking-wide">Weight (g)</span>
                                        <input type="text" inputMode="decimal" min="0" step="0.001" max={it.tray_total_weight}
                                          className="w-20 text-center border border-amber-300 rounded-[10px] text-[12px] py-0.5 font-mono bg-amber-50"
                                          value={it.tray_weight_input ?? String(it.tray_weight_sold ?? 0)}
                                          onChange={(e) => {
                                            const raw = sanitizeWeightDraft(e.target.value);
                                            const parsed = parseFloat(raw);
                                            updateItem(i, {
                                              tray_weight_input: raw,
                                              tray_weight_sold: Number.isFinite(parsed) ? parsed : 0,
                                            });
                                          }}
                                          onBlur={(e) => {
                                            const parsed = parseFloat(e.target.value);
                                            const clamped = Math.max(0, Math.min(it.tray_total_weight || 0, Number.isFinite(parsed) ? parsed : 0));
                                            const normalized = parseFloat(clamped.toFixed(3));
                                            updateItem(i, { tray_weight_sold: normalized, tray_weight_input: String(normalized) });
                                          }} />
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-[12px] text-[#69716D] uppercase tracking-wide">Qty</span>
                                  <div className="flex items-center gap-1">
                                    <button type="button" onClick={() => updateItem(i, { quantity: Math.max(1, it.quantity - 1) })}
                                      className="h-6 w-6 rounded-[10px] border border-[#DDD8CF] text-[#4E5954] hover:bg-[#F7F4ED] text-[13px] font-medium flex items-center justify-center">−</button>
                                    <input type="text" inputMode="decimal" min="1"
                                      className="w-10 text-center border border-[#DDD8CF] rounded-[10px] text-[12px] py-0.5 font-mono"
                                      value={it.quantity}
                                      onChange={(e) => {
                                        const next = Math.max(1, Number(e.target.value) || 1);
                                        const cap = Number(it.available_stock) || 0;
                                        if (cap > 0 && next > cap) {
                                          showStockAlert(it.name, `Only ${cap} in stock.`);
                                          updateItem(i, { quantity: cap });
                                          return;
                                        }
                                        updateItem(i, { quantity: next });
                                      }} />
                                    <button type="button" onClick={() => {
                                        const cap = Number(it.available_stock) || 0;
                                        if (cap > 0 && it.quantity + 1 > cap) {
                                          showStockAlert(it.name, `Only ${cap} in stock, and you already have ${it.quantity} of it on this bill.`);
                                          return;
                                        }
                                        updateItem(i, { quantity: it.quantity + 1 });
                                      }}
                                      className="h-6 w-6 rounded-[10px] border border-[#DDD8CF] text-[#4E5954] hover:bg-[#F7F4ED] text-[13px] font-medium flex items-center justify-center">+</button>
                                  </div>
                                </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
            </div>
          </div>
          )}
          </>
          )}

          {/* Bottom Action Bar — matches mockup */}
          <div className="pos-redesign-surface flex-shrink-0 border-t border-[#DDD8CF] bg-[#FFFDF9] px-3 flex items-center gap-2 shadow-[0_-1px_4px_rgba(54,45,31,0.04)]" style={{ height: 58 }}>
            <ActionPill onClick={holdBill} icon={<Save size={14} strokeWidth={1.5} />} shortcut="F7">
              Hold Bill
            </ActionPill>
            <div className="relative">
              <ActionPill onClick={() => setRecallOpen((v) => !v)} icon={<Clock size={14} strokeWidth={1.5} />} shortcut="F8">
                Recall Bill
                {heldBills.length > 0 && (
                  <span className="ml-0.5 text-[12px] font-bold" style={{ color: FOREST }}>{heldBills.length}</span>
                )}
              </ActionPill>
              {recallOpen && (
                <div className="absolute bottom-full left-0 mb-1 bg-white border border-[#DDD8CF] rounded-xl shadow-lg z-30 min-w-[180px]">
                  {heldBills.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-[#8B8F88]">No held bills</div>
                  ) : heldBills.map((b) => (
                    <button key={b.id} type="button" onClick={() => recallBill(b)}
                      className="w-full text-left px-3 py-2 hover:bg-[#F7F4ED] border-b border-[#F3F4F6] last:border-0 text-[12px]">
                      <div className="font-medium text-[#0A0A0A]">Bill {b.heldAt}</div>
                      <div className="text-[10.5px] text-[#69716D]">{b.cart.length} items</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ActionPill onClick={() => setPendingSalesOpen(true)} icon={<Hourglass size={14} strokeWidth={1.5} />}>
              Pending Sales
            </ActionPill>
            <button
              type="button"
              onClick={clearAll}
              className="flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-[10px] border border-[#E7D1CE] bg-[#FCF8F7] text-[12.5px] font-medium hover:bg-[#F8EEEC] transition-colors"
              style={{ color: DANGER }}
            >
              <Trash2 size={14} strokeWidth={1.5} /> Clear All
            </button>
          </div>
        </div>

        {/* ─── RIGHT PANEL ─────────────────────────────────────────────────── */}
        <div className="pos-redesign-surface flex-shrink-0 flex flex-col overflow-hidden bg-[#FFFDF9] border-l border-[#DDD8CF] shadow-[-4px_0_12px_rgba(54,45,31,0.05)]" style={{ width: 360 }}>

          {/* Tabs */}
          <div className="pos-redesign-surface flex-shrink-0 border-b border-[#DDD8CF] bg-[#F7F3EA] flex">
            {[
              { key: "summary", label: "BILL SUMMARY" },
              { key: "payment", label: "PAYMENT" },
              { key: "history", label: "HISTORY" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-3 text-[10.5px] font-semibold uppercase tracking-[0.07em] transition-colors border-b-2 ${
                  activeTab === tab.key
                    ? "bg-[#FFFDF9] text-[#245B4B]"
                    : "border-transparent text-[#69716D] hover:text-[#245B4B]"
                }`}
                style={activeTab === tab.key ? { borderBottomColor: FOREST, borderBottomWidth: 2 } : {}}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">

            {/* ── BILL SUMMARY TAB ────────────────────────────────────────── */}
            {activeTab === "summary" && posMode === "pure_metal" && (
              <PureMetalBillSummary
                metalLabel={pmMetal === "24k" ? "24K Gold" : "Pure Silver"}
                rate={pmRate}
                weight={pmWeight}
                gross={toMoneyNumber((Number(pmWeight) || 0) * parseMoneyInput(pmRate))}
                discountAmt={discountAmt}
                otherCharges={parseMoneyInput(pmOtherCharges)}
                taxable={afterDiscount}
                cgst={cgstAmt}
                sgst={sgstAmt}
                gstHalfPct={(effectiveGstPct / 2).toFixed(1)}
                grand={grand}
                onProceed={() => { goToPayment(); }}
                canProceed={cart.length > 0}
                testId="pm-bill-summary"
              />
            )}

            {activeTab === "summary" && posMode === "jewellery" && (
              <div className="p-4 space-y-0">
                {loadedQuotation?.price_locked && (
                  <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                        Booked · prices locked
                      </span>
                      <span className="font-mono text-[11px] text-amber-800">{loadedQuotation.quote_no}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 text-[12px]">
                      <span className="text-amber-800/80">Bill total</span>
                      <span className="text-right font-mono font-semibold">{fmtINR(grand)}</span>
                      <span className="text-amber-800/80">Advance paid</span>
                      <span className="text-right font-mono font-semibold">{fmtINR(loadedQuotation.advance_paid || 0)}</span>
                      {oldGoldValue > 0 && (
                        <>
                          <span className="text-amber-800/80">Old Gold Exchange</span>
                          <span className="text-right font-mono font-semibold">-{fmtINR(oldGoldValue)}</span>
                        </>
                      )}
                      {oldSilverValue > 0 && (
                        <>
                          <span className="text-amber-800/80">Old Silver Exchange</span>
                          <span className="text-right font-mono font-semibold">-{fmtINR(oldSilverValue)}</span>
                        </>
                      )}
                      <span className="text-amber-800/80">Collect now</span>
                      <span className="text-right font-mono font-semibold">
                        {fmtINR(Math.max(0, grand - oldGoldValue - oldSilverValue - (Number(loadedQuotation.advance_paid) || 0)))}
                      </span>
                      {loadedQuotation.valid_until && (
                        <>
                          <span className="text-amber-800/80">Deadline</span>
                          <span className="text-right font-mono">{loadedQuotation.valid_until}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {/* Breakdown rows */}
                <div className="pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#77766F]">Charge breakdown</div>
                <div className="space-y-2 pb-3 border-b border-[#DDD8CF]">
                  <SummaryRow label={metalValueLabel} value={fmtINR(totalGoldValue)} />
                  <SummaryRow label="Wastage" value={fmtINR(totalWastage)} />
                  <SummaryRow label="Making Charges" value={fmtINR(totalMaking)} />
                  <SummaryRow label="Stone Value" value={fmtINR(totalStone)} />
                  <SummaryRow label="Other Charges" value={fmtINR(0)} />
                  <div className="pt-1 border-t border-dashed border-[#DDD8CF]" />
                  <SummaryRow label="Sub Total" value={fmtINR(subtotal)} bold />
                </div>

                {/* Discount + Old Gold + Scheme */}
                <div className="pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#77766F]">Discounts & exchange</div>
                <div className="space-y-2 pb-3 border-b border-[#DDD8CF]">
                  {/* Discount */}
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#4E5954]">Discount</span>
                    <span className="text-[12.5px] font-medium tabular-nums" style={{ color: discountAmt > 0 ? "#16a34a" : "#0A0A0A" }}>
                      {discountAmt > 0 ? `- ${fmtINR(discountAmt)}` : fmtINR(0)}
                    </span>
                  </div>
                  {discountEditOpen && (
                    <div className="bg-[#F1F6F3] border border-[#CBDDD5] rounded-[10px] p-2 flex items-center gap-2">
                      <button onClick={() => setDiscountType("flat")}
                        className={`px-2 py-1 rounded-[10px] text-[11px] ${discountType === "flat" ? "text-white" : "text-[#69716D] border border-[#DDD8CF]"}`}
                        style={discountType === "flat" ? { background: FOREST } : {}}>₹</button>
                      <button onClick={() => setDiscountType("pct")}
                        className={`px-2 py-1 rounded-[10px] text-[11px] ${discountType === "pct" ? "text-white" : "text-[#69716D] border border-[#DDD8CF]"}`}
                        style={discountType === "pct" ? { background: FOREST } : {}}>%</button>
                      {discountType === "flat" ? (
                        <MoneyInput
                          ref={discountInputRef}
                          className="flex-1 border border-[#DDD8CF] rounded-[10px] px-2 py-1 text-[12px] font-mono outline-none focus:border-[#245B4B]"
                          value={discount}
                          onValueChange={(raw) => setDiscount(raw)}
                        />
                      ) : (
                        <input
                          ref={discountInputRef}
                          type="text"
                          inputMode="decimal"
                          className="flex-1 border border-[#DDD8CF] rounded-[10px] px-2 py-1 text-[12px] font-mono outline-none focus:border-[#245B4B]"
                          value={discount}
                          onChange={(e) => setDiscount(e.target.value)}
                        />
                      )}
                      <button onClick={() => setDiscountEditOpen(false)}
                        className="text-[12px] text-[#69716D] hover:text-[#245B4B]"><X size={12} strokeWidth={1.5} /></button>
                    </div>
                  )}

                  {/* Old Gold Exchange — a PAYMENT method (settles the invoice), not a deduction */}
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] text-[#4E5954]">Old Gold Exchange</span>
                        <button onClick={() => setOldGold((g) => ({ ...g, active: !g.active }))}
                          className="h-5 w-5 rounded-[10px] flex items-center justify-center text-[#69716D] hover:text-[#245B4B] border border-[#DDD8CF] hover:border-[#245B4B] transition-colors">
                          <Plus size={9} strokeWidth={1.5} />
                        </button>
                      </div>
                      <span className="text-[12.5px] font-medium tabular-nums" style={{ color: oldGoldValue > 0 ? "#B45309" : "#0A0A0A" }}>
                        {fmtINR(oldGoldValue)}{oldGoldValue > 0 ? " (payment)" : ""}
                      </span>
                    </div>
                    {oldGold.active && (
                      <div className="mt-1.5 bg-[#FBF7ED] border border-[#E4D3AC] rounded-[10px] p-2 space-y-1.5">
                        <div className="flex gap-1.5">
                          <div className="flex-1">
                            <label className="text-[12px] text-amber-700 mb-0.5 block">Weight (g)</label>
                            <WeightInput placeholder="0.000" className="input !py-1 !text-[12px] font-mono w-full"
                              value={oldGold.weight} onValueChange={(raw) => setOldGold((g) => ({ ...g, weight: raw }))} />
                          </div>
                          <div className="flex-1">
                            <label className="text-[12px] text-amber-700 mb-0.5 block">Purity</label>
                            <input type="text" list="old-gold-purity-options" placeholder="e.g. 18.5K"
                              className="input !py-1 !text-[12px] w-full"
                              value={oldGold.purity} onChange={(e) => setOldGold((g) => ({ ...g, purity: e.target.value }))} />
                            <datalist id="old-gold-purity-options">
                              {OLD_GOLD_PURITY_SUGGESTIONS.map((k) => <option key={k} value={k} />)}
                            </datalist>
                          </div>
                          <div className="flex-1">
                            <label className="text-[12px] text-amber-700 mb-0.5 block">
                              {oldMetalManual.gold ? "Amount (₹)" : "Rate/g"}
                            </label>
                            <MoneyInput placeholder={oldMetalManual.gold ? "0.00" : goldRate} className="input !py-1 !text-[12px] font-mono w-full"
                              value={oldGold.rate} onValueChange={(raw) => setOldGold((g) => ({ ...g, rate: raw }))} />
                          </div>
                        </div>
                        {oldGoldValue > 0 && (
                          <div className="flex justify-between text-[11.5px] font-semibold text-amber-700">
                            <span>Exchange Value (paid toward invoice)</span><span>{fmtINR(oldGoldValue)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Old Silver Exchange — a PAYMENT method (settles the invoice), not a deduction */}
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] text-[#4E5954]">Old Silver Exchange</span>
                        <button onClick={() => setOldSilver((g) => ({ ...g, active: !g.active }))}
                          className="h-5 w-5 rounded-[10px] flex items-center justify-center text-[#69716D] hover:text-[#245B4B] border border-[#DDD8CF] hover:border-[#245B4B] transition-colors">
                          <Plus size={9} strokeWidth={1.5} />
                        </button>
                      </div>
                      <span className="text-[12.5px] font-medium tabular-nums" style={{ color: oldSilverValue > 0 ? "#334155" : "#0A0A0A" }}>
                        {fmtINR(oldSilverValue)}{oldSilverValue > 0 ? " (payment)" : ""}
                      </span>
                    </div>
                    {oldSilver.active && (
                      <div className="mt-1.5 bg-[#F4F3EE] border border-[#D8D5CB] rounded-[10px] p-2 space-y-1.5">
                        <div className="flex gap-1.5">
                          <div className="flex-1">
                            <label className="text-[12px] text-[#69716D] mb-0.5 block">Weight (g)</label>
                            <WeightInput placeholder="0.000" className="input !py-1 !text-[12px] font-mono w-full"
                              value={oldSilver.weight} onValueChange={(raw) => setOldSilver((g) => ({ ...g, weight: raw }))} />
                          </div>
                          <div className="flex-1">
                            <label className="text-[12px] text-[#69716D] mb-0.5 block">Purity</label>
                            <input type="text" list="old-silver-purity-options" placeholder="e.g. 925"
                              className="input !py-1 !text-[12px] w-full"
                              value={oldSilver.purity} onChange={(e) => setOldSilver((g) => ({ ...g, purity: e.target.value }))} />
                            <datalist id="old-silver-purity-options">
                              {OLD_SILVER_PURITY_SUGGESTIONS.map((k) => <option key={k} value={k} />)}
                            </datalist>
                          </div>
                          <div className="flex-1">
                            <label className="text-[12px] text-[#69716D] mb-0.5 block">
                              {oldMetalManual.silver ? "Amount (₹)" : "Rate/g"}
                            </label>
                            <MoneyInput placeholder={oldMetalManual.silver ? "0.00" : silverRate} className="input !py-1 !text-[12px] font-mono w-full"
                              value={oldSilver.rate} onValueChange={(raw) => setOldSilver((g) => ({ ...g, rate: raw }))} />
                          </div>
                        </div>
                        {oldSilverValue > 0 && (
                          <div className="flex justify-between text-[11.5px] font-semibold text-[#4E5954]">
                            <span>Exchange Value (paid toward invoice)</span><span>{fmtINR(oldSilverValue)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Scheme credit — show saved gold grams, not plan name */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[12px] text-[#4E5954] truncate">
                        {appliedScheme
                          ? (appliedSchemeGrams > 0
                            ? `Saved gold · ${appliedSchemeGrams.toFixed(3)}g`
                            : "Scheme credit")
                          : "Scheme"}
                      </span>
                      {customerSchemes.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSchemePanelOpen(true)}
                          className="h-5 w-5 rounded-[10px] flex items-center justify-center text-[#69716D] hover:text-[#245B4B] border border-[#DDD8CF] hover:border-[#245B4B] transition-colors shrink-0"
                          title="Select scheme"
                        >
                          <Plus size={9} strokeWidth={1.5} />
                        </button>
                      )}
                      {appliedScheme && (
                        <button
                          type="button"
                          onClick={clearScheme}
                          className="h-5 w-5 rounded-[10px] flex items-center justify-center text-[#8B8F88] hover:text-red-500 shrink-0"
                          title="Remove scheme"
                        >
                          <X size={9} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                    <span className="text-[12.5px] font-medium tabular-nums shrink-0" style={{ color: schemeCreditAmt > 0 ? "#16a34a" : "#0A0A0A" }}>
                      {schemeCreditAmt > 0 ? `- ${fmtINR(schemeCreditAmt)}` : fmtINR(0)}
                    </span>
                  </div>

                  {/* Customer advance — only when they actually have unspent advance */}
                  {advanceBalance > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] text-[#4E5954]">Available advance</span>
                      <button
                        type="button"
                        disabled={!selectedCustomer || advanceApplying || balance <= 0}
                        onClick={async () => {
                          if (!selectedCustomer?.id) return;
                          const applyAmt = Math.min(advanceBalance, Math.max(0, balance));
                          if (!(applyAmt > 0)) return;
                          setAdvanceApplying(true);
                          try {
                            setPayments((prev) => {
                              const rest = prev.filter((p) => p.mode !== "advance");
                              return [...rest, { mode: "advance", amount: applyAmt, description: "Customer advance" }];
                            });
                            toast.success(`Advance ${fmtINR(applyAmt)} added to payments`);
                          } finally {
                            setAdvanceApplying(false);
                          }
                        }}
                        className="h-5 w-5 rounded-[10px] flex items-center justify-center text-[#69716D] border border-[#DDD8CF] disabled:opacity-40 hover:border-[#245B4B]"
                        title="Apply available advance to this bill (payment)"
                      >
                        <Plus size={9} strokeWidth={1.5} />
                      </button>
                    </div>
                    <span className="text-[12.5px] font-medium tabular-nums text-[#0A0A0A]">{fmtINR(advanceBalance)}</span>
                  </div>
                  )}
                </div>

                {/* Tax breakdown */}
                <div className="pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#77766F]">Tax breakdown</div>
                <div className="space-y-2 pb-3 border-b border-[#DDD8CF]">
                  <SummaryRow label="Taxable Amount" value={fmtINR(afterDiscount)} />
                  <SummaryRow label={`CGST (${(effectiveGstPct / 2).toFixed(1)}%)`} value={fmtINR(cgstAmt)} />
                  <SummaryRow label={`SGST (${(effectiveGstPct / 2).toFixed(1)}%)`} value={fmtINR(sgstAmt)} />
                  {Number(roundOff) !== 0 && (
                    <SummaryRow
                      label="Round Off"
                      value={`${roundOff > 0 ? "+ " : "− "}${fmtINR(Math.abs(roundOff))}`}
                    />
                  )}
                </div>

                {/* Grand Total */}
                <div className="pt-3 border-b border-[#DDD8CF] pb-3">
                  {grandEditOpen ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); applyGrandOverride(); }}
                      className="w-full max-w-full overflow-hidden rounded-xl border px-2.5 py-2"
                      style={{ borderColor: FOREST, background: "#EEF4F0" }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[11px] font-bold text-[#0A0A0A]">GRAND TOTAL</span>
                        <span className="text-[9.5px] text-[#69716D]">Diff → discount</span>
                      </div>
                      <div className="flex items-stretch gap-1.5 w-full min-w-0">
                        <label className="flex-1 min-w-0 flex items-center gap-1.5 rounded-[10px] border border-[#CBDDD5] bg-white px-2 h-8 overflow-hidden">
                          <span className="text-[14px] font-bold text-[#245B4B] shrink-0 leading-none">₹</span>
                          <MoneyInput
                            autoFocus
                            className="min-w-0 flex-1 w-full text-right text-[14px] font-bold font-mono outline-none bg-transparent tabular-nums leading-none"
                            style={{ color: FOREST_HOVER, caretColor: FOREST }}
                            value={grandInput}
                            onValueChange={(raw) => setGrandInput(raw)}
                            onKeyDown={(e) => e.key === "Escape" && setGrandEditOpen(false)}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setGrandEditOpen(false)}
                          className="h-8 px-2 rounded-[10px] text-[10px] font-medium border border-[#DDD8CF] text-[#69716D] hover:text-[#245B4B] bg-white shrink-0"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="h-8 px-2.5 rounded-[10px] text-[10px] font-semibold text-white shrink-0"
                          style={{ background: FOREST }}
                        >
                          Apply
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-[#0A0A0A]">GRAND TOTAL</span>
                        {cart.length > 0 && !loadedQuotation?.price_locked && (
                          <button
                            type="button"
                            onClick={() => { setGrandEditOpen(true); setGrandInput(String(grand)); }}
                            className="px-2 py-0.5 rounded-[10px] text-[10px] font-semibold border transition-colors"
                            style={{ borderColor: "#DDD8CF", color: "#69716D" }}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      <span className="text-[22px] font-bold tabular-nums" style={{ color: FOREST }}>{fmtINR(grand)}</span>
                    </div>
                  )}
                </div>

                {/* Proceed to Payment button */}
                <div className="pt-3">
                  <button
                    data-testid={T.posCheckout}
                    data-enter-submit="true"
                    onClick={() => { goToPayment(); }}
                    disabled={cart.length === 0}
                    className="w-full min-h-[56px] py-3.5 rounded-xl text-[15px] font-semibold text-white flex items-center justify-center gap-2.5 transition-opacity disabled:opacity-50 shadow-[0_2px_6px_rgba(27,73,60,0.17)]"
                    style={{ background: FOREST }}
                    onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = FOREST_HOVER; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = FOREST; }}
                  >
                    Proceed to Payment
                    <span className="inline-flex items-center justify-center min-w-[36px] h-7 px-1.5 rounded-[10px] bg-white/20 border border-white/35 text-[12px] font-bold tracking-wide">
                      F12
                    </span>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </div>

                {/* Tip — matches mockup (no F5–F10 grid under button) */}
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#E7DCC7] bg-[#FAF7F0] px-3 py-2.5">
                  <Lightbulb size={14} className="mt-0.5 flex-shrink-0" style={{ color: GOLD }} strokeWidth={1.75} />
                  <p className="text-[11.5px] text-[#686D68] leading-snug">
                    Scan tag to add item to the bill.
                  </p>
                </div>
              </div>
            )}

            {/* ── PAYMENT TAB ─────────────────────────────────────────────── */}
            {activeTab === "payment" && (
              <div className="p-4 space-y-3">
                {/* Grand Total reminder */}
                <div className="flex items-center justify-between bg-[#F7F4ED] rounded-xl px-3 py-2 border border-[#DDD8CF]">
                  <span className="text-[12px] text-[#69716D]">Grand Total</span>
                  <span className="text-[16px] font-bold tabular-nums" style={{ color: "#245B4B" }}>{fmtINR(grand)}</span>
                </div>

                {loadedQuotation?.price_locked && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                        Booked · {loadedQuotation.quote_no}
                      </span>
                      {loadedQuotation.valid_until && (
                        <span className="font-mono text-[11px] text-amber-800">by {loadedQuotation.valid_until}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px]">
                      <span className="text-amber-800/80">Bill total</span>
                      <span className="text-right font-mono font-semibold text-amber-950">{fmtINR(grand)}</span>
                      <span className="text-amber-800/80">Advance already paid</span>
                      <span className="text-right font-mono font-semibold text-amber-950">{fmtINR(loadedQuotation.advance_paid || 0)}</span>
                      {oldGoldValue > 0 && (
                        <>
                          <span className="text-amber-800/80">Old Gold Exchange</span>
                          <span className="text-right font-mono font-semibold text-amber-950">-{fmtINR(oldGoldValue)}</span>
                        </>
                      )}
                      {oldSilverValue > 0 && (
                        <>
                          <span className="text-amber-800/80">Old Silver Exchange</span>
                          <span className="text-right font-mono font-semibold text-amber-950">-{fmtINR(oldSilverValue)}</span>
                        </>
                      )}
                      <span className="text-amber-800/80">Collect now</span>
                      <span className="text-right font-mono font-semibold text-amber-950">
                        {fmtINR(Math.max(0, grand - oldGoldValue - oldSilverValue - (Number(loadedQuotation.advance_paid) || 0)))}
                      </span>
                    </div>
                    <p className="text-[10.5px] text-amber-800/90 pt-0.5">
                      Advance is applied automatically. Collect only the remaining balance.
                    </p>
                  </div>
                )}

                {/* Old gold exceeds invoice total — checkout is blocked until adjusted */}
                {oldGold.active && oldGoldValue > 0 && oldGoldValue > grand + 0.5 && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <span className="text-[#A24D4D] text-[13px] font-semibold mt-0.5">⚠</span>
                    <div>
                      <p className="text-[12px] font-semibold text-[#8F4141]">Old Gold Exchange Exceeds Invoice Total</p>
                      <p className="text-[11px] text-red-700">
                        Old gold value ({fmtINR(oldGoldValue)}) is more than the invoice total ({fmtINR(grand)}). Checkout is blocked — reduce the old gold weight/rate, or use the buyback/refund flow for the excess.
                      </p>
                    </div>
                  </div>
                )}
                {oldSilver.active && oldSilverValue > 0 && oldSilverValue > grand + 0.5 && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <span className="text-[#A24D4D] text-[13px] font-semibold mt-0.5">⚠</span>
                    <div>
                      <p className="text-[12px] font-semibold text-[#8F4141]">Old Silver Exchange Exceeds Invoice Total</p>
                      <p className="text-[11px] text-red-700">
                        Old silver value ({fmtINR(oldSilverValue)}) is more than the invoice total ({fmtINR(grand)}). Checkout is blocked — reduce the old silver weight/rate, or use the buyback/refund flow for the excess.
                      </p>
                    </div>
                  </div>
                )}
                {oldGoldValue > 0 && oldSilverValue > 0 && oldGoldValue + oldSilverValue > grand + 0.5 && oldGoldValue <= grand + 0.5 && oldSilverValue <= grand + 0.5 && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <span className="text-[#A24D4D] text-[13px] font-semibold mt-0.5">⚠</span>
                    <div>
                      <p className="text-[12px] font-semibold text-[#8F4141]">Exchange Exceeds Invoice Total</p>
                      <p className="text-[11px] text-red-700">
                        Old gold + old silver ({fmtINR(oldGoldValue + oldSilverValue)}) is more than the invoice total ({fmtINR(grand)}). Checkout is blocked until both together fit the bill.
                      </p>
                    </div>
                  </div>
                )}

                {/* Old Gold Exchange — settled first, shown as a payment (not editable here) */}
                {oldGoldPaymentEntry && (
                  <div className="rounded-xl border border-[#E4D3AC] bg-[#FBF7ED] px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-amber-800">Old Gold Exchange</span>
                      <span className="text-[13px] font-bold tabular-nums text-amber-800">{fmtINR(oldGoldPaymentEntry.amount)}</span>
                    </div>
                    <div className="text-[11px] text-amber-700 font-mono mt-0.5">
                      {Number(oldGoldPaymentEntry.old_gold.weight).toFixed(3)} g | {oldGoldPaymentEntry.old_gold.purity}{exchangeSnapShowsRate(oldGoldPaymentEntry) && <> | {fmtINR(oldGoldPaymentEntry.old_gold.rate, { decimals: 0 })}/g</>}
                    </div>
                  </div>
                )}
                {oldSilverPaymentEntry && (
                  <div className="rounded-xl border border-[#D8D5CB] bg-[#F4F3EE] px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-[#25332E]">Old Silver Exchange</span>
                      <span className="text-[13px] font-bold tabular-nums text-[#25332E]">{fmtINR(oldSilverPaymentEntry.amount)}</span>
                    </div>
                    <div className="text-[11px] text-[#4E5954] font-mono mt-0.5">
                      {Number(oldSilverPaymentEntry.old_silver.weight).toFixed(3)} g | {oldSilverPaymentEntry.old_silver.purity}{exchangeSnapShowsRate(oldSilverPaymentEntry) && <> | {fmtINR(oldSilverPaymentEntry.old_silver.rate, { decimals: 0 })}/g</>}
                    </div>
                  </div>
                )}

                <div className="pt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#77766F]">Payment details</div>

                {/* Quick payment mode buttons */}
                {payments.length === 1 && (
                  <div className="flex gap-1">
                    {cashierPaymentModes(paymentModes).slice(0, 4).map((mode) => (
                      <button key={mode} onClick={() => { setPayments([{ mode, amount: remainingAfterExchange, description: "" }]); setPaymentNoteOpen([]); }}
                        className={`flex-1 py-1.5 rounded-[10px] text-[11px] font-medium border transition-colors
                          ${payments[0].mode === mode && Number(payments[0].amount) === remainingAfterExchange
                            ? "text-white border-[#245B4B]"
                            : "border-[#DDD8CF] text-[#4E5954] hover:border-[#245B4B] hover:bg-[#E9F0EC]"}`}
                        style={payments[0].mode === mode && Number(payments[0].amount) === remainingAfterExchange ? { background: FOREST } : {}}>
                        {mode === "bank_transfer" ? "Bank" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </button>
                    ))}
                  </div>
                )}

                {/* Payment rows (cash / UPI / card / bank / cheque — Old Gold Exchange shown above) */}
                <div className="space-y-1.5">
                  {payments.map((p, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <select className="input !py-1 !text-[12px] flex-1"
                          value={p.mode} onChange={(e) => setPayments((prev) => prev.map((x, idx) => idx === i ? { ...x, mode: e.target.value } : x))}>
                          {cashierPaymentModes(paymentModes).map((mode) => (
                            <option key={mode} value={mode}>
                              {mode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                            </option>
                          ))}
                          <option value="advance">Advance</option>
                        </select>
                        <MoneyInput placeholder="Amount"
                          className="input !py-1 !text-[12.5px] font-mono flex-1"
                          value={p.amount}
                          onValueChange={(raw) => updatePaymentAmount(i, raw)} />
                        {p.mode === "cash" && (
                          <button title="Add note" onClick={() => togglePaymentNote(i)}
                            className={`flex-shrink-0 text-[11px] px-1.5 py-1 rounded-[10px] border transition-colors ${paymentNoteOpen[i] ? "bg-[#245B4B] text-white border-[#245B4B]" : "border-[#DDD8CF] text-[#69716D] hover:border-[#245B4B]"}`}>
                            ✎
                          </button>
                        )}
                        {payments.length > 1 && (
                          <button onClick={() => removePayment(i)} className="text-[#8B8F88] hover:text-red-500">
                            <X size={13} strokeWidth={1.5} />
                          </button>
                        )}
                      </div>
                      {(p.mode !== "cash" || paymentNoteOpen[i]) && (
                        <input className="input !py-1 !text-[12px] w-full"
                          placeholder={
                            p.mode === "upi" ? "UPI Ref / Transaction ID"
                              : p.mode === "card" ? "Card ending XXXX"
                              : p.mode === "bank_transfer" ? "Bank / UTR reference"
                              : p.mode === "cheque" ? "Cheque No."
                              : "Note (optional)"
                          }
                          value={p.description || ""}
                          onChange={(e) => updatePaymentDescription(i, e.target.value)} />
                      )}
                    </div>
                  ))}
                  <button onClick={addPayment} className="text-[11.5px] font-medium text-[#245B4B] hover:text-[#1B493C] flex items-center gap-1">
                    <Plus size={11} strokeWidth={1.5} /> Split payment
                  </button>
                </div>

                <div className="pt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#77766F]">Cash reconciliation</div>

                {/* Cash denominations */}
                <div>
                  <button onClick={() => setShowDenoms((p) => !p)}
                    className="text-[11px] text-[#69716D] hover:text-[#245B4B] flex items-center gap-1">
                    <Calculator size={11} strokeWidth={1.5} /> Cash denominations
                  </button>
                  {showDenoms && (
                    <div className="mt-2 bg-[#F7F4ED] border border-[#DDD8CF] rounded-[10px] p-2">
                      <div className="grid grid-cols-2 gap-1">
                        {CASH_DENOMS.map((d) => (
                          <div key={d} className="flex items-center gap-1.5">
                            <span className="text-[11.5px] text-[#4E5954] w-14 text-right">{fmtINR(d, { decimals: 0 })}</span>
                            <span className="text-[11px] text-[#8B8F88]">×</span>
                            <input type="text" inputMode="decimal" min="0" className="input !py-0.5 !text-[12px] font-mono w-12"
                              value={denomCounts[d] || ""}
                              onChange={(e) => setDenomCounts((p) => ({ ...p, [d]: e.target.value }))} />
                            <span className="text-[11px] text-[#0A0A0A] tabular-nums">= {fmtINR(d * (Number(denomCounts[d]) || 0))}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-1.5 pt-1.5 border-t border-[#DDD8CF] flex justify-between text-[12px] font-semibold text-[#0A0A0A]">
                        <span>Total Cash</span>
                        <button onClick={() => setPayments([{ mode: "cash", amount: denomTotal }])} className="hover:text-[#1B493C]" style={{ color: "#245B4B" }}>
                          {fmtINR(denomTotal)} → Use
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Balance + Change */}
                <div className="space-y-1">
                  <div className={`flex justify-between text-[12.5px] font-medium ${Math.abs(balance) < 0.5 ? "text-[#245B4B]" : "text-[#A24D4D]"}`}>
                    <span>{balance > 0.5 ? "Balance Due" : balance < -0.5 ? "Overpaid" : "✓ Settled"}</span>
                    <span className="font-mono tabular-nums">{fmtINR(Math.abs(balance))}</span>
                  </div>
                  {balance > 0.5 && creditSaleAllowed && (
                    <p className="text-[11px] text-amber-800 leading-snug">
                      Remaining will be saved as outstanding on {selectedCustomer.name}.
                    </p>
                  )}
                  {balance > 0.5 && !selectedCustomer?.id && !hiddenBillMode && (
                    <p className="text-[11px] text-red-700 leading-snug">
                      Select a customer to leave a balance, or settle in full.
                    </p>
                  )}
                  {balance > 0.5 && hiddenBillMode && (
                    <p className="text-[11px] text-red-700 leading-snug">
                      Hidden bills must be fully paid.
                    </p>
                  )}
                  {payments.some((p) => p.mode === "cash") && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#69716D]">Cash received</span>
                      <MoneyInput placeholder={grand}
                        className="input !py-0.5 !text-[12px] font-mono flex-1"
                        value={cashGiven} onValueChange={(raw) => setCashGiven(raw)} />
                      {cashGiven && <span className="text-[12px] font-semibold text-[#245B4B] tabular-nums">Change: {fmtINR(changeAmt)}</span>}
                    </div>
                  )}
                </div>

                {/* Settle full shortcut */}
                <button onClick={settleFull} className="w-full py-1.5 rounded-[10px] text-[11.5px] border border-[#DDD8CF] text-[#4E5954] hover:border-[#245B4B] hover:text-[#245B4B] transition-colors">
                  Settle Full (Cash)
                </button>

                <div className="pt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#77766F]">Compliance & bill options</div>

                {/* Show Detailed Stone Bill */}
                <label className="flex items-center gap-2 text-[12.5px] text-[#0A0A0A] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-[#D4D4D4]"
                    checked={detailedStoneBill}
                    onChange={(e) => setDetailedStoneBill(e.target.checked)}
                  />
                  Show Detailed Stone Bill
                </label>

                {/* PAN for large purchases */}
                <div>
                  {grand > 200000 && (
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-[#A24D4D] uppercase tracking-wide">
                        PAN Card <span className="text-red-500">*</span> Required (₹2L+)
                      </span>
                      {panNumber.trim() && (
                        <span className="text-[10.5px] text-[#245B4B] font-medium">✓ Filled</span>
                      )}
                    </div>
                  )}
                  <input
                    className={`input !py-1.5 !text-[12.5px] w-full font-mono tracking-wider${
                      grand > 200000 && !panNumber.trim()
                        ? " !border-red-400 !ring-1 !ring-red-300"
                        : ""
                    }`}
                    placeholder={grand > 200000 ? "PAN Card No. (mandatory)" : "PAN Card No. (optional, required if >₹2L)"}
                    maxLength={10}
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                  />
                </div>

                {/* Aadhaar — mandatory above ₹50,000, when enabled in Settings → Company Profile */}
                <div className="mt-2">
                  {aadhaarMandatoryAbove50k && grand > 50000 && (
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-[#A24D4D] uppercase tracking-wide">
                        Aadhaar <span className="text-red-500">*</span> Required (₹50K+)
                      </span>
                      {aadhaarNumber.trim() && (
                        <span className="text-[10.5px] text-[#245B4B] font-medium">✓ Filled</span>
                      )}
                    </div>
                  )}
                  <input
                    type="text"
                    inputMode="numeric"
                    className={`input !py-1.5 !text-[12.5px] w-full font-mono tracking-wider${
                      aadhaarMandatoryAbove50k && grand > 50000 && !aadhaarNumber.trim()
                        ? " !border-red-400 !ring-1 !ring-red-300"
                        : ""
                    }`}
                    placeholder={
                      aadhaarMandatoryAbove50k
                        ? (grand > 50000 ? "Aadhaar No. (mandatory)" : "Aadhaar No. (optional, required if >₹50K)")
                        : "Aadhaar No. (optional)"
                    }
                    maxLength={12}
                    value={aadhaarNumber}
                    onChange={(e) => setAadhaarNumber(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  />
                </div>

                {/* Persistent checkout error */}
                {testMode && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-950 leading-snug">
                    TEST / PRE-ACCOUNTS bill — will not affect Live Accounts or GL.
                  </div>
                )}
                {checkoutError && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-[#8F4141]">
                    <span className="mt-0.5 shrink-0 text-red-500">✕</span>
                    <span className="flex-1 leading-snug">{checkoutError}</span>
                    <button
                      onClick={() => setCheckoutError(null)}
                      className="shrink-0 text-red-400 hover:text-red-700 text-[14px] leading-none ml-1"
                      title="Dismiss"
                    >×</button>
                  </div>
                )}

                {/* Checkout button */}
                <button
                  data-testid={T.posCheckout}
                  data-enter-submit="true"
                  onClick={checkout}
                  disabled={busy || !rateLoaded || cart.length === 0 || balance < -0.5 || (balance > 0.5 && !creditSaleAllowed) || !connStatus.ok || !connStatus.billingAllowed}
                  className="w-full py-3 rounded-xl text-[14px] font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 shadow-[0_2px_6px_rgba(27,73,60,0.17)]"
                  style={{ background: (!connStatus.ok || !connStatus.billingAllowed) ? "#9CA3AF" : (hiddenBillMode ? "#0A0A0A" : "#245B4B") }}
                  onMouseEnter={(e) => {
                    if (e.currentTarget.disabled) return;
                    e.currentTarget.style.background = hiddenBillMode ? "#262626" : "#1B493C";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = (!connStatus.ok || !connStatus.billingAllowed) ? "#9CA3AF" : (hiddenBillMode ? "#0A0A0A" : "#245B4B");
                  }}
                >
                  {busy
                    ? "Processing…"
                    : (!connStatus.ok || !connStatus.billingAllowed)
                      ? "Billing paused — shop service not ready"
                      : hiddenBillMode
                        ? <><CheckCircle2 size={15} strokeWidth={1.5} /> Complete Hidden Bill</>
                        : balance > 0.5 && creditSaleAllowed
                          ? <><CheckCircle2 size={15} strokeWidth={1.5} /> Save Outstanding &amp; Checkout</>
                          : <><CheckCircle2 size={15} strokeWidth={1.5} /> Complete Payment &amp; Checkout</>}
                </button>
              </div>
            )}

            {/* ── HISTORY TAB ─────────────────────────────────────────────── */}
            {activeTab === "history" && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] text-[#69716D] uppercase tracking-wide">
                    {includeHiddenInHistory ? "Hidden invoices" : "Recent Invoices"}
                  </div>
                  {hiddenAccessUnlocked && (
                    includeHiddenInHistory ? (
                      <button
                        type="button"
                        onClick={() => setIncludeHiddenInHistory(false)}
                        className="flex items-center gap-1 rounded-full bg-[#245B4B]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#245B4B] hover:bg-[#245B4B]/25"
                        title="Back to normal POS bills"
                      >
                        <EyeOff size={12} strokeWidth={1.5} />
                        Hide hidden bills
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIncludeHiddenInHistory(true)}
                        className="flex items-center gap-1 text-[10.5px] font-medium text-[#8B8F88] hover:text-[#245B4B]"
                        title="Show hidden bills only"
                      >
                        <Eye size={12} strokeWidth={1.5} />
                        Show hidden bills
                      </button>
                    )
                  )}
                </div>

                <div className="space-y-2 mb-3">
                  <div className="relative">
                    <Search size={13} strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8B8F88]" />
                    <input
                      type="text"
                      className="input !py-1.5 !pl-8 !text-[12px] w-full"
                      placeholder="Invoice no. / phone / name / Aadhaar / PAN"
                      value={historySearchInput}
                      onChange={(e) => setHistorySearchInput(e.target.value)}
                    />
                    {historySearchInput && (
                      <button
                        type="button"
                        onClick={() => setHistorySearchInput("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8B8F88] hover:text-red-500"
                      >
                        <X size={12} strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      className="input !py-1.5 !text-[11.5px] flex-1"
                      value={historyFrom}
                      max={historyTo || undefined}
                      onChange={(e) => setHistoryFrom(e.target.value)}
                      title="From date"
                    />
                    <span className="text-[11px] text-[#8B8F88]">to</span>
                    <input
                      type="date"
                      className="input !py-1.5 !text-[11.5px] flex-1"
                      value={historyTo}
                      min={historyFrom || undefined}
                      onChange={(e) => setHistoryTo(e.target.value)}
                      title="To date"
                    />
                    {(historyFrom || historyTo) && (
                      <button
                        type="button"
                        onClick={() => { setHistoryFrom(""); setHistoryTo(""); }}
                        className="text-[11px] text-[#69716D] hover:text-red-500 flex-shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {historyLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-12 shimmer rounded-[10px]" />
                    ))}
                  </div>
                ) : visibleHistoryInvoices.length === 0 ? (
                  <div className="text-center text-[13px] text-[#8B8F88] py-8">
                    {includeHiddenInHistory ? "No hidden bills found" : "No invoices found"}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {visibleHistoryInvoices.map((inv) => (
                      <div key={inv.id || inv.invoice_no} className="border border-[#DDD8CF] rounded-xl bg-[#FFFDF9] px-3 py-2 shadow-[0_1px_2px_rgba(54,45,31,0.03)] hover:border-[#245B4B] transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-semibold text-[#0A0A0A] font-mono inline-flex items-center gap-1.5 min-w-0">
                            {inv.invoice_no}
                            {isPreAccountsInvoice(inv) && <TestBadge />}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[12px] font-semibold tabular-nums" style={{ color: "#245B4B" }}>{fmtINR(inv.grand_total)}</span>
                            <button
                              type="button"
                              title="View Invoice"
                              onClick={() => openInvoiceView(inv.id)}
                              className="h-6 w-6 rounded-[10px] flex items-center justify-center text-[#77766F] hover:text-[#245B4B] hover:bg-[#FAF7F0] transition-colors"
                            >
                              <Eye size={14} strokeWidth={1.5} />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[11px] text-[#69716D]">{inv.customer_name || "Walk-in"}</span>
                          <span className="text-[10.5px] text-[#8B8F88]">
                            {invoiceOccurredAt(inv)
                              ? invoiceOccurredAt(inv).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                              : "—"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          STATUS BAR
      ══════════════════════════════════════════════════════════════════════ */}

      {/* New customer — left drawer */}
      <DuplicateCustomerDialog
        info={dupCustomer}
        viewing={dupViewing}
        creating={newCustSaving}
        onClose={() => setDupCustomer(null)}
        onViewCustomer={useExistingCustomer}
        onCreateAnyway={
          dupCustomer?.code === "DUPLICATE_MOBILE"
            ? () => { setDupCustomer(null); saveNewCustomer(null, { force: true }); }
            : undefined
        }
      />

      {newCustOpen && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="absolute inset-0 bg-black/35" />
          <aside
            className="relative h-full w-full max-w-[380px] bg-[#FFFDF9] shadow-lg border-r border-[#DDD8CF] flex flex-col animate-in slide-in-from-left duration-200"
            style={{ animation: "posCustSlide 180ms ease-out" }}
          >
            <style>{`@keyframes posCustSlide { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#DDD8CF] bg-[#F7F3EA] flex-shrink-0">
              <div>
                <div className="text-[14px] font-semibold text-[#0A0A0A]">New Customer</div>
                <div className="text-[11px] text-[#77766F]">Saved to list and selected for this bill</div>
              </div>
              <button
                type="button"
                disabled={newCustSaving}
                onClick={() => setNewCustOpen(false)}
                className="h-8 w-8 rounded-[10px] border border-[#DDD8CF] flex items-center justify-center text-[#77766F] hover:border-[#245B4B] hover:text-[#245B4B]"
              >
                <X size={15} strokeWidth={1.5} />
              </button>
            </div>
            <form onSubmit={saveNewCustomer} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#69716D]">Name <span style={{ color: GOLD }}>*</span></span>
                <input
                  autoFocus
                  required
                  className="mt-1 w-full border border-[#DDD8CF] rounded-[10px] bg-[#FFFDF9] px-2.5 py-2 text-[13px] outline-none focus:border-[#245B4B]"
                  value={newCustForm.name}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Customer name"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#69716D]">Mobile <span style={{ color: GOLD }}>*</span></span>
                <input
                  required
                  className="mt-1 w-full border border-[#DDD8CF] rounded-[10px] bg-[#FFFDF9] px-2.5 py-2 text-[13px] font-mono outline-none focus:border-[#245B4B]"
                  value={newCustForm.mobile}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, mobile: e.target.value }))}
                  placeholder="10-digit mobile"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#69716D]">Email</span>
                <input
                  type="email"
                  className="mt-1 w-full border border-[#DDD8CF] rounded-[10px] bg-[#FFFDF9] px-2.5 py-2 text-[13px] outline-none focus:border-[#245B4B]"
                  value={newCustForm.email}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="optional"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#69716D]">Address</span>
                <textarea
                  rows={3}
                  className="mt-1 w-full border border-[#DDD8CF] rounded-[10px] bg-[#FFFDF9] px-2.5 py-2 text-[13px] resize-none outline-none focus:border-[#245B4B]"
                  value={newCustForm.address}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Full address"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#69716D]">PAN Number</span>
                <input
                  className="mt-1 w-full border border-[#DDD8CF] rounded-[10px] bg-[#FFFDF9] px-2.5 py-2 text-[13px] font-mono uppercase outline-none focus:border-[#245B4B]"
                  value={newCustForm.pan_number}
                  maxLength={10}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, pan_number: e.target.value.toUpperCase() }))}
                  placeholder="ABCDE1234F"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#69716D]">Aadhaar Number</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-1 w-full border border-[#DDD8CF] rounded-[10px] bg-[#FFFDF9] px-2.5 py-2 text-[13px] font-mono outline-none focus:border-[#245B4B]"
                  value={newCustForm.aadhaar_number}
                  maxLength={12}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, aadhaar_number: e.target.value.replace(/\D/g, "").slice(0, 12) }))}
                  placeholder="123456789012"
                />
              </label>

              {/* PAN card image */}
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#69716D]">PAN Card Image</span>
                <input
                  ref={panGalleryRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPanImagePicked}
                />
                <input
                  ref={panCameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onPanImagePicked}
                />
                <button
                  type="button"
                  onClick={() => setPanSourceOpen(true)}
                  className="mt-1 w-full relative rounded-xl border border-dashed border-[#D6D0C6] bg-[#FAF7F0] hover:border-[#245B4B] transition-colors overflow-hidden"
                  style={{ minHeight: 140 }}
                >
                  {newCustForm.pan_image ? (
                    <>
                      <img src={newCustForm.pan_image} alt="PAN card" className="w-full h-40 object-cover" />
                      <span className="absolute bottom-2 left-2 right-2 text-[11px] text-white bg-black/55 rounded px-2 py-1 text-center">
                        Tap to change photo
                      </span>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-[#77766F]">
                      <Camera size={22} strokeWidth={1.5} style={{ color: GOLD }} />
                      <div className="text-[12.5px] font-medium text-[#25332E]">Add PAN card photo</div>
                      <div className="text-[11px]">Camera or gallery</div>
                    </div>
                  )}
                </button>
                {newCustForm.pan_image && (
                  <button
                    type="button"
                    className="mt-1.5 text-[11.5px] text-[#A24D4D] hover:underline"
                    onClick={() => setNewCustForm((f) => ({ ...f, pan_image: "" }))}
                  >
                    Remove image
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#69716D]">Date of Birth</span>
                  <input
                    type="date"
                    className="mt-1 w-full border border-[#DDD8CF] rounded-[10px] bg-[#FFFDF9] px-2.5 py-2 text-[13px] outline-none focus:border-[#245B4B]"
                    value={newCustForm.dob}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setNewCustForm((f) => ({ ...f, dob: e.target.value }))}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#69716D]">Anniversary</span>
                  <input
                    type="date"
                    className="mt-1 w-full border border-[#DDD8CF] rounded-[10px] bg-[#FFFDF9] px-2.5 py-2 text-[13px] outline-none focus:border-[#245B4B]"
                    value={newCustForm.anniversary}
                    onChange={(e) => setNewCustForm((f) => ({ ...f, anniversary: e.target.value }))}
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#69716D]">Tag</span>
                <select
                  className="mt-1 w-full border border-[#DDD8CF] rounded-[10px] bg-[#FFFDF9] px-2.5 py-2 text-[13px] outline-none focus:border-[#245B4B]"
                  value={newCustForm.tag}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, tag: e.target.value }))}
                >
                  <option value="regular">Regular</option>
                  <option value="vip">VIP</option>
                  <option value="wholesale">Wholesale</option>
                </select>
              </label>
            </form>
            <div className="flex-shrink-0 flex gap-2 px-4 py-3 border-t border-[#DDD8CF] bg-[#FAF7F0]">
              <button
                type="button"
                disabled={newCustSaving}
                onClick={() => { setPanSourceOpen(false); setNewCustOpen(false); }}
                className="flex-1 py-2 rounded-[10px] border border-[#DDD8CF] text-[13px] text-[#4E5954] hover:border-[#245B4B]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={newCustSaving}
                onClick={saveNewCustomer}
                className="flex-1 py-2 rounded-[10px] text-[13px] font-semibold text-white disabled:opacity-60 shadow-[0_2px_5px_rgba(27,73,60,0.15)]"
                style={{ background: FOREST }}
              >
                {newCustSaving ? "Saving…" : "Save Customer"}
              </button>
            </div>
          </aside>

          {/* Camera / Gallery chooser */}
          {panSourceOpen && (
            <div className="absolute inset-0 z-[70] flex items-end sm:items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40" onClick={() => setPanSourceOpen(false)} />
              <div className="relative w-full max-w-sm bg-white rounded-xl shadow-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-[#DDD8CF]">
                  <div className="text-[14px] font-semibold text-[#0A0A0A]">Add PAN card image</div>
                  <div className="text-[11.5px] text-[#77766F]">Choose camera or gallery</div>
                </div>
                <div className="p-3 space-y-2">
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-[#DDD8CF] hover:border-[#245B4B] hover:bg-[#E9F0EC] text-left"
                    onClick={() => panCameraRef.current?.click()}
                  >
                    <span className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "#FAF7F0" }}>
                      <Camera size={16} style={{ color: GOLD }} strokeWidth={1.6} />
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium text-[#0A0A0A]">Camera</span>
                      <span className="block text-[11px] text-[#77766F]">Take a new photo</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-[#DDD8CF] hover:border-[#245B4B] hover:bg-[#E9F0EC] text-left"
                    onClick={() => panGalleryRef.current?.click()}
                  >
                    <span className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "#FAF7F0" }}>
                      <ImageIcon size={16} style={{ color: GOLD }} strokeWidth={1.6} />
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium text-[#0A0A0A]">Gallery</span>
                      <span className="block text-[11px] text-[#77766F]">Pick from photos</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="w-full py-2.5 text-[13px] text-[#69716D] hover:text-[#245B4B]"
                    onClick={() => setPanSourceOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status bar */}
      <footer
        className="pos-redesign-surface flex-shrink-0 border-t px-5 flex items-center justify-between text-[11.5px]"
        style={{
          height: 34,
          background: hiddenBillMode ? HIDDEN_UNLOCK_BG : POS_PAPER,
          borderColor: hiddenBillMode ? HIDDEN_UNLOCK_EDGE : "#E3DCCD",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background:
                authorityStateVal === AUTHORITY_STATES.ISOLATED ? "#D14343"
                : authorityStateVal === AUTHORITY_STATES.LAN_COORDINATED ? "#F59E0B"
                : connStatus.ok && connStatus.billingAllowed ? "#22A06B"
                : "#D14343"
            }}
          />
          <span className={
            authorityStateVal === AUTHORITY_STATES.ISOLATED || (!connStatus.ok || !connStatus.billingAllowed)
              ? "text-[#A24D4D] font-medium"
              : authorityStateVal === AUTHORITY_STATES.LAN_COORDINATED
                ? "text-amber-700 font-medium"
                : "text-[#25332E] font-medium"
          }>
            {authorityStateVal === AUTHORITY_STATES.ISOLATED && !connStatus.ok
              ? "Starting shop service…"
              : authorityStateVal === AUTHORITY_STATES.LAN_COORDINATED
                ? "Following host on LAN"
                : !connStatus.ok
                  ? "Shop service offline — billing paused"
                  : !connStatus.billingAllowed
                    ? "Not the active host — billing paused"
                    : "Local shop ready"}
          </span>
        </div>
        <div className="text-[#77766F]">
          Terminal: <span className="font-semibold text-[#25332E]">T01</span>
        </div>
        <div className="text-[#77766F] font-medium">
          SLGT
        </div>
      </footer>

      {staleDayModal}

      <ConfirmDialog
        open={modeSwitchConfirm != null}
        title="Switch POS mode?"
        message="Switching POS mode will clear the current bill. Continue?"
        confirmLabel="Switch mode"
        danger
        onCancel={() => setModeSwitchConfirm(null)}
        onConfirm={() => {
          const mode = modeSwitchConfirm;
          setModeSwitchConfirm(null);
          if (mode) applyPosModeSwitch(mode);
        }}
      />

      <StockAlertDialog
        open={stockAlert.open}
        title={stockAlert.title}
        message={stockAlert.message}
        onClose={() => setStockAlert((s) => ({ ...s, open: false }))}
      />

      {/* Invoice success modal */}
      {lastInvoice && <InvoiceSuccess invoice={lastInvoice} onClose={() => setLastInvoice(null)} company={company} />}

      {/* View invoice modal (read-only, from History tab) */}
      {viewInvoiceOpen && (
        <InvoiceViewModal
          invoice={viewInvoiceData}
          loading={viewInvoiceLoading}
          onClose={() => { setViewInvoiceOpen(false); setViewInvoiceData(null); }}
          company={company}
        />
      )}

      {/* Pending Sales modal */}
      {pendingSalesOpen && <PendingSales onClose={() => setPendingSalesOpen(false)} />}

      {/* Stone details modal */}
      {stoneModalIndex != null && cart[stoneModalIndex] && (
        <StoneDetailsModal
          item={cart[stoneModalIndex]}
          onClose={() => setStoneModalIndex(null)}
          onChangePrice={(stoneIdx, amount) => updateStonePrice(stoneModalIndex, stoneIdx, amount)}
        />
      )}

      {/* Booked ornament warning — another customer's estimation holds this tag */}
      {bookedBlock && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="booked-ornament-title"
            className="w-full max-w-md rounded-xl bg-white shadow-lg border border-[#DDD8CF] overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-amber-200 bg-amber-50 flex items-start justify-between gap-3">
              <div>
                <h2 id="booked-ornament-title" className="text-[15px] font-semibold text-amber-950">
                  Ornament is booked
                </h2>
                <p className="text-[12.5px] text-amber-800 mt-1">
                  This tag cannot be sold to someone else until the booking is billed or cancelled.
                </p>
              </div>
              <button
                type="button"
                className="h-8 w-8 rounded-[10px] border border-amber-200 flex items-center justify-center text-amber-800 hover:bg-amber-100"
                onClick={() => setBookedBlock(null)}
              >
                <X size={15} strokeWidth={1.5} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-2.5 text-[13px]">
              <div className="flex justify-between gap-3">
                <span className="text-[#69716D]">Tag</span>
                <span className="font-mono font-semibold text-[#0A0A0A]">
                  {bookedBlock.barcode || bookedBlock._product?.barcode || "—"}
                </span>
              </div>
              {(bookedBlock.product_name || bookedBlock._product?.name) && (
                <div className="flex justify-between gap-3">
                  <span className="text-[#69716D]">Item</span>
                  <span className="text-right font-medium text-[#0A0A0A]">
                    {bookedBlock.product_name || bookedBlock._product?.name}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-[#69716D]">Booked for</span>
                <span className="text-right font-semibold text-[#0A0A0A]">
                  {bookedBlock.customer_name || "Customer"}
                  {bookedBlock.customer_mobile ? (
                    <span className="block text-[11.5px] font-mono font-normal text-[#69716D]">
                      {bookedBlock.customer_mobile}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[#69716D]">Estimation</span>
                <span className="font-mono font-semibold text-[#0A0A0A]">{bookedBlock.quote_no}</span>
              </div>
              {Number(bookedBlock.advance_paid) > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-[#69716D]">Advance paid</span>
                  <span className="font-mono font-semibold text-amber-900">
                    {fmtINR(bookedBlock.advance_paid)}
                  </span>
                </div>
              )}
              {bookedBlock.valid_until && (
                <div className="flex justify-between gap-3">
                  <span className="text-[#69716D]">Hold until</span>
                  <span className="font-mono text-[#0A0A0A]">{bookedBlock.valid_until}</span>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-[#DDD8CF] flex flex-col sm:flex-row gap-2 justify-end">
              <button
                type="button"
                className="btn-secondary !rounded-[10px] border-[#DDD8CF]"
                onClick={() => setBookedBlock(null)}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="btn-primary !rounded-[10px] !bg-[#245B4B] hover:!bg-[#1B493C]"
                onClick={async () => {
                  const quoteNo = bookedBlock.quote_no;
                  setBookedBlock(null);
                  if (quoteNo) await loadEstimation(quoteNo);
                }}
              >
                Open estimation {bookedBlock.quote_no}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <HiddenBillPasswordDialog
        open={hiddenPwOpen}
        busy={hiddenPwBusy}
        error={hiddenPwError}
        onClose={() => {
          if (hiddenPwBusy) return;
          setHiddenPwOpen(false);
          setHiddenPwError("");
        }}
        onSubmit={async (pin) => {
          setHiddenPwBusy(true);
          setHiddenPwError("");
          try {
            await api.post("/settings/verify-hidden-bill-password", { password: pin });
            setHiddenBillMode(true);
            setHiddenAccessUnlocked(true);
            setHiddenPwOpen(false);
            setHiddenPwError("");
            toast.success("Hidden Bill unlocked — new POS bills stay hidden until you Lock");
          } catch (err) {
            const msg = formatApiError(err) || "Incorrect password";
            setHiddenPwError(msg);
            toast.error(msg === "Incorrect password" || msg.includes("Incorrect")
              ? "Wrong PIN — try again"
              : msg);
          } finally {
            setHiddenPwBusy(false);
          }
        }}
      />

    </div>
  );
}

function RateCard({ label, value, onClick }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex flex-col items-center justify-center px-6 border-r border-[#34594D] last:border-r-0 ${
        onClick ? "cursor-pointer hover:bg-[#21483C] transition-colors" : ""
      }`}
      style={{ minWidth: 110 }}
    >
      <div className="text-[9.5px] font-bold uppercase tracking-widest text-[#C6A65F] leading-none mb-1">{label}</div>
      <div className="text-[14px] font-bold tabular-nums leading-none text-[#FFFDF9]">{value}</div>
      <div className="text-[8.5px] text-[#AFC0B9] uppercase tracking-wider mt-0.5">per gram</div>
    </Comp>
  );
}

function ActionPill({ children, onClick, icon, shortcut }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-[10px] border border-[#DDD8CF] bg-[#FFFDF9] text-[12.5px] font-medium text-[#4E5954] shadow-[0_1px_2px_rgba(54,45,31,0.03)] hover:border-[#245B4B] hover:bg-[#E9F0EC] hover:text-[#245B4B] transition-colors"
    >
      {icon}
      <span className="flex items-center gap-1.5">
        {children}
        {shortcut && (
          <span
            className="inline-flex items-center justify-center min-w-[28px] h-5 px-1 rounded-[6px] border text-[10.5px] font-bold tracking-wide"
            style={{ borderColor: "#C7D9D1", background: "#E9F0EC", color: FOREST }}
          >
            {shortcut}
          </span>
        )}
      </span>
    </button>
  );
}

function SummaryRow({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-[12px] ${bold ? "font-semibold text-[#0A0A0A]" : "text-[#4E5954]"}`}>{label}</span>
      <span className={`tabular-nums font-mono text-[12.5px] ${bold ? "font-semibold text-[#0A0A0A]" : "font-medium text-[#0A0A0A]"}`}>{value}</span>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-[#4E5954]">{label}</span>
      <span className="text-[12.5px] font-medium text-[#0A0A0A] tabular-nums">{value}</span>
    </div>
  );
}

function InvoiceSuccess({ invoice, onClose, company }) {
  const [previewHtml, setPreviewHtml] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [whatsapping, setWhatsapping] = useState(false);

  const openPreview = async () => {
    const html = await generateInvoicePrintHTMLAsync(invoice, company, "print");
    setPreviewHtml(html);
  };

  const confirmPrint = async () => {
    setPrinting(true);
    try {
      await printHtml(previewHtml);
      setPreviewHtml(null);
    } catch {
      /* printHtml already showed success/error toast */
    } finally {
      setPrinting(false);
    }
  };
  const download = async () => {
    try {
      await downloadInvoicePdf(invoice, company, null, { useInvoiceDownloadFolder: true });
    } catch {
      /* downloadInvoicePdf already showed a toast */
    }
  };
  const shareWhatsApp = async () => {
    setWhatsapping(true);
    try {
      const result = await sendPosInvoiceOnWhatsApp(invoice, company);
      if (!result.ok) toast.error(result.error);
      else toast.success("PDF saved — attach it in the WhatsApp chat");
    } catch (err) {
      toast.error(err?.message || "Could not open WhatsApp");
    } finally {
      setWhatsapping(false);
    }
  };
  return (
    <>
      {previewHtml && (
        <PrintPreviewModal
          html={previewHtml}
          onPrint={confirmPrint}
          onClose={() => setPreviewHtml(null)}
          printing={printing}
        />
      )}
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose?.();
        }}
      >
        <div className="bg-[#FFFDF9] rounded-xl shadow-lg border border-[#DDD8CF] w-full max-w-md">
          <div className="p-5 text-center border-b border-[#DDD8CF]">
            <div className="h-12 w-12 rounded-xl bg-[#E9F0EC] flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={24} className="text-[#245B4B]" strokeWidth={1.5} />
            </div>
            <div className="text-[16px] font-semibold text-[#0A0A0A]">
              {isPreAccountsInvoice(invoice) ? "Test Invoice Created" : "Invoice Created"}
            </div>
            <div className="text-[13px] text-[#69716D] mt-1 font-mono">{invoice.invoice_no}</div>
            {isPreAccountsInvoice(invoice) && (
              <div className="mt-2">
                <TestBadge />
                <div className="text-[11px] text-amber-800 mt-1">Does not affect Live Accounts or GL.</div>
              </div>
            )}
          </div>
          <div className="p-5 space-y-2">
            <div className="flex justify-between text-[13px]">
              <span className="text-[#69716D]">Customer</span>
              <span className="font-medium text-[#25332E]">{invoice.customer_name}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-[#69716D]">Items</span>
              <span className="font-medium text-[#0A0A0A]">{invoice.items?.length}</span>
            </div>
            <div className="flex justify-between text-[15px] font-semibold">
              <span className="text-[#25332E]">Amount Paid</span>
              <span className="text-[#245B4B]">{fmtINR(invoice.grand_total)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 p-4 border-t border-[#DDD8CF]">
            <button type="button" onClick={openPreview} className="btn-secondary !rounded-[10px] border-[#DDD8CF] flex items-center justify-center gap-2">
              <Printer size={14} strokeWidth={1.5} /> Print
            </button>
            <button type="button" onClick={download} className="btn-secondary !rounded-[10px] border-[#DDD8CF] flex items-center justify-center gap-2">
              <Download size={14} strokeWidth={1.5} /> Download
            </button>
            <button
              type="button"
              onClick={shareWhatsApp}
              disabled={whatsapping}
              className="btn-secondary !rounded-[10px] border-[#DDD8CF] flex items-center justify-center gap-2"
            >
              <MessageCircle size={14} strokeWidth={1.5} /> {whatsapping ? "Opening…" : "WhatsApp"}
            </button>
            <button type="button" onClick={onClose} className="btn-primary !rounded-[10px] !bg-[#245B4B] hover:!bg-[#1B493C]">New Bill</button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Read-only invoice detail viewer, opened from POS History tab. */
function InvoiceViewModal({ invoice, loading, onClose, company }) {
  const [previewHtml, setPreviewHtml] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [whatsapping, setWhatsapping] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [refundStepOpen, setRefundStepOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const collectedAmount = Math.max(0, (Number(invoice?.grand_total) || 0) - (Number(invoice?.balance_due) || 0));
  // Old gold / silver taken in exchange goes back to the customer as metal on
  // cancel, not as cash — shown as fixed rows in the refund step (the server
  // computes the same split authoritatively).
  const oldMetalRefundRows = useMemo(() => {
    const sums = { old_gold_exchange: 0, old_silver_exchange: 0 };
    for (const p of asArray(invoice?.payments)) {
      const m = String(p?.mode || "").toLowerCase();
      const amt = Number(p?.amount) || 0;
      if (!(amt > 0)) continue;
      if (m === "old_gold_exchange" || m === "old_gold" || m === "exchange") sums.old_gold_exchange += amt;
      else if (m === "old_silver_exchange" || m === "old_silver") sums.old_silver_exchange += amt;
    }
    let left = collectedAmount;
    return Object.entries(sums).map(([mode, amt]) => {
      const amount = Math.round(Math.min(amt, left) * 100) / 100;
      left -= amount;
      return { mode, amount };
    }).filter((r) => r.amount > 0);
  }, [invoice?.payments, collectedAmount]);

  const proceedToCancel = () => {
    setCancelConfirmOpen(false);
    if (collectedAmount > 0.5) {
      setRefundStepOpen(true);
    } else {
      cancelInvoice([]);
    }
  };

  const cancelInvoice = async (refund) => {
    setCancelling(true);
    try {
      await api.post(`/invoices/${invoice.id}/cancel`, { reason: "POS cancel", refund });
      toast.success(isPreAccountsInvoice(invoice) ? "Test invoice cancelled" : "Invoice cancelled — stock restored");
      // Force inventory screens to refetch (WS may be slow)
      window.dispatchEvent(new CustomEvent("inventory:changed"));
      setCancelConfirmOpen(false);
      setRefundStepOpen(false);
      onClose();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setCancelling(false);
    }
  };

  const openPreview = async () => {
    if (!invoice) return;
    const html = await generateInvoicePrintHTMLAsync(invoice, company, "print");
    setPreviewHtml(html);
  };

  const confirmPrint = async () => {
    setPrinting(true);
    try {
      await printHtml(previewHtml);
      setPreviewHtml(null);
    } catch {
      /* printHtml already showed success/error toast */
    } finally {
      setPrinting(false);
    }
  };
  const download = async () => {
    if (!invoice) return;
    try {
      await downloadInvoicePdf(invoice, company, null, { useInvoiceDownloadFolder: true });
    } catch {
      /* downloadInvoicePdf already showed a toast */
    }
  };
  const shareWhatsApp = async () => {
    if (!invoice) return;
    setWhatsapping(true);
    try {
      const result = await sendPosInvoiceOnWhatsApp(invoice, company);
      if (!result.ok) toast.error(result.error);
      else toast.success("PDF saved — attach it in the WhatsApp chat");
    } catch (err) {
      toast.error(err?.message || "Could not open WhatsApp");
    } finally {
      setWhatsapping(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md max-h-[85vh] flex flex-col">
        {loading || !invoice ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3 relative">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 h-8 w-8 rounded-[10px] border border-[#DDD8CF] flex items-center justify-center text-[#77766F] hover:border-[#245B4B] hover:text-[#245B4B]"
              aria-label="Close"
            >
              <X size={15} strokeWidth={1.5} />
            </button>
            <RefreshCw size={20} className="animate-spin" style={{ color: FOREST }} strokeWidth={1.5} />
            <div className="text-[13px] text-[#69716D]">Loading invoice…</div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#DDD8CF] flex-shrink-0">
              <div>
                <div className="text-[14px] font-semibold text-[#0A0A0A] font-mono">
                  {invoice.invoice_no}
                  {isPreAccountsInvoice(invoice) && <TestBadge className="ml-2 align-middle" />}
                </div>
                <div className="text-[11px] text-[#77766F]">
                  {invoiceOccurredAt(invoice)
                    ? invoiceOccurredAt(invoice).toLocaleString("en-IN", {
                        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                      })
                    : "—"}
                  {invoice.status === "cancelled" && (
                    <span className="ml-2 text-[#A24D4D] font-semibold uppercase">
                      Cancelled{invoice.cancelled_at ? ` · ${fmtDate(invoice.cancelled_at)}` : ""}
                    </span>
                  )}
                  {(invoice.status === "returned" || invoice.status === "partially_returned") && (
                    <span className="ml-2 text-amber-700 font-semibold uppercase">
                      Returned{invoice.returned_at ? ` · ${fmtDate(invoice.returned_at)}` : ""}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-[10px] border border-[#DDD8CF] flex items-center justify-center text-[#77766F] hover:border-[#245B4B] hover:text-[#245B4B]"
              >
                <X size={15} strokeWidth={1.5} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[#69716D]">Customer</span>
                <span className="text-[12.5px] font-medium text-[#0A0A0A]">{invoice.customer_name || "Walk-in Customer"}</span>
              </div>
              {invoice.customer_mobile && (
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#69716D]">Mobile</span>
                  <span className="text-[12.5px] font-medium text-[#0A0A0A] font-mono">{invoice.customer_mobile}</span>
                </div>
              )}

              <div className="border-t border-[#DDD8CF] pt-3 space-y-2">
                {(invoice.items || []).map((it, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="text-[12px] text-[#0A0A0A]">
                      {lineDescription(it)}
                      {(it.quantity || 1) > 1 ? ` × ${it.quantity}` : ""}
                    </div>
                    <div className="text-[12.5px] font-mono tabular-nums text-[#0A0A0A]">{fmtINR(it.line_total)}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-[#DDD8CF] pt-3 space-y-1.5">
                <SummaryRow label="Subtotal" value={fmtINR(invoice.subtotal)} />
                {Number(invoice.discount) > 0 && <SummaryRow label="Discount" value={`− ${fmtINR(invoice.discount)}`} />}
                {/* Legacy invoices (created before Old Gold became a payment) subtracted it
                    from grand total directly — keep showing that deduction so the numbers
                    below still reconcile with the stored grand_total. New invoices carry
                    Old Gold as a payment row instead (rendered further down). */}
                {!hasOldGoldPayment(invoice) && Number(invoice.old_gold_value) > 0 && (
                  <SummaryRow label="Old Gold Exchange" value={`− ${fmtINR(invoice.old_gold_value)}`} />
                )}
                {!hasOldSilverPayment(invoice) && Number(invoice.old_silver_value) > 0 && (
                  <SummaryRow label="Old Silver Exchange" value={`− ${fmtINR(invoice.old_silver_value)}`} />
                )}
                <SummaryRow label="CGST" value={fmtINR(invoice.cgst_amount)} />
                <SummaryRow label="SGST" value={fmtINR(invoice.sgst_amount)} />
                {Number(invoice.round_off) !== 0 && (
                  <SummaryRow
                    label="Round Off"
                    value={`${Number(invoice.round_off) > 0 ? "+ " : "− "}${fmtINR(Math.abs(Number(invoice.round_off)))}`}
                  />
                )}
              </div>

              {/* Unlike Old Gold Exchange, grand_total is stored *after* scheme credit
                  is netted off — add it back so GRAND TOTAL matches what the payment
                  rows below (including the scheme redemption row) sum to. */}
              <div className="border-t border-[#DDD8CF] pt-3 flex items-center justify-between">
                <span className="text-[13px] font-bold text-[#0A0A0A]">GRAND TOTAL</span>
                <span className="text-[16px] font-bold tabular-nums" style={{ color: FOREST }}>
                  {fmtINR(Number(invoice.grand_total) + Number(invoice.scheme_credit || 0))}
                </span>
              </div>

              {((invoice.payments || []).length > 0 || Number(invoice.scheme_credit) > 0 || Number(invoice.balance_due) > 0.5) && (
                <div className="border-t border-[#DDD8CF] pt-3 space-y-1">
                  {Number(invoice.scheme_credit) > 0 && (
                    <Row label="scheme redemption" value={fmtINR(invoice.scheme_credit)} />
                  )}
                  {(invoice.payments || []).map((p, i) => (
                    <div key={i}>
                      <Row label={p.mode?.replace(/_/g, " ")} value={fmtINR(p.amount)} />
                      {exchangePaymentSnap(p) && (
                        <div className="text-[10.5px] text-[#77766F] font-mono -mt-0.5">
                          {Number(exchangePaymentSnap(p).weight).toFixed(3)} g | {exchangePaymentSnap(p).purity}{exchangeSnapShowsRate(p) && <> | {fmtINR(exchangePaymentSnap(p).rate, { decimals: 0 })}/g</>}
                        </div>
                      )}
                    </div>
                  ))}
                  {Number(invoice.balance_due) > 0.5 && (
                    <Row label="Balance due" value={fmtINR(invoice.balance_due)} />
                  )}
                </div>
              )}
            </div>

            <div className="flex-shrink-0 p-4 border-t border-[#DDD8CF] space-y-2">
              {invoice.status !== "cancelled" && invoice.status !== "returned" && invoice.status !== "partially_returned" && invoice.id && (
                <>
                  <button
                  type="button"
                  className="w-full btn-secondary text-red-700 border-red-200 flex items-center justify-center gap-1.5"
                  onClick={() => setCancelConfirmOpen(true)}
                >
                  Cancel / Return Order
                </button>
                </>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={openPreview} className="btn-secondary !rounded-[10px] border-[#DDD8CF] flex items-center justify-center gap-1.5">
                  <Printer size={14} strokeWidth={1.5} /> Print
                </button>
                <button type="button" onClick={download} className="btn-secondary !rounded-[10px] border-[#DDD8CF] flex items-center justify-center gap-1.5">
                  <Download size={14} strokeWidth={1.5} /> Download
                </button>
                <button
                  type="button"
                  onClick={shareWhatsApp}
                  disabled={whatsapping}
                  className="btn-secondary !rounded-[10px] border-[#DDD8CF] flex items-center justify-center gap-1.5"
                >
                  <MessageCircle size={14} strokeWidth={1.5} /> {whatsapping ? "Opening…" : "WhatsApp"}
                </button>
                <button type="button" onClick={onClose} className="btn-primary !rounded-[10px] !bg-[#245B4B] hover:!bg-[#1B493C]">Close</button>
              </div>
            </div>
          </>
        )}
      </div>
      {previewHtml && (
        <PrintPreviewModal
          html={previewHtml}
          onPrint={confirmPrint}
          onClose={() => setPreviewHtml(null)}
          printing={printing}
        />
      )}
      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Cancel invoice?"
        message={`Cancel invoice ${invoice?.invoice_no}? Stock will be restored.`}
        confirmLabel="Cancel invoice"
        cancelLabel="Keep invoice"
        danger
        busy={cancelling}
        onCancel={() => setCancelConfirmOpen(false)}
        onConfirm={proceedToCancel}
      />
      <RefundEntryModal
        open={refundStepOpen}
        totalDue={collectedAmount}
        lockedRows={oldMetalRefundRows}
        busy={cancelling}
        onCancel={() => setRefundStepOpen(false)}
        onConfirm={cancelInvoice}
      />
    </div>
  );
}
