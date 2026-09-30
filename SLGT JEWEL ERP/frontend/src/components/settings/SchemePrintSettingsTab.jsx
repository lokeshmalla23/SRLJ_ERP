import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { useCompany } from "@/context/CompanyContext";
import { SettingsSection, SettingsTabFrame } from "@/components/settings/settingsLayout";
import {
  SAMPLE_SCHEME_PRINT_DATA,
  SCHEME_DOCS,
  generateSchemeClosureHTML,
  generateSchemeCreationHTML,
  generateSchemePaymentReceiptHTML,
  generateSchemeStatementHTML,
} from "@/lib/schemePrint";

/**
 * Settings → Scheme. Three independent field checklists — Scheme Creation
 * Print, Scheme Statement Print, Scheme Closure Certificate — stored in the
 * `scheme_print` setting. The field catalog comes from the backend so both
 * sides agree on which fields exist. Unchecked fields are not rendered on
 * that document at all. Invoice print settings are not touched.
 */
function previewHtml(doc, settings, company) {
  const data = SAMPLE_SCHEME_PRINT_DATA;
  if (doc === SCHEME_DOCS.CREATION) return generateSchemeCreationHTML(data, company, settings);
  if (doc === SCHEME_DOCS.STATEMENT) return generateSchemeStatementHTML(data, company, settings);
  if (doc === "payment_receipt") return generateSchemePaymentReceiptHTML(data, company);
  return generateSchemeClosureHTML(data, company, settings);
}

function DocSection({ docCatalog, value, onChange, company, allSettings, canWrite, saving, onSave, onReset, dirty }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const f of docCatalog.fields) {
      if (!map.has(f.group)) map.set(f.group, []);
      map.get(f.group).push(f);
    }
    return [...map.entries()];
  }, [docCatalog]);
  const html = useMemo(
    () => previewHtml(docCatalog.id, { ...allSettings, [docCatalog.id]: value }, company),
    [docCatalog.id, allSettings, value, company],
  );
  const pageWIn = Number(html.match(/data-page-w-in="([\d.]+)"/)?.[1]) || 5.83;
  const pageHIn = Number(html.match(/data-page-h-in="([\d.]+)"/)?.[1]) || 8.27;
  const scale = 300 / (pageWIn * 96);

  const setField = (key, checked) => onChange({ ...value, fields: { ...value.fields, [key]: checked } });
  const setAll = (checked) => {
    const fields = {};
    for (const f of docCatalog.fields) fields[f.key] = checked;
    onChange({ ...value, fields });
  };

  return (
    <SettingsSection
      title={docCatalog.title}
      description={docCatalog.description}
      actions={
        <>
          <button type="button" className="btn-secondary !py-1 !text-[12px]" disabled={!canWrite} onClick={onReset}>
            <RotateCcw size={13} strokeWidth={1.5} /> Defaults
          </button>
          <button type="button" className="btn-primary !py-1 !text-[12px]" disabled={!canWrite || saving || !dirty} onClick={onSave} data-testid={`scheme-print-save-${docCatalog.id}`}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} strokeWidth={1.5} />} Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="flex-1 space-y-3" data-testid={`scheme-print-fields-${docCatalog.id}`}>
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <span className="text-[#737373]">Paper:</span>
            {docCatalog.papers.length > 1 ? (
              docCatalog.papers.map((p) => (
                <label key={p} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`paper-${docCatalog.id}`}
                    disabled={!canWrite}
                    checked={value.paper === p}
                    onChange={() => onChange({ ...value, paper: p })}
                  />
                  {p}{p === docCatalog.default_paper ? " (default)" : ""}
                </label>
              ))
            ) : (
              <span className="font-medium">{docCatalog.papers[0]} only</span>
            )}
            <span className="ml-auto flex gap-2">
              <button type="button" className="text-[11.5px] text-[#737373] underline" disabled={!canWrite} onClick={() => setAll(true)}>Select all</button>
              <button type="button" className="text-[11.5px] text-[#737373] underline" disabled={!canWrite} onClick={() => setAll(false)}>Clear all</button>
            </span>
          </div>
          {groups.map(([group, fields]) => (
            <div key={group}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#a3a3a3]">{group}</div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {fields.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 text-[12.5px] text-[#0A0A0A]">
                    <input
                      type="checkbox"
                      disabled={!canWrite}
                      checked={value.fields[f.key] !== false}
                      onChange={(e) => setField(f.key, e.target.checked)}
                      data-testid={`scheme-field-${docCatalog.id}-${f.key}`}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="shrink-0">
          <div className="mb-1 text-[11px] text-[#737373]">Live preview (sample data)</div>
          <div
            className="overflow-hidden rounded border border-[#E5E7EB] bg-[#E8E8EA] p-2"
            style={{ width: 300 + 16, height: pageHIn * 96 * scale + 16 }}
          >
            <iframe
              title={`${docCatalog.title} preview`}
              srcDoc={html}
              style={{
                width: pageWIn * 96,
                height: pageHIn * 96,
                border: 0,
                background: "#fff",
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

export default function SchemePrintSettingsTab({ canWrite = false }) {
  const { company } = useCompany();
  const [catalog, setCatalog] = useState(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [savingDoc, setSavingDoc] = useState(null);

  useEffect(() => {
    api.get("/settings/scheme-print")
      .then(({ data }) => {
        setCatalog(data.catalog || []);
        setSaved(data.settings || {});
        setDraft(data.settings || {});
      })
      .catch((err) => toast.error(formatApiError(err)));
  }, []);

  if (!catalog || !draft) {
    return <div className="text-[13px] text-[#737373]"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading scheme print settings…</div>;
  }

  const save = async (doc) => {
    setSavingDoc(doc);
    try {
      const { data } = await api.put("/settings/scheme-print", { [doc]: draft[doc] });
      setSaved(data.settings);
      setDraft((d) => ({ ...d, [doc]: data.settings[doc] }));
      toast.success("Scheme print settings saved");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSavingDoc(null);
    }
  };

  const resetDoc = (doc) => {
    const def = catalog.find((c) => c.id === doc);
    const fields = {};
    for (const f of def.fields) fields[f.key] = f.default !== false;
    setDraft((d) => ({ ...d, [doc]: { fields, paper: def.default_paper } }));
  };

  return (
    <SettingsTabFrame>
      <div className="text-[12.5px] text-[#737373]">
        Choose which fields appear on each scheme document. Each document is configured independently;
        invoice print settings are not affected.
      </div>
      {catalog.map((doc) => (
        <DocSection
          key={doc.id}
          docCatalog={doc}
          value={draft[doc.id]}
          allSettings={draft}
          company={company}
          canWrite={canWrite}
          saving={savingDoc === doc.id}
          dirty={JSON.stringify(draft[doc.id]) !== JSON.stringify(saved?.[doc.id])}
          onChange={(v) => setDraft((d) => ({ ...d, [doc.id]: v }))}
          onSave={() => save(doc.id)}
          onReset={() => resetDoc(doc.id)}
        />
      ))}
    </SettingsTabFrame>
  );
}
