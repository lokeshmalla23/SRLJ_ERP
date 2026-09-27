import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { SettingsSection } from "./settingsLayout";

/**
 * Scheme Print settings — three independent print-setting sections:
 *   1. Scheme Creation Print (A5 receipt)
 *   2. Scheme Statement Print (A4/A5)
 *   3. Scheme Closure Certificate (A5)
 *
 * Each section has its own field checklist. Only fields that actually exist in
 * the current data model are exposed. Saved via PUT /settings/scheme-print.
 */

const CREATION_FIELDS = [
  { key: "company_logo", label: "Company Logo" },
  { key: "company_name", label: "Company Name" },
  { key: "company_address", label: "Company Address" },
  { key: "company_phone", label: "Company Phone" },
  { key: "company_gst", label: "Company GST" },
  { key: "customer_name", label: "Customer Name" },
  { key: "customer_mobile", label: "Customer Mobile" },
  { key: "scheme_number", label: "Scheme Number" },
  { key: "scheme_name", label: "Scheme Name" },
  { key: "scheme_type", label: "Scheme Type" },
  { key: "start_date", label: "Start Date" },
  { key: "duration", label: "Duration" },
  { key: "monthly_amount", label: "Monthly Installment" },
  { key: "bonus_months", label: "Bonus Months" },
  { key: "total_target_amount", label: "Total Target Amount" },
  { key: "created_by", label: "Created By" },
  { key: "employee_phone", label: "Employee Phone" },
  { key: "signature", label: "Signature" },
];

const STATEMENT_FIELDS = [
  { key: "company_logo", label: "Company Logo" },
  { key: "company_name", label: "Company Name" },
  { key: "company_address", label: "Company Address" },
  { key: "company_phone", label: "Company Phone" },
  { key: "company_gst", label: "Company GST" },
  { key: "customer_name", label: "Customer Name" },
  { key: "customer_mobile", label: "Customer Mobile" },
  { key: "scheme_number", label: "Scheme Number" },
  { key: "scheme_name", label: "Scheme Name" },
  { key: "start_date", label: "Start Date" },
  { key: "duration", label: "Duration" },
  { key: "status", label: "Status" },
  { key: "maturity_date", label: "Maturity Date" },
  { key: "payment_summary", label: "Payment Summary" },
  { key: "total_installments", label: "Total Installments" },
  { key: "paid_installments", label: "Paid Installments" },
  { key: "pending_installments", label: "Pending Installments" },
  { key: "total_scheme_amount", label: "Total Scheme Amount" },
  { key: "amount_paid", label: "Amount Paid" },
  { key: "amount_pending", label: "Amount Pending" },
  { key: "last_payment_date", label: "Last Payment Date" },
  { key: "signature", label: "Signature" },
];

const CLOSURE_FIELDS = [
  { key: "company_logo", label: "Company Logo" },
  { key: "company_name", label: "Company Name" },
  { key: "company_address", label: "Company Address" },
  { key: "company_phone", label: "Company Phone" },
  { key: "company_gst", label: "Company GST" },
  { key: "customer_name", label: "Customer Name" },
  { key: "customer_mobile", label: "Customer Mobile" },
  { key: "scheme_number", label: "Scheme Number" },
  { key: "scheme_name", label: "Scheme Name" },
  { key: "start_date", label: "Start Date" },
  { key: "closure_date", label: "Closure Date" },
  { key: "duration", label: "Duration" },
  { key: "installments_required", label: "Installments Required" },
  { key: "installments_paid", label: "Installments Paid" },
  { key: "amount_paid", label: "Amount Paid" },
  { key: "amount_pending", label: "Amount Pending" },
  { key: "scheme_status", label: "Scheme Status" },
  { key: "closure_reason", label: "Closure Reason" },
  { key: "redemption_info", label: "Redemption Info" },
  { key: "created_by", label: "Created By" },
  { key: "closed_by", label: "Closed By" },
  { key: "signature", label: "Signature" },
];

const SECTIONS = [
  { key: "scheme_creation_print_settings", label: "Scheme Creation Print", description: "A5 receipt printed when a customer joins/creates a scheme.", fields: CREATION_FIELDS },
  { key: "scheme_statement_print_settings", label: "Scheme Statement Print", description: "A4/A5 detailed scheme account statement with payment summary and transaction table.", fields: STATEMENT_FIELDS },
  { key: "scheme_closure_print_settings", label: "Scheme Closure Certificate", description: "A5 certificate for a final closed scheme (completed / breaked / cancelled).", fields: CLOSURE_FIELDS },
];

function FieldCheckbox({ label, checked, disabled, onChange }) {
  return (
    <label className={`flex items-center gap-2.5 px-3 py-2 ${disabled ? "opacity-50" : "hover:bg-[#F7F8F2] cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-[#C8D4C7] text-[#244B39] focus:ring-[#B8CBB9]"
      />
      <span className="text-[13px] text-[#294236]">{label}</span>
    </label>
  );
}

export default function SchemePrintSettingsTab({ canWrite = false, unlocked = false, onLocked }) {
  const [settings, setSettings] = useState({
    scheme_creation_print_settings: {},
    scheme_statement_print_settings: {},
    scheme_closure_print_settings: {},
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/settings/scheme-print")
      .then(({ data }) => { if (data) setSettings(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleField = (sectionKey, fieldKey) => {
    if (!canWrite || !unlocked) return;
    setSettings((prev) => ({
      ...prev,
      [sectionKey]: {
        ...prev[sectionKey],
        [fieldKey]: prev[sectionKey]?.[fieldKey] === false ? true : false,
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/settings/scheme-print", settings);
      setSettings(data);
      toast.success("Scheme print settings saved");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-[13px] text-[#8D998F]">Loading…</div>;
  }

  const frozen = !canWrite || !unlocked;

  return (
    <div className="space-y-6">
      {canWrite && !unlocked && (
        <div className="mb-4 flex items-center gap-2 rounded-[9px] border border-[#E7D5AA] bg-[#FBF7ED] px-3 py-2 text-[12px] text-[#755D25]">
          <span>🔒 Locked — click this tab 5× to enter the password.</span>
        </div>
      )}
      {canWrite && unlocked && (
        <div className="mb-4 flex items-center justify-between rounded-[9px] border border-[#DCE3D6] bg-[#F7F8F2] px-3 py-2 text-[12px] text-[#5F6D62]">
          <span>Unlocked — make changes, then click Save.</span>
          <button onClick={onLocked} className="btn-primary !py-1 !px-3 !text-[11px]">Lock Again</button>
        </div>
      )}

      {SECTIONS.map((section) => (
        <SettingsSection key={section.key} title={section.label} description={section.description}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            {section.fields.map((field) => (
              <FieldCheckbox
                key={field.key}
                label={field.label}
                checked={settings[section.key]?.[field.key] !== false}
                disabled={frozen}
                onChange={() => toggleField(section.key, field.key)}
              />
            ))}
          </div>
        </SettingsSection>
      ))}

      {canWrite && unlocked && (
        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Saving…" : "Save Scheme Print Settings"}
          </button>
        </div>
      )}
    </div>
  );
}
