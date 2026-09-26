import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Lock, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import { fmtDateTime } from "@/lib/format";
import { SettingsSection, SettingsTabFrame } from "@/components/settings/settingsLayout";
import { APPLICATION_FEATURES, APPLICATION_FEATURE_SECTIONS } from "@/config/applicationFeatures";
import { notifyApplicationFeaturesUpdated } from "@/context/ApplicationFeatureContext";
import { notifySectionVisibilityUpdated } from "@/context/SectionVisibilityContext";
import { notifyBusinessDateChanged } from "@/context/BusinessDateContext";
import useConfirm from "@/hooks/useConfirm";
import { REPORT_CATEGORIES, reportsInCategory } from "@/pages/reports/reportCatalog";
import { ACCOUNTS_NAV_GROUPS } from "@/components/accounts/accountsShared";

function onOff(value, invert = false) {
  if (value === true || value === "true") return invert ? "OFF" : "ON";
  if (value === false || value === "false") return invert ? "ON" : "OFF";
  return "—";
}

// Category/sub-item toggle registries for the two modules that get
// finer-grained visibility control — derived from each module's own catalog
// (not duplicated) so this UI never drifts from what's actually rendered in
// Reports & Analytics / Accounts & Finance. "Hidden Data" is excluded from
// both — it has its own separate owner-unlock gate.
const SECTION_MODULES = [
  {
    module: "reports",
    title: "Reports & Analytics",
    description: "Control which report categories and individual reports are visible in Reports & Analytics.",
    categories: REPORT_CATEGORIES.filter((c) => c.id !== "hidden-data").map((c) => ({ id: c.id, label: c.label })),
    itemsFor: (catId) => reportsInCategory(catId).map((r) => ({ id: r.id, label: r.name })),
  },
  {
    module: "accounts",
    title: "Accounts & Finance",
    description: "Control which sections and sub-sections are visible in Accounts & Finance.",
    categories: ACCOUNTS_NAV_GROUPS.filter((g) => g.id !== "hidden-data").map((g) => ({ id: g.id, label: g.label })),
    itemsFor: (catId) => (ACCOUNTS_NAV_GROUPS.find((g) => g.id === catId)?.items || []).map((i) => ({ id: i.id, label: i.label })),
  },
];

/**
 * One { enabled } on/off admin setting (Profit & Loss, Cal Code): its value,
 * its audit log, and a toggle that rolls back on a failed save. Same GET/PUT
 * shape on the backend (adminFlagHandlers in controllers/settings.js).
 */
