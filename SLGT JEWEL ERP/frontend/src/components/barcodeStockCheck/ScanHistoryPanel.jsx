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
    <div className="card">
      <div className="text-[12px] font-semibold text-[#0A0A0A] mb-3 flex items-center gap-2">
        <History size={14} strokeWidth={1.5} className="text-[#737373]" />
        Recent Scan Activity
      </div>
      <div className="max-h-[420px] overflow-y-auto -mx-2">
        {(!items || items.length === 0) ? (
          <div className="text-[12px] text-[#a3a3a3] px-2 py-6 text-center">No scans yet</div>
        ) : (
          <table className="w-full">
            <tbody>
              {items.map((h) => {
                const meta = RESULT_META[h.result] || RESULT_META.not_found;
                return (
                  <tr key={h.id} className="border-b border-[#F4F4F5] last:border-0">
                    <td className="py-2 px-2 text-[11px] text-[#a3a3a3] font-mono whitespace-nowrap">{fmtTime(h.created_at)}</td>
                    <td className="py-2 px-2">
                      <div className="text-[12px] font-mono text-[#0A0A0A]">{h.barcode}</div>
                      {h.item_name && <div className="text-[10.5px] text-[#737373] truncate max-w-[140px]">{h.item_name}</div>}
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
