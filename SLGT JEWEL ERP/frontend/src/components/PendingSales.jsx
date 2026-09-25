import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock, AlertCircle, CheckCircle2, XCircle, Printer } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { fmtINR } from "@/lib/format";
import { printHtml } from "@/lib/printHtml";
import { generateDraftReceiptHTML } from "@/lib/draftReceipt";

function StatusBadge({ status }) {
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700">
        <Clock size={10} />
        Waiting to sync
      </span>
    );
  }
  if (status === "conflict") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">
        <AlertCircle size={10} />
        Needs Attention
      </span>
    );
  }
  if (status === "promoted") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
        <CheckCircle2 size={10} />
        Invoiced
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">
        <XCircle size={10} />
        Cancelled
      </span>
    );
  }
  return <span className="text-[11px] text-gray-400">{status}</span>;
}

function itemSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return "—";
  const first = items[0];
  const name = first.name || first.product_id || "Item";
  return items.length > 1 ? `${name} +${items.length - 1} more` : name;
}

export default function PendingSales({ onClose }) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/draft-sales");
      setDrafts(Array.isArray(data) ? data : []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const cancel = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/draft-sales/${id}/cancel`);
      toast.success("Draft sale cancelled");
      load();
    } catch (e) {
      toast.error(formatApiError(e) || "Could not cancel draft");
    } finally {
      setBusyId(null);
    }
  };

  const recalculate = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/draft-sales/${id}/resolve`, { pricing_mode: "recalculate" });
      toast.success("Draft updated to recalculate at sync time");
      load();
    } catch (e) {
      toast.error(formatApiError(e) || "Could not update draft");
    } finally {
      setBusyId(null);
    }
  };

  const replaceItem = async (draft) => {
    toast.info("Edit the items in the conflict draft and resubmit via the POS.", { duration: 5000 });
  };

  const printDraft = async (draft) => {
    if (draft.status === "promoted") return;
    try {
      const company = await api.get("/settings/company").then(({ data }) => data).catch(() => ({}));
      const html = generateDraftReceiptHTML(draft, company);
      await printHtml(html);
    } catch {
      /* printHtml already showed toast */
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[15px] font-semibold text-[#0A0A0A]">Pending Sales</h2>
            <p className="text-[12px] text-[#737373] mt-0.5">Drafts saved while host was offline</p>
          </div>
          <button onClick={onClose} className="text-[#737373] hover:text-[#0A0A0A] p-1.5 rounded-md hover:bg-[#F9FAFB]">
            <XCircle size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading && (
            <div className="px-6 py-8 text-center text-[13px] text-[#737373]">Loading…</div>
          )}
          {!loading && drafts.length === 0 && (
            <div className="px-6 py-8 text-center text-[13px] text-[#737373]">No pending sales</div>
          )}
          {!loading && drafts.length > 0 && (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                  <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-[#737373] font-medium">Time</th>
                  <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-[#737373] font-medium">Customer</th>
                  <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-[#737373] font-medium">Items</th>
                  <th className="text-right px-4 py-3 text-[11px] uppercase tracking-wider text-[#737373] font-medium">Total</th>
                  <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-[#737373] font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <>
                    <tr key={d.id} className="border-b border-[#F3F4F6] hover:bg-[#FAFAFA]">
                      <td className="px-4 py-3 text-[#525252]">
                        {d.created_at ? new Date(d.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-4 py-3 text-[#525252]">{d.customer_id ? `#${d.customer_id}` : "Walk-in"}</td>
                      <td className="px-4 py-3 text-[#525252]">{itemSummary(d.items)}</td>
                      <td className="px-4 py-3 text-right font-medium text-[#0A0A0A]">{fmtINR(d.total)}</td>
                      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {(d.status === "pending" || d.status === "conflict") && (
                            <button
                              onClick={() => printDraft(d)}
                              className="text-[12px] text-[#737373] hover:text-[#0A0A0A]"
                              title="Print draft receipt"
                            >
                              <Printer size={13} />
                            </button>
                          )}
                          {d.status === "pending" && (
                            <button
                              disabled={busyId === d.id}
                              onClick={() => cancel(d.id)}
                              className="text-[12px] text-red-500 hover:text-red-700 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          )}
                          {d.status === "conflict" && (
                            <>
                              <button
                                disabled={busyId === d.id}
                                onClick={() => replaceItem(d)}
                                className="text-[12px] text-blue-600 hover:text-blue-800 disabled:opacity-50"
                              >
                                Replace Item
                              </button>
                              <button
                                disabled={busyId === d.id}
                                onClick={() => recalculate(d.id)}
                                className="text-[12px] text-amber-600 hover:text-amber-800 disabled:opacity-50"
                              >
                                Recalculate
                              </button>
                              <button
                                disabled={busyId === d.id}
                                onClick={() => cancel(d.id)}
                                className="text-[12px] text-red-500 hover:text-red-700 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {d.status === "conflict" && d.conflict_reason && (
                      <tr key={`${d.id}-reason`} className="bg-red-50 border-b border-[#F3F4F6]">
                        <td colSpan={6} className="px-4 py-2 text-[12px] text-red-700">
                          Conflict: {d.conflict_reason}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
