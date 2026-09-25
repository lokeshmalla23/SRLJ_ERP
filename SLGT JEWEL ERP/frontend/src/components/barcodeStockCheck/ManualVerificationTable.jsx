import { fmtWeight } from "@/lib/format";

export default function ManualVerificationTable({ data, loading }) {
  const items = data?.items || [];

  if (!loading && items.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="text-[13px] font-semibold text-[#0A0A0A] mb-1">Items Requiring Manual Verification</div>
      <p className="text-[12px] text-[#737373] mb-3">
        Stock with no barcode cannot be scanned — physically count these separately.
      </p>
      <div className="table-shell overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="table-head-row">
              <th className="table-th">Item</th>
              <th className="table-th">Category</th>
              <th className="table-th">Purity</th>
              <th className="table-th text-right">Quantity</th>
              <th className="table-th text-right">Gross Wt</th>
              <th className="table-th text-right">Net Wt</th>
              <th className="table-th">Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.product_id} className="table-row">
                <td className="table-td text-[13px] font-medium text-[#0A0A0A]">{r.item_name || "—"}</td>
                <td className="table-td text-[12.5px] text-[#525252]">{r.category_name || "—"}</td>
                <td className="table-td text-[12.5px] text-[#525252]">{r.purity_name || "—"}</td>
                <td className="table-td text-right font-mono text-[12.5px]">{r.quantity}</td>
                <td className="table-td text-right font-mono text-[12.5px]">{fmtWeight(r.gross_weight)}</td>
                <td className="table-td text-right font-mono text-[12.5px]">{fmtWeight(r.net_weight)}</td>
                <td className="table-td"><span className="chip chip-neutral">{r.reason}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
