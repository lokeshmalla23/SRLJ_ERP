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
      <span className="chip chip-warning">
        <Clock size={10} />
        Waiting to sync
      </span>
    );
  }
  if (status === "conflict") {
    return (
      <span className="chip chip-danger">
        <AlertCircle size={10} />
        Needs Attention
      </span>
    );
  }
  if (status === "promoted") {
    return (
      <span className="chip chip-success">
        <CheckCircle2 size={10} />
        Invoiced
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="chip chip-neutral">
        <XCircle size={10} />
        Cancelled
      </span>
    );
  }
  return <span className="chip chip-neutral">{status}</span>;
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#17201C]/45 backdrop-blur-sm">
      <div className="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#E2E7E2] bg-[#FFFDF9] shadow-float">
        <div className="flex shrink-0 items-center justify-between border-b border-[#E2E7E2] bg-[linear-gradient(90deg,rgba(247,232,188,0.24),rgba(255,253,249,0.96)_42%)] px-6 py-4">
          <div>
            <h2 className="font-display text-[16px] font-semibold tracking-[-0.012em] text-[#17201C]">Pending Sales</h2>
            <p className="mt-0.5 text-[12px] text-[#6F7772]">Drafts saved while host was offline</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-[#6F7772] transition-colors hover:border-[#D3DCD5] hover:bg-[#FFFDF9] hover:text-[#214F3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/25"
          >
            <XCircle size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#FFFDF9]">
          {loading && (
            <div className="m-5 flex min-h-[200px] items-center justify-center rounded-xl border border-[#D3DCD5] bg-[#F7F9F6] px-6 py-8 text-center text-[13px] font-medium text-[#6F7772]">
              Loading…
            </div>
          )}
          {!loading && drafts.length === 0 && (
            <div className="m-5 flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-[#D3DCD5] bg-[#FAF7EF] px-6 py-8 text-center text-[13px] font-medium text-[#6F7772]">
              No pending sales
            </div>
          )}
          {!loading && drafts.length > 0 && (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#E2E7E2] bg-[#F1F4F0]">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.065em] text-[#6F7772]">Time</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.065em] text-[#6F7772]">Customer</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.065em] text-[#6F7772]">Items</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.065em] text-[#6F7772]">Total</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.065em] text-[#6F7772]">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <>
                    <tr
                      key={d.id}
                      className="border-b border-[#E2E7E2] transition-colors hover:bg-[#F7F9F6] focus-within:bg-[#FBF4E3]/60"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-[#4F5A54]">
                        {d.created_at ? new Date(d.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#4F5A54]">{d.customer_id ? `#${d.customer_id}` : "Walk-in"}</td>
                      <td className="px-4 py-3 text-[#4F5A54]">{itemSummary(d.items)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-[#17201C]">{fmtINR(d.total)}</td>
                      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {(d.status === "pending" || d.status === "conflict") && (
                            <button
                              onClick={() => printDraft(d)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D3DCD5] bg-[#FFFDF9] text-[#6F7772] transition-colors hover:border-[#AEBBB2] hover:bg-[#F1F4F0] hover:text-[#214F3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/25"
                              title="Print draft receipt"
                            >
                              <Printer size={13} />
                            </button>
                          )}
                          {d.status === "pending" && (
                            <button
                              disabled={busyId === d.id}
                              onClick={() => cancel(d.id)}
                              className="rounded-lg border border-transparent px-2 py-1.5 text-[12px] font-semibold text-[#9D4B47] transition-colors hover:border-[#E8C9C5] hover:bg-[#F9ECEA] hover:text-[#843D3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9D4B47]/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          )}
                          {d.status === "conflict" && (
                            <>
                              <button
                                disabled={busyId === d.id}
                                onClick={() => replaceItem(d)}
                                className="rounded-lg border border-transparent px-2 py-1.5 text-[12px] font-semibold text-[#214F3A] transition-colors hover:border-[#CBD8CF] hover:bg-[#EAF2ED] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Replace Item
                              </button>
                              <button
                                disabled={busyId === d.id}
                                onClick={() => recalculate(d.id)}
                                className="rounded-lg border border-transparent px-2 py-1.5 text-[12px] font-semibold text-[#8A651E] transition-colors hover:border-[#EAD8B2] hover:bg-[#FBF4E3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8A651E]/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Recalculate
                              </button>
                              <button
                                disabled={busyId === d.id}
                                onClick={() => cancel(d.id)}
                                className="rounded-lg border border-transparent px-2 py-1.5 text-[12px] font-semibold text-[#9D4B47] transition-colors hover:border-[#E8C9C5] hover:bg-[#F9ECEA] hover:text-[#843D3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9D4B47]/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {d.status === "conflict" && d.conflict_reason && (
                      <tr key={`${d.id}-reason`} className="border-b border-[#E8C9C5] bg-[#F9ECEA]">
                        <td colSpan={6} className="px-4 py-2.5 text-[12px] font-medium leading-5 text-[#843D3A]">
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
