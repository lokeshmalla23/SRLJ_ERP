import { useEffect, useRef, useState, useCallback } from "react";
import { ListSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  Megaphone,
  Plus,
  X,
  ChevronRight,
  ChevronLeft,
  Send,
  Eye,
  Trash2,
  PartyPopper,
  Cake,
  Heart,
  BellRing,
  Trophy,
  Gem,
  MessageSquare,
  Users,
  Crown,
  Calendar,
  CalendarHeart,
  AlertCircle,
  CheckCircle2,
  UserX,
  Star,
  ExternalLink,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import PageHeader from "@/components/common/PageHeader";
import KpiCard from "@/components/common/KpiCard";
import EmptyState from "@/components/common/EmptyState";
import MoneyInput from "@/components/ui/MoneyInput";
import { fmtDate } from "@/lib/format";
import useConfirm from "@/hooks/useConfirm";
import { openWhatsAppChat } from "@/lib/whatsapp";

// ─── Constants ───────────────────────────────────────────────────────────────
const CAMPAIGN_TYPES = [
  { value: "festival", label: "Festival Greeting", icon: PartyPopper, desc: "Festive season messages for all occasions" },
  { value: "birthday", label: "Birthday Wishes", icon: Cake, desc: "Personalised birthday greetings for customers" },
  { value: "anniversary", label: "Anniversary Wishes", icon: Heart, desc: "Anniversary celebration messages" },
  { value: "scheme_reminder", label: "Scheme Reminder", icon: BellRing, desc: "Remind customers of pending installments" },
  { value: "scheme_maturity", label: "Scheme Maturity", icon: Trophy, desc: "Alert customers when schemes mature" },
  { value: "new_collection", label: "New Collection", icon: Gem, desc: "Announce new jewellery arrivals" },
  { value: "custom", label: "Custom Message", icon: MessageSquare, desc: "Write a fully custom message" },
];

const SEGMENTS = [
  { value: "all", label: "All Customers", icon: Users, desc: "Send to your entire customer base" },
  { value: "vip", label: "VIP Customers", icon: Crown, desc: "Customers tagged as VIP" },
  { value: "birthday_month", label: "Birthday This Month", icon: Cake, desc: "Customers celebrating birthday this month" },
  { value: "anniversary_month", label: "Anniversary This Month", icon: CalendarHeart, desc: "Customers with anniversary this month" },
  { value: "scheme_overdue", label: "Scheme Overdue", icon: AlertCircle, desc: "Customers with missed scheme installments" },
  { value: "scheme_matured", label: "Scheme Matured", icon: CheckCircle2, desc: "Customers whose scheme is fully paid" },
  { value: "inactive", label: "Inactive (6+ months)", icon: UserX, desc: "Customers who haven't purchased in 6 months" },
  { value: "high_value", label: "High Value", icon: Star, desc: "Customers above a purchase threshold" },
];

const TYPE_CHIP_CLASS = {
  festival: "chip chip-gold",
  birthday: "chip chip-gold",
  anniversary: "chip chip-gold",
  scheme_reminder: "chip chip-warning",
  scheme_maturity: "chip chip-success",
  new_collection: "chip chip-diamond",
  invoice: "chip chip-neutral",
  custom: "chip chip-neutral",
};

const STATUS_CHIP_CLASS = {
  draft: "chip chip-neutral",
  scheduled: "chip chip-diamond",
  sent: "chip chip-success",
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Promotions() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [viewCampaign, setViewCampaign] = useState(null); // { campaign, messages }
  const [confirm, confirmModal] = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/promotions/campaigns");
      setCampaigns(data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ─── KPI derivations ────────────────────────────────────────────────────────
  const totalCampaigns = campaigns.length;
  const customersReached = campaigns.reduce((s, c) => s + (c.sent_count || 0), 0);
  const uniqueSegments = new Set(campaigns.map((c) => c.segment)).size;
  const thisMonth = (() => {
    const now = new Date();
    return campaigns.filter((c) => {
      const d = new Date(c.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  })();

  const handleDelete = async (id) => {
    if (!(await confirm("Delete this draft campaign?"))) return;
    try {
      await api.delete(`/promotions/campaigns/${id}`);
      toast.success("Campaign deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const handleView = async (id) => {
    try {
      const { data } = await api.get(`/promotions/campaigns/${id}`);
      setViewCampaign(data);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const handleSendDraft = async (campaign) => {
    if (!(await confirm(`Send "${campaign.name}" to its audience now?`))) return;
    try {
      const { data } = await api.post(`/promotions/campaigns/${campaign.id}/send`);
      toast.success(`Sent to ${data.sent_count} customers`);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title="Promotions & Marketing"
        subtitle="Create WhatsApp campaigns for your customers — birthdays, festivals, scheme reminders and more."
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={14} strokeWidth={1.5} /> New Campaign
          </button>
        }
      />

      {/* KPI Bar */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <KpiCard label="Total Campaigns" value={totalCampaigns} icon={Megaphone} />
        <KpiCard label="Customers Reached" value={customersReached.toLocaleString("en-IN")} icon={Users} accent />
        <KpiCard label="Active Segments" value={uniqueSegments} icon={Star} />
        <KpiCard label="This Month" value={thisMonth} icon={Calendar} />
      </div>

      {/* Campaign list */}
      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <ListSkeleton rows={5} />
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Create your first WhatsApp campaign to reach your customers."
        />
      ) : (
        <div className="table-shell">
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Campaign Name</th>
                <th className="table-th">Type</th>
                <th className="table-th">Segment</th>
                <th className="table-th text-right">Recipients</th>
                <th className="table-th">Status</th>
                <th className="table-th">Created</th>
                <th className="table-th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const segLabel = SEGMENTS.find((s) => s.value === c.segment)?.label || c.segment;
                const typeLabel = CAMPAIGN_TYPES.find((t) => t.value === c.type)?.label || c.type;
                return (
                  <tr key={c.id} className="table-row">
                    <td className="table-td">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-md bg-[#FDFBF7] border border-[#EADFBF] flex items-center justify-center">
                          <Megaphone size={14} className="text-[#B49042]" strokeWidth={1.5} />
                        </div>
                        <span className="font-medium">{c.name}</span>
                      </div>
                    </td>
                    <td className="table-td">
                      <span className={TYPE_CHIP_CLASS[c.type] || "chip chip-neutral"}>{typeLabel}</span>
                    </td>
                    <td className="table-td text-[#525252]">{segLabel}</td>
                    <td className="table-td text-right font-mono tabular-nums">
                      {c.total_recipients > 0 ? c.total_recipients : "—"}
                    </td>
                    <td className="table-td">
                      <span className={STATUS_CHIP_CLASS[c.status] || "chip chip-neutral"}>{c.status}</span>
                    </td>
                    <td className="table-td text-[#737373] font-mono text-[12px]">{fmtDate(c.created_at)}</td>
                    <td className="table-td text-right">
                      <div className="flex items-center justify-end gap-2">
                        {c.status === "draft" && (
                          <>
                            <button
                              onClick={() => handleSendDraft(c)}
                              className="btn-accent"
                              style={{ padding: "5px 12px", fontSize: "12px" }}
                            >
                              <Send size={12} strokeWidth={1.5} /> Send
                            </button>
                            <button
                              onClick={() => handleDelete(c.id)}
                              className="btn-secondary"
                              style={{ padding: "5px 10px", fontSize: "12px" }}
                              aria-label="Delete campaign"
                            >
                              <Trash2 size={12} strokeWidth={1.5} />
                            </button>
                          </>
                        )}
                        {c.status === "sent" && (
                          <button
                            onClick={() => handleView(c.id)}
                            className="btn-secondary"
                            style={{ padding: "5px 12px", fontSize: "12px" }}
                          >
                            <Eye size={12} strokeWidth={1.5} /> View
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create campaign slide-in panel */}
      {showCreate && (
        <CreateCampaignPanel
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      {/* View campaign detail */}
      {viewCampaign && (
        <CampaignDetailPanel
          data={viewCampaign}
          onClose={() => setViewCampaign(null)}
        />
      )}

      {confirmModal}
    </div>
  );
}

// ─── Create Campaign Panel (4-step wizard) ────────────────────────────────────
function CreateCampaignPanel({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState(null);
  const [selectedSegment, setSelectedSegment] = useState("all");
  const [segmentConfig, setSegmentConfig] = useState({});
  const [templates, setTemplates] = useState([]);
  const [message, setMessage] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [audiencePreview, setAudiencePreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    api.get("/promotions/templates").then(({ data }) => setTemplates(data || [])).catch(() => setTemplates([]));
  }, []);

  // When type is selected, pre-fill the template
  const selectType = (type) => {
    setSelectedType(type);
    const tpl = templates.find((t) => t.type === type);
    if (tpl) setMessage(tpl.template);
    const typeObj = CAMPAIGN_TYPES.find((t) => t.value === type);
    if (typeObj) setCampaignName(typeObj.label + " Campaign");
  };

  // Insert variable at textarea cursor
  const insertVariable = (variable) => {
    const el = textareaRef.current;
    if (!el) {
      setMessage((m) => m + variable);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newMsg = message.slice(0, start) + variable + message.slice(end);
    setMessage(newMsg);
    setTimeout(() => {
      el.setSelectionRange(start + variable.length, start + variable.length);
      el.focus();
    }, 0);
  };

  const previewAudience = async () => {
    setPreviewLoading(true);
    try {
      const params = { segment: selectedSegment };
      if (Object.keys(segmentConfig).length) {
        params.segment_config = JSON.stringify(segmentConfig);
      }
      const { data } = await api.get("/promotions/segments/preview", { params });
      setAudiencePreview(data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!campaignName.trim()) return toast.error("Campaign name is required");
    setBusy(true);
    try {
      await api.post("/promotions/campaigns", {
        name: campaignName,
        type: selectedType,
        message_template: message,
        segment: selectedSegment,
        segment_config: segmentConfig,
      });
      toast.success("Campaign saved as draft");
      onCreated();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSendNow = async () => {
    if (!campaignName.trim()) return toast.error("Campaign name is required");
    setBusy(true);
    try {
      const { data: created } = await api.post("/promotions/campaigns", {
        name: campaignName,
        type: selectedType,
        message_template: message,
        segment: selectedSegment,
        segment_config: segmentConfig,
      });
      const { data: result } = await api.post(`/promotions/campaigns/${created.id}/send`);
      toast.success(`Campaign sent to ${result.sent_count} customers!`);
      onCreated();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const canNext =
    step === 1 ? !!selectedType :
    step === 2 ? !!selectedSegment :
    step === 3 ? message.trim().length > 0 :
    true;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex flex-col bg-white border-l border-[#E5E7EB] shadow-2xl"
        style={{ width: "520px" }}
      >
        {/* Header */}
        <div className="h-16 border-b border-[#E5E7EB] flex items-center justify-between px-6 flex-shrink-0">
          <div>
            <div className="section-title">New Campaign</div>
            <div className="text-[11px] text-[#737373] mt-0.5">
              Step {step} of 4 — {["Choose Type", "Select Audience", "Compose Message", "Review & Send"][step - 1]}
            </div>
          </div>
          <button onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A] transition-colors">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 px-6 pt-4 pb-3 flex-shrink-0">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center">
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold transition-all"
                style={{
                  background: s <= step ? "#0A0A0A" : "#F3F4F6",
                  color: s <= step ? "white" : "#9CA3AF",
                }}
              >
                {s}
              </div>
              {s < 4 && (
                <div
                  className="h-px w-10 transition-all"
                  style={{ background: s < step ? "#0A0A0A" : "#E5E7EB" }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 1 && (
            <Step1TypeSelect
              types={CAMPAIGN_TYPES}
              selected={selectedType}
              onSelect={selectType}
            />
          )}
          {step === 2 && (
            <Step2Audience
              segments={SEGMENTS}
              selected={selectedSegment}
              onSelect={setSelectedSegment}
              segmentConfig={segmentConfig}
              onSegmentConfigChange={setSegmentConfig}
              preview={audiencePreview}
              previewLoading={previewLoading}
              onPreview={previewAudience}
            />
          )}
          {step === 3 && (
            <Step3Compose
              message={message}
              onMessageChange={setMessage}
              textareaRef={textareaRef}
              onInsertVariable={insertVariable}
            />
          )}
          {step === 4 && (
            <Step4Review
              campaignName={campaignName}
              onCampaignNameChange={setCampaignName}
              selectedType={selectedType}
              selectedSegment={selectedSegment}
              audiencePreview={audiencePreview}
              message={message}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#E5E7EB] px-6 py-4 flex items-center justify-between flex-shrink-0">
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            className="btn-secondary"
          >
            <ChevronLeft size={14} strokeWidth={1.5} /> Back
          </button>
          <div className="flex items-center gap-2">
            {step < 4 ? (
              <button
                data-enter-submit="true"
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext}
                className="btn-primary"
              >
                Next <ChevronRight size={14} strokeWidth={1.5} />
              </button>
            ) : (
              <>
                <button onClick={handleSaveDraft} disabled={busy} className="btn-secondary">
                  Save Draft
                </button>
                <button data-enter-submit="true" onClick={handleSendNow} disabled={busy} className="btn-accent">
                  <Send size={14} strokeWidth={1.5} /> {busy ? "Sending…" : "Send Now"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Step 1: Campaign Type ────────────────────────────────────────────────────
function Step1TypeSelect({ types, selected, onSelect }) {
  return (
    <div>
      <div className="text-[13px] text-[#525252] mb-4">Select the type of campaign you want to run.</div>
      <div className="grid grid-cols-2 gap-3">
        {types.map(({ value, label, icon: Icon, desc }) => {
          const isSelected = selected === value;
          return (
            <button
              key={value}
              onClick={() => onSelect(value)}
              className="text-left p-4 rounded-lg border transition-all"
              style={{
                border: isSelected ? "1px solid #0A0A0A" : "1px solid #E5E7EB",
                background: isSelected ? "#FAFAFA" : "white",
                boxShadow: isSelected ? "0 0 0 3px rgba(10,10,10,0.06)" : "none",
              }}
            >
              <div
                className="h-8 w-8 rounded-md flex items-center justify-center mb-3"
                style={{
                  background: isSelected ? "#0A0A0A" : "#F9FAFB",
                  border: isSelected ? "none" : "1px solid #E5E7EB",
                }}
              >
                <Icon
                  size={15}
                  strokeWidth={1.5}
                  style={{ color: isSelected ? "#B49042" : "#737373" }}
                />
              </div>
              <div className="font-medium text-[13px] text-[#0A0A0A] mb-1">{label}</div>
              <div className="text-[11.5px] text-[#737373] leading-relaxed">{desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 2: Audience ─────────────────────────────────────────────────────────
function Step2Audience({ segments, selected, onSelect, segmentConfig, onSegmentConfigChange, preview, previewLoading, onPreview }) {
  return (
    <div>
      <div className="text-[13px] text-[#525252] mb-4">Choose who should receive this campaign.</div>
      <div className="flex flex-col gap-2 mb-5">
        {segments.map(({ value, label, icon: Icon, desc }) => {
          const isSelected = selected === value;
          return (
            <label
              key={value}
              className="flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-all"
              style={{
                border: isSelected ? "1px solid #0A0A0A" : "1px solid #E5E7EB",
                background: isSelected ? "#FAFAFA" : "white",
              }}
            >
              <input
                type="radio"
                name="segment"
                value={value}
                checked={isSelected}
                onChange={() => onSelect(value)}
                className="mt-0.5 accent-[#0A0A0A]"
              />
              <div className="flex items-center gap-2.5 flex-1">
                <div className="h-7 w-7 rounded-md bg-[#F9FAFB] border border-[#E5E7EB] flex items-center justify-center flex-shrink-0">
                  <Icon size={13} strokeWidth={1.5} className="text-[#525252]" />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-[13px] text-[#0A0A0A]">{label}</div>
                  <div className="text-[11.5px] text-[#737373]">{desc}</div>
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {selected === "high_value" && (
        <div className="mb-4">
          <label className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">
            Minimum Purchase Amount (₹)
          </label>
          <MoneyInput
            className="input"
            placeholder="100000"
            value={segmentConfig.min_purchase || ""}
            onValueChange={(_, amount) => onSegmentConfigChange({ ...segmentConfig, min_purchase: amount })}
          />
        </div>
      )}

      <button onClick={onPreview} disabled={previewLoading} className="btn-secondary w-full mb-4">
        <Eye size={14} strokeWidth={1.5} />
        {previewLoading ? "Loading…" : "Preview Audience"}
      </button>

      {preview && (
        <div className="rounded-lg border border-[#E5E7EB] p-4 bg-[#F9FAFB]">
          <div className="flex items-center gap-2 mb-3">
            <Users size={14} strokeWidth={1.5} className="text-[#B49042]" />
            <span className="font-semibold text-[13px] text-[#0A0A0A]">
              {preview.count} customer{preview.count !== 1 ? "s" : ""} will receive this campaign
            </span>
          </div>
          {preview.preview.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {preview.preview.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[12.5px]">
                  <span className="text-[#0A0A0A] font-medium">{c.name}</span>
                  <span className="text-[#737373] font-mono">{c.mobile}</span>
                </div>
              ))}
              {preview.count > 5 && (
                <div className="text-[11.5px] text-[#a3a3a3] mt-1">
                  +{preview.count - 5} more…
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Compose Message ──────────────────────────────────────────────────
const VARIABLES = ["{{name}}", "{{mobile}}", "{{shop_name}}", "{{date}}"];

function Step3Compose({ message, onMessageChange, textareaRef, onInsertVariable }) {
  // Build preview by substituting sample values
  const preview = message
    .replace(/\{\{name\}\}/g, "Priya Sharma")
    .replace(/\{\{mobile\}\}/g, "9876543210")
    .replace(/\{\{shop_name\}\}/g, "Sri Srinivasa Jewellers")
    .replace(/\{\{date\}\}/g, new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }));

  return (
    <div>
      <div className="text-[13px] text-[#525252] mb-4">Compose your message. Use variables to personalise it for each customer.</div>

      <label className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">
        Message
      </label>
      <textarea
        ref={textareaRef}
        className="input"
        rows={6}
        style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
        value={message}
        onChange={(e) => onMessageChange(e.target.value)}
        placeholder="Type your message here…"
      />
      <div className="flex items-center justify-between mt-1.5 mb-4">
        <div className="text-[11px] text-[#a3a3a3]">Click a variable to insert it at cursor position</div>
        <div className="text-[11px] text-[#a3a3a3] font-mono">{message.length} chars</div>
      </div>

      {/* Variable chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {VARIABLES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onInsertVariable(v)}
            className="chip chip-diamond cursor-pointer hover:bg-[#DBEAFE] transition-colors"
            style={{ cursor: "pointer" }}
          >
            {v}
          </button>
        ))}
      </div>

      {/* WhatsApp preview */}
      <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-2">
        Preview (sample data)
      </div>
      <div
        className="rounded-xl p-4 relative overflow-hidden"
        style={{ background: "#ECE5DD", minHeight: "80px" }}
      >
        <div
          className="inline-block rounded-xl px-4 py-3 text-[13.5px] leading-relaxed max-w-[90%] shadow-sm"
          style={{
            background: "white",
            color: "#0A0A0A",
            borderRadius: "0 12px 12px 12px",
            fontFamily: "inherit",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {preview || <span style={{ color: "#a3a3a3" }}>Your message preview will appear here…</span>}
        </div>
        <div className="flex items-center gap-1 mt-2">
          <Smartphone size={11} className="text-[#737373]" strokeWidth={1.5} />
          <span className="text-[10.5px] text-[#737373]">WhatsApp preview</span>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Review & Send ────────────────────────────────────────────────────
function Step4Review({ campaignName, onCampaignNameChange, selectedType, selectedSegment, audiencePreview, message }) {
  const typeLabel = CAMPAIGN_TYPES.find((t) => t.value === selectedType)?.label || selectedType;
  const segLabel = SEGMENTS.find((s) => s.value === selectedSegment)?.label || selectedSegment;

  return (
    <div>
      <div className="text-[13px] text-[#525252] mb-5">Review your campaign details before sending.</div>

      <div className="mb-4">
        <label className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">
          Campaign Name
        </label>
        <input
          className="input"
          value={campaignName}
          onChange={(e) => onCampaignNameChange(e.target.value)}
          placeholder="Enter campaign name"
        />
      </div>

      <div className="rounded-lg border border-[#E5E7EB] divide-y divide-[#E5E7EB] mb-5">
        <SummaryRow label="Type" value={typeLabel} />
        <SummaryRow label="Segment" value={segLabel} />
        <SummaryRow
          label="Recipients"
          value={audiencePreview ? `${audiencePreview.count} customers` : "Preview audience in step 2 to see count"}
        />
      </div>

      <div className="mb-4">
        <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-2">
          Message Preview
        </div>
        <div
          className="rounded-lg border border-[#E5E7EB] p-4 text-[13px] leading-relaxed text-[#0A0A0A] bg-[#F9FAFB]"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {message}
        </div>
      </div>

      <div className="rounded-lg border border-[#EADFBF] bg-[#FDFBF7] p-4">
        <div className="flex gap-2">
          <Megaphone size={14} strokeWidth={1.5} className="text-[#B49042] flex-shrink-0 mt-0.5" />
          <div className="text-[12.5px] text-[#7a5e26] leading-relaxed">
            Clicking <strong>Send Now</strong> will generate WhatsApp links for each recipient.
            You can open each link manually or share the list with your team.
            Messages are sent via WhatsApp — no third-party API required.
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[11.5px] text-[#737373] font-medium uppercase tracking-[0.06em]">{label}</span>
      <span className="text-[13px] font-medium text-[#0A0A0A]">{value}</span>
    </div>
  );
}

// ─── Campaign Detail Panel ────────────────────────────────────────────────────
function CampaignDetailPanel({ data, onClose }) {
  const { campaign, messages } = data;
  const typeLabel = CAMPAIGN_TYPES.find((t) => t.value === campaign.type)?.label || campaign.type;
  const segLabel = SEGMENTS.find((s) => s.value === campaign.segment)?.label || campaign.segment;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed inset-y-0 right-0 z-50 flex flex-col bg-white border-l border-[#E5E7EB] shadow-2xl"
        style={{ width: "560px" }}
      >
        {/* Header */}
        <div className="h-16 border-b border-[#E5E7EB] flex items-center justify-between px-6 flex-shrink-0">
          <div className="section-title">{campaign.name}</div>
          <button onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A] transition-colors">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Summary */}
          <div className="rounded-lg border border-[#E5E7EB] divide-y divide-[#E5E7EB] mb-6">
            <SummaryRow label="Type" value={<span className={TYPE_CHIP_CLASS[campaign.type] || "chip chip-neutral"}>{typeLabel}</span>} />
            <SummaryRow label="Segment" value={segLabel} />
            <SummaryRow label="Status" value={<span className={STATUS_CHIP_CLASS[campaign.status] || "chip chip-neutral"}>{campaign.status}</span>} />
            <SummaryRow label="Sent At" value={fmtDate(campaign.sent_at)} />
            <SummaryRow label="Recipients" value={campaign.total_recipients} />
          </div>

          {/* Message preview */}
          <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-2">
            Message Template
          </div>
          <div
            className="rounded-lg border border-[#E5E7EB] p-4 text-[13px] leading-relaxed text-[#0A0A0A] bg-[#F9FAFB] mb-6"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {campaign.message_template}
          </div>

          {/* Recipient list */}
          <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-3">
            Recipients ({messages.length})
          </div>
          {messages.length === 0 ? (
            <div className="text-[13px] text-[#a3a3a3]">No recipients found.</div>
          ) : (
            <div className="table-shell">
              <table className="w-full">
                <thead>
                  <tr className="table-head-row">
                    <th className="table-th">Customer</th>
                    <th className="table-th">Mobile</th>
                    <th className="table-th text-right">WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id} className="table-row">
                      <td className="table-td font-medium">{m.customer_name}</td>
                      <td className="table-td font-mono text-[12.5px] text-[#525252]">{m.mobile}</td>
                      <td className="table-td text-right">
                        <button
                          type="button"
                          className="btn-accent"
                          style={{ padding: "4px 10px", fontSize: "12px" }}
                          onClick={() => {
                            const result = openWhatsAppChat(m.mobile, m.message);
                            if (!result.ok) toast.error(result.error);
                          }}
                        >
                          <ExternalLink size={11} strokeWidth={1.5} /> Open WhatsApp
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
