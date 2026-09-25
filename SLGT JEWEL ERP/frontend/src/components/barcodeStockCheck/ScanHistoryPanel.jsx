import { History } from "lucide-react";

const RESULT_META = {
  matched: { label: "Matched", cls: "chip chip-success" },
  already_completed: { label: "Warning", cls: "chip chip-warning" },
  not_found: { label: "Not Found", cls: "chip chip-danger" },
};

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour12: false });
}

export default function ScanHistoryPanel({ items }) {
  return (
    <div className="card !rounded-xl !border-[#E2E7E2] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(23,56,42,0.04)]">
      <div className="text-[12px] font-semibold text-[#17201C] mb-3 flex items-center gap-2">
        <History size={14} strokeWidth={1.5} className="text-[#214F3A]" />
        Recent Scan Activity
      </div>
      <div className="max-h-[420px] overflow-y-auto -mx-2">
        {(!items || items.length === 0) ? (
          <div className="text-[12px] text-[#89928C] px-2 py-6 text-center">No scans yet</div>
        ) : (
          <table className="w-full">
            <tbody>
              {items.map((h) => {
                const meta = RESULT_META[h.result] || RESULT_META.not_found;
                return (
                  <tr key={h.id} className="border-b border-[#E2E7E2] last:border-0 hover:bg-[#F7F9F6] transition-colors">
                    <td className="py-2 px-2 text-[11px] text-[#89928C] font-mono whitespace-nowrap">{fmtTime(h.created_at)}</td>
                    <td className="py-2 px-2">
                      <div className="text-[12px] font-mono text-[#17201C]">{h.barcode}</div>
                      {h.item_name && <div className="text-[10.5px] text-[#6F7772] truncate max-w-[140px]">{h.item_name}</div>}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <span className={`${meta.cls} text-[10px]`}>{meta.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
