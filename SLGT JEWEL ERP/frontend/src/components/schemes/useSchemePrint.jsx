import { useCallback, useState } from "react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { printHtml } from "@/lib/printHtml";
import { useCompany } from "@/context/CompanyContext";
import PrintPreviewModal from "@/components/PrintPreviewModal";
import {
  SCHEME_DOCS,
  canPrintClosureCertificate,
  generateSchemeClosureHTML,
  generateSchemeCreationHTML,
  generateSchemeStatementHTML,
} from "@/lib/schemePrint";

const TITLES = {
  [SCHEME_DOCS.CREATION]: "Scheme Creation Print",
  [SCHEME_DOCS.STATEMENT]: "Scheme Statement",
  [SCHEME_DOCS.CLOSURE]: "Scheme Closure Certificate",
};

/**
 * Open any of the three scheme documents with a confirm-before-print preview
 * (same PrintPreviewModal → printHtml flow as invoices). Fresh print data and
 * Settings → Scheme field checklists are fetched every time, so a print always
 * reflects the latest payments and settings.
 *
 *   const { openSchemeDoc, schemePrintModal } = useSchemePrint();
 *   openSchemeDoc(scheme.id, "statement", { paper: "A5" });
 */
export default function useSchemePrint() {
  const { company } = useCompany();
  const [state, setState] = useState(null); // { html, title, subtitle }
  const [printing, setPrinting] = useState(false);
  const [loading, setLoading] = useState(false);

  const openSchemeDoc = useCallback(async (schemeId, doc, { paper } = {}) => {
    if (!schemeId) return;
    setLoading(true);
    try {
      const [{ data }, settingsRes] = await Promise.all([
        api.get(`/schemes/${schemeId}/print-data`),
        api.get("/settings/scheme-print"),
      ]);
      const settings = settingsRes.data?.settings || {};
      let html;
      if (doc === SCHEME_DOCS.CREATION) html = generateSchemeCreationHTML(data, company, settings);
      else if (doc === SCHEME_DOCS.STATEMENT) html = generateSchemeStatementHTML(data, company, settings, paper);
      else if (doc === SCHEME_DOCS.CLOSURE) {
        if (!canPrintClosureCertificate(data)) {
          toast.error("Closure certificate is available only after the scheme is closed");
          return;
        }
        html = generateSchemeClosureHTML(data, company, settings, paper);
      } else return;
      const paperLabel = (html.match(/data-paper="(A\d)"/) || [])[1];
      setState({
        html,
        title: TITLES[doc],
        subtitle: `${data.scheme?.plan_name || ""} · ${data.customer?.name || ""}${paperLabel ? ` · ${paperLabel}` : ""}`,
        customerMobile: data.customer?.mobile || "",
      });
    } catch (err) {
      toast.error(formatApiError(err) || "Could not prepare the scheme document");
    } finally {
      setLoading(false);
    }
  }, [company]);

  const confirmPrint = async () => {
    if (!state?.html) return;
    setPrinting(true);
    try {
      await printHtml(state.html, { printerType: "invoice" });
      setState(null);
    } catch {
      // printHtml already surfaced the error toast
    } finally {
      setPrinting(false);
    }
  };

  const schemePrintModal = state ? (
    <PrintPreviewModal
      html={state.html}
      title={state.title}
      subtitle={state.subtitle}
      onPrint={confirmPrint}
      onClose={() => !printing && setState(null)}
      printing={printing}
      customerMobile={state.customerMobile}
    />
  ) : null;

  return { openSchemeDoc, schemePrintModal, schemePrintLoading: loading };
}