function useAdminFlag({ endpoint, entityType, label, unlocked, toastText = null }) {
  const [enabled, setEnabled] = useState(null); // null until loaded
  const [saving, setSaving] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const { data } = await api.get("/cluster/audit/events", {
        params: { entity_type: entityType, limit: 50 },
      });
      setEvents(data?.data || []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [entityType]);

  useEffect(() => {
    api.get(endpoint)
      .then(({ data }) => setEnabled(data?.enabled === true))
      .catch((err) => {
        toast.error(formatApiError(err));
        setEnabled(false);
      });
    loadEvents();
  }, [endpoint, loadEvents]);

  const toggle = async (next) => {
    if (!unlocked) return false;
    const prev = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      const { data } = await api.put(endpoint, { enabled: next });
      setEnabled(data?.enabled === true);
      toast.success(toastText ? toastText(next) : `${label} ${next ? "enabled" : "disabled"}`);
      loadEvents();
      return true;
    } catch (err) {
      setEnabled(prev);
      toast.error(formatApiError(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { enabled, saving, toggle, events, eventsLoading, loadEvents };
}

function AdminFlagSection({ flag, canWrite, unlocked, title, description, rowLabel, onText, offText }) {
  if (flag.enabled === null) return null;
  return (
    <SettingsSection title={title} description={description}>
      <div className="overflow-hidden rounded-[9px] border border-[#DCE3D6]">
        <div className="flex items-center justify-between gap-4 bg-white px-4 py-3 transition-colors hover:bg-[#F8F9F5]">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[#294236]">{rowLabel}</div>
            <div className="text-[11.5px] text-[#737373]">{flag.enabled ? onText : offText}</div>
          </div>
          <Switch
            checked={flag.enabled}
            onCheckedChange={flag.toggle}
            disabled={!canWrite || !unlocked || flag.saving}
          />
        </div>
      </div>
    </SettingsSection>
  );
}

function AdminFlagLog({ flag, title, invert = false }) {
  const { events, eventsLoading, loadEvents } = flag;
  return (
    <SettingsSection
      title={title}
      description={`Every ${title.replace(/ Log$/, "")} enable/disable change, in this shop's tamper-evident audit trail.`}
      actions={(
        <button type="button" className="btn-secondary" onClick={loadEvents}>
          <RefreshCw size={13} className={eventsLoading ? "animate-spin" : ""} /> Refresh
        </button>
      )}
    >
      {eventsLoading && !events.length ? (
        <PageLoadingBadge />
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Date/Time</th>
                <th className="table-th">User</th>
                <th className="table-th">Action</th>
                <th className="table-th">Old Value</th>
                <th className="table-th">New Value</th>
                <th className="table-th">Device</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td className="table-td text-[#737373]" colSpan={6}>No changes yet.</td></tr>
              ) : events.map((ev) => (
                <tr key={ev.id} className="table-row">
                  <td className="table-td text-[12px] text-[#737373]">{fmtDateTime(ev.created_at)}</td>
                  <td className="table-td font-mono text-[11.5px]">{ev.user_id || "—"}</td>
                  <td className="table-td capitalize">
                    {invert ? ({ enabled: "turned off", disabled: "turned on" }[ev.action] || ev.action) : ev.action}
                  </td>
                  <td className="table-td text-[#737373]">{onOff(ev.old_value, invert)}</td>
                  <td className="table-td font-medium">{onOff(ev.new_value, invert)}</td>
                  <td className="table-td font-mono text-[11px] text-[#a3a3a3]">{ev.device_id || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SettingsSection>
  );
}

/**
 * Close Day on/off. Stored inverted as auto_day_close { enabled }: Close Day
 * OFF = auto_day_close ON — every transaction uses the real date, the
 * Transaction date / Day Closing / Opening Setup screens are hidden and each
 * day closes automatically after midnight. Meant as a one-time setup choice
 * for small shops, so turning it off asks for confirmation.
 */
function CloseDaySection({ flag, canWrite, unlocked }) {
  const [confirm, confirmModal] = useConfirm();
  if (flag.enabled === null) return null;
  const closeDayOn = !flag.enabled;

  const onChange = async (nextCloseDayOn) => {
    if (!nextCloseDayOn) {
      const ok = await confirm(
        "Every bill and transaction will use the real date and time. Days will close automatically after midnight — no checklist, cash count or Opening Setup. If Opening Setup is not done yet, the shop goes live today with zero opening balances and test-mode bills are cleared.",
        { title: "Turn off Close Day?", confirmLabel: "Turn off Close Day", cancelLabel: "Cancel", danger: true },
      );
      if (!ok) return;
    }
    const saved = await flag.toggle(!nextCloseDayOn);
    if (saved) notifyBusinessDateChanged();
  };

  return (
    <SettingsSection
      title="Close Day"
      description="When ON (default), billing runs on the Transaction date and the day is closed manually from Accounts → Daily ops → Day Closing. When OFF, the real date and time are used everywhere and each day closes automatically after midnight — for small shops that do not need the Day Closing process."
    >
      <div className="overflow-hidden rounded-[9px] border border-[#DCE3D6]">
        <div className="flex items-center justify-between gap-4 bg-white px-4 py-3 transition-colors hover:bg-[#F8F9F5]">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[#294236]">Close Day Required</div>
            <div className="text-[11.5px] text-[#737373]">
              {closeDayOn
                ? "ON — Transaction date and manual Day Closing are in use."
                : "OFF — real date is used; days close automatically after midnight."}
            </div>
          </div>
          <Switch
            checked={closeDayOn}
            onCheckedChange={onChange}
            disabled={!canWrite || !unlocked || flag.saving}
          />
        </div>
      </div>
      {confirmModal}
    </SettingsSection>
  );
}

/**
 * Application Management — shop-level module licensing, separate from the
 * Permissions tab (which controls what an individual employee can do inside
 * a module that's already enabled here). Only the ERP Administrator
 * (super_admin) can see or write this tab — gated at the page level
 * (TABS entry has `superAdminOnly: true`), matching the Hidden Bill tab's
 * lock pattern but with a narrower role than "owner".
 *
 * Locks the same way the Company Profile tab does: `unlocked` starts false,
 * a click-counter on the tab button (in Settings.jsx) opens a password
 * dialog to unlock. Unlike Company Profile, it stays unlocked across any
 * number of toggles in the same session — the admin clicks "Update — Lock
 * Again" (below) when done, which is what actually re-locks it.
 */
export default function ApplicationManagementTab({ canWrite = false, unlocked = false, onLocked }) {
  const [features, setFeatures] = useState(null);
  const [saving, setSaving] = useState(null); // key currently being saved, or null
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [sections, setSections] = useState(null);
  const [sectionSaving, setSectionSaving] = useState(null); // compound key currently being saved, or null
  const [expanded, setExpanded] = useState({}); // compound category key -> bool
  const [sectionEvents, setSectionEvents] = useState([]);
  const [sectionEventsLoading, setSectionEventsLoading] = useState(true);

  const [oldMetalManual, setOldMetalManual] = useState(null); // { gold, silver }
  const [oldMetalSaving, setOldMetalSaving] = useState(null); // "gold" | "silver" | null
  const [oldMetalEvents, setOldMetalEvents] = useState([]);
  const [oldMetalEventsLoading, setOldMetalEventsLoading] = useState(true);

  const profitLoss = useAdminFlag({ endpoint: "/settings/profit-loss", entityType: "profit_loss", label: "Profit & Loss", unlocked });
  const calCode = useAdminFlag({ endpoint: "/settings/cal-code", entityType: "cal_code", label: "Cal Code", unlocked });
  const autoDayClose = useAdminFlag({
    endpoint: "/settings/auto-day-close",
    entityType: "auto_day_close",
    label: "Close Day",
    unlocked,
    toastText: (next) => (next ? "Close Day turned off — days now close automatically" : "Close Day turned on"),
  });

  const loadFeatures = async () => {
    try {
      const { data } = await api.get("/settings/application-management");
      setFeatures(data?.features || {});
    } catch (err) {
      toast.error(formatApiError(err));
      setFeatures({});
    }
  };

  const loadEvents = async () => {
    setEventsLoading(true);
    try {
      const { data } = await api.get("/cluster/audit/events", {
        params: { entity_type: "application_feature", limit: 50 },
      });
      setEvents(data?.data || []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  const loadSections = async () => {
    try {
      const { data } = await api.get("/settings/section-visibility");
      setSections(data?.sections || {});
    } catch (err) {
      toast.error(formatApiError(err));
      setSections({});
    }
  };

  const loadSectionEvents = async () => {
    setSectionEventsLoading(true);
    try {
      const { data } = await api.get("/cluster/audit/events", {
        params: { entity_type: "section_visibility", limit: 50 },
      });
      setSectionEvents(data?.data || []);
    } catch {
      setSectionEvents([]);
    } finally {
      setSectionEventsLoading(false);
    }
  };

  const loadOldMetalManual = async () => {
    try {
      const { data } = await api.get("/settings/old-metal-exchange");
      setOldMetalManual({ gold: data?.manual?.gold === true, silver: data?.manual?.silver === true });
    } catch (err) {
      toast.error(formatApiError(err));
      setOldMetalManual({ gold: false, silver: false });
    }
  };

  const loadOldMetalEvents = async () => {
    setOldMetalEventsLoading(true);
    try {
      const { data } = await api.get("/cluster/audit/events", {
        params: { entity_type: "old_metal_exchange_manual", limit: 50 },
      });
      setOldMetalEvents(data?.data || []);
    } catch {
      setOldMetalEvents([]);
    } finally {
      setOldMetalEventsLoading(false);
    }
  };

  useEffect(() => {
    loadFeatures();
    loadEvents();
    loadSections();
    loadSectionEvents();
    loadOldMetalManual();
    loadOldMetalEvents();
  }, []);

  const toggle = async (key, next) => {
    if (!unlocked) return;
    const prev = features;
    setFeatures((f) => ({ ...f, [key]: next }));
    setSaving(key);
    try {
      const { data } = await api.put("/settings/application-management", { features: { [key]: next } });
      setFeatures(data?.features || {});
      const label = APPLICATION_FEATURES.find((f) => f.key === key)?.label || key;
      toast.success(`${label} ${next ? "enabled" : "disabled"}`);
      notifyApplicationFeaturesUpdated();
      loadEvents();
    } catch (err) {
      setFeatures(prev);
      toast.error(formatApiError(err));
    } finally {
      setSaving(null);
    }
  };

  const toggleSection = async (key, next, label) => {
    if (!unlocked) return;
    const prev = sections;
    setSections((s) => ({ ...s, [key]: next }));
    setSectionSaving(key);
    try {
      const { data } = await api.put("/settings/section-visibility", { sections: { [key]: next } });
      setSections(data?.sections || {});
      toast.success(`${label} ${next ? "shown" : "hidden"}`);
      notifySectionVisibilityUpdated();
      loadSectionEvents();
    } catch (err) {
      setSections(prev);
      toast.error(formatApiError(err));
    } finally {
      setSectionSaving(null);
    }
  };

  const toggleOldMetal = async (metal, next, label) => {
    if (!unlocked) return;
    const prev = oldMetalManual;
    setOldMetalManual((m) => ({ ...m, [metal]: next }));
    setOldMetalSaving(metal);
    try {
      const { data } = await api.put("/settings/old-metal-exchange", { manual: { [metal]: next } });
      setOldMetalManual({ gold: data?.manual?.gold === true, silver: data?.manual?.silver === true });
      toast.success(`${label} manual mode ${next ? "enabled" : "disabled"}`);
      loadOldMetalEvents();
    } catch (err) {
      setOldMetalManual(prev);
      toast.error(formatApiError(err));
    } finally {
      setOldMetalSaving(null);
    }
  };

  if (!features || !sections) {
    return (
      <SettingsTabFrame>
        <PageLoadingBadge />
      </SettingsTabFrame>
    );
  }

  const enabledCount = APPLICATION_FEATURES.filter((f) => features[f.key] !== false).length;
  const disabledCount = APPLICATION_FEATURES.length - enabledCount;

  return (
    <SettingsTabFrame>
      <CloseDaySection flag={autoDayClose} canWrite={canWrite} unlocked={unlocked} />
      <SettingsSection
        title="Application Management"
        description="Control which ERP modules are available for this shop. Disabled modules are hidden from users and cannot be accessed directly. This is separate from employee permissions — a module can be fully licensed and still restricted per employee in the Permissions tab."
      >
        <div className="text-[12px] text-[#737373] mb-4">
          {enabledCount} module{enabledCount === 1 ? "" : "s"} enabled · {disabledCount} disabled
        </div>
        {canWrite && !unlocked && (
          <div className="mb-4 flex items-center gap-2 rounded-[9px] border border-[#DCE3D6] bg-[#F5F7F1] px-3 py-2 text-[12px] text-[#5F6F63]">
            <Lock size={13} className="text-[#6D7D71]" strokeWidth={1.7} />
            Locked — click this tab 5× to enter the password and make changes.
          </div>
        )}
        {canWrite && unlocked && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-[9px] border border-[#E2D2A6] bg-[#FBF7ED] px-3 py-2 text-[12px] text-[#755D25]">
            <span>Unlocked — make any changes you need, then click Update to lock again.</span>
            <button
              type="button"
              onClick={() => {
                onLocked?.();
                toast.success("Application Management locked");
              }}
              className="btn-primary !py-1.5 !px-3 text-[12px] whitespace-nowrap"
            >
              Update — Lock Again
            </button>
          </div>
        )}
        <div className="space-y-6">
          {APPLICATION_FEATURE_SECTIONS.map((section) => {
            const items = APPLICATION_FEATURES.filter((f) => f.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#a3a3a3] mb-2">
                  {section}
                </div>
                <div className="divide-y divide-[#E6E9E2] overflow-hidden rounded-[9px] border border-[#DCE3D6]">
                  {items.map((f) => {
                    const enabled = features[f.key] !== false;
                    return (
                      <div key={f.key} className="flex items-center justify-between gap-4 bg-white px-4 py-3 transition-colors hover:bg-[#F8F9F5]">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-[#294236]">{f.label}</div>
                          <div className="text-[11.5px] text-[#737373]">{f.description}</div>
                        </div>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => toggle(f.key, v)}
                          disabled={!canWrite || !unlocked || saving === f.key}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      {oldMetalManual && (
        <SettingsSection
          title="Old Gold / Old Silver Exchange"
          description="When ON, POS Billing and Estimation skip the weight × rate calculation — the cashier enters the exchange amount directly. When OFF (default), the amount is calculated automatically as weight × rate, same as today."
        >
          <div className="divide-y divide-[#E6E9E2] overflow-hidden rounded-[9px] border border-[#DCE3D6]">
            {[
              { metal: "gold", label: "Old Gold Exchange — Manual Mode" },
              { metal: "silver", label: "Old Silver Exchange — Manual Mode" },
            ].map(({ metal, label }) => (
              <div key={metal} className="flex items-center justify-between gap-4 bg-white px-4 py-3 transition-colors hover:bg-[#F8F9F5]">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#294236]">{label}</div>
                  <div className="text-[11.5px] text-[#737373]">
                    {oldMetalManual[metal] ? "Manual — amount entered directly, no calculation." : "Automatic — amount = weight × rate."}
                  </div>
                </div>
                <Switch
                  checked={oldMetalManual[metal]}
                  onCheckedChange={(v) => toggleOldMetal(metal, v, label)}
                  disabled={!canWrite || !unlocked || oldMetalSaving === metal}
                />
              </div>
            ))}
          </div>
        </SettingsSection>
      )}

      <AdminFlagSection
        flag={profitLoss}
        canWrite={canWrite}
        unlocked={unlocked}
        title="Profit & Loss"
        description="When ON, Inventory → Add Product shows a mandatory Purchase Price field (beside Purchase Date) so profit & loss valuations are exact. When OFF (default), the Purchase Price field is hidden."
        rowLabel="Profit & Loss Required"
        onText="On — Purchase Price is mandatory when creating a product."
        offText="Off — Purchase Price field is hidden in Inventory."
      />

      <AdminFlagSection
        flag={calCode}
        canWrite={canWrite}
        unlocked={unlocked}
        title="Cal Code"
        description="When ON, Inventory → Add Product shows an optional Cal Code field (beside Unit). When OFF (default), the field is hidden. To print it on tags, tick Cal code in Settings → Barcode Tag (left and/or right panel)."
        rowLabel="Cal Code Field"
        onText="On — optional Cal Code field shown in Inventory."
        offText="Off — Cal Code field is hidden in Inventory."
      />

      {SECTION_MODULES.map(({ module, title, description, categories, itemsFor }) => (
        <SettingsSection key={module} title={title} description={description}>
          <div className="space-y-2">
            {categories.map((cat) => {
              const catKey = `${module}:category:${cat.id}`;
              const catEnabled = sections[catKey] !== false;
              const isOpen = !!expanded[catKey];
              const items = itemsFor(cat.id);
              return (
                <div key={cat.id} className="overflow-hidden rounded-[9px] border border-[#DCE3D6]">
                  <div
                    className="flex cursor-pointer select-none items-center justify-between gap-4 bg-white px-4 py-3 transition-colors hover:bg-[#F8F9F5]"
                    onClick={() => setExpanded((e) => ({ ...e, [catKey]: !e[catKey] }))}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ChevronRight
                        size={14}
                        strokeWidth={1.5}
                        className={`text-[#a3a3a3] transition-transform ${isOpen ? "rotate-90" : ""}`}
                      />
                      <span className="text-[13px] font-medium text-[#294236]">{cat.label}</span>
                      <span className="text-[11px] text-[#a3a3a3]">({items.length})</span>
                    </div>
                    {/* stopPropagation on a wrapper, not the Switch itself — Switch's
                        own onClick IS its toggle handler, so overriding onClick directly
                        on it (as this used to) silently replaced that toggle with a no-op. */}
                    <span onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={catEnabled}
                        onCheckedChange={(v) => toggleSection(catKey, v, cat.label)}
                        disabled={!canWrite || !unlocked || sectionSaving === catKey}
                      />
                    </span>
                  </div>
                  {isOpen && (
                    <div className="divide-y divide-[#E6E9E2] border-t border-[#DCE3D6] bg-[#F5F7F1]">
                      {!catEnabled && (
                        <div className="pl-9 pr-4 py-2 text-[11.5px] text-[#a3a3a3] italic">
                          Category is off — sub-items are hidden regardless of their switch below. Turn the category
                          back on to control them individually.
                        </div>
                      )}
                      {items.map((item) => {
                        const itemKey = `${module}:item:${item.id}`;
                        const itemEnabled = sections[itemKey] !== false;
                        return (
                          <div key={item.id} className="flex items-center justify-between gap-4 pl-9 pr-4 py-2.5">
                            <span className={`text-[12.5px] ${catEnabled ? "text-[#294236]" : "text-[#a3a3a3]"}`}>
                              {item.label}
                            </span>
                            <Switch
                              // While the category is off, sub-items are inert — show that
                              // visually (off, dimmed) without touching their stored value,
                              // so turning the category back on restores each one exactly
                              // as it was left.
                              checked={catEnabled && itemEnabled}
                              onCheckedChange={(v) => toggleSection(itemKey, v, item.label)}
                              disabled={!canWrite || !unlocked || !catEnabled || sectionSaving === itemKey}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SettingsSection>
      ))}

      <SettingsSection
        title="Section Visibility Log"
        description="Every category/sub-item shown or hidden in Reports & Analytics and Accounts & Finance, in this shop's tamper-evident audit trail."
        actions={(
          <button type="button" className="btn-secondary" onClick={loadSectionEvents}>
            <RefreshCw size={13} className={sectionEventsLoading ? "animate-spin" : ""} /> Refresh
          </button>
        )}
      >
        {sectionEventsLoading && !sectionEvents.length ? (
          <PageLoadingBadge />
        ) : (
          <div className="table-shell overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="table-head-row">
                  <th className="table-th">Date/Time</th>
                  <th className="table-th">User</th>
                  <th className="table-th">Action</th>
                  <th className="table-th">Section</th>
                  <th className="table-th">Old Value</th>
                  <th className="table-th">New Value</th>
                  <th className="table-th">Device</th>
                </tr>
              </thead>
              <tbody>
                {sectionEvents.length === 0 ? (
                  <tr><td className="table-td text-[#737373]" colSpan={7}>No changes yet.</td></tr>
                ) : sectionEvents.map((ev) => (
                  <tr key={ev.id} className="table-row">
                    <td className="table-td text-[12px] text-[#737373]">{fmtDateTime(ev.created_at)}</td>
                    <td className="table-td font-mono text-[11.5px]">{ev.user_id || "—"}</td>
                    <td className="table-td capitalize">{ev.action}</td>
                    <td className="table-td font-mono text-[11.5px]">{ev.entity_id}</td>
                    <td className="table-td text-[#737373]">{onOff(ev.old_value)}</td>
                    <td className="table-td font-medium">{onOff(ev.new_value)}</td>
                    <td className="table-td font-mono text-[11px] text-[#a3a3a3]">{ev.device_id || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Application Management Log"
        description="Every module enable/disable change, in this shop's tamper-evident audit trail."
        actions={(
          <button type="button" className="btn-secondary" onClick={loadEvents}>
            <RefreshCw size={13} className={eventsLoading ? "animate-spin" : ""} /> Refresh
          </button>
        )}
      >
        {eventsLoading && !events.length ? (
          <PageLoadingBadge />
        ) : (
          <div className="table-shell overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="table-head-row">
                  <th className="table-th">Date/Time</th>
                  <th className="table-th">User</th>
                  <th className="table-th">Action</th>
                  <th className="table-th">Feature</th>
                  <th className="table-th">Old Value</th>
                  <th className="table-th">New Value</th>
                  <th className="table-th">Device</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr><td className="table-td text-[#737373]" colSpan={7}>No changes yet.</td></tr>
                ) : events.map((ev) => {
                  const label = APPLICATION_FEATURES.find((f) => f.key === ev.entity_id)?.label || ev.entity_id;
                  return (
                    <tr key={ev.id} className="table-row">
                      <td className="table-td text-[12px] text-[#737373]">{fmtDateTime(ev.created_at)}</td>
                      <td className="table-td font-mono text-[11.5px]">{ev.user_id || "—"}</td>
                      <td className="table-td capitalize">{ev.action}</td>
                      <td className="table-td">{label}</td>
                      <td className="table-td text-[#737373]">{onOff(ev.old_value)}</td>
                      <td className="table-td font-medium">{onOff(ev.new_value)}</td>
                      <td className="table-td font-mono text-[11px] text-[#a3a3a3]">{ev.device_id || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Old Gold / Old Silver Exchange Log"
        description="Every manual-mode enable/disable change, in this shop's tamper-evident audit trail."
        actions={(
          <button type="button" className="btn-secondary" onClick={loadOldMetalEvents}>
            <RefreshCw size={13} className={oldMetalEventsLoading ? "animate-spin" : ""} /> Refresh
          </button>
        )}
      >
        {oldMetalEventsLoading && !oldMetalEvents.length ? (
          <PageLoadingBadge />
        ) : (
          <div className="table-shell overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="table-head-row">
                  <th className="table-th">Date/Time</th>
                  <th className="table-th">User</th>
                  <th className="table-th">Action</th>
                  <th className="table-th">Metal</th>
                  <th className="table-th">Old Value</th>
                  <th className="table-th">New Value</th>
                  <th className="table-th">Device</th>
                </tr>
              </thead>
              <tbody>
                {oldMetalEvents.length === 0 ? (
                  <tr><td className="table-td text-[#737373]" colSpan={7}>No changes yet.</td></tr>
                ) : oldMetalEvents.map((ev) => (
                  <tr key={ev.id} className="table-row">
                    <td className="table-td text-[12px] text-[#737373]">{fmtDateTime(ev.created_at)}</td>
                    <td className="table-td font-mono text-[11.5px]">{ev.user_id || "—"}</td>
                    <td className="table-td capitalize">{ev.action}</td>
                    <td className="table-td capitalize">{ev.entity_id}</td>
                    <td className="table-td text-[#737373]">{onOff(ev.old_value)}</td>
                    <td className="table-td font-medium">{onOff(ev.new_value)}</td>
                    <td className="table-td font-mono text-[11px] text-[#a3a3a3]">{ev.device_id || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      <AdminFlagLog flag={profitLoss} title="Profit & Loss Log" />
      <AdminFlagLog flag={calCode} title="Cal Code Log" />
      <AdminFlagLog flag={autoDayClose} title="Close Day Log" invert />
    </SettingsTabFrame>
  );
}
